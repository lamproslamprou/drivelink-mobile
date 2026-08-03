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
  alertHtml,
  money,
  stripeClient,
  supabaseAdmin,
  PLATFORM_FEE,
  PROMOTER_FEE,
  AUTO_RELEASE_DAYS,
  todayET,
} from "../_shared/helpers.ts";

// Stripe's standard US card pricing, used ONLY as a fallback when the real
// balance_transaction can't be read. Intentionally not a source of truth.
const FALLBACK_FEE_PERCENT = 0.029;
const FALLBACK_FEE_FIXED_CENTS = 30;

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
  const { data: existing } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return jsonResponse({ received: true, duplicate: true });
  await supabase.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    if (event.type === "checkout.session.completed") {
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

        // Money has already changed hands at this point. If the row update
        // failed, that is exactly when you most need to know — alert either
        // way, and say so in the subject.
        if (adErr) console.error("ad_placements update failed:", adErr.message, meta.ad_id);

        notifyAdmin({
          subject: adErr
            ? `⚠️ Ad paid but NOT activated — ${meta.ad_id}`
            : `New ad placement purchased — ${adRow?.business_name ?? "Unknown business"}`,
          html: alertHtml(
            adErr ? "Ad payment received but the placement did not activate" : "New ad placement",
            [
              ["Business", adRow?.business_name],
              ["Contact", adRow?.contact_email],
              ["Link", adRow?.link_url],
              ["Plan", adRow?.plan ?? plan],
              ["Amount", money(adRow?.amount_cents)],
              ["Runs", `${todayET(startDate)} to ${todayET(endDate)}`],
              ["Ad ID", meta.ad_id],
            ],
            adErr
              ? `Database error: ${adErr.message}. The customer has been charged — activate this manually.`
              : undefined,
          ),
        });

        return jsonResponse({ received: true });
      }

      const { listing_id, buyer_id } = meta;

      // Cents throughout. Stripe's amount_total IS the sale_price now — no
      // conversion, no rounding, no lost precision.
      const salePrice = session.amount_total ?? 0;
      const platformFee = Math.round(salePrice * PLATFORM_FEE);

      // ── Stripe's actual processing fee ────────────────────────────────────
      const realFeeCents = stripeFeeCentsFrom(paymentIntent);
      const feeWasEstimated = realFeeCents === null;
      // The fallback still rounds UP: overestimating the fee we don't control
      // keeps seller_net at or below the real balance. The old ceil-to-dollars
      // is gone — this is the exact cent figure Stripe reports.
      const stripeFee = realFeeCents ??
        (Math.ceil(salePrice * FALLBACK_FEE_PERCENT) + FALLBACK_FEE_FIXED_CENTS);
      const effectiveFeeCents = stripeFee;

      if (feeWasEstimated) {
        console.warn(
          "balance_transaction unavailable, estimating Stripe fee:",
          listing_id,
          effectiveFeeCents,
        );
      }

      // Only reserve a promoter cut if a pending referral actually exists —
      // this is the bug fix mentioned above.
      const { data: pendingRef } = await supabase
        .from("referrals")
        .select("id, promoter_id")
        .eq("listing_id", listing_id)
        .eq("status", "pending")
        .maybeSingle();

      const promoterFeeReserved = pendingRef ? Math.round(salePrice * PROMOTER_FEE) : 0;

      // Clamp at zero. On a sale small enough that fees exceed the price, a
      // negative seller_net would become a negative transfer amount and throw
      // inside release-funds. Record zero and let the alert flag it.
      const rawSellerNet = salePrice - platformFee - promoterFeeReserved - stripeFee;
      const sellerNet = Math.max(0, rawSellerNet);
      const netWasClamped = rawSellerNet !== sellerNet;

      const releaseAt = new Date();
      releaseAt.setDate(releaseAt.getDate() + AUTO_RELEASE_DAYS);

      const { data: soldListing, error: listingErr } = await supabase
        .from("listings")
        .update({
          status: "pending_confirmation",
          buyer_id,
          sale_price: salePrice,
          platform_fee: platformFee,
          seller_net: sellerNet,
          stripe_payment_intent_id: piId,
          sold_at: todayET(),
          // Precise payment instant. sold_at is a date and cannot carry this.
          // Read by evaluate_listing_risk() for INSTANT_CONFIRM / FAST_CLOSE.
          paid_at: new Date().toISOString(),
          auto_release_at: releaseAt.toISOString(),
        })
        .eq("id", listing_id)
        .select("make, model, year, seller_id")
        .single();

      if (listingErr) console.error("listings update failed:", listingErr.message, listing_id);

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
      const subject = listingErr
        ? `⚠️ Sale paid but listing NOT updated — ${listing_id}`
        : netWasClamped
        ? `⚠️ Sale recorded with $0 seller net — ${carLabel}`
        : feeWasEstimated
        ? `⚠️ Sale recorded with ESTIMATED processing fee — ${carLabel}`
        : `New car sale — ${carLabel} (${money(salePrice)})`;

      const footnote = listingErr
        ? `Database error: ${listingErr.message}. The buyer has been charged — reconcile this manually.`
        : netWasClamped
        ? `Fees exceeded the sale price, so seller net was clamped to $0. Check this before releasing.`
        : feeWasEstimated
        ? `Stripe's balance_transaction wasn't readable, so the processing fee above is an ESTIMATE. Compare it to the real fee on the payment in Stripe and adjust seller_net before release if it's off.`
        : `Funds auto-release in ${AUTO_RELEASE_DAYS} days unless the buyer confirms or disputes first.`;

      notifyAdmin({
        subject,
        html: alertHtml(
          listingErr
            ? "Payment received but the listing did not update"
            : "New sale — payment received, awaiting buyer confirmation",
          [
            ["Vehicle", carLabel],
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
            ["Auto-release", todayET(releaseAt)],
            ["Listing ID", listing_id],
          ],
          footnote,
        ),
      });
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

    return jsonResponse({ received: true });
  } catch (err) {
    console.error("stripe-webhook processing error:", err);

    // A thrown error here means a paid checkout may not have been recorded.
    // Silence was the old behavior; a log line nobody reads is not a signal.
    notifyAdmin({
      subject: "⚠️ Stripe webhook threw an error",
      html: alertHtml("Webhook processing failed", [
        ["Event type", event?.type],
        ["Event ID", event?.id],
        ["Error", err instanceof Error ? err.message : String(err)],
      ], "Check the function logs and Stripe dashboard — a payment may be unrecorded."),
    });

    // Still 200 so Stripe doesn't hammer retries on a bug we need to fix
    // server-side — but log loudly so it doesn't go unnoticed.
    return jsonResponse({ received: true, processingError: true });
  }
});