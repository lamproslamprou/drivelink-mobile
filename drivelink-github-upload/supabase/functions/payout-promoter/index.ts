// POST /payout-promoter
// Admin-only, gated by the ADMIN_EMAILS secret (see helpers.ts). Replaces the
// "record it happened externally" flow in recordPayout() with a real Stripe
// transfer when the promoter has a connected account set up (same Connect
// account type as sellers — a user can be both). Falls back gracefully: if
// the promoter hasn't set up payouts yet, the frontend keeps using the old
// manual/external recording path instead of calling this function.
import { corsHeaders, isAdminEmail, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { user_id, amount, note } = await req.json();
    if (!user_id || !amount || amount <= 0) throw new Error("user_id and a positive amount are required");

    const supabase = supabaseAdmin();
    const stripe = stripeClient();

    const { data: caller } = await supabase.from("users").select("email").eq("id", callerId).single();
    if (!isAdminEmail(caller?.email)) throw new Error("Not authorized to issue payouts");

    const { data: promoter, error: promoterErr } = await supabase
      .from("users")
      .select("id, name, balance, stripe_account_id, stripe_payouts_enabled")
      .eq("id", user_id)
      .single();
    if (promoterErr || !promoter) throw new Error("Promoter not found");
    if (!promoter.stripe_payouts_enabled || !promoter.stripe_account_id) {
      throw new Error("This promoter hasn't set up Stripe payouts — use the manual record-payout flow instead");
    }
    if (amount > (promoter.balance || 0)) throw new Error("Amount exceeds promoter's tracked balance");

    const amountCents = Math.round(Number(amount) * 100);

    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: promoter.stripe_account_id,
      transfer_group: `promoter_payout_${promoter.id}_${Date.now()}`,
    });

    const row = {
      id: "po" + Date.now(),
      user_id: promoter.id,
      amount,
      method: "Stripe",
      note: note || null,
      stripe_transfer_id: transfer.id,
    };
    const { error: insertErr } = await supabase.from("payouts").insert(row);
    if (insertErr) throw new Error(`Transfer succeeded but failed to record payout row: ${insertErr.message}`);

    await supabase
      .from("users")
      .update({ balance: (promoter.balance || 0) - amount })
      .eq("id", promoter.id);

    return jsonResponse({ transferred: amount, transferId: transfer.id });
  } catch (err) {
    console.error("payout-promoter error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
