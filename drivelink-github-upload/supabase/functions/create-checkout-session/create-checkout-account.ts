// POST /create-checkout-session
// Called when a buyer clicks "Buy" on a listing. Creates a Stripe Checkout
// session. Funds land on the PLATFORM's Stripe balance first (this is a
// separate-charges-and-transfers setup, not a destination charge) — that's
// what makes the hold-then-release escrow flow possible. The seller is paid
// out later by release-funds or auto-release-cron, not by Stripe directly.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const buyerId = await requireUser(req);
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const stripe = stripeClient();
    const supabase = supabaseAdmin();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, title, price, seller_id, status, referred_by_scout_id")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");
    if (listing.status !== "active") throw new Error("This listing is no longer available");
    if (listing.seller_id === buyerId) throw new Error("You can't buy your own listing");

    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id, stripe_payouts_enabled")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller) throw new Error("Seller not found");
    if (!seller.stripe_payouts_enabled) {
      throw new Error("This seller hasn't finished setting up payouts yet");
    }

    const priceCents = Math.round(Number(listing.price) * 100);
    const origin = req.headers.get("origin") ?? "https://drivelink.deals";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: priceCents,
            product_data: { name: listing.title ?? "DriveLink vehicle purchase" },
          },
          quantity: 1,
        },
      ],
      // No `transfer_data` / `on_behalf_of` here on purpose — funds stay on
      // the platform balance until release-funds explicitly transfers them.
      metadata: {
        listing_id: String(listing.id),
        buyer_id: buyerId,
        seller_id: String(listing.seller_id),
        scout_id: listing.referred_by_scout_id ? String(listing.referred_by_scout_id) : "",
      },
      success_url: `${origin}/listing/${listing.id}?purchase=success`,
      cancel_url: `${origin}/listing/${listing.id}?purchase=cancelled`,
    });

    await supabase
      .from("listings")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", listing.id);

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
