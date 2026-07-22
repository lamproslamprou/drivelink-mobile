// POST /refund-listing
// Admin-only, gated by the same users.role = 'admin' check the frontend
// uses for the Admin tab — one source of truth for who's an admin. Issues a
// real Stripe refund to the buyer and resolves the dispute — replacing the
// "remember to actually issue the refund in Stripe" manual step that used to
// sit inside resolveDispute() in App.jsx. Wired to your actual disputes
// table, not a separate status field.
//
// Only works if funds haven't already been released to the seller
// (funds_released=false) — once a transfer has gone out, recovering funds
// from the seller isn't something Stripe refunds can do; that needs manual
// seller-side recovery instead.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { dispute_id, resolution_note } = await req.json();
    if (!dispute_id) throw new Error("dispute_id is required");

    const supabase = supabaseAdmin();
    const stripe = stripeClient();

    const { data: caller } = await supabase.from("users").select("role").eq("id", callerId).single();
    if (caller?.role !== "admin") throw new Error("Not authorized to issue refunds");

    const { data: dispute, error: disputeErr } = await supabase
      .from("disputes")
      .select("id, listing_id, status")
      .eq("id", dispute_id)
      .single();
    if (disputeErr || !dispute) throw new Error("Dispute not found");
    if (dispute.status !== "open") throw new Error("This dispute isn't open");

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, funds_released, stripe_payment_intent_id")
      .eq("id", dispute.listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");
    if (listing.funds_released) {
      throw new Error("Funds already transferred to the seller — this requires manual seller-side recovery, not a refund");
    }
    if (!listing.stripe_payment_intent_id) throw new Error("No real Stripe payment found for this listing — was it a manual/off-platform sale?");

    const refund = await stripe.refunds.create({
      payment_intent: listing.stripe_payment_intent_id,
    });

    await supabase
      .from("disputes")
      .update({ status: "refunded", resolution_note: resolution_note || null, resolved_at: new Date().toISOString() })
      .eq("id", dispute.id);

    await supabase
      .from("listings")
      .update({ status: "active", sale_price: null, buyer_id: null, sold_at: null, stripe_payment_intent_id: null, stripe_checkout_session_id: null })
      .eq("id", listing.id);

    return jsonResponse({ refunded: true, refundId: refund.id });
  } catch (err) {
    console.error("refund-listing error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});