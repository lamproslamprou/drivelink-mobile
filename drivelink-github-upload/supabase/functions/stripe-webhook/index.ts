// POST /stripe-webhook
// Registered as your webhook endpoint in the Stripe Dashboard. This is what
// makes the flow automatic — replaces manually clicking "Mark Sold" for any
// sale that actually goes through real Stripe Checkout.
//
// NOTE ON DESTINATIONS: this function is the target of TWO Stripe event
// destinations, and they are not interchangeable:
//   - "Your account"       → checkout.session.completed, identity.*
//   - "Connected accounts" → account.updated
// checkout.session.completed is a PLATFORM event. Stripe's UI will happily let
// you subscribe a connected-accounts destination to it and then never deliver
// anything, because the sessions are created on the platform account. If sales
// stop recording themselves, check "Events from" on the destination first.
//
// Handles:
//  - checkout.session.completed: payment succeeded → listing goes to
//    "pending_confirmation", mirrors the fields the old markSold() set
//    (sale_price, sold_at, platform_fee, seller_net), plus auto_release_at.
//    On a DELAYED-NOTIFICATION method (ACH) this same event fires days before
//    the money exists, with payment_status "unpaid" — see below.
//  - checkout.session.async_payment_succeeded: an ACH debit settled. This is
//    the real settlement moment for bank payments and runs the identical
//    settlement path.
//  - checkout.session.async_payment_failed: an ACH debit bounced. Returns the
//    listing to "active" and tells both parties.
//
// ── DELAYED-NOTIFICATION PAYMENTS (ACH), added 2026-08-12 ───────────────────
// A card checkout completes and settles in one event. A bank debit does not:
// checkout.session.completed arrives immediately with payment_status
// "unpaid", and the money lands ~4-5 business days later on
// async_payment_succeeded — or never, on async_payment_failed.
//
// Three rules follow, and all three are load-bearing:
//
//   1. NOTHING SETTLES ON AN UNPAID SESSION. settleSale() runs only when
//      payment_status === "paid". On an unpaid completion the listing is
//      parked in "awaiting_payment": locked so a second buyer cannot pay for
//      the same car, but short of "pending_confirmation" so
//      trg_issue_handover_code never fires. No handover code exists until the
//      money does.
//
//   2. THE CLOCKS ANCHOR TO SETTLEMENT, NOT CHECKOUT. auto_release_at is
//      computed inside settleSale(), which for ACH runs at settlement — so a
//      sale cannot be escalated for "no confirmation" during days when the
//      buyer could not possibly have confirmed.
//
//   3. RELEASE HAS A FLOOR. release_not_before is set to settlement + 3
//      business days on ACH sales and left NULL on card sales. release-funds
//      and confirm-handover both refuse to transfer before it.
//
// ── WHAT THIS DOES NOT PROTECT AGAINST ──────────────────────────────────────
// An ACH debit on a personal account can be returned as UNAUTHORIZED for 60
// calendar days. Per Stripe those returns are final and uncontestable through
// the ACH network: the funds are pulled straight back out of the platform
// balance, there is no appeal, and the dispute has to be settled with the
// customer directly. If the seller has already been paid, the loss lands on
// DriveLink — not on the seller, and not on Stripe.
//
// No hold short of 60 days closes that window, and no seller will wait 60 days
// to be paid, so the trade is deliberate: the 3-day floor closes the
// INVOLUNTARY failure window (insufficient funds, closed account, the rare
// late bank return), and the identity-verification requirement in
// create-checkout-session ensures the DELIBERATE case comes attached to a
// verified legal identity. Do not describe this to sellers as "guaranteed".
//  - account.updated: a seller's Connect onboarding status changed.
//  - identity.verification_session.verified: a seller's Stripe Identity
//    check succeeded → flips users.verified to true and marks their
//    identity_verification_status "verified".
//  - identity.verification_session.requires_input: a seller's Stripe
//    Identity check failed (bad document, mismatch, etc) → marks
//    identity_verification_status "failed" so the Profile page can prompt
//    them to retry.
//
// IMPORTANT FIX vs the old markSold() logic: that function always subtracted
// the 1% promoter fee from the seller's net, even when no referral existed —
// meaning sellers were shorted 1% with nobody receiving it. This version only
// deducts the promoter fee when a pending referral actually exists for the
// listing, computed once here and honored downstream by release-funds.
//
// ── SETTLEMENT ARITHMETIC ───────────────────────────────────────────────────
// EVERY money column in the database is CENTS as of migration
// 20260803_05_money_to_cents. price, sale_price, platform_fee, seller_net,
// offers.amount, offers.counter_amount, payouts.amount,
// referrals.commission_amount, users.balance, deal_invites.price,
// saved_searches.max_price. Stripe is also cents. There is no conversion
// anywhere in this file and there should never be one again — if you find
// yourself writing / 100 or * 100 against a database column, something is
// wrong.
//
// This removed a whole class of bug rather than moving it. The previous
// version stored whole dollars, so it had to divide Stripe's cents down and
// then round the processing fee UP to avoid quoting the seller more than the
// platform balance could actually pay out. That ceil absorbed up to 99c per
// sale as platform remainder and left platform_fee unable to represent its
// own true value — the $50 test charged $1.25 in fees and stored 1.
//
// Now the arithmetic is exact:
//
//     seller_net = sale_price - platform_fee - promoter_fee - stripe_fee
//
// all in cents, all integers, no rounding anywhere except the two percentage
// calculations, which round to the nearest cent.
//
// Why the Stripe fee is deducted at all: a $50.00 charge only puts $48.25 on
// the platform balance — Stripe keeps ~2.9% + 30c. release-funds transfers
// seller_net, so if seller_net ignored the processing fee it would exceed the
// money that exists and Stripe would reject the transfer for insufficient
// funds. On a $10,000 car the shortfall would be ~$220 and EVERY real sale
// would fail at release.
//
// FALLBACK IF UNAVAILABLE: balance_transaction is normally present the moment
// a card charge succeeds, but it is not contractually guaranteed to be (async
// payment methods, timing). Rather than throw — the buyer has already been
// charged by this point — fall back to a conservative estimate and flag it in
// the admin alert so it can be reconciled.
//
// The stored platform_fee remains the nominal 1% (that's the DriveLink fee the
// seller was quoted). The processing fee is not stored as its own column: it's
// already baked into seller_net and stays retrievable from the payment intent
// in Stripe forever. If you later want it on the row for reconciliation, it
// needs an ALTER TABLE *and* an entry in guard_listings_settlement_columns,
// or sellers would be able to edit it from the browser.
//
// ── paid_at ─────────────────────────────────────────────────────────────────
// sold_at is a DATE, too coarse to tell "buyer confirmed four minutes after
// paying" from "confirmed four hours later" — which is the sharpest signal the
// risk engine has for card cash-out fraud. paid_at is the precise timestamp
// and is set here, at the only moment the platform knows payment succeeded.
// evaluate_listing_risk() reads it for INSTANT_CONFIRM and FAST_CLOSE.
//
// ALERT DELIVERY: these used to call sendEmail() without awaiting it, on the
// reasoning that a slow email shouldn't hold up the webhook. Sound goal, wrong
// mechanism — Supabase's Edge Runtime can destroy the isolate the moment the
// handler returns, killing the in-flight fetch. notifyAdmin() keeps the same
// non-blocking behavior but registers the work with EdgeRuntime.waitUntil()
// so it survives to completion.
import {
  corsHeaders,
  jsonResponse,
  notifyAdmin,
  sendEmail,
  alertHtml,
  money,
  stripeClient,
  supabaseAdmin,
  findPendingReferrals,
  addBusinessDays,
  PLATFORM_FEE,
  PROMOTER_FEE,
  AUTO_RELEASE_DAYS,
  todayET,
} from "../_shared/helpers.ts";

