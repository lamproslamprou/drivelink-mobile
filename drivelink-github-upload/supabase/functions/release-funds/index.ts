// POST /release-funds
// Called when the buyer clicks "Confirm Receipt" (replaces the old direct
// Supabase update in confirmReceipt()), or by auto-release-cron after 7 days
// with no confirmation and no dispute. Transfers the seller's net proceeds
// (already computed and stored on the listing by the webhook) out of the
// platform's Stripe balance into the seller's connected account, and — if a
// referral is attached — marks it paid and credits the promoter's balance,
// exactly like the existing confirmReceipt() did, just now paired with an
// actual Stripe transfer for the seller side.
//
// The platform fee is never transferred anywhere: it's the portion of the
// original charge left behind on the platform's Stripe balance once the
// seller's transfer goes out. That balance pays out to whatever bank account
// is set in Stripe Dashboard → Settings → Payouts (Mercury).
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

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
      .select("id, seller_id, buyer_id, status, funds_released, seller_net, sale_price")
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

    // Same referral-payout behavior as the existing confirmReceipt() —
    // credit the promoter's balance if one is attached to this listing.
    const { data: ref } = await supabase
      .from("referrals")
      .select("id, promoter_id")
      .eq("listing_id", listing.id)
      .eq("status", "pending")
      .maybeSingle();

    if (ref) {
      const commission = Math.round(Number(listing.sale_price) * 0.01);
      await supabase
        .from("referrals")
        .update({ status: "paid", commission_amount: commission, paid_at: new Date().toISOString().slice(0, 10) })
        .eq("id", ref.id);

      const { data: promoter } = await supabase.from("users").select("balance").eq("id", ref.promoter_id).single();
      await supabase
        .from("users")
        .update({ balance: (promoter?.balance || 0) + commission })
        .eq("id", ref.promoter_id);
    }

    return jsonResponse({ transferred: sellerNetCents / 100, transferId: transfer.id });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
