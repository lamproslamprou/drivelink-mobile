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
//
// ── ATTRIBUTION (fixed 2026-09-19) ──────────────────────────────────────────
// A marketplace referral row (share_code set) only means a Promoter SHARED the
// car. It is not evidence the buyer came through them. Until 2026-09-19 this
// function paid the sole pending referral on a listing whenever
// listings.referral_code was empty — so an admin marking a car sold off-platform
// paid a Promoter whose link the buyer never used (Cadence / Mustang
// l1782940413026, reversed by hand). Now:
//   - share_code rows pay ONLY when listings.referral_code matches them;
//   - share_code NULL rows (BYOD — written by create-deal only when a buyer
//     actually arrived via a code) keep the single-candidate fallback.
import { corsHeaders, jsonResponse, requireUser, supabaseAdmin, todayET } from "../_shared/helpers.ts";

// Promoters are paid a flat bounty (promoter_bounties), never a percentage of a
// sale. Kept as a constant so the commission below resolves to 0 and these
// rows settle without crediting anything.
const PROMOTER_FEE = 0;

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
    const { data: claimed, error: claimErr } = await supabase
      .from("listings")
      .update({ status: "sold", confirmed_at: new Date().toISOString() })
      .eq("id", listing.id)
      .is("confirmed_at", null)
      .select("id");

    if (claimErr) throw claimErr;

    if (!claimed || claimed.length === 0) {
      console.log("confirm-manual-sale: lost the confirm race, no-op:", listing.id);
      return jsonResponse({ alreadyConfirmed: true });
    }

    // ── Resolve which Promoter earned this, same rules as settleReferral ──────
    const { data: pendingRefs, error: refsErr } = await supabase
      .from("referrals")
      .select("id, promoter_id, share_code")
      .eq("listing_id", listing.id)
      .eq("status", "pending");

    if (refsErr) {
      console.error("referral lookup failed for listing:", listing.id, refsErr);
    }

    const refs = (pendingRefs ?? []) as Array<{ id: string; promoter_id: string; share_code: string | null }>;
    const commission = Math.round(Number(listing.sale_price || 0) * PROMOTER_FEE);
    let referralOutcome = "none";

    let ref: { id: string; promoter_id: string; share_code: string | null } | null = null;
    let ambiguousIds: string[] = [];

    if (listing.referral_code) {
      ref = refs.find(
        (r) => (r.share_code ?? "").toUpperCase() === String(listing.referral_code).toUpperCase(),
      ) ?? null;
      if (!ref) console.warn("attributed referral not pending:", listing.referral_code, listing.id);
    } else {
      // No buyer attribution recorded. A share-link row alone is not proof the
      // buyer used it, so only BYOD rows (share_code NULL) are candidates.
      const byod = refs.filter((r) => !r.share_code);
      if (byod.length === 1) ref = byod[0];
      else if (byod.length > 1) ambiguousIds = byod.map((r) => r.id);
    }

    if (ambiguousIds.length) {
      await supabase
        .from("referrals")
        .update({ status: "flagged", commission_amount: commission })
        .in("id", ambiguousIds);
      referralOutcome = "flagged_ambiguous";
      console.warn("ambiguous referral on listing:", listing.id, ambiguousIds.length, "competing promoters");
    } else if (ref) {
      if (ref.promoter_id === listing.buyer_id) {
        await supabase
          .from("referrals")
          .update({ status: "flagged", commission_amount: commission })
          .eq("id", ref.id);
        referralOutcome = "flagged_self_referral";
      } else {
        const { data: paidRef, error: payErr } = await supabase
          .from("referrals")
          .update({ status: "paid", commission_amount: commission, paid_at: todayET() })
          .eq("id", ref.id)
          .eq("status", "pending")
          .select("id");

        if (payErr) throw payErr;

        if (!paidRef || paidRef.length === 0) {
          console.warn("referral already settled, skipping credit:", ref.id, listing.id);
          referralOutcome = "already_settled";
        } else {
          const { error: creditErr } = await supabase.rpc("increment_user_balance", {
            p_user_id: ref.promoter_id,
            p_amount: commission,
          });

          if (creditErr) {
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