// Stripe's standard US card pricing, used ONLY as a fallback when the real
// balance_transaction can't be read. Intentionally not a source of truth.
const FALLBACK_FEE_PERCENT = 0.029;
const FALLBACK_FEE_FIXED_CENTS = 30;

// ACH Direct Debit is priced completely differently: 0.8% capped at $5, no
// fixed component. Falling back to the CARD numbers on a bank payment would
// estimate ~$870 of processing on a $30,000 car against a real fee of $5, and
// seller_net is computed by subtracting that estimate — the seller would be
// shorted the difference with nobody receiving it. Separate constants, and
// stripeFallbackFor() below picks between them off the actual charge.
const FALLBACK_ACH_FEE_PERCENT = 0.008;
const FALLBACK_ACH_FEE_CAP_CENTS = 500;

// Customer Balance / us_bank_transfer receipts (wires and ACH credits pushed
// INTO the platform's virtual account) are not priced like card or ACH-debit
// charges — Stripe's own docs describe this rail as carrying little to no fee
// on the receiving side, unlike the percentage-based card/ACH-debit rate
// cards above. Flat zero until a real test-mode wire proves otherwise (see
// PHASE2_WIRE_RAIL_SPEC.md §5.2 and the rollout checklist) — do NOT reuse
// FALLBACK_FEE_PERCENT or FALLBACK_ACH_FEE_PERCENT here, that would silently
// misestimate a wire's processing cost against a rate card that doesn't
// apply to it. A wrong value here still shows up in the admin alert, since
// feeWasEstimated flags it the same way an estimated card/ACH fee does.
const FALLBACK_WIRE_FEE_CENTS = 0;

// $5, in cents — the underpayment/overpayment tolerance for wires (§5.4).
// Cards and ACH debit always charge exactly the agreed total because Stripe
// enforces it; a wire doesn't have that guarantee (intermediary bank fees,
// buyer typos), so this absorbs small variance without blocking the sale.
const WIRE_AMOUNT_TOLERANCE_CENTS = 500;

// Buffer between ACH settlement and the earliest possible payout. Business
// days, so a Friday settlement doesn't burn the buffer over a weekend when no
// bank return could arrive anyway.
const ACH_RELEASE_BUFFER_BUSINESS_DAYS = 3;

// addBusinessDays() moved to _shared/helpers.ts (weekends-only business-day
// arithmetic) — expire-stale-wires needs the identical logic for its day-2
// reminder and 10-business-day timeout, and two copies is how this kind of
// helper drifts (see the settleReferral comment in helpers.ts for that
// history). Imported above.

// True when the charge behind this session was a bank debit rather than a
// card. Read off the expanded charge, never off the session's
// payment_method_types — that lists what was OFFERED, not what was used.
function isBankDebit(pi: unknown): boolean {
  if (!pi || typeof pi !== "object") return false;
  const charge = (pi as { latest_charge?: unknown }).latest_charge;
  if (!charge || typeof charge !== "object") return false;
  const details = (charge as { payment_method_details?: unknown }).payment_method_details;
  if (!details || typeof details !== "object") return false;
  return (details as { type?: unknown }).type === "us_bank_account";
}

