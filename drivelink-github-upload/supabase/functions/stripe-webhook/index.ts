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

// Buffer between ACH settlement and the earliest possible payout. Business
// days, so a Friday settlement doesn't burn the buffer over a weekend when no
// bank return could arrive anyway.
const ACH_RELEASE_BUFFER_BUSINESS_DAYS = 3;

// Weekends only — US bank holidays are not modelled. The consequence of that
// simplification is a buffer that is occasionally a day short of intent, never
// a payout before settlement, so it fails in the safe direction.
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

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
// isn't readable. Rounds UP in both branches: overestimating a fee we do not
// control keeps seller_net at or below the money that actually exists.
function stripeFallbackFor(chargedTotalCents: number, bankDebit: boolean): number {
  if (bankDebit) {
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

      // ── What the car actually sold for ────────────────────────────────────
      // NOT amount_total. On a buyer-initiated BYOD deal with a Promoter
      // referral, the buyer is charged the agreed price PLUS a 1% referral
      // surcharge, so amount_total overstates the sale. Deriving fees from it
      // would take 1% of the inflated figure and — worse — still deduct the
      // promoter cut from the seller, charging the commission twice.
      //
      // create-checkout-session stamps both numbers. Fall back to amount_total
      // for sessions created before this existed, where the two are equal.
      const agreedPriceMeta = Number(session.metadata?.agreed_price);
      const salePrice = Number.isFinite(agreedPriceMeta) && agreedPriceMeta > 0
        ? agreedPriceMeta
        : (session.amount_total ?? 0);

      // How much of amount_total was the referral surcharge the BUYER paid.
      // Zero on marketplace sales and on seller-initiated deals, where the
      // commission comes out of the seller's proceeds instead.
      const surchargeMeta = Number(session.metadata?.promoter_surcharge);
      const promoterSurcharge = Number.isFinite(surchargeMeta) && surchargeMeta > 0
        ? surchargeMeta
        : 0;

      const platformFee = Math.round(salePrice * PLATFORM_FEE);

      // ── Stripe's actual processing fee ────────────────────────────────────
      const realFeeCents = stripeFeeCentsFrom(paymentIntent);
      const feeWasEstimated = realFeeCents === null;
      // The fallback still rounds UP: overestimating the fee we don't control
      // keeps seller_net at or below the real balance. The old ceil-to-dollars
      // is gone — this is the exact cent figure Stripe reports.
      // Estimated against what was actually CHARGED, not the agreed price —
      // Stripe's fee applies to amount_total, which includes any referral
      // surcharge.
      const chargedTotal = session.amount_total ?? salePrice;
      // Which rate card applies is read off the actual charge, not off what
      // Checkout offered. Getting this wrong costs the seller real money on
      // every ACH sale where balance_transaction isn't readable.
      const bankDebit = isBankDebit(paymentIntent);
      const stripeFee = realFeeCents ?? stripeFallbackFor(chargedTotal, bankDebit);
      const effectiveFeeCents = stripeFee;

      if (feeWasEstimated) {
        console.warn(
          "balance_transaction unavailable, estimating Stripe fee:",
          listing_id,
          effectiveFeeCents,
        );
      }

      // Only reserve a promoter cut if a pending referral actually exists.
      // findPendingReferrals covers marketplace rows (listing_id) and BYOD
      // rows (deal_id) — the plain listing_id filter used here before could
      // never see a broker's referral.
      const { refs: pendingRefs } = await findPendingReferrals(supabase, listing_id);
      const hasPendingRef = pendingRefs.length > 0;

      // Who absorbs the commission.
      //
      // Buyer paid it (promoterSurcharge > 0): it is already sitting in
      // amount_total on top of the agreed price. Reserving it again from the
      // seller would charge it twice, so the seller's deduction is zero.
      //
      // Seller pays it (surcharge 0): the marketplace behaviour, and what a
      // seller-initiated BYOD deal does. Comes out of their proceeds.
      const promoterFeeReserved = hasPendingRef && promoterSurcharge === 0
        ? Math.round(salePrice * PROMOTER_FEE)
        : 0;

      // Clamp at zero. On a sale small enough that fees exceed the price, a
      // negative seller_net would become a negative transfer amount and throw
      // inside release-funds. Record zero and let the alert flag it.
      // The seller nets the agreed price less DriveLink's cut, less Stripe's
      // processing fee, less the promoter cut ONLY when they are the one
      // paying it.
      //
      // Deliberate: when the buyer paid the surcharge, Stripe's fee was
      // charged on the larger total, so the seller absorbs processing on the
      // broker's commission too — roughly $9 on a $30,000 car. Judged not
      // worth the complexity of splitting; revisit if a seller queries it.
      const rawSellerNet = salePrice - platformFee - promoterFeeReserved - stripeFee;
      const sellerNet = Math.max(0, rawSellerNet);
      const netWasClamped = rawSellerNet !== sellerNet;

      // ── RELEASE CLOCK ─────────────────────────────────────────────────────
      // Anchored to the LATER of (payment + 7d) and (handover + 7d).
      //
      // This used to be payment + 7d unconditionally, which meant that on any
      // sale where the seller couldn't hand the car over promptly, the escrow
      // released to the seller before the buyer ever saw the vehicle. The
      // buyer's only recourse at that point was a dispute against money that
      // had already left the platform.
      //
      // handover_date arrives as a plain YYYY-MM-DD in session metadata,
      // written there by create-checkout-session (which reads it server-side
      // from the listing — never from the browser). Absent or unparseable, the
      // behaviour is byte-for-byte what it was before: payment + 7d. That is
      // deliberate, so this function is safe to deploy on its own, ahead of
      // the checkout change that starts populating the field.
      //
      // Noon UTC, not midnight: a calendar date two people agreed on carries
      // no time of day, and midnight sits close enough to a DST boundary to
      // shift the result by a day twice a year. Noon UTC is 7-8am ET whatever
      // the season. This matches guard_listings_handover() in the database —
      // the two must agree, or the trigger will quietly push the date around
      // after this function writes it.
      const paymentReleaseAt = new Date();
      paymentReleaseAt.setDate(paymentReleaseAt.getDate() + AUTO_RELEASE_DAYS);

      const handoverDate = handoverDateFromMeta(meta);

      let releaseAt = paymentReleaseAt;

      if (handoverDate) {
        const handoverReleaseAt = new Date(`${handoverDate}T12:00:00Z`);
        handoverReleaseAt.setDate(handoverReleaseAt.getDate() + AUTO_RELEASE_DAYS);

        // Math.max over getTime() rather than comparing Dates directly — `>`
        // on two Date objects coerces to string in some paths and compares
        // lexically, which is exactly the kind of bug that would silently
        // release money early.
        if (
          Number.isFinite(handoverReleaseAt.getTime()) &&
          handoverReleaseAt.getTime() > paymentReleaseAt.getTime()
        ) {
          releaseAt = handoverReleaseAt;
        }
      }

      // ── RELEASE FLOOR ─────────────────────────────────────────────────────
      // NULL on cards: a card charge that reached this point is settled money
      // and every existing sale behaves exactly as it did before ACH existed.
      //
      // On a bank debit, settlement + 3 business days. Stripe's own docs note
      // that in rare cases an ACH failure arrives from the bank AFTER the
      // payment has transitioned to succeeded, and the money for that failure
      // comes out of the platform balance. This is the window that covers.
      //
      // It does NOT cover the 60-day unauthorized-return window. See the
      // header. Nothing here does.
      const releaseNotBefore = bankDebit
        ? addBusinessDays(new Date(), ACH_RELEASE_BUFFER_BUSINESS_DAYS)
        : null;

      // The escalation deadline must never land before funds are even
      // releasable, or auto-release-cron would email both parties that their
      // sale is being paused for inaction during days when acting was
      // impossible. On a card this is a no-op.
      if (releaseNotBefore && releaseNotBefore.getTime() > releaseAt.getTime()) {
        releaseAt = new Date(releaseNotBefore.getTime());
        releaseAt.setDate(releaseAt.getDate() + AUTO_RELEASE_DAYS);
      }

      const { data: soldListing, error: listingErr } = await supabase
        .from("listings")
        .update({
          status: "pending_confirmation",
          // NULL on cards — see above.
          release_not_before: releaseNotBefore ? releaseNotBefore.toISOString() : null,
          buyer_id,
          sale_price: salePrice,
          platform_fee: platformFee,
          seller_net: sellerNet,
          stripe_payment_intent_id: piId,
          sold_at: todayET(),
          // Precise payment instant. sold_at is a date and cannot carry this.
          // Read by evaluate_listing_risk() for INSTANT_CONFIRM / FAST_CLOSE.
          paid_at: new Date().toISOString(),
          // Persisted so the agreed date survives on the listing itself, not
          // only in Stripe metadata. guard_listings_handover() takes over from
          // here: once this row is pending_confirmation the date can be pushed
          // later (a slipped handover) but never pulled earlier.
          ...(handoverDate ? { handover_date: handoverDate } : {}),
          auto_release_at: releaseAt.toISOString(),
        })
        .eq("id", listing_id)
        .select("make, model, year, seller_id")
        .single();

      // The buyer has been charged. Anything that stops the listing from
      // recording that is a retryable fault, not a finished job — return 500
      // and let Stripe redeliver rather than emailing a human to go and fix
      // the database by hand.
      //
      // No admin email on this path: Stripe retries several times over ~3
      // days, and one alert per attempt is noise. If every attempt fails,
      // Stripe's endpoint-failure notification is the thing that should reach
      // you — confirm it's enabled in the dashboard.
      if (listingErr) {
        console.error("listings update failed:", listingErr.message, listing_id);
        return jsonResponse({ error: "listings update failed", detail: listingErr.message }, 500);
      }

      // Referral stays "pending" — it's marked "paid" and credited to the
      // promoter's balance in release-funds, same moment the seller is paid,
      // same as the existing confirmReceipt() behavior.

      const [{ data: buyerRow }, { data: sellerRow }] = await Promise.all([
        supabase.from("users").select("name, email").eq("id", buyer_id).single(),
        soldListing?.seller_id
          ? supabase.from("users").select("name, email").eq("id", soldListing.seller_id).single()
          : Promise.resolve({ data: null }),
      ]);

      const carLabel = soldListing
        ? `${soldListing.year} ${soldListing.make} ${soldListing.model}`
        : listing_id;

      // Anything that needs a human eye goes in the subject line, in priority
      // order — a failed row update outranks a clamped net outranks an
      // estimated fee.
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
            ["Listing ID", listing_id],
          ],
          footnote,
        ),
      });

      // ── Buyer's handover code + seller's heads-up ────────────────────────
      // The code is created by trg_issue_handover_code, which fires on the
      // status flip to pending_confirmation in the UPDATE above — so it exists
      // by the time this SELECT runs. Read it back rather than generating one
      // here: two sources of truth for a release credential is how you end up
      // with a buyer holding a code the seller's entry will never match.
      //
      // Sent even though the app shows the code too. Email is the buyer's copy
      // of record at a parking lot with no signal, which is exactly where this
      // gets used.
      //
      // WARNING FOR THE ACH WORK: this block must move to
      // checkout.session.async_payment_succeeded before us_bank_account is
      // added to payment_method_types. On a delayed-notification method,
      // checkout.session.completed fires days before the money settles, and
      // mailing the code here would let a buyer take delivery of a car against
      // a payment that can still fail.
      {
        const { data: handover } = await supabase
          .from("escrow_handovers")
          .select("code")
          .eq("listing_id", listing_id)
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