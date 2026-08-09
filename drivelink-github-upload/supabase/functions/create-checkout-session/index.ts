// POST /create-checkout-session
// Called when a buyer clicks "Buy Now" on a listing. Creates a real Stripe
// Checkout session at the listing's asking price. Funds land on the
// PLATFORM's Stripe balance first (separate-charges-and-transfers, not a
// destination charge) — that's what makes the hold-then-release flow work.
// The seller is paid out later by release-funds or auto-release-cron.
import { corsHeaders, jsonResponse, PROMOTER_FEE, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

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
      .select("id, make, model, year, price, seller_id, status, is_private, buyer_id, handover_date")
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

    // ── Buyer identity on the Stripe side ────────────────────────────────────
    // Without this, Checkout collects an email itself and the payment shows up
    // as a "Guest" customer with no link back to the DriveLink account that
    // made it. That is fine until something goes wrong: on a refund, dispute,
    // or chargeback the first question is who paid, and the answer was buried
    // in session metadata rather than on the customer record. Prefilling the
    // buyer's own email also spares them retyping it.
    //
    // Read server-side from the users table, never from the request body — the
    // client could otherwise attach someone else's address to a payment.
    const { data: buyer, error: buyerErr } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", buyerId)
      .single();
    if (buyerErr) console.error("buyer lookup failed:", buyerId, buyerErr);
    const buyerEmail = typeof buyer?.email === "string" && buyer.email.includes("@")
      ? buyer.email
      : undefined;

    // ── Promoter attribution ────────────────────────────────────────────────────
    // Two shapes reach this point.
    //
    // MARKETPLACE. The client sends whatever share_code it stored when the
    // buyer arrived via a /s/:code link. That value is fully under the buyer's
    // control, so it is never written as-is: it has to name a real PENDING
    // referral on THIS listing. Anything that doesn't verify is dropped and the
    // sale is recorded as organic — an unverifiable code should cost nobody a
    // commission, and should never let a buyer redirect one to an account of
    // their choosing.
    //
    // BYOD. Nothing is read from the request at all. create-deal already wrote
    // the referral server-side when the deal was created, keyed on the invite
    // token, from a code the initiator's browser was carrying. The buyer at
    // checkout cannot influence it. This used to be blocked outright on the
    // grounds that "nobody referred a car the two parties found themselves" —
    // true of a shared listing, false of a broker who sent both parties here.
    let attributedCode: string | null = null;
    let attributedPromoterId: string | null = null;
    let dealCreatorRole: string | null = null;

    if (listing.is_private) {
      const { data: invite, error: inviteErr } = await supabase
        .from("deal_invites")
        .select("token, creator_role")
        .eq("listing_id", listing_id)
        .maybeSingle();

      if (inviteErr) {
        console.error("deal_invites lookup failed at checkout:", listing_id, inviteErr);
      } else if (invite?.token) {
        dealCreatorRole = invite.creator_role ?? null;

        const { data: ref, error: refErr } = await supabase
          .from("referrals")
          .select("id, promoter_id, share_code")
          .eq("deal_id", invite.token)
          .eq("status", "pending")
          .maybeSingle();

        if (refErr) {
          console.error("BYOD referral lookup failed:", invite.token, refErr);
        } else if (ref) {
          if (ref.promoter_id === buyerId || ref.promoter_id === listing.seller_id) {
            // Neither party to the deal can earn on it.
            console.log("self-referral ignored on deal:", ref.share_code, invite.token);
          } else {
            // Stays null: BYOD referral rows carry no share_code (see
            // create-deal for why). Do NOT be tempted to fill this from
            // promoter_codes — listings.referral_code is matched against
            // referrals.share_code in settleReferral, so a stamped code with a
            // null share_code returns "attributed_not_pending" and pays the
            // broker nothing. With one referral per deal, settlement's
            // single-candidate path resolves it correctly.
            attributedCode = ref.share_code;
            attributedPromoterId = ref.promoter_id;
          }
        }
      }
    } else if (
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
          // A Promoter buying through their own link earns nothing. Record no
          // attribution rather than creating a self-referral to be flagged later.
          console.log("self-referral ignored at checkout:", ref.share_code, buyerId);
        } else {
          attributedCode = ref.share_code;
          attributedPromoterId = ref.promoter_id;
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

    // Both listings.price and offers.amount are CENTS as of migration
    // 20260803_05_money_to_cents, and Stripe wants cents, so this is a
    // straight pass-through. The previous `* 100` here would now send Stripe
    // one hundred times the asking price on a real card.
    const priceCents = acceptedOffer ? Number(acceptedOffer.amount) : Number(listing.price);
    if (!Number.isFinite(priceCents) || priceCents < 50) {
      // Stripe's minimum charge is 50 cents. A listing priced below that is
      // either mispriced or a units bug — fail loudly rather than charge.
      throw new Error("This listing's price is not valid for checkout");
    }

    // ── Who pays the Promoter's 1% ──────────────────────────────────────────
    // Whoever STARTED the deal pays it, additively. They are the one who chose
    // to come through a broker, so the cost lands on them rather than on a
    // counterparty who never met that broker.
    //
    //   buyer-initiated  → added to the charge. The buyer pays price + 1%, and
    //                      the seller's proceeds are untouched.
    //   seller-initiated → nothing added here. The webhook deducts it from the
    //                      seller's net instead, exactly as a marketplace sale
    //                      has always worked.
    //
    // Marketplace sales never reach the first branch: dealCreatorRole is only
    // set for private deals, so promoterSurcharge stays 0 and the arithmetic is
    // bit-for-bit what it was before this existed.
    const buyerPaysPromoter = attributedPromoterId !== null && dealCreatorRole === "buyer";
    const promoterSurcharge = buyerPaysPromoter ? Math.round(priceCents * PROMOTER_FEE) : 0;
    // ── Handover date ────────────────────────────────────────────────────────
    // The day the seller hands the car over. Read from the LISTING, server-side,
    // never from the request body — same rule as buyerEmail above. A buyer who
    // could post their own handover_date could push the seller's payout months
    // out; a seller who could post one at checkout could pull it forward.
    //
    // This is what anchors the escrow clock. stripe-webhook sets
    // auto_release_at to the later of (payment + 7d) and (handover + 7d), so
    // unconfirmed sale escalates to manual review (NOT to payment — see
    // auto-release-cron). Null
    // means immediate handover, which is the overwhelming majority of sales and
    // behaves exactly as it always has.
    //
    // Dates already in the past are ignored rather than rejected: a seller who
    // set "next Tuesday" three weeks ago and never updated it should not have
    // their sale blocked at the payment screen. The webhook's max() means an
    // ignored date costs nothing — the clock just falls back to payment + 7d.
    const HANDOVER_MAX_DAYS = 90;
    let handoverDate: string | null = null;

    if (typeof listing.handover_date === "string" && listing.handover_date.length > 0) {
      const parsed = new Date(`${listing.handover_date}T12:00:00Z`);
      const daysOut = Math.round((parsed.getTime() - Date.now()) / 86_400_000);

      if (!Number.isFinite(parsed.getTime())) {
        console.error("unparseable handover_date on listing:", listing.id, listing.handover_date);
      } else if (daysOut > HANDOVER_MAX_DAYS) {
        // Not a delayed car sale — something needs a human. Better to fail at
        // the payment screen than to lock a buyer's money up for a quarter.
        throw new Error(
          `This listing's handover date is more than ${HANDOVER_MAX_DAYS} days away. ` +
          `Ask the seller to update it before purchasing.`,
        );
      } else if (daysOut > 0) {
        handoverDate = listing.handover_date;
      }
    }

    // Rendered on Stripe's own payment screen, not just ours. A buyer agreeing
    // to escrow terms on the seller's website is weaker consent than one who
    // saw them on the page where the card was actually charged — this is the
    // page a dispute gets argued over.
    //
    // CHANGED 2026-08-06. This previously promised release "7 days after
    // handover", which stopped being true the moment auto-release-cron was
    // rewritten: nothing pays out on a timer any more. Leaving the old wording
    // on the Stripe payment screen would have been a written commitment, shown
    // at the point of payment, that the backend no longer honours.
    //
    // It now also renders on EVERY sale, not only delayed-handover ones. The
    // handover code is how funds move in all cases, so every buyer needs to
    // know they hold it before they hand over money.
    const escrowNotice =
      (handoverDate
        ? `The seller hands over this vehicle on ${new Date(`${handoverDate}T12:00:00Z`)
            .toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}. `
        : "") +
      (promoterSurcharge > 0
        ? `This total includes a 1% referral fee paid to the broker who referred you. `
        : "") +
      `DriveLink holds your payment — the seller is not paid at checkout. ` +
      `You'll get a 6-digit handover code. Give it to the seller only after the vehicle and the signed title are in your hands; ` +
      `entering it releases the funds. You can also confirm receipt yourself in the app, or report a problem instead. ` +
      `Nothing is released automatically.`;

    const origin = req.headers.get("origin") ?? "https://drivelink.deals";
    const label = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || "DriveLink vehicle purchase";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      // Prefills Checkout and stamps the payment with a real address rather
      // than leaving it as an anonymous guest.
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      // Creates a persistent Stripe Customer from that email, so repeat
      // purchases by the same person group together in the dashboard.
      customer_creation: "always",
      // Two line items rather than one inflated total. The buyer already saw
      // this split on the deal screen; hiding it on the payment page is where
      // a surprise fee turns into a chargeback.
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: priceCents,
            product_data: { name: label },
          },
          quantity: 1,
        },
        ...(promoterSurcharge > 0
          ? [{
            price_data: {
              currency: "usd",
              unit_amount: promoterSurcharge,
              product_data: { name: "Referral fee (1%)" },
            },
            quantity: 1,
          }]
          : []),
      ],
      // No transfer_data/on_behalf_of on purpose — funds stay on the
      // platform balance until release-funds explicitly transfers them.
      metadata: {
        listing_id: String(listing.id),
        buyer_id: buyerId,
        seller_id: String(listing.seller_id),
        // Read back by stripe-webhook to anchor auto_release_at. Empty string
        // rather than omitted: Stripe metadata values must be strings, and the
        // webhook's regex test treats "" as absent.
        handover_date: handoverDate ?? "",
        // Mirrored into Stripe so attribution is visible in the dashboard and
        // survives a webhook replay even if the listings row is later touched.
        referral_code: attributedCode ?? "",
        // What the CAR sold for, independent of what was charged. The webhook
        // computes every fee from this, not from amount_total — otherwise a
        // referral surcharge would inflate both fees and get deducted from the
        // seller on top of the buyer having already paid it.
        agreed_price: String(priceCents),
        // How much of the charge was the referral surcharge. "0" means the
        // seller is paying the commission out of proceeds.
        promoter_surcharge: String(promoterSurcharge),
      },
      custom_text: { submit: { message: escrowNotice.slice(0, 1200) } },
      // Copied onto the PaymentIntent as well as the session. Refunds and
      // disputes surface from the payment, not the checkout session, so
      // without this the buyer link is missing exactly where it's needed.
      payment_intent_data: {
        metadata: {
          listing_id: String(listing.id),
          buyer_id: buyerId,
          seller_id: String(listing.seller_id),
        },
        description: `DriveLink — ${label}`,
      },
      success_url: `${origin}/?purchase=success&listing=${listing.id}`,
      cancel_url: `${origin}/?purchase=cancelled&listing=${listing.id}`,
    });

    // Stamp the session and the attributed Promoter code together. referral_code is
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