// The agreed handover day, or null. One parser for both the parked path and
// the settlement path — they must not disagree about what counts as a valid
// date, or a sale could be parked with a handover_date and settle without one.
function handoverDateFromMeta(meta: Record<string, string> | null): string | null {
  const raw = meta?.handover_date ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// Conservative estimate of Stripe's cut, used only when balance_transaction
// isn't readable. Rounds UP in the card/ACH-debit branches: overestimating a
// fee we do not control keeps seller_net at or below the money that actually
// exists. Takes `rail` rather than a boolean (the pre-wire shape of this
// function) specifically so the wire branch can use its own flat estimate
// instead of being forced into the card or ACH-debit rate card — see
// FALLBACK_WIRE_FEE_CENTS above.
function stripeFallbackFor(chargedTotalCents: number, rail: "card" | "ach_debit" | "wire"): number {
  if (rail === "wire") {
    return FALLBACK_WIRE_FEE_CENTS;
  }
  if (rail === "ach_debit") {
    return Math.min(
      Math.ceil(chargedTotalCents * FALLBACK_ACH_FEE_PERCENT),
      FALLBACK_ACH_FEE_CAP_CENTS,
    );
  }
  return Math.ceil(chargedTotalCents * FALLBACK_FEE_PERCENT) + FALLBACK_FEE_FIXED_CENTS;
}

// Expanding payment_intent turns session.payment_intent from a string id into
// an object. Anything that wants the id has to cope with both shapes — writing
// the raw value into a text column when it's an object silently stores junk.
function paymentIntentId(pi: unknown): string | null {
  if (typeof pi === "string") return pi;
  if (pi && typeof pi === "object" && typeof (pi as { id?: unknown }).id === "string") {
    return (pi as { id: string }).id;
  }
  return null;
}

// Digs the actual Stripe processing fee (in cents) out of an expanded
// payment_intent.latest_charge.balance_transaction. Returns null if any link
// in that chain wasn't expanded or isn't there yet.
function stripeFeeCentsFrom(pi: unknown): number | null {
  if (!pi || typeof pi !== "object") return null;
  const charge = (pi as { latest_charge?: unknown }).latest_charge;
  if (!charge || typeof charge !== "object") return null;
  const bt = (charge as { balance_transaction?: unknown }).balance_transaction;
  if (!bt || typeof bt !== "object") return null;
  const fee = (bt as { fee?: unknown }).fee;
  return typeof fee === "number" ? fee : null;
}

// ── settleSale() ────────────────────────────────────────────────────────
// Extracted per PHASE2_WIRE_RAIL_SPEC.md §5.1. This is the settlement block
// that used to live inline inside the checkout.session.completed /
// checkout.session.async_payment_succeeded handler — fee arithmetic, the
// listings UPDATE, the referral lookup, the admin alert, and the
// handover-code + seller-notice emails. Moved unchanged in substance so it
// can also be driven by a bare PaymentIntent (the wire path, §5.2), which
// has no session.metadata to read.
//
// Deviates from the spec's drafted signature in one place: takes `rail`
// ("card" | "ach_debit" | "wire") instead of a plain `isBankDebit: boolean`.
// A boolean can't tell a wire's PaymentIntent apart from a card's, and §5.2
// is explicit that the wire fee fallback must NOT reuse the card or
// ACH-debit rate cards — that three-way distinction has to reach
// stripeFallbackFor() somehow, and a boolean can't carry it. Also drops the
// unused `stripe` client param from the spec's draft: by the time this is
// called, the caller has already retrieved/expanded the PaymentIntent (or
// Checkout Session) and resolved stripeFeeCents, so settleSale() itself
// never talks to Stripe.
//
// Returns { ok: true, ... } on success or { ok: false, status, body } on a
// failure the caller should turn straight into an HTTP response — mirrors
// the original inline code's behavior of returning 500 (never claiming the
// event) so Stripe redelivers.
async function settleSale(
  supabase: ReturnType<typeof supabaseAdmin>,
  input: {
    listingId: string;
    buyerId: string;
    piId: string | null;
    meta: Record<string, string>;
    rail: "card" | "ach_debit" | "wire";
    stripeFeeCents: number | null;
    chargedTotalCents: number;
  },
): Promise<
  | { ok: true; carLabel: string; sellerNet: number }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const { listingId, buyerId, piId, meta, rail, stripeFeeCents: realFeeCents, chargedTotalCents } = input;
  const bankDebit = rail === "ach_debit";

  // ── What the car actually sold for ────────────────────────────────────
  // NOT amount_total / chargedTotalCents. On a buyer-initiated BYOD deal
  // with a Promoter referral, the buyer is charged the agreed price PLUS a
  // 1% referral surcharge, so the charged total overstates the sale.
  // Deriving fees from it would take 1% of the inflated figure and — worse
  // — still deduct the promoter cut from the seller, charging the
  // commission twice. Works unchanged for wires too (§5.5): a
  // customer_balance PaymentIntent has no Stripe-side line items, and this
  // was always derived purely from metadata, never from Stripe's total.
  const agreedPriceMeta = Number(meta.agreed_price);
  const salePrice = Number.isFinite(agreedPriceMeta) && agreedPriceMeta > 0
    ? agreedPriceMeta
    : chargedTotalCents;

  // How much of the charged total was the referral surcharge the BUYER
  // paid. Zero on marketplace sales and on seller-initiated deals, where
  // the commission comes out of the seller's proceeds instead.
  const surchargeMeta = Number(meta.promoter_surcharge);
  const promoterSurcharge = Number.isFinite(surchargeMeta) && surchargeMeta > 0
    ? surchargeMeta
    : 0;

  const platformFee = Math.round(salePrice * PLATFORM_FEE);

  // ── Stripe's actual processing fee ────────────────────────────────────
  const feeWasEstimated = realFeeCents === null;
  const stripeFee = realFeeCents ?? stripeFallbackFor(chargedTotalCents, rail);
  const effectiveFeeCents = stripeFee;

  if (feeWasEstimated) {
    console.warn(
      "balance_transaction unavailable, estimating Stripe fee:",
      listingId,
      rail,
      effectiveFeeCents,
    );
  }

  // Only reserve a promoter cut if a pending referral actually exists.
  const { refs: pendingRefs } = await findPendingReferrals(supabase, listingId);
  const hasPendingRef = pendingRefs.length > 0;

  const promoterFeeReserved = hasPendingRef && promoterSurcharge === 0
    ? Math.round(salePrice * PROMOTER_FEE)
    : 0;

  // Clamp at zero — see the header comment in this file for why.
  const rawSellerNet = salePrice - platformFee - promoterFeeReserved - stripeFee;
  const sellerNet = Math.max(0, rawSellerNet);
  const netWasClamped = rawSellerNet !== sellerNet;

  // ── RELEASE CLOCK ─────────────────────────────────────────────────────
  const paymentReleaseAt = new Date();
  paymentReleaseAt.setDate(paymentReleaseAt.getDate() + AUTO_RELEASE_DAYS);

  const handoverDate = handoverDateFromMeta(meta);

  let releaseAt = paymentReleaseAt;

  if (handoverDate) {
    const handoverReleaseAt = new Date(`${handoverDate}T12:00:00Z`);
    handoverReleaseAt.setDate(handoverReleaseAt.getDate() + AUTO_RELEASE_DAYS);

    if (
      Number.isFinite(handoverReleaseAt.getTime()) &&
      handoverReleaseAt.getTime() > paymentReleaseAt.getTime()
    ) {
      releaseAt = handoverReleaseAt;
    }
  }

  // ── RELEASE FLOOR ─────────────────────────────────────────────────────
  // NULL on cards AND wires: a card charge or an incoming wire that reached
  // this point is settled, irreversible money — "a credit push can't
  // bounce" (§5.3). Only ACH debit gets the 3-business-day buffer, because
  // only ACH debit can be returned days after Stripe reports it succeeded.
  const releaseNotBefore = bankDebit
    ? addBusinessDays(new Date(), ACH_RELEASE_BUFFER_BUSINESS_DAYS)
    : null;

  if (releaseNotBefore && releaseNotBefore.getTime() > releaseAt.getTime()) {
    releaseAt = new Date(releaseNotBefore.getTime());
    releaseAt.setDate(releaseAt.getDate() + AUTO_RELEASE_DAYS);
  }

  const { data: soldListing, error: listingErr } = await supabase
    .from("listings")
    .update({
      status: "pending_confirmation",
      release_not_before: releaseNotBefore ? releaseNotBefore.toISOString() : null,
      buyer_id: buyerId,
      sale_price: salePrice,
      platform_fee: platformFee,
      seller_net: sellerNet,
      stripe_payment_intent_id: piId,
      sold_at: todayET(),
      paid_at: new Date().toISOString(),
      ...(handoverDate ? { handover_date: handoverDate } : {}),
      auto_release_at: releaseAt.toISOString(),
    })
    .eq("id", listingId)
    .select("make, model, year, seller_id")
    .single();

  if (listingErr) {
    console.error("listings update failed:", listingErr.message, listingId);
    return {
      ok: false,
      status: 500,
      body: { error: "listings update failed", detail: listingErr.message },
    };
  }

  const [{ data: buyerRow }, { data: sellerRow }] = await Promise.all([
    supabase.from("users").select("name, email").eq("id", buyerId).single(),
    soldListing?.seller_id
      ? supabase.from("users").select("name, email").eq("id", soldListing.seller_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const carLabel = soldListing
    ? `${soldListing.year} ${soldListing.make} ${soldListing.model}`
    : listingId;

  const subject = netWasClamped
    ? `⚠️ Sale recorded with $0 seller net — ${carLabel}`
    : feeWasEstimated
    ? `⚠️ Sale recorded with ESTIMATED processing fee — ${carLabel}`
    : `New car sale — ${carLabel} (${money(salePrice)})`;

  const footnote = netWasClamped
    ? `Fees exceeded the sale price, so seller net was clamped to $0. Check this before releasing.`
    : feeWasEstimated
    ? `Stripe's balance_transaction wasn't readable, so the processing fee above is an ESTIMATE. Compare it to the real fee on the payment in Stripe and adjust seller_net before release if it's off.`
    : handoverDate
    ? `Handover is agreed for ${handoverDate}. Funds do NOT release on a timer — the buyer confirms receipt, or the seller enters the buyer's handover code. If neither happens by ${releaseAt.toISOString().slice(0, 10)}, the sale is escalated to you for manual review.`
    : `Funds do NOT release on a timer — the buyer confirms receipt, or the seller enters the buyer's handover code. If neither happens by ${releaseAt.toISOString().slice(0, 10)}, the sale is escalated to you for manual review.`;

  notifyAdmin({
    subject,
    html: alertHtml(
      "New sale — payment received, awaiting buyer confirmation",
      [
        ["Vehicle", carLabel],
        ["Rail", rail],
        ...(handoverDate
          ? [["Handover agreed for", handoverDate] as [string, unknown]]
          : []),
        ["Escalates to review", releaseAt.toISOString().slice(0, 10)],
        ["Sale price", money(salePrice)],
        ["Platform fee (1%)", money(platformFee)],
        [
          feeWasEstimated ? "Stripe processing (ESTIMATED)" : "Stripe processing",
          money(stripeFee),
        ],
        ...(promoterFeeReserved
          ? [["Promoter reserved", money(promoterFeeReserved)] as [string, unknown]]
          : []),
        ["Seller net", money(sellerNet)],
        ["Buyer", `${buyerRow?.name ?? "—"} (${buyerRow?.email ?? "—"})`],
        ["Seller", `${sellerRow?.name ?? "—"} (${sellerRow?.email ?? "—"})`],
        ["Review deadline", todayET(releaseAt)],
        ["Listing ID", listingId],
      ],
      footnote,
    ),
  });

  // ── Buyer's handover code + seller's heads-up ────────────────────────
  {
    const { data: handover } = await supabase
      .from("escrow_handovers")
      .select("code")
      .eq("listing_id", listingId)
      .maybeSingle();

    if (handover?.code && buyerRow?.email) {
      await sendEmail({
        to: buyerRow.email,
        subject: `Your handover code for the ${carLabel}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
          <h2 style="font-size:18px;margin:0 0 14px;">Payment received — your money is held safely</h2>
          <p style="font-size:15px;line-height:1.55;">We're holding your ${money(salePrice)} for the <b>${carLabel}</b>. The seller has not been paid.</p>
          <div style="background:#FFF8E7;border:1px solid #FFB020;border-radius:8px;padding:16px;margin:20px 0;">
            <div style="font-size:12px;font-weight:700;color:#7c5000;letter-spacing:0.5px;">YOUR HANDOVER CODE</div>
            <div style="font-size:32px;font-family:monospace;letter-spacing:8px;font-weight:700;margin:8px 0;">${handover.code}</div>
            <div style="font-size:14px;color:#7c5000;line-height:1.6;">
              Give this to the seller <b>only after</b> the car and the signed title are in your hands. The moment they enter it, the money is theirs.<br><br>
              <b>Don't text or email it. Read it out in person.</b>
            </div>
          </div>
          <p style="font-size:14px;line-height:1.55;color:#374151;">If something isn't right, don't give out the code — report a problem at <a href="https://drivelink.deals" style="color:#B87300;">drivelink.deals</a> instead and we'll hold the funds while we look into it.</p>
          <p style="font-size:14px;line-height:1.55;color:#374151;"><b>DriveLink will never ask you for this code.</b> Nobody from DriveLink will call, email or message you to request it. If someone does, it isn't us.</p>
          <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
        </div>`,
      });
    }

    if (sellerRow?.email) {
      await sendEmail({
        to: sellerRow.email,
        subject: `Payment received for your ${carLabel}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
          <h2 style="font-size:18px;margin:0 0 14px;">The buyer has paid — ${money(salePrice)} is in escrow</h2>
          <p style="font-size:15px;line-height:1.55;">Your net proceeds of <b>${money(sellerNet)}</b> are held by DriveLink and released when the handover is confirmed.</p>
          <p style="font-size:15px;line-height:1.55;">The buyer has a <b>6-digit handover code</b>. Once they have the car and the signed title, ask them for it and enter it on your listing — that releases your funds straight away. They can also confirm receipt themselves in the app.</p>
          <p style="font-size:14px;line-height:1.55;color:#374151;">Nothing releases automatically. If neither happens, we'll check in with both of you.</p>
          ${releaseNotBefore
            ? `<div style="background:#FFF8E7;border-left:3px solid #FFB020;padding:12px 14px;margin:18px 0;font-size:14px;line-height:1.55;">
                This buyer paid by bank transfer, which has now cleared. Bank payments carry a short settlement hold, so funds can be released from <b>${releaseNotBefore.toISOString().slice(0, 10)}</b>. You can hand over the vehicle before then — the code just won't pay out until that date.
              </div>`
            : ""}
          <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
        </div>`,
      });
    }
  }

  return { ok: true, carLabel, sellerNet };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = stripeClient();
  const supabase = supabaseAdmin();
  const signature = req.headers.get("stripe-signature");

  // Two Stripe webhook endpoints point at this same function: one for
  // "your account" events (checkout.session.completed, identity.*) and one
  // for "connected accounts" events (account.updated) — Stripe requires
  // these as separate endpoints, each with its own signing secret. Try both.
  const body = await req.text();
  const candidateSecrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT"),
  ].filter(Boolean) as string[];

  let event;
  let verified = false;
  for (const secret of candidateSecrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature!, secret);
      verified = true;
      break;
    } catch {
      // try the next secret
    }
  }
  if (!verified || !event) {
    console.error("Webhook signature verification failed against all known secrets");
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  // Idempotency: Stripe redelivers events on retry. If we've already logged
  // this event id, acknowledge and stop — don't double-process a sale.
  //
  // The ledger row is written at the END of successful processing, not here.
  // Claiming the event up front meant a failed run still marked it "seen", so
  // Stripe's retry — the one thing that would have healed the failure — was
  // dropped as a duplicate. That is exactly how l1786111000114 was charged
  // with no sale recorded: gen_handover_code() threw inside the listing
  // UPDATE's trigger, the handler logged it, returned 200, and the event was
  // already marked processed. Record success, never receipt.
  const { data: existing } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return jsonResponse({ received: true, duplicate: true });

  // Marks the event processed. Called immediately before each success return.
  const claimEvent = async () => {
    const { error } = await supabase
      .from("stripe_events")
      .insert({ id: event!.id, type: event!.type });
    // A duplicate-key error here means a concurrent delivery of the same event
    // won the race and already recorded it. Harmless: the work is idempotent.
    if (error && !/duplicate key/i.test(error.message)) {
      console.error("stripe_events insert failed:", error.message, event!.id);
    }
  };

  try {
    // One block, three events. checkout.session.completed and
    // async_payment_succeeded run the SAME settlement path — the only
    // difference is that on a bank payment the money is real by the time the
    // second one arrives. Deliberately not two copies of the settlement code:
    // a fee calculation that drifts between the card path and the ACH path is
    // a silent money bug.
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      // Fetch the full session from Stripe's API rather than trusting the
      // webhook body directly — works whether Stripe sends a full ("snapshot")
      // or minimal ("thin") event payload, so we don't depend on which
      // payload style a given endpoint happens to be configured for.
      //
      // The expand chain is what makes the real processing fee available:
      // session -> payment_intent -> latest_charge -> balance_transaction.fee
      const sessionId = (event.data.object as { id: string }).id;
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.latest_charge.balance_transaction"],
      });
      const meta = session.metadata as Record<string, string>;
      const paymentIntent = session.payment_intent;
      const piId = paymentIntentId(paymentIntent);

      // Ad placement purchases use this same event but a completely
      // different downstream update — handle and exit early.
      if (meta.type === "ad_placement") {
        const plan = meta.plan;
        const months = plan === "12mo" ? 12 : plan === "6mo" ? 6 : 3;
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + months);

        const { data: adRow, error: adErr } = await supabase
          .from("ad_placements")
          .update({
            status: "active",
            // piId, not `session.payment_intent as string` — that cast was
            // silently wrong the moment payment_intent became expanded.
            stripe_payment_intent_id: piId,
            start_date: todayET(startDate),
            end_date: todayET(endDate),
          })
          .eq("id", meta.ad_id)
          .select("business_name, contact_email, link_url, plan, amount_cents")
          .single();

        // Money has already changed hands at this point. Fail loudly with a
        // 500 so Stripe redelivers: the retry re-runs this update, and a
        // transient database fault heals itself without anyone touching SQL.
        // No admin email here — Stripe retries several times over ~3 days and
        // one alert per attempt is noise. Stripe's own endpoint-failure
        // notification is the signal that retries are being exhausted; make
        // sure it's switched on in the dashboard.
        if (adErr) {
          console.error("ad_placements update failed:", adErr.message, meta.ad_id);
          return jsonResponse({ error: "ad_placements update failed", detail: adErr.message }, 500);
        }

        notifyAdmin({
          subject: `New ad placement purchased — ${adRow?.business_name ?? "Unknown business"}`,
          html: alertHtml(
            "New ad placement",
            [
              ["Business", adRow?.business_name],
              ["Contact", adRow?.contact_email],
              ["Link", adRow?.link_url],
              ["Plan", adRow?.plan ?? plan],
              ["Amount", money(adRow?.amount_cents)],
              ["Runs", `${todayET(startDate)} to ${todayET(endDate)}`],
              ["Ad ID", meta.ad_id],
            ],
          ),
        });

        await claimEvent();
        return jsonResponse({ received: true });
      }

      const { listing_id, buyer_id } = meta;

      // ── UNPAID COMPLETION: park it, settle nothing ───────────────────────
      // Reached only by delayed-notification methods. A card checkout is
      // already "paid" here and falls straight through.
      //
      // Everything below this branch — fee arithmetic, seller_net, the
      // handover code, both parties' emails — is deliberately skipped. None of
      // it is safe to run against money that does not exist yet, and the
      // handover code least of all: a code issued now would let the buyer
      // collect the car days before the debit clears, on a payment that can
      // still bounce.
      if (session.payment_status !== "paid") {
        // Idempotent by construction. If a redelivered event arrives after the
        // payment has already settled, this must not drag a live sale back
        // into awaiting_payment — so it only moves a row that is still active.
        const { data: parked, error: parkErr } = await supabase
          .from("listings")
          .update({
            status: "awaiting_payment",
            buyer_id,
            stripe_payment_intent_id: piId,
            ...(handoverDateFromMeta(meta) ? { handover_date: handoverDateFromMeta(meta) } : {}),
          })
          .eq("id", listing_id)
          .eq("status", "active")
          .select("make, model, year, seller_id")
          .maybeSingle();

        if (parkErr) {
          console.error("awaiting_payment update failed:", parkErr.message, listing_id);
          return jsonResponse({ error: "listings update failed", detail: parkErr.message }, 500);
        }

        const parkedLabel = parked
          ? [parked.year, parked.make, parked.model].filter(Boolean).join(" ")
          : listing_id;

        // Both parties need to know the car is spoken for but the money is not
        // here yet. The seller especially: without this they see a sale in the
        // app and may hand over a vehicle against an unsettled debit, which is
        // the exact failure this whole design exists to prevent.
        if (parked) {
          const [{ data: b }, { data: sl }] = await Promise.all([
            supabase.from("users").select("name, email").eq("id", buyer_id).single(),
            parked.seller_id
              ? supabase.from("users").select("name, email").eq("id", parked.seller_id).single()
              : Promise.resolve({ data: null }),
          ]);

          if (b?.email) {
            await sendEmail({
              to: b.email,
              subject: `Bank transfer started for the ${parkedLabel}`,
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
                <h2 style="font-size:18px;margin:0 0 14px;">Your bank transfer is on its way</h2>
                <p style="font-size:15px;line-height:1.55;">We've started the transfer for the <b>${parkedLabel}</b>. Bank payments take about 5 business days to clear.</p>
                <p style="font-size:15px;line-height:1.55;"><b>You don't have a handover code yet.</b> We'll email it the moment the payment clears — that code is what releases the money to the seller.</p>
                <p style="font-size:14px;line-height:1.55;color:#374151;">Please don't arrange to collect the vehicle until you've had that email. Nothing has been paid to the seller yet.</p>
                <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
              </div>`,
            });
          }

          if (sl?.email) {
            await sendEmail({
              to: sl.email,
              subject: `Bank transfer started for your ${parkedLabel}`,
              html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
                <h2 style="font-size:18px;margin:0 0 14px;">A buyer has started a bank transfer</h2>
                <p style="font-size:15px;line-height:1.55;">The buyer for your <b>${parkedLabel}</b> is paying by bank transfer. Your listing is now reserved for them.</p>
                <div style="background:#FFF8E7;border-left:3px solid #FFB020;padding:12px 14px;margin:18px 0;font-size:15px;line-height:1.55;">
                  <b>Do not hand over the vehicle yet.</b> Bank transfers take about 5 business days to clear, and this one has not cleared. We'll email you the moment it does.
                </div>
                <p style="font-size:14px;line-height:1.55;color:#374151;">If the transfer fails, your listing goes back on sale automatically and we'll let you know.</p>
                <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
              </div>`,
            });
          }
        }

        notifyAdmin({
          subject: `⏳ Bank payment initiated — ${parkedLabel}`,
          html: alertHtml("ACH checkout completed, funds not settled", [
            ["Vehicle", parkedLabel],
            ["Charged total", money(session.amount_total ?? 0)],
            ["Payment status", session.payment_status ?? "—"],
            ["Listing ID", listing_id],
            ["Row parked", parked ? "yes" : "NO — listing was not active"],
          ], parked
            ? "No money has settled and no handover code exists. Awaiting checkout.session.async_payment_succeeded."
            : "The listing was NOT in 'active' status, so nothing was parked. Either this is a redelivered event for a sale that already settled (harmless) or two payments raced for one car (not harmless). Check the listing."),
        });

        await claimEvent();
        return jsonResponse({ received: true, awaitingSettlement: true });
      }

      // ── Settle ─────────────────────────────────────────────────────────
      // Card and ACH-debit both settle through settleSale() (§5.1) — the
      // only difference between them is `rail`, which drives the fee
      // fallback rate card and whether release_not_before gets the 3-day
      // ACH buffer. See PHASE2_WIRE_RAIL_SPEC.md for why this is now a real
      // function instead of inline code: a third caller (the wire path
      // below, driven by a bare PaymentIntent with no session.metadata)
      // needed the same logic without a Checkout Session.
      //
      // Which rate card / release-floor behavior applies is read off the
      // actual charge (isBankDebit), never off what Checkout offered.
      // Getting this wrong costs the seller real money on every ACH sale
      // where balance_transaction isn't readable.
      const bankDebit = isBankDebit(paymentIntent);
      const rail: "card" | "ach_debit" = bankDebit ? "ach_debit" : "card";
      const realFeeCents = stripeFeeCentsFrom(paymentIntent);
      // Fallback for the (effectively theoretical) case where Stripe's own
      // amount_total is absent on a paid session — in practice this is
      // always present once payment_status === "paid", so this mirrors the
      // original inline fallback chain in every real case.
      const chargedTotalCents = session.amount_total ?? 0;

      const settled = await settleSale(supabase, {
        listingId: listing_id,
        buyerId: buyer_id,
        piId,
        meta,
        rail,
        stripeFeeCents: realFeeCents,
        chargedTotalCents,
      });

      // The buyer has been charged. A settlement failure is a retryable
      // fault, not a finished job — return 500 and let Stripe redeliver
      // rather than emailing a human to go fix the database by hand. No
      // admin email on this path: Stripe retries several times over ~3 days,
      // and one alert per attempt is noise. Stripe's own endpoint-failure
      // notification is the signal that retries are being exhausted.
      if (!settled.ok) {
        return jsonResponse(settled.body, settled.status);
      }

      // Referral stays "pending" — it's marked "paid" and credited to the
      // promoter's balance in release-funds, same moment the seller is paid,
      // same as the existing confirmReceipt() behavior.
      //
      // WARNING FOR FUTURE ACH/WIRE WORK PRESERVED FROM THE PRE-EXTRACTION
      // CODE: the handover-code email inside settleSale() must only ever run
      // from a path that has confirmed money has actually settled
      // (payment_status === "paid" for Checkout, or a wire's
      // payment_intent.succeeded). Mailing it earlier would let a buyer take
      // delivery of a car against a payment that can still fail.
    }

    // ── WIRE / ACH-CREDIT SETTLED (Customer Balance) ─────────────────────────
    // Domestic wire rail, PHASE2_WIRE_RAIL_SPEC.md §5.2. A customer_balance
    // PaymentIntent (created by create-wire-session — not built this session;
    // this handler is dormant until that function exists and the payment
    // method is turned on) fires payment_intent.succeeded when the buyer's
    // bank transfer lands, with no Checkout Session anywhere in the flow.
    //
    // Every other PaymentIntent also fires this same event (a card or ACH
    // Checkout creates one under the hood) — those are already fully handled
    // above via checkout.session.completed / async_payment_succeeded and must
    // NOT be re-settled here. Guarded on metadata.rail === "wire", stamped by
    // create-wire-session, rather than trying to infer "wire-ness" from the
    // PaymentIntent's shape.
    //
    // Retrieved fresh from Stripe's API (not read off event.data.object)
    // for the same reason every other handler in this file does that: works
    // whether Stripe sends a thin or full event payload, and the expand here
    // costs nothing extra — it's the same API call, not a second one.
    if (event.type === "payment_intent.succeeded") {
      const eventPiId = (event.data.object as { id: string }).id;
      const pi = await stripe.paymentIntents.retrieve(eventPiId, {
        expand: ["latest_charge.balance_transaction"],
      });
      const meta = (pi.metadata ?? {}) as Record<string, string>;

      if (meta.rail === "wire" && meta.listing_id) {
        const listing_id = meta.listing_id;
        const buyer_id = meta.buyer_id;

        // ── Underpayment / overpayment tolerance, §5.4 ──────────────────────
        // Cards and ACH debit always charge exactly the agreed total because
        // Stripe enforces the charged amount. A wire doesn't: an
        // intermediary bank can clip a fee, or the buyer can fat-finger the
        // amount. Compare what was agreed (metadata) against what actually
        // landed (pi.amount_received).
        //
        // UPDATE, confirmed by test-mode testing 2026-09-01: the diff < 0
        // (underpayment) branch below is believed unreachable for a genuine
        // buyer shortfall in practice — Stripe does not fire
        // payment_intent.succeeded at all until received funds reach the
        // PaymentIntent's requested amount; a short wire instead fires
        // payment_intent.partially_funded (handled separately below, which is
        // where the real alert for a short wire now happens). Left in place
        // here as defensive insurance in case `expected` (derived from our
        // own metadata) ever disagrees with what Stripe considered the
        // PaymentIntent's requested amount — cheap to keep, not proven to be
        // dead in every case.
        const agreedPriceMeta = Number(meta.agreed_price);
        const surchargeMeta = Number(meta.promoter_surcharge);
        const agreedPrice = Number.isFinite(agreedPriceMeta) && agreedPriceMeta > 0 ? agreedPriceMeta : 0;
        const surcharge = Number.isFinite(surchargeMeta) && surchargeMeta > 0 ? surchargeMeta : 0;
        const expected = agreedPrice + surcharge;
        const received = pi.amount_received ?? 0;
        const diff = received - expected;

        if (diff < -WIRE_AMOUNT_TOLERANCE_CENTS) {
          // More than $5 short: do NOT settle. Leave the listing in
          // awaiting_payment and flag for a human — same posture as a
          // clamped seller-net or an estimated fee already gets.
          notifyAdmin({
            subject: `⚠️ Wire underpaid — ${listing_id}`,
            html: alertHtml(
              "Wire payment received but underpaid by more than $5",
              [
                ["Listing ID", listing_id],
                ["Buyer ID", buyer_id ?? "—"],
                ["Expected", money(expected)],
                ["Received", money(received)],
                ["Shortfall", money(-diff)],
                ["PaymentIntent", pi.id],
              ],
              "Listing left in awaiting_payment — this payment was NOT settled. Review manually before releasing anything; contact the buyer about the difference or refund/reconcile by hand.",
            ),
          });
          await claimEvent();
          return jsonResponse({ received: true, wireUnderpaid: true });
        }

        // UPDATE, confirmed by test-mode overpayment testing 2026-09-01: this
        // branch is dead in practice, the same way the underpayment branch
        // above is. Verified directly against a real overpaid PaymentIntent
        // (funded $16,008 against a $16,000 request): Stripe's
        // amount_received came back exactly 1600000 — capped at the
        // PaymentIntent's requested `amount`, not the true funded total. So
        // `diff` is ~0 here even on a genuine overpayment; the extra $8 never
        // touches this PaymentIntent at all and instead sits as unapplied
        // credit in the customer's Stripe cash balance. The real overpayment
        // alert now lives below, after settlement, reading
        // stripe.customers.retrieveCashBalance() instead. Left in place as
        // defensive insurance, same reasoning as the underpayment branch.
        if (diff > WIRE_AMOUNT_TOLERANCE_CENTS) {
          // More than $5 over: do NOT auto-refund (Stripe can't reverse an
          // incoming wire the way it reverses a card charge, and this is a
          // documented non-goal). Settle at the agreed price and flag for
          // manual buyer contact about the difference.
          notifyAdmin({
            subject: `⚠️ Wire overpaid — ${listing_id}`,
            html: alertHtml(
              "Wire payment received, overpaid by more than $5",
              [
                ["Listing ID", listing_id],
                ["Buyer ID", buyer_id ?? "—"],
                ["Expected", money(expected)],
                ["Received", money(received)],
                ["Overage", money(diff)],
                ["PaymentIntent", pi.id],
              ],
              "Settling at the agreed price. DriveLink does not auto-refund overpayments — contact the buyer about the difference by hand.",
            ),
          });
          // Fall through and settle at `expected`.
        }

        // diff within ±$5 (or over, handled above): settle at `expected`.
        // Confirmed with Lampros 2026-08-28: DriveLink's platform fee
        // absorbs an under-$5 shortfall — seller_net is computed from
        // `expected` as if the full amount arrived, never reduced for a
        // few-dollar clip. settleSale() derives salePrice from
        // meta.agreed_price directly, so passing chargedTotalCents: expected
        // only affects the fee-fallback rate-card estimate, matching intent.
        const stripeFeeCents = stripeFeeCentsFrom(pi);

        const settled = await settleSale(supabase, {
          listingId: listing_id,
          buyerId: buyer_id,
          piId: pi.id,
          meta,
          rail: "wire",
          stripeFeeCents,
          chargedTotalCents: expected,
        });

        if (!settled.ok) {
          return jsonResponse(settled.body, settled.status);
        }

        // ── Real overpayment detection, added 2026-09-01 ────────────────────
        // The diff-based check above can't see an overpayment — amount_received
        // is capped at the PaymentIntent's requested amount (confirmed via a
        // live test-mode overpaid wire; see the comment above). Any extra the
        // buyer sent lands as unapplied credit on their Stripe cash balance
        // instead, invisible to this PaymentIntent. That balance is the only
        // reliable signal, so check it directly after settling. Non-fatal by
        // design: a failed balance lookup must never undo an already-settled
        // sale, so this is wrapped and logged rather than allowed to throw.
        if (pi.customer) {
          try {
            const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer.id;
            const cashBalance = await stripe.customers.retrieveCashBalance(customerId);
            const leftoverCents = cashBalance.available?.usd ?? 0;
            if (leftoverCents > WIRE_AMOUNT_TOLERANCE_CENTS) {
              notifyAdmin({
                subject: `⚠️ Wire overpaid — ${listing_id}`,
                html: alertHtml(
                  "Wire settled at the agreed price, but the buyer's Stripe cash balance still holds unapplied funds",
                  [
                    ["Listing ID", listing_id],
                    ["Buyer ID", buyer_id ?? "—"],
                    ["Agreed price (settled)", money(expected)],
                    ["Unapplied balance", money(leftoverCents)],
                    ["Stripe customer", customerId],
                    ["PaymentIntent", pi.id],
                  ],
                  "The buyer's wire covered more than the agreed price. Stripe applied only what was owed to this PaymentIntent — the rest is sitting as a cash balance credit under this customer, not reflected anywhere else. DriveLink does not auto-refund — contact the buyer about the difference, or refund the cash balance to them by hand from the Stripe Dashboard (Customer → Balance).",
                ),
              });
            }
          } catch (e) {
            console.error(
              `wire overpayment cash-balance check failed for ${pi.id}:`,
              e instanceof Error ? e.message : String(e),
            );
          }
        }

        await claimEvent();
        return jsonResponse({ received: true });
      }

      // Not a wire PaymentIntent (or missing listing_id) — nothing to do
      // here. Falls through to the bottom claimEvent()/return: Checkout's
      // own PaymentIntents already settled via checkout.session.completed /
      // async_payment_succeeded above, and this event needs no extra work.
    }

    // ── WIRE PARTIALLY FUNDED (Customer Balance) ──────────────────────────────
    // Discovered during test-mode testing 2026-09-01: a short wire does NOT
    // fire payment_intent.succeeded. Stripe fires payment_intent.partially_funded
    // instead and leaves the PaymentIntent open, waiting for the rest — which
    // means the underpayment branch inside the payment_intent.succeeded
    // handler above is effectively unreachable for a genuine buyer shortfall
    // (Stripe only calls a wire "succeeded" once received >= the requested
    // amount). Before this handler existed, a short wire produced no alert of
    // any kind — the listing just sat in awaiting_payment until the day-2
    // reminder / 10-business-day abandonment cron eventually caught it. This
    // closes that gap: alert the moment Stripe tells us a wire came up short,
    // instead of waiting up to 2 days for the generic reminder to notice.
    //
    // Not a settlement path — the listing stays in awaiting_payment. If the
    // buyer sends the rest, Stripe fires payment_intent.succeeded once the
    // total clears the requested amount and the handler above settles it
    // normally. If they never do, the existing abandonment timeout still
    // applies on top of this alert. No DB write here — nothing to guard
    // against a concurrent settlement racing this alert.
    //
    // UPDATE, corrected 2026-09-01 after the first version of this handler
    // shipped reading pi.amount_received — which is the wrong field here and
    // produced a real "Received so far: $0.00" alert for a PaymentIntent
    // that actually had ~$15,993 sitting against it. Root cause per Stripe's
    // own docs (docs.stripe.com/payments/bank-transfers/accept-a-payment):
    // "PaymentIntents that are partially funded aren't reflected in your
    // account balance until the payment is complete" — amount_received is
    // defined to read 0 for the entire time a customer_balance PaymentIntent
    // is only partially funded, whether read fresh via retrieve() or straight
    // off event.data.object; there was never a staleness/race bug to fix.
    // The authoritative "how much is still owed" figure while partially
    // funded is next_action.display_bank_transfer_instructions.amount_remaining
    // (documented on the same page, next to the payment_intent.partially_funded
    // row of their event table) — it decreases as each partial transfer
    // lands and hits 0 the moment the PaymentIntent actually succeeds.
    // received is derived as expected - amountRemaining rather than trusted
    // off pi.amount, so the alert's "Expected" and "Received so far" rows
    // stay internally consistent with each other. Reads straight off
    // event.data.object (no retrieve() needed) since next_action is present
    // on the full/snapshot payload this account's webhook destination sends.
    if (event.type === "payment_intent.partially_funded") {
      const pi = event.data.object as {
        id: string;
        metadata?: Record<string, string> | null;
        next_action?: {
          display_bank_transfer_instructions?: { amount_remaining?: number | null } | null;
        } | null;
      };
      const meta = (pi.metadata ?? {}) as Record<string, string>;

      if (meta.rail === "wire" && meta.listing_id) {
        const listing_id = meta.listing_id;
        const buyer_id = meta.buyer_id;

        const agreedPriceMeta = Number(meta.agreed_price);
        const surchargeMeta = Number(meta.promoter_surcharge);
        const agreedPrice = Number.isFinite(agreedPriceMeta) && agreedPriceMeta > 0 ? agreedPriceMeta : 0;
        const surcharge = Number.isFinite(surchargeMeta) && surchargeMeta > 0 ? surchargeMeta : 0;
        const expected = agreedPrice + surcharge;
        const amountRemaining = pi.next_action?.display_bank_transfer_instructions?.amount_remaining;
        const shortfall = typeof amountRemaining === "number" ? amountRemaining : expected;
        const received = expected - shortfall;

        notifyAdmin({
          subject: `⚠️ Wire came up short — ${listing_id}`,
          html: alertHtml(
            "A wire transfer partially funded but hasn't reached the full amount yet",
            [
              ["Listing ID", listing_id],
              ["Buyer ID", buyer_id ?? "—"],
              ["Expected", money(expected)],
              ["Received so far", money(received)],
              ["Still short", money(shortfall)],
              ["PaymentIntent", pi.id],
            ],
            "Listing remains in awaiting_payment — nothing has settled. Stripe will fire payment_intent.succeeded automatically if the buyer sends the rest. If they don't, the normal day-2 reminder and 10-business-day abandonment timeout still apply. No action needed unless you want to reach out to the buyer directly.",
          ),
        });
      }

      await claimEvent();
      return jsonResponse({ received: true });
    }

    // ── ACH BOUNCED ────────────────────────────────────────────────────────
    // Insufficient funds, closed account, wrong details, or the buyer's bank
    // refusing the debit. Without this handler the listing sits in
    // awaiting_payment forever: unbuyable by anyone else, with no money behind
    // it, and nobody told. That is the single worst outcome in the whole ACH
    // path, and it is a handler that is easy to forget to subscribe to in the
    // Stripe dashboard — if bank payments seem to vanish, check the endpoint's
    // event list first.
    //
    // No handover code can exist here: codes are minted on the flip to
    // pending_confirmation, which an unsettled sale never reached. Nothing to
    // revoke, nothing to claw back.
    if (event.type === "checkout.session.async_payment_failed") {
      const sessionId = (event.data.object as { id: string }).id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const meta = (session.metadata ?? {}) as Record<string, string>;
      const { listing_id, buyer_id } = meta;

      if (!listing_id) {
        console.error("async_payment_failed with no listing_id in metadata", sessionId);
        await claimEvent();
        return jsonResponse({ received: true, ignored: "no listing_id" });
      }

      // Only un-park a row this payment actually parked. Guarding on
      // awaiting_payment means a redelivered failure event cannot reopen a car
      // that has since been paid for and handed over.
      const { data: freed, error: freeErr } = await supabase
        .from("listings")
        .update({
          status: "active",
          buyer_id: null,
          stripe_payment_intent_id: null,
        })
        .eq("id", listing_id)
        .eq("status", "awaiting_payment")
        .select("make, model, year, seller_id")
        .maybeSingle();

      if (freeErr) {
        console.error("async_payment_failed un-park failed:", freeErr.message, listing_id);
        return jsonResponse({ error: "listings update failed", detail: freeErr.message }, 500);
      }

      const label = freed
        ? [freed.year, freed.make, freed.model].filter(Boolean).join(" ")
        : listing_id;

      if (freed) {
        const [{ data: b }, { data: sl }] = await Promise.all([
          buyer_id
            ? supabase.from("users").select("name, email").eq("id", buyer_id).single()
            : Promise.resolve({ data: null }),
          freed.seller_id
            ? supabase.from("users").select("name, email").eq("id", freed.seller_id).single()
            : Promise.resolve({ data: null }),
        ]);

        if (b?.email) {
          await sendEmail({
            to: b.email,
            subject: `Your bank transfer for the ${label} didn't go through`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
              <h2 style="font-size:18px;margin:0 0 14px;">The bank transfer didn't complete</h2>
              <p style="font-size:15px;line-height:1.55;">Your payment for the <b>${label}</b> was returned by the bank, so the purchase didn't go ahead. <b>You haven't been charged</b>, and no money is being held.</p>
              <p style="font-size:15px;line-height:1.55;">Banks return transfers for ordinary reasons — available balance, account details, or debit restrictions. Your bank can tell you which.</p>
              <p style="font-size:14px;line-height:1.55;color:#374151;">The listing is available again if you'd like to try, by bank transfer or card.</p>
              <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
            </div>`,
          });
        }

        if (sl?.email) {
          await sendEmail({
            to: sl.email,
            subject: `Your ${label} is back on sale`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;max-width:520px;">
              <h2 style="font-size:18px;margin:0 0 14px;">That bank transfer didn't clear</h2>
              <p style="font-size:15px;line-height:1.55;">The bank transfer for your <b>${label}</b> was returned, so the sale didn't complete. Your listing is active again and open to other buyers.</p>
              <p style="font-size:14px;line-height:1.55;color:#374151;">This is exactly why we asked you not to hand over the vehicle before the payment cleared. If you already did, contact us straight away.</p>
              <p style="font-size:12px;color:#6b7280;margin-top:24px;">DriveLink · drivelink.deals</p>
            </div>`,
          });
        }
      }

      notifyAdmin({
        subject: `❌ Bank payment FAILED — ${label}`,
        html: alertHtml("ACH debit returned by the bank", [
          ["Vehicle", label],
          ["Amount attempted", money(session.amount_total ?? 0)],
          ["Buyer ID", buyer_id ?? "—"],
          ["Listing ID", listing_id],
          ["Listing reopened", freed ? "yes" : "NO — was not in awaiting_payment"],
        ], freed
          ? "No money moved and no handover code ever existed. The listing is active again and both parties were emailed."
          : "The listing was NOT in awaiting_payment, so nothing was reopened. If this sale later settled and completed, a car may have been handed over against a payment that has now been returned — check this one by hand."),
      });

      await claimEvent();
      return jsonResponse({ received: true, paymentFailed: true });
    }

    if (event.type === "account.updated") {
      // Same reasoning as above — fetch the full account object rather than
      // trusting fields on the event body.
      const accountId = (event.data.object as { id: string }).id;
      const account = await stripe.accounts.retrieve(accountId);
      await supabase
        .from("users")
        .update({ stripe_payouts_enabled: account.payouts_enabled })
        .eq("stripe_account_id", account.id);
    }

    if (event.type === "identity.verification_session.verified") {
      // Fetch the full session so we get metadata reliably regardless of
      // thin/snapshot payload style, same pattern as checkout sessions above.
      const sessionId = (event.data.object as { id: string }).id;
      const session = await stripe.identity.verificationSessions.retrieve(sessionId);
      const userId = (session.metadata as Record<string, string> | null)?.drivelink_user_id;
      if (userId) {
        await supabase
          .from("users")
          .update({ identity_verification_status: "verified", verified: true })
          .eq("id", userId);
      } else {
        console.error("identity.verification_session.verified event had no drivelink_user_id in metadata", sessionId);
      }
    }

    if (event.type === "identity.verification_session.requires_input") {
      // The session needs the user to retry (bad photo, mismatch, expired
      // document, etc). Mark as "failed" so the Profile page shows a retry
      // prompt instead of leaving them stuck on "pending" forever.
      const sessionId = (event.data.object as { id: string }).id;
      const session = await stripe.identity.verificationSessions.retrieve(sessionId);
      const userId = (session.metadata as Record<string, string> | null)?.drivelink_user_id;
      if (userId) {
        await supabase
          .from("users")
          .update({ identity_verification_status: "failed" })
          .eq("id", userId);
      } else {
        console.error("identity.verification_session.requires_input event had no drivelink_user_id in metadata", sessionId);
      }
    }

    await claimEvent();
    return jsonResponse({ received: true });
  } catch (err) {
    console.error("stripe-webhook processing error:", err);

    // A thrown error means a paid checkout may not have been recorded. The
    // event is deliberately NOT claimed above, so returning 500 puts it back
    // in Stripe's retry queue — which is what fixes a transient fault, and
    // what buys time to ship a fix for a real one before the retries lapse.
    //
    // No admin email: retries would send one per attempt. Stripe's own
    // endpoint-failure notification covers the case where they all fail.
    return jsonResponse(
      { error: "processing failed", detail: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});