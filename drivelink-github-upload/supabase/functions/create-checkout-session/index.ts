// POST /create-checkout-session
// Called when a buyer clicks "Buy Now" on a listing. Creates a real Stripe
// Checkout session at the listing's asking price. Funds land on the
// PLATFORM's Stripe balance first (separate-charges-and-transfers, not a
// destination charge) — that's what makes the hold-then-release flow work.
// The seller is paid out later by release-funds or auto-release-cron.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const buyerId = await requireUser(req);
    const { listing_id, share_code } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const stripe = stripeClient();
    const supabase = supabaseAdmin();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, make, model, year, price, seller_id, status, is_private, buyer_id")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) {
      console.error("listing lookup failed:", listing_id, listingErr);
      throw new Error(listingErr ? `Listing lookup failed: ${listingErr.message}` : "Listing not found");
    }
    if (listing.status !== "active") throw new Error("This listing is no longer available");
    if (listing.seller_id === buyerId) throw new Error("You can't buy your own listing");

    // ── Bring-your-own-deal listings are two-party only ──────────────────────
    // buyer_id is set at join time by accept-deal-invite and is unwritable from
    // the browser (guard_listings_settlement_columns). Listing IDs are
    // l${Date.now()} and therefore guessable, so anyone else reaching this point
    // is enumerating timestamps against a private escrow. RLS already hides the
    // row from them, but this function runs with the service role key and would
    // otherwise happily open a session on someone else's deal.
    if (listing.is_private && listing.buyer_id !== buyerId) {
      throw new Error("This deal isn't available");
    }

    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id, stripe_payouts_enabled")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller) throw new Error("Seller not found");
    if (!seller.stripe_payouts_enabled) {
      throw new Error("This seller hasn't finished setting up payouts yet");
    }

    // ── Scout attribution ────────────────────────────────────────────────────
    // The client sends whatever share_code it stored when the buyer arrived via
    // a /s/:code link. That value is fully under the buyer's control, so it is
    // never written as-is: it has to name a real PENDING referral on THIS
    // listing. Anything that doesn't verify is dropped and the sale is recorded
    // as organic — an unverifiable code should cost nobody a commission, and
    // should never let a buyer redirect one to an account of their choosing.
    //
    // Private deals are never Scout-attributed: nobody referred a car the two
    // parties found themselves, and there is no listing page to share.
    let attributedCode: string | null = null;

    if (
      !listing.is_private &&
      typeof share_code === "string" &&
      share_code.length > 0 &&
      share_code.length <= 64
    ) {
      const { data: ref, error: refErr } = await supabase
        .from("referrals")
        .select("id, promoter_id, share_code")
        .eq("listing_id", listing_id)
        .eq("status", "pending")
        .ilike("share_code", share_code)
        .maybeSingle();

      if (refErr) {
        // Attribution is not worth failing a sale over — log and continue.
        console.error("referral lookup failed:", share_code, refErr);
      } else if (ref) {
        if (ref.promoter_id === buyerId) {
          // A Scout buying through their own link earns nothing. Record no
          // attribution rather than creating a self-referral to be flagged later.
          console.log("self-referral ignored at checkout:", ref.share_code, buyerId);
        } else {
          attributedCode = ref.share_code;
        }
      }
    }

    // If this buyer has an accepted offer on this listing, honor that price
    // instead of the asking price — this is the fix for the bug where an
    // accepted offer never actually changed what Checkout charged.
    const { data: acceptedOffer } = await supabase
      .from("offers")
      .select("amount")
      .eq("listing_id", listing_id)
      .eq("buyer_id", buyerId)
      .eq("status", "accepted")
      .maybeSingle();

    const finalPrice = acceptedOffer ? Number(acceptedOffer.amount) : Number(listing.price);
    const priceCents = Math.round(finalPrice * 100);
    const origin = req.headers.get("origin") ?? "https://drivelink.deals";
    const label = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || "DriveLink vehicle purchase";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: priceCents,
            product_data: { name: label },
          },
          quantity: 1,
        },
      ],
      // No transfer_data/on_behalf_of on purpose — funds stay on the
      // platform balance until release-funds explicitly transfers them.
      metadata: {
        listing_id: String(listing.id),
        buyer_id: buyerId,
        seller_id: String(listing.seller_id),
        // Mirrored into Stripe so attribution is visible in the dashboard and
        // survives a webhook replay even if the listings row is later touched.
        referral_code: attributedCode ?? "",
      },
      success_url: `${origin}/?purchase=success&listing=${listing.id}`,
      cancel_url: `${origin}/?purchase=cancelled&listing=${listing.id}`,
    });

    // Stamp the session and the attributed Scout code together. referral_code is
    // written with the service role key (RLS bypassed) — buyers must never have
    // update access to listings, or they could rewrite attribution directly.
    const listingPatch: Record<string, string> = { stripe_checkout_session_id: session.id };
    if (attributedCode) listingPatch.referral_code = attributedCode;

    await supabase
      .from("listings")
      .update(listingPatch)
      .eq("id", listing.id);

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
