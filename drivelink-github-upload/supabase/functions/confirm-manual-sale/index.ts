// POST /confirm-manual-sale
// Finalises a sale that never went through Stripe Checkout — an off-platform or
// cash sale entered by an admin via markSold, which has no payment_intent and
// therefore nothing for release-funds to transfer.
//
// This used to run in the browser inside confirmReceipt(): it flipped the
// listing to sold, marked the referral paid, and incremented users.balance
// directly. A client that can write users.balance can write itself any balance,
// so that path only worked because of an over-permissive RLS policy. It lives
// here now, behind the service role.
//
// Callable by the listing's buyer, or by an admin on their behalf.
import { corsHeaders, jsonResponse, requireUser, supabaseAdmin } from "../_shared/helpers.ts";

const PROMOTER_FEE = 0.01; // 1% promoter commission

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const supabase = supabaseAdmin();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, seller_id, buyer_id, status, sale_price, referral_code, stripe_payment_intent_id, confirmed_at")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Anything with a real charge behind it belongs to release-funds, which
    // moves actual money. Refuse rather than silently doing half the job.
    if (listing.stripe_payment_intent_id) {
      throw new Error("This sale went through Stripe — use release-funds instead");
    }
    if (listing.status !== "pending_confirmation") {
      throw new Error("This listing isn't awaiting confirmation");
    }

    const { data: caller } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", callerId)
      .single();
    const isAdmin = caller?.role === "admin";

    if (listing.buyer_id !== callerId && !isAdmin) {
      throw new Error("Only the buyer can confirm receipt for this listing");
    }

    // Idempotency: this is called from a button, and a double-tap must not
    // credit a commission twice.
    if (listing.confirmed_at) {
      return jsonResponse({ alreadyConfirmed: true });
    }

    await supabase
      .from("listings")
      .update({ status: "sold", confirmed_at: new Date().toISOString() })
      .eq("id", listing.id)
      .is("confirmed_at", null); // no-op if another request got here first

    // ── Resolve which Scout earned this, same rules as release-funds ──────────
    const { data: pendingRefs, error: refsErr } = await supabase
      .from("referrals")
      .select("id, promoter_id, share_code")
      .eq("listing_id", listing.id)
      .eq("status", "pending");

    if (refsErr) {
      console.error("referral lookup failed for listing:", listing.id, refsErr);
    }

    const refs = pendingRefs ?? [];
    const commission = Math.round(Number(listing.sale_price || 0) * PROMOTER_FEE);
    let referralOutcome = "none";

    let ref: { id: string; promoter_id: string; share_code: string } | null = null;
    let ambiguous = false;

    if (listing.referral_code) {
      ref = refs.find(
        (r) => (r.share_code ?? "").toUpperCase() === String(listing.referral_code).toUpperCase(),
      ) ?? null;
      if (!ref) console.warn("attributed referral not pending:", listing.referral_code, listing.id);
    } else if (refs.length === 1) {
      ref = refs[0];
    } else if (refs.length > 1) {
      ambiguous = true;
    }

    if (ambiguous) {
      await supabase
        .from("referrals")
        .update({ status: "flagged", commission_amount: commission })
        .in("id", refs.map((r) => r.id));
      referralOutcome = "flagged_ambiguous";
      console.warn("ambiguous referral on listing:", listing.id, refs.length, "competing scouts");
    } else if (ref) {
      if (ref.promoter_id === listing.buyer_id) {
        await supabase
          .from("referrals")
          .update({ status: "flagged", commission_amount: commission })
          .eq("id", ref.id);
        referralOutcome = "flagged_self_referral";
      } else {
        await supabase
          .from("referrals")
          .update({ status: "paid", commission_amount: commission, paid_at: new Date().toISOString().slice(0, 10) })
          .eq("id", ref.id);

        const { data: promoter } = await supabase
          .from("users")
          .select("balance")
          .eq("id", ref.promoter_id)
          .single();

        await supabase
          .from("users")
          .update({ balance: (Number(promoter?.balance) || 0) + commission })
          .eq("id", ref.promoter_id);

        referralOutcome = "paid";
      }
    }

    return jsonResponse({ confirmed: true, referral: referralOutcome, commission });
  } catch (err) {
    console.error("confirm-manual-sale error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
