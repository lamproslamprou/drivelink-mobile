// POST /release-funds
// Called when the buyer clicks "Confirm Receipt" (replaces the old direct
// Supabase update in confirmReceipt()), or by auto-release-cron after 7 days
// with no confirmation and no dispute. Transfers the seller's net proceeds
// (already computed and stored on the listing by the webhook) out of the
// platform's Stripe balance into the seller's connected account, and — if a
// referral is attributed — marks it paid and credits the promoter's balance.
//
// The platform fee is never transferred anywhere: it's the portion of the
// original charge left behind on the platform's Stripe balance once the
// seller's transfer goes out. That balance pays out to whatever bank account
// is set in Stripe Dashboard → Settings → Payouts (Mercury).
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

const PROMOTER_FEE = 0.01; // 1% promoter commission

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const callerId = await requireUser(req);
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");
    const supabase = supabaseAdmin();
    const stripe = stripeClient();
    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, seller_id, buyer_id, status, funds_released, seller_net, sale_price, referral_code")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");
    // Only the actual buyer can manually release funds — the cron job
    // bypasses this by calling with the service role, not a user token.
    if (listing.buyer_id !== callerId) {
      throw new Error("Only the buyer can confirm receipt for this listing");
    }
    if (listing.status !== "pending_confirmation") {
      throw new Error("This listing isn't awaiting fund release");
    }
    if (listing.funds_released) {
      return jsonResponse({ alreadyReleased: true });
    }
    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller?.stripe_account_id) throw new Error("Seller has no connected account");
    const sellerNetCents = Math.round(Number(listing.seller_net) * 100);
    const transfer = await stripe.transfers.create({
      amount: sellerNetCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: `listing_${listing.id}`,
    });
    await supabase
      .from("listings")
      .update({
        status: "sold",
        confirmed_at: new Date().toISOString(),
        funds_released: true,
        stripe_transfer_id: transfer.id,
      })
      .eq("id", listing.id);

    // ── Resolve which Scout earned this commission ───────────────────────────
    // listings.referral_code is written at checkout from the buyer's stored
    // attribution, after being validated against a real pending referral. It
    // names one specific Scout, so it wins whenever it's present.
    //
    // Fetch ALL pending referrals rather than using .maybeSingle(): a listing
    // shared by several Scouts returns multiple rows, and maybeSingle() errors
    // on that. Because the old code discarded the error and only read `data`,
    // a contested listing silently paid nobody at all.
    const { data: pendingRefs, error: refsErr } = await supabase
      .from("referrals")
      .select("id, promoter_id, share_code")
      .eq("listing_id", listing.id)
      .eq("status", "pending");

    if (refsErr) {
      // The seller has already been paid at this point, so never throw here —
      // that would surface as a failed release to the buyer. Log for follow-up.
      console.error("referral lookup failed for listing:", listing.id, refsErr);
    }

    const refs = pendingRefs ?? [];
    const commission = Math.round(Number(listing.sale_price) * PROMOTER_FEE);
    let referralOutcome: string = "none";

    let ref: { id: string; promoter_id: string; share_code: string } | null = null;
    let ambiguous = false;

    if (listing.referral_code) {
      ref = refs.find(
        (r) => (r.share_code ?? "").toUpperCase() === String(listing.referral_code).toUpperCase(),
      ) ?? null;
      if (!ref) {
        // Attribution was recorded but the referral is gone or already settled.
        console.warn("attributed referral not pending:", listing.referral_code, listing.id);
      }
    } else if (refs.length === 1) {
      ref = refs[0]; // only one candidate — nothing to guess between
    } else if (refs.length > 1) {
      ambiguous = true; // several Scouts shared this car, no attribution recorded
    }

    if (ambiguous) {
      // Never pick arbitrarily and never pay everyone. Flag them all so the
      // admin Approve/Deny UI can settle it against the real evidence.
      await supabase
        .from("referrals")
        .update({ status: "flagged", commission_amount: commission })
        .in("id", refs.map((r) => r.id));
      referralOutcome = "flagged_ambiguous";
      console.warn("ambiguous referral on listing:", listing.id, refs.length, "competing scouts");
    } else if (ref) {
      // Self-dealing check: a promoter buying through their own referral link
      // should never earn a commission. Flag for admin review instead of
      // transferring money automatically.
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
        const { data: promoter } = await supabase.from("users").select("balance").eq("id", ref.promoter_id).single();
        await supabase
          .from("users")
          .update({ balance: (Number(promoter?.balance) || 0) + commission })
          .eq("id", ref.promoter_id);
        referralOutcome = "paid";
      }
    }

    return jsonResponse({
      transferred: sellerNetCents / 100,
      transferId: transfer.id,
      referral: referralOutcome,
    });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
