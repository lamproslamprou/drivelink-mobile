// supabase/functions/_shared/direct.ts
//
// DIRECT-CHARGE MODE — DriveLink never receives the buyer's money.
//
// In this mode the buyer's payment is created ON the seller's connected Stripe
// account (a "direct charge"). DriveLink collects only an application fee, which
// Stripe splits off at payment time. The seller's account is set to MANUAL
// PAYOUTS, so the money sits in the seller's own Stripe balance and cannot reach
// their bank until DriveLink triggers a payout — which only happens after the
// handover code is entered (or the buyer confirms receipt) and the risk gate,
// dispute check and ACH settlement floor all pass.
//
// Everything about WHEN money may leave (code, risk gate, ACH floor) is unchanged.
// What changes is WHO holds the money while it waits: Stripe, in the seller's
// balance, not DriveLink's balance.
//
// Rows carry listings.charge_mode = 'direct' and listings.charge_account_id.
// Anything without that stamp is a legacy platform-balance sale and keeps using
// stripe.transfers.create exactly as before.

import type Stripe from "npm:stripe@16";
import { alertHtml, money, notifyAdminSync, sendCompletionEmails, settleReferral } from "./helpers.ts";
import { ensurePromoterCode } from "./promoter.ts";

/** True when NEW checkouts should be created as direct charges. */
export function directChargesEnabled(): boolean {
  return (Deno.env.get("DIRECT_CHARGES") ?? "").toLowerCase() === "on";
}

/**
 * Makes sure a seller's connected account holds its balance until we say so.
 * Idempotent and cheap; called before every direct checkout so existing
 * sellers need no separate migration.
 *
 *  - schedule.interval = manual : Stripe will not pay the seller's bank on its own.
 *  - debit_negative_balances    : if a chargeback or refund drives the seller's
 *    balance negative, Stripe debits the seller's bank to recover it, instead of
 *    waiting to collect from DriveLink.
 *
 * Returns the account so the caller can also inspect its capabilities.
 */
export async function ensureHoldingAccount(
  stripe: Stripe,
  accountId: string,
): Promise<Stripe.Account> {
  const acct = await stripe.accounts.retrieve(accountId);
  const payouts = acct.settings?.payouts;
  const needsManual = payouts?.schedule?.interval !== "manual";
  const needsDebit = payouts?.debit_negative_balances !== true;

  if (needsManual || needsDebit) {
    return await stripe.accounts.update(accountId, {
      settings: {
        payouts: {
          ...(needsDebit ? { debit_negative_balances: true } : {}),
          ...(needsManual ? { schedule: { interval: "manual" } } : {}),
        },
      },
    });
  }
  return acct;
}

export type PayoutAttempt =
  | { status: "paid"; payoutId: string; amountCents: number }
  | { status: "pending"; reason: string; availableCents: number }
  | { status: "failed"; reason: string };

/**
 * Pays the seller's share of ONE sale out of their own Stripe balance to their
 * bank. Never pays more than the listing's seller_net, so the seller's other
 * held sales are untouched.
 *
 * "pending" means the funds exist but Stripe has not made them available yet
 * (card funds settle in about 2 business days; longer on new accounts). The
 * caller records payout_status = 'pending' and process-pending-payouts retries.
 *
 * The idempotency key is per listing: a buyer confirming at the same moment the
 * seller enters the code cannot produce two payouts for one sale.
 */
export async function payoutSellerShare(
  stripe: Stripe,
  listing: {
    id: string;
    seller_net: number | string | null;
    charge_account_id: string | null;
    stripe_payment_intent_id: string | null;
  },
): Promise<PayoutAttempt> {
  const accountId = listing.charge_account_id;
  const amount = Number(listing.seller_net);
  if (!accountId) return { status: "failed", reason: "listing has no charge_account_id" };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "failed", reason: "listing has no valid seller_net" };
  }
  if (!listing.stripe_payment_intent_id) {
    return { status: "failed", reason: "listing has no stripe_payment_intent_id" };
  }

  // Which balance bucket the money is in. Stripe tracks card and bank-debit
  // funds separately and a payout draws on one named source.
  const pi = await stripe.paymentIntents.retrieve(
    listing.stripe_payment_intent_id,
    { expand: ["latest_charge"] },
    { stripeAccount: accountId },
  );
  const charge = pi.latest_charge && typeof pi.latest_charge === "object"
    ? pi.latest_charge
    : null;
  const methodType = charge?.payment_method_details?.type;
  const sourceType = methodType === "us_bank_account" ? "bank_account" : "card";

  const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
  const bucket = (balance.available ?? []).find((b) => b.currency === "usd");
  const availableTotal = bucket?.amount ?? 0;
  const availableForSource = bucket?.source_types?.[sourceType] ?? availableTotal;

  if (Math.min(availableTotal, availableForSource) < amount) {
    return {
      status: "pending",
      reason:
        `Seller balance has ${money(Math.min(availableTotal, availableForSource))} available ` +
        `(${sourceType}); needs ${money(amount)}. Funds are still settling.`,
      availableCents: Math.min(availableTotal, availableForSource),
    };
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount,
        currency: "usd",
        source_type: sourceType,
        metadata: { listing_id: listing.id },
        description: `DriveLink sale ${listing.id}`,
      },
      { stripeAccount: accountId, idempotencyKey: `payout_${listing.id}` },
    );
    return { status: "paid", payoutId: payout.id, amountCents: amount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Stripe says "insufficient funds" when pending funds were miscounted as
    // available; that is a retry, not a failure.
    if (/insufficient/i.test(message)) {
      return { status: "pending", reason: message, availableCents: 0 };
    }
    return { status: "failed", reason: message };
  }
}

