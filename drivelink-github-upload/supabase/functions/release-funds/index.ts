// POST /release-funds
// Called when the buyer clicks "Confirm Receipt", or by auto-release-cron
// after AUTO_RELEASE_DAYS with no confirmation and no dispute. Transfers the
// seller's net proceeds out of the platform's Stripe balance into the seller's
// connected account, then settles any attributed Scout referral.
//
// The platform fee is never transferred anywhere: it's the portion of the
// original charge left behind on the platform's Stripe balance once the
// seller's transfer goes out. That balance pays out to Mercury.
import {
  corsHeaders,
  jsonResponse,
  requireUser,
  settleReferral,
  stripeClient,
  supabaseAdmin,
} from "../_shared/helpers.ts";

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
      .select(
        "id, seller_id, buyer_id, status, funds_released, seller_net, sale_price, referral_code, stripe_payment_intent_id",
      )
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Compare normalized. users.id is `text`, not `uuid`, so Postgres does not
    // canonicalize these — stray whitespace or case survives storage and would
    // make a strict !== reject the legitimate buyer.
    const buyerId = String(listing.buyer_id ?? "").trim().toLowerCase();
    const caller = String(callerId ?? "").trim().toLowerCase();

    // Only the actual buyer can manually release funds — the cron job bypasses
    // this by calling with the service role, not a user token.
    if (!buyerId || buyerId !== caller) {
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
    if (sellerErr || !seller?.stripe_account_id) {
      throw new Error("Seller has no connected account");
    }

    // source_transaction: without it, the transfer draws on the platform's
    // *available* balance. Card charges take days to settle — longer on a new
    // account with a rolling reserve — so releasing before then fails with
    // `balance_insufficient`. Naming the originating charge lets Stripe
    // transfer against those specific funds while they are still pending.
    if (!listing.stripe_payment_intent_id) {
      throw new Error("Listing has no stripe_payment_intent_id — cannot release safely");
    }
    const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
    const sourceTransaction = typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id;
    if (!sourceTransaction) {
      throw new Error("No charge found on the payment intent for this listing");
    }

    const sellerNetCents = Math.round(Number(listing.seller_net) * 100);
    if (!Number.isFinite(sellerNetCents) || sellerNetCents <= 0) {
      throw new Error("Listing has no valid seller_net to transfer");
    }

    const transfer = await stripe.transfers.create({
      amount: sellerNetCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: `listing_${listing.id}`,
      source_transaction: sourceTransaction,
    }, {
      // Shared with auto-release-cron so a buyer confirming while the cron is
      // mid-run cannot produce two transfers for one sale.
      idempotencyKey: `release_${listing.id}`,
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

    // Referral settlement lives in _shared/helpers.ts so this path and
    // auto-release-cron behave identically. Never throws — the seller has
    // already been paid by the time it runs.
    const referral = await settleReferral(supabase, listing);

    return jsonResponse({
      transferred: sellerNetCents / 100,
      transferId: transfer.id,
      sourceTransaction,
      referral: referral.outcome,
    });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
