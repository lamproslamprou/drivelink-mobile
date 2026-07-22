// POST /release-funds
// Called when the buyer clicks "Confirm I received the car" (or by
// auto-release-cron after 7 days with no dispute). Transfers the seller's
// net proceeds — price minus platform fee minus Scout fee — out of the
// platform's Stripe balance into the seller's connected account.
//
// The platform fee is never transferred anywhere: it's simply the portion
// of the original charge that's left behind on the platform's own Stripe
// balance once the seller's transfer goes out. That balance pays out to
// whatever bank account is set in Stripe Dashboard → Settings → Payouts.
import {
  corsHeaders,
  jsonResponse,
  requireUser,
  stripeClient,
  supabaseAdmin,
  PLATFORM_FEE,
  SCOUT_FEE,
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
      .select("id, price, seller_id, buyer_id, status, funds_released, referred_by_scout_id")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Only the actual buyer can manually release funds — the cron job below
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

    const priceCents = Math.round(Number(listing.price) * 100);
    const feeRate = listing.referred_by_scout_id ? PLATFORM_FEE + SCOUT_FEE : PLATFORM_FEE;
    const sellerNetCents = Math.round(priceCents * (1 - feeRate));

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
        funds_released: true,
        stripe_transfer_id: transfer.id,
      })
      .eq("id", listing.id);

    return jsonResponse({ transferred: sellerNetCents / 100, transferId: transfer.id });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