/** Alert text shared by every caller when a payout needs a human. */
export async function alertPayoutProblem(
  carLabel: string,
  listingId: string,
  attempt: PayoutAttempt,
): Promise<void> {
  if (attempt.status === "paid") return;
  await notifyAdminSync({
    subject: attempt.status === "failed"
      ? `⚠️ Seller payout FAILED — ${carLabel}`
      : `Seller payout waiting on settlement — ${carLabel}`,
    html: alertHtml(
      attempt.status === "failed" ? "Payout could not be created" : "Payout queued",
      [
        ["Vehicle", carLabel],
        ["Listing ID", listingId],
        ["Reason", attempt.reason],
      ],
      attempt.status === "failed"
        ? "The handover is recorded and the buyer's money is safe in the seller's Stripe balance. Look at the seller's connected account in Stripe."
        : "process-pending-payouts will retry automatically until the funds are available.",
    ),
  });
}

// ── Shared tail of every release path ───────────────────────────────────────
//
// release-funds (buyer confirms), confirm-handover (seller enters the code) and
// process-pending-payouts (retry) all end the same way for a direct sale:
// pay the seller's share out of their own balance, and if that worked, mark the
// sale sold, settle the Promoter and send the receipts. Kept in one place so the
// three paths cannot drift.
//
// Callers must already have passed: caller authorization, the risk gate, the
// dispute check and the ACH settlement floor. This function does none of those.
//
// Never throws after a payout has been created.
export type DirectReleaseResult =
  | {
    released: true;
    payoutId: string;
    amountCents: number;
    referral: string;
    notified: boolean;
    promoterCode: string | null;
  }
  | { released: false; pending: true; reason: string }
  | { released: false; pending: false; reason: string };

export async function completeDirectRelease(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  listing: any,
  releasedVia: "handover_code" | "buyer_confirm" | "admin" | "admin_force_confirm",
): Promise<DirectReleaseResult> {
  const carLabel = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") ||
    listing.id;

  const attempt = await payoutSellerShare(stripe, listing);

  if (attempt.status !== "paid") {
    // Record the intent so process-pending-payouts can finish it. A failed
    // attempt is parked the same way: the money is safe in the seller's
    // balance either way, and a human is told.
    await supabase
      .from("listings")
      .update({ payout_status: attempt.status === "pending" ? "pending" : "failed" })
      .eq("id", listing.id);
    await alertPayoutProblem(carLabel, listing.id, attempt);
    return {
      released: false,
      pending: attempt.status === "pending",
      reason: attempt.reason,
    };
  }

  await supabase
    .from("listings")
    .update({
      status: "sold",
      funds_released: true,
      stripe_transfer_id: attempt.payoutId, // payout id in direct mode
      stripe_payout_id: attempt.payoutId,
      payout_status: "paid",
      review_flagged_at: null,
    })
    .eq("id", listing.id);

  const referral = await settleReferral(supabase, listing);

  let promoterCode: string | null = null;
  if (listing.seller_id) {
    const minted = await ensurePromoterCode(supabase, String(listing.seller_id));
    promoterCode = minted.code;
  }

  const notified = await sendCompletionEmails(supabase, listing, {
    transferId: attempt.payoutId,
    amountCents: attempt.amountCents,
    releasedVia,
    promoterCode,
  });

  return {
    released: true,
    payoutId: attempt.payoutId,
    amountCents: attempt.amountCents,
    referral: referral.outcome,
    notified: notified.ok,
    promoterCode,
  };
}
