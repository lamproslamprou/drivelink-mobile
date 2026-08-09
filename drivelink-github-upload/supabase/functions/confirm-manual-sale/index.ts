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
//
// ── CONCURRENCY ─────────────────────────────────────────────────────────────
// This is triggered by a button, so double-taps and simultaneous buyer/admin
// confirmations are the normal case, not the exotic one. The confirmed_at read
// near the top is only a fast path — two requests can both read null before
// either writes. Two gates do the real work, and each is a conditional update
// that reports the rows it changed:
//
//   1. listings   ... .is("confirmed_at", null).select()   — decides who wins
//   2. referrals  ... .eq("status", "pending").select()    — guards the payout
//
// Only a caller that wins gate 1 reaches gate 2, and only one that wins gate 2
// credits a balance. The balance credit itself goes through
// increment_user_balance(), which adds under a row lock instead of the old
// read-then-write that could lose a concurrent credit entirely.
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

    // ── The one write that decides who wins ─────────────────────────────────
    // The confirmed_at check above is a fast path, not a lock: two requests can
    // both read null before either writes. This update is the real gate. It is
    // conditional on confirmed_at still being null and returns the rows it
    // actually changed, so exactly one concurrent caller can see a row back.
    //
    // Everything below credits money. Previously it ran unconditionally after
    // this update, so a double-tap — or a buyer and an admin confirming at the
    // same moment — ran the referral payout twice off one sale.
    const { data: claimed, error: claimErr } = await supabase
      .from("listings")
      .update({ status: "sold", confirmed_at: new Date().toISOString() })
      .eq("id", listing.id)
      .is("confirmed_at", null)
      .select("id");

    if (claimErr) throw claimErr;

    if (!claimed || claimed.length === 0) {
      // Another request got there first and is paying the commission. Report
      // success — the caller's sale did complete — but touch nothing.
      console.log("confirm-manual-sale: lost the confirm race, no-op:", listing.id);
      return jsonResponse({ alreadyConfirmed: true });
    }

    // ── Resolve which Promoter earned this, same rules as release-funds ──────────
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
      console.warn("ambiguous referral on listing:", listing.id, refs.length, "competing promoters");
    } else if (ref) {
      if (ref.promoter_id === listing.buyer_id) {
        await supabase
          .from("referrals")
          .update({ status: "flagged", commission_amount: commission })
          .eq("id", ref.id);
        referralOutcome = "flagged_self_referral";
      } else {
        // .eq("status", "pending") is the second gate. Even if two callers
        // somehow reach here, only the one that flips the referral out of
        // "pending" gets a row back — and only that one credits the balance.
        const { data: paidRef, error: payErr } = await supabase
          .from("referrals")
          .update({ status: "paid", commission_amount: commission, paid_at: new Date().toISOString().slice(0, 10) })
          .eq("id", ref.id)
          .eq("status", "pending")
          .select("id");

        if (payErr) throw payErr;

        if (!paidRef || paidRef.length === 0) {
          console.warn("referral already settled, skipping credit:", ref.id, listing.id);
          referralOutcome = "already_settled";
        } else {
          // Atomic. The previous read-then-write here computed the new balance
          // from a value fetched over the network, so two concurrent credits
          // both added to the same starting figure and one silently vanished.
          // increment_user_balance() does the arithmetic under a row lock.
          const { error: creditErr } = await supabase.rpc("increment_user_balance", {
            p_user_id: ref.promoter_id,
            p_amount: commission,
          });

          if (creditErr) {
            // The referral is marked paid but the money never landed. That is
            // a discrepancy a human has to reconcile, so make it loud rather
            // than returning a cheerful 200.
            console.error("balance credit FAILED after marking referral paid:", ref.id, creditErr);
            throw new Error(
              `Sale confirmed and referral ${ref.id} marked paid, but crediting the promoter's ` +
              `balance failed: ${creditErr.message}. This needs manual reconciliation.`,
            );
          }

          referralOutcome = "paid";
        }
      }
    }

    return jsonResponse({ confirmed: true, referral: referralOutcome, commission });
  } catch (err) {
    console.error("confirm-manual-sale error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
