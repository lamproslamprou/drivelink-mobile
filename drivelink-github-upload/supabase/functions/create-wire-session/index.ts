// POST /create-wire-session
// Companion to create-checkout-session for the domestic wire rail
// (PHASE2_WIRE_RAIL_SPEC.md §4). Called when a buyer on a high-value listing
// ($15k+, ACH_MIN_CENTS) chooses "pay by wire transfer" instead of
// card/ACH-debit checkout.
//
// Why this is a separate function rather than a branch inside
// create-checkout-session: Stripe's Customer Balance (bank transfer) flow is
// built on a bare PaymentIntent, not a Checkout Session — there is no hosted
// Stripe payment page to redirect the buyer to. This function creates and
// confirms that PaymentIntent directly and hands back the routing number,
// virtual account number, and reference code for the frontend to render in
// its own screen, plus Stripe's own hosted_instructions_url as a fallback.
//
// Mirrors create-checkout-session's auth, listing/seller/BYOD lookups,
// promoter attribution, and handover-date validation exactly — see that
// file's comments for the reasoning behind each of those checks. This file's
// comments only cover what's different about the wire path.
//
// Settlement does NOT happen here. stripe-webhook's payment_intent.succeeded
// handler (guarded on metadata.rail === "wire") is what actually settles the
// sale once the buyer's bank transfer lands — this function only starts the
// transfer and parks the listing, exactly like an ACH-debit checkout parks
// the listing in "awaiting_payment" until checkout.session.async_payment_succeeded
// fires. See stripe-webhook/index.ts for that settlement path and
// expire-stale-wires for what happens if the wire never arrives.
//
// ── STRIPE API SHAPE, VERIFIED AGAINST LIVE DOCS 2026-08-31 ─────────────────
// PHASE2_WIRE_RAIL_SPEC.md §3 described payment_method_options.customer_balance
// as `{ funding_type: "us_bank_transfer" }`. That's wrong — checked against
// Stripe's current "Accept a bank transfer" (direct API) docs before writing
// this against real Stripe with real money:
//   payment_method_options.customer_balance.funding_type = "bank_transfer"
//   payment_method_options.customer_balance.bank_transfer.type = "us_bank_transfer"
// "us_bank_transfer" nests one level deeper than the spec draft had it. Also
// confirmed: a Stripe Customer is REQUIRED on the PaymentIntent — "Bank
// transfers aren't available on PaymentIntents that don't have an associated
// customer" (Stripe docs, verbatim). There's no stripe_customer_id column on
// users, and create-checkout-session doesn't persist one either (it uses
// Checkout's customer_creation: "always", which creates a fresh Customer per
// session) — this function does the same: a new Customer per wire session,
// consistent with the rest of the codebase rather than introducing new dedup
// behavior nothing else here has.
import {
  ACH_MIN_CENTS,
  alertHtml,
  corsHeaders,
  jsonResponse,
  money,
  notifyAdmin,
  PROMOTER_FEE,
  requireUser,
  sendEmail,
  stripeClient,
  supabaseAdmin,
} from "../_shared/helpers.ts";

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

    // Same BYOD two-party guard as create-checkout-session — see that file
    // for why this can't be left to RLS alone (service-role key bypasses it).
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

    const { data: buyer, error: buyerErr } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", buyerId)
      .single();
    if (buyerErr) console.error("buyer lookup failed:", buyerId, buyerErr);
    const buyerEmail = typeof buyer?.email === "string" && buyer.email.includes("@")
      ? buyer.email
      : undefined;

    // ── Promoter attribution — identical logic to create-checkout-session ──
    // Kept as a direct copy rather than a shared helper for this build: the
    // spec (§4) suggested factoring this into _shared/helpers.ts, but doing
    // that safely means also refactoring create-checkout-session to call the
    // extracted version and re-verifying its existing, real-money behavior
    // doesn't change — a bigger and riskier change than this feature needs.
    // Flagging here rather than silently deviating from the spec's suggestion.
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
        console.error("deal_invites lookup failed at wire checkout:", listing_id, inviteErr);
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
            console.log("self-referral ignored on deal:", ref.share_code, invite.token);
          } else {
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
        console.error("referral lookup failed:", share_code, refErr);
      } else if (ref) {
        if (ref.promoter_id === buyerId) {
          console.log("self-referral ignored at wire checkout:", ref.share_code, buyerId);
        } else {
          attributedCode = ref.share_code;
          attributedPromoterId = ref.promoter_id;
        }
      }
    }

    const { data: acceptedOffer } = await supabase
      .from("offers")
      .select("amount")
      .eq("listing_id", listing_id)
      .eq("buyer_id", buyerId)
      .eq("status", "accepted")
      .maybeSingle();

    const priceCents = acceptedOffer ? Number(acceptedOffer.amount) : Number(listing.price);
    if (!Number.isFinite(priceCents) || priceCents < 50) {
      throw new Error("This listing's price is not valid for checkout");
    }

    const buyerPaysPromoter = attributedPromoterId !== null &&
      (dealCreatorRole === "buyer" || dealCreatorRole === "promoter");
    const promoterSurcharge = buyerPaysPromoter ? Math.round(priceCents * PROMOTER_FEE) : 0;

    // ── Handover date — identical parsing to create-checkout-session ───────
    const HANDOVER_MAX_DAYS = 90;
    let handoverDate: string | null = null;

    if (typeof listing.handover_date === "string" && listing.handover_date.length > 0) {
      const parsed = new Date(`${listing.handover_date}T12:00:00Z`);
      const daysOut = Math.round((parsed.getTime() - Date.now()) / 86_400_000);

      if (!Number.isFinite(parsed.getTime())) {
        console.error("unparseable handover_date on listing:", listing.id, listing.handover_date);
      } else if (daysOut > HANDOVER_MAX_DAYS) {
        throw new Error(
          `This listing's handover date is more than ${HANDOVER_MAX_DAYS} days away. ` +
          `Ask the seller to update it before purchasing.`,
        );
      } else if (daysOut > 0) {
        handoverDate = listing.handover_date;
      }
    }

    // ── High-value gate (§4) ─────────────────────────────────────────────
    // Shares ACH_MIN_CENTS with the ACH-debit gate in create-checkout-session
    // rather than a separate WIRE_MIN_CENTS — confirmed with Lampros
    // 2026-08-28 (see PHASE2_WIRE_RAIL_SPEC.md §4): arranging a wire is, if
    // anything, more friction for the buyer than linking a bank account for
    // ACH debit through Checkout, so there's no case for offering wires
    // below the point ACH debit already covers. Gated on chargedTotal (price
    // + any buyer-paid referral surcharge), same figure create-checkout-session
    // uses for achEligible, for consistency.
    const chargedTotal = priceCents + promoterSurcharge;
    if (chargedTotal < ACH_MIN_CENTS) {
      throw new Error(
        `Wire transfer is only available for purchases of ${money(ACH_MIN_CENTS)} or more.`,
      );
    }

    // ── Stripe Customer (required — see header comment) ─────────────────────
    const customer = await stripe.customers.create({
      email: buyerEmail,
      name: typeof buyer?.name === "string" ? buyer.name : undefined,
      metadata: { drivelink_user_id: buyerId },
    });

    const label = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") ||
      "DriveLink vehicle purchase";

    // ── Create + confirm the PaymentIntent ──────────────────────────────────
    // No transfer_data/on_behalf_of, same as create-checkout-session: funds
    // land on the platform balance and stay there until release-funds
    // explicitly transfers them. Metadata carries the exact same keys
    // stripe-webhook's settleSale() already reads off Checkout Session
    // metadata (agreed_price, promoter_surcharge, handover_date,
    // referral_code) — that's what makes settleSale() source-agnostic
    // between a Session and a bare PaymentIntent (§5.1). `rail: "wire"` is
    // what stripe-webhook's payment_intent.succeeded handler checks for to
    // avoid re-settling every other PaymentIntent that event also fires for.
    let pi;
    try {
      pi = await stripe.paymentIntents.create({
        amount: chargedTotal,
        currency: "usd",
        customer: customer.id,
        payment_method_types: ["customer_balance"],
        payment_method_data: { type: "customer_balance" },
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: { type: "us_bank_transfer" },
          },
        },
        confirm: true,
        description: `DriveLink — ${label}`,
        metadata: {
          listing_id: String(listing.id),
          buyer_id: buyerId,
          seller_id: String(listing.seller_id),
          handover_date: handoverDate ?? "",
          referral_code: attributedCode ?? "",
          agreed_price: String(priceCents),
          promoter_surcharge: String(promoterSurcharge),
          rail: "wire",
        },
      });
    } catch (stripeErr) {
      console.error("Stripe PaymentIntent creation failed:", stripeErr);
      throw new Error(
        stripeErr instanceof Error ? `Stripe error: ${stripeErr.message}` : "Stripe error",
      );
    }

    const nextAction = pi.next_action as
      | { type?: string; display_bank_transfer_instructions?: Record<string, unknown> }
      | null
      | undefined;
    const instructions = nextAction?.type === "display_bank_transfer_instructions"
      ? nextAction.display_bank_transfer_instructions
      : null;

    if (!instructions) {
      // Not expected on a first-time wire session, but not impossible (e.g.
      // a Customer with pre-existing balance could settle instantly). Either
      // way, stripe-webhook's payment_intent.succeeded handler is what
      // actually settles the sale — this function's job is just to start
      // the transfer and tell the buyer what to do, so log loudly and let
      // the buyer know to check email/the app rather than failing the
      // request outright (the PaymentIntent was already created).
      console.warn(
        "create-wire-session: no display_bank_transfer_instructions on PaymentIntent",
        pi.id,
        pi.status,
      );
    }

    // deno-lint-ignore no-explicit-any
    const financialAddresses = (instructions?.financial_addresses as any[]) ?? [];
    const aba = financialAddresses.find((a) => a?.type === "aba")?.aba ?? null;

    // ── Park the listing ─────────────────────────────────────────────────
    // Mirrors the ACH-debit "unpaid completion" park branch in
    // stripe-webhook (same status, same .eq("status","active") guard so a
    // redelivered/duplicate call can't re-park a listing that's already
    // moved on) — that branch runs on a Checkout Session; this is its
    // wire-native equivalent, since a wire never passes through
    // checkout.session.completed at all.
    const { data: parked, error: parkErr } = await supabase
      .from("listings")
      .update({
        status: "awaiting_payment",
        buyer_id: buyerId,
        stripe_payment_intent_id: pi.id,
        funding_type: "wire",
        payment_started_at: new Date().toISOString(),
        ...(handoverDate ? { handover_date: handoverDate } : {}),
        ...(attributedCode ? { referral_code: attributedCode } : {}),
      })
      .eq("id", listing.id)
      .eq("status", "active")
      .select("make, model, year, seller_id")
      .maybeSingle();

    if (parkErr) {
      console.error("awaiting_payment (wire) update failed:", parkErr.message, listing.id);
      throw new Error("Couldn't reserve this listing — try again.");
    }
    if (!parked) {
      // Someone else's checkout (card, ACH, or another wire session) won the
      // race between our earlier "status === active" read and this write.
      // The PaymentIntent above has already been created and confirmed —
      // cancel it so a buyer's bank doesn't get funding instructions for a
      // car that just sold out from under them.
      await stripe.paymentIntents.cancel(pi.id).catch((e) =>
        console.error("failed to cancel orphaned wire PaymentIntent:", pi.id, e)
      );
      throw new Error("This listing was just purchased by someone else.");
    }

    const carLabel = [parked.year, parked.make, parked.model].filter(Boolean).join(" ") ||
      listing.id;

    // ── Buyer + seller notice, same posture as the ACH "bank transfer
    // started" emails in stripe-webhook: the seller must not hand over the
    // vehicle against a payment that hasn't settled yet. ──────────────────
    const [{ data: buyerRow }, { data: sellerRow }] = await Promise.all([
      supabase.from("users").select("name, email").eq("id", buyerId).single(),
      parked.seller_id
        ? supabase.from("users").select("name, email").eq("id", parked.seller_id).single()
        : Promise.resolve({ data: null }),
    ]);

    if (buyerRow?.email && instructions) {
      await sendEmail({
        to: buyerRow.email,
        subject: `Wire transfer instructions for the ${carLabel}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
          <h2 style="font-size:18px;margin:0 0 14px;">Complete your wire transfer</h2>
          <p style="font-size:15px;line-height:1.55;">To pay for the <b>${carLabel}</b>, send a domestic wire transfer using the details below.</p>
          <div style="background:#FFF8E7;border:1px solid #FFB020;border-radius:8px;padding:16px;margin:20px 0;font-size:14px;line-height:1.8;">
            <div><b>Amount:</b> ${money(Number(instructions.amount_remaining ?? chargedTotal))}</div>
            ${aba?.routing_number ? `<div><b>Routing number:</b> ${aba.routing_number}</div>` : ""}
            ${aba?.account_number ? `<div><b>Account number:</b> ${aba.account_number}</div>` : ""}
            ${instructions.reference ? `<div><b>Reference (required):</b> ${instructions.reference}</div>` : ""}
          </div>
          <p style="font-size:14px;line-height:1.55;color:#374151;">Include the reference code exactly as shown so the transfer matches to your purchase. Wires typically arrive within a few business days — we'll email you the moment it's received. Your listing is reserved for you for up to 10 business days.</p>
          <p style="font-size:14px;line-height:1.55;color:#374151;"><b>You don't have a handover code yet.</b> We'll send it the moment the transfer clears — that code is what releases the money to the seller.</p>
          <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
        </div>`,
      });
    }

    if (sellerRow?.email) {
      await sendEmail({
        to: sellerRow.email,
        subject: `A buyer has started a wire transfer for your ${carLabel}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
          <h2 style="font-size:18px;margin:0 0 14px;">A buyer is paying by wire transfer</h2>
          <p style="font-size:15px;line-height:1.55;">The buyer for your <b>${carLabel}</b> has started a domestic wire transfer. Your listing is now reserved for them.</p>
          <div style="background:#FFF8E7;border-left:3px solid #FFB020;padding:12px 14px;margin:18px 0;font-size:15px;line-height:1.55;">
            <b>Do not hand over the vehicle yet.</b> The wire has not cleared. We'll email you the moment it does.
          </div>
          <p style="font-size:14px;line-height:1.55;color:#374151;">If the transfer doesn't arrive within 10 business days, your listing reopens automatically and we'll let you know.</p>
          <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
        </div>`,
      });
    }

    notifyAdmin({
      subject: `⏳ Wire transfer initiated — ${carLabel}`,
      html: alertHtml("Wire session created, funds not yet settled", [
        ["Vehicle", carLabel],
        ["Amount", money(chargedTotal)],
        ["Buyer", `${buyerRow?.name ?? "—"} (${buyerRow?.email ?? "—"})`],
        ["Seller", `${sellerRow?.name ?? "—"} (${sellerRow?.email ?? "—"})`],
        ["PaymentIntent", pi.id],
        ["Listing ID", listing.id],
      ], "No money has settled and no handover code exists yet. Awaiting payment_intent.succeeded."),
    });

    return jsonResponse({
      payment_intent_id: pi.id,
      amount: Number(instructions?.amount_remaining ?? chargedTotal),
      currency: instructions?.currency ?? "usd",
      reference: instructions?.reference ?? null,
      routing_number: aba?.routing_number ?? null,
      account_number: aba?.account_number ?? null,
      hosted_instructions_url: instructions?.hosted_instructions_url ?? null,
      abandonment_timeout_business_days: 10,
    });
  } catch (err) {
    console.error("create-wire-session error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
