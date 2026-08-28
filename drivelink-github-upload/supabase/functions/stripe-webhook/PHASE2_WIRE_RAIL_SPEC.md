# Phase 2 — Domestic Wire Rail

Status: **spec only, not built.** Written to hand to a build session.
Scoped: 2026-08-25 (decisions) / 2026-08-27 (this document) / 2026-08-28
(open questions below resolved with Lampros — see each section).
Against: `supabase/functions/stripe-webhook/index.ts` as of this date (Task 1's
`ACH_MIN_CENTS` move and TDZ fix already applied — see that commit).

## 1. Purpose

Give high-value deals a domestic push-payment option (US wire, or ACH credit
initiated by the buyer's bank) alongside the existing card/ACH-debit checkout.
This is explicitly why GT3 Labs outreach is on hold — their deals are
six-figure, and card processing at that size is expensive; ACH debit has the
60-day unauthorized-return exposure documented in `stripe-webhook`'s header,
which gets worse, not better, as the dollar amount grows.

**Non-goals:** international wires / SWIFT (domestic only — everything below
assumes a US-only sender and receiving bank). No change to the Promoter
brokering legal question. No change to card or ACH-debit behavior except
where explicitly noted (`isBankDebit()`).

## 2. Recap: not touching this

The settlement-anchoring concern raised going into this session was a false
alarm. `stripe-webhook` already computes `auto_release_at` at settlement, not
at checkout — confirmed against the header comment (lines 27–64) and the
actual code path: the settlement block only runs when `session.payment_status
=== "paid"`, and for ACH that's `checkout.session.async_payment_succeeded`,
not `checkout.session.completed`. **No fix needed here.** This spec adds a
third path into that same already-correct anchoring logic; it does not change
how the anchor is computed.

## 3. Payment mechanism — confirmed: Stripe Customer Balance

**Confirmed with Lampros 2026-08-28.** The Aug 25 decision describes a
funding-instructions screen showing "routing, virtual account number,
reference code, exact amount" — a precise match for Stripe's **Customer
Balance** payment method (`payment_method_types: ["customer_balance"]`,
`payment_method_options.customer_balance.funding_type: "us_bank_transfer"`).
Creating a PaymentIntent this way and confirming it returns
`next_action.display_bank_transfer_instructions`, which carries exactly
those four fields per Stripe's API. When the buyer's bank sends the wire or
ACH credit into that virtual account, Stripe fires `payment_intent.succeeded`
on the underlying PaymentIntent — no Checkout Session is involved at any
point in this flow. It's also USD/US-bank-transfer only, which lines up
exactly with the domestic-only, no-SWIFT constraint from §1 — not a
coincidence; that's part of why this is the right fit rather than Stripe
Treasury or a third-party BaaS.

Everything below is written against this mechanism.

## 4. New function: `create-wire-session`

A companion to `create-checkout-session`, not a modification of it — the
decision was "a new screen alongside existing checkout," and Stripe's
Customer Balance flow doesn't go through Checkout Sessions, so this can't be
a branch inside the existing function without entangling two different
Stripe object models in one handler.

Mirrors `create-checkout-session`'s existing logic for: auth (`requireUser`),
listing/seller/BYOD lookups, promoter attribution (`attributedCode`,
`attributedPromoterId`, `buyerPaysPromoter`), handover date validation, and
the "who pays the promoter" arithmetic (`promoterSurcharge = buyerPaysPromoter
? Math.round(priceCents * PROMOTER_FEE) : 0`). None of that changes for a
wire buyer — reuse it rather than re-deriving it, ideally by factoring the
shared pieces (promoter attribution lookup, handover date parsing) into
`_shared/helpers.ts` so the two functions can't drift the way `settleSale`
logic already drifted once between `release-funds` and `auto-release-cron`
(see the `settleReferral` comment in `helpers.ts` for that history).

Gating: **high-value only**, per the decision. **Confirmed with Lampros
2026-08-28: shares `ACH_MIN_CENTS` ($15k)** rather than getting its own
constant. (Revised from this spec's first draft, which argued for a lower
wire-specific floor on the theory that wires carry none of ACH debit's
60-day return risk — but that risk is what gates *identity verification*,
not what sets the dollar threshold itself; the threshold is a cost/friction
trade-off, and arranging a wire is if anything more friction for the buyer
than linking a bank account for ACH debit through Checkout. No reason to
offer wires below the point ACH debit already covers.) Gate on the same
`chargedTotal` figure used for `achEligible` (price + any buyer-paid
surcharge), for consistency.

What it does, on top of the shared lookups:

1. Computes `agreedPrice` (cents) and `surcharge` (cents) exactly as
   `create-checkout-session` computes `priceCents` and `promoterSurcharge`.
   The buyer-facing total is `agreedPrice + surcharge` — shown as the
   breakdown (`$50,000 + $500 = $50,500`) per the decision, not as Stripe
   line items (there are none on this rail).
2. Creates a Stripe PaymentIntent for that total with
   `payment_method_types: ["customer_balance"]`,
   `payment_method_options.customer_balance.funding_type: "us_bank_transfer"`,
   and `metadata` carrying the same keys `stripe-webhook` already reads off
   Checkout Session metadata today: `listing_id`, `buyer_id`, `seller_id`,
   `handover_date`, `referral_code`, `agreed_price`, `promoter_surcharge`.
   This is what makes §5's extracted settlement function source-agnostic —
   it reads these keys the same way regardless of whether they came off a
   Checkout Session or a PaymentIntent directly.
3. Reads back `next_action.display_bank_transfer_instructions` — routing
   number, virtual account number, reference — for the screen to render, and
   sends the "same by email" copy (mirrors the pattern in
   `sendCompletionEmails` / the ACH "bank transfer started" email already in
   `stripe-webhook` — reuse that visual language, buyers have seen it before
   if they've used ACH).
4. Stamps the listing: `status = "awaiting_payment"`, `buyer_id`,
   `stripe_payment_intent_id`, plus (new column, see §7)
   `funding_type = "wire"` and `payment_started_at = now()` for the
   abandonment timer in §8. Same `.eq("status", "active")` guard
   `stripe-webhook` uses when parking an ACH sale, for the same reason: don't
   let a redelivered/duplicate call re-park a listing that's already moved on.

## 5. `stripe-webhook` changes

### 5.1 Extract `settleSale()` as an actual function

The Aug 25 decision refers to "`settleSale()`" as if it already exists as a
named, callable unit. It doesn't — today the settlement logic (fee
arithmetic, `listings` UPDATE, referral lookup, handover-code email, seller
email) is ~250 lines inline inside the `if (event.type ===
"checkout.session.completed" || event.type ===
"checkout.session.async_payment_succeeded")` block (lines ~480–797 as of this
writing). It's already shared between those two event types via that `||`,
but only because both deliver a `session` object with `session.metadata`.

A third trigger (`payment_intent.succeeded` on a `customer_balance`
PaymentIntent, see §5.2) delivers a *PaymentIntent*, not a Session — there is
no `session.metadata` to read. So this needs an actual extraction, not just a
third arm added to the existing `if`. Recommended shape:

```ts
async function settleSale(
  supabase: SupabaseClient,
  stripe: Stripe,
  input: {
    listingId: string;
    buyerId: string;
    piId: string | null;
    meta: Record<string, string>;       // agreed_price, promoter_surcharge, handover_date, referral_code
    isBankDebit: boolean;                 // false for wires — see 5.3
    stripeFeeCents: number | null;        // from stripeFeeCentsFrom(), or null → fallback path
    chargedTotalCents: number;            // for the fallback-fee estimate only
  },
): Promise<{ ok: boolean; ... }>
```

Everything from `agreedPriceMeta` (current line 489) through the two
completion emails (current line ~797) moves into this function largely
unchanged — it's already written in terms of `meta`, `salePrice`,
`promoterSurcharge`, `piId`, `bankDebit`, which is exactly the shape above.
The three call sites (`checkout.session.completed` paid branch,
`checkout.session.async_payment_succeeded`, and the new wire trigger) each
just need to assemble `input` from their respective Stripe object before
calling it.

**Idempotency across all three paths** (the Aug 25 requirement): the
existing dedup — `stripe_events` keyed on `event.id`, checked before any
processing and claimed via `claimEvent()` at the end — already covers
*retries of the same event* regardless of which of the three event types it
is. That doesn't change. What's new is worth stating explicitly for the build
session: nothing about extracting `settleSale()` should add a second
idempotency mechanism (e.g., a status check inside the function) unless a
real double-delivery scenario is identified — the current code doesn't guard
the main settlement UPDATE with a status filter (unlike the "park" branch,
which does `.eq("status", "active")`), and it's relied on event-level
idempotency instead. Keep that same posture for the wire path rather than
inventing a new pattern; flag in the build session if that assumption seems
wrong once the actual PaymentIntent flow is in front of you.

### 5.2 Third trigger

Add a handler for `payment_intent.succeeded`, scoped to PaymentIntents whose
`metadata.listing_id` is present (a wire/customer-balance PaymentIntent from
§4) — other PaymentIntents (e.g., ones created incidentally by Checkout,
which also fire this event) must be ignored, not re-settled. Guard on
`payment_method_types` or a metadata marker (e.g. stamp
`metadata.rail = "wire"` in `create-wire-session` and check for it here)
rather than assuming every `payment_intent.succeeded` is a wire — Checkout's
own PaymentIntents fire this event too and are already handled via
`checkout.session.completed`.

```ts
if (event.type === "payment_intent.succeeded") {
  const pi = event.data.object as Stripe.PaymentIntent;
  if (pi.metadata?.rail === "wire" && pi.metadata?.listing_id) {
    await settleSale(supabase, stripe, {
      listingId: pi.metadata.listing_id,
      buyerId: pi.metadata.buyer_id,
      piId: pi.id,
      meta: pi.metadata,
      isBankDebit: false,           // see 5.3 — never true for a wire
      stripeFeeCents: /* balance_transaction off pi.latest_charge, if expanded */,
      chargedTotalCents: pi.amount_received,
    });
    await claimEvent();
    return jsonResponse({ received: true });
  }
}
```

Retrieve the PaymentIntent expanded (`latest_charge.balance_transaction`) the
same way the existing code expands the Checkout Session, so the real Stripe
fee is available rather than falling back to the fallback-fee estimate.
Customer Balance transfers have their own (low, often zero for wire-in)
Stripe fee schedule — **do not** reuse `FALLBACK_FEE_PERCENT` or
`FALLBACK_ACH_FEE_PERCENT` for the wire fallback; if `balance_transaction`
isn't readable, this needs its own `FALLBACK_WIRE_FEE_CENTS` (likely a flat
small number or zero) rather than silently misestimating with a card or ACH
rate card that doesn't apply.

### 5.3 `isBankDebit()` must not catch wires

Direct requirement from the Aug 25 decision: *"a credit push can't bounce."*
`isBankDebit()` currently checks
`payment_method_details.type === "us_bank_account"`, which is the ACH
**debit** charge type. A Customer Balance wire/ACH-credit payment has a
different `payment_method_details.type` (Stripe reports these under the
`customer_balance` payment method, not `us_bank_account`), so the *existing*
function should already return `false` for a wire's PaymentIntent without
modification — but this needs to be verified against a real test
PaymentIntent in the build session, not assumed. If Stripe's shape doesn't
cleanly disambiguate, don't loosen `isBankDebit()`'s definition — instead
pass `isBankDebit: false` explicitly from the wire call site (as drafted in
§5.2), which is guaranteed correct regardless of what Stripe reports, and is
the safer default for a code path whose entire purpose is "wires release as
fast as cards."

Consequence, per the decision: `release_not_before` stays `NULL` for wires
(same as cards) — no 3-business-day buffer. That falls out for free once
`isBankDebit` is `false`, since `releaseNotBefore = bankDebit ?
addBusinessDays(...) : null` (current line 619) is unchanged logic, just fed
a `false` from a new source.

### 5.4 Underpayment / overpayment tolerance ($5)

Not currently modeled anywhere in `stripe-webhook` — cards and ACH debit
always charge exactly the agreed total because Stripe enforces the charged
amount. A wire doesn't have that guarantee: the buyer's bank may clip a fee,
or the buyer may fat-finger the amount. `settleSale()`'s wire call site needs
a comparison step before proceeding:

```
expected = agreedPrice + surcharge   // from metadata, cents
received = pi.amount_received        // cents, what actually landed
diff = received - expected
```

- `diff >= -500` (received is expected, or up to $5 under): proceed with
  settlement using `expected` as `salePrice` — the shortfall is absorbed by
  DriveLink's platform fee (confirmed below) rather than blocking the sale
  over a few dollars an intermediary bank clipped.
- `diff < -500` (more than $5 short): **do not** run `settleSale()`. Flag for
  manual review the same way a clamped seller-net or estimated fee already
  triggers an admin alert (`notifyAdmin`/`notifyAdminSync` with a distinct
  subject line, e.g. `⚠️ Wire underpaid — <car>`), and leave the listing in
  `awaiting_payment` rather than advancing it to `pending_confirmation`.
- `diff > 500` (more than $5 over): **do not** auto-refund — flagged
  explicitly as a non-goal in the decision, and Stripe can't reverse an
  incoming wire the way it reverses a card charge anyway. Settle at
  `expected` (the seller and buyer agreed to `expected`, not to whatever
  arrived) and raise the same kind of admin alert for manual contact with the
  buyer about the difference.

**Confirmed with Lampros 2026-08-28:** DriveLink's platform fee absorbs the
shortfall — `seller_net` is computed from `expected` as if the full amount
arrived. The seller's payout is never reduced by an under-$5 shortfall.

### 5.5 No line items

Straightforward given §4 — a `customer_balance` PaymentIntent has no
Stripe-side line items the way a Checkout Session does, so
`stripe-webhook`'s existing derivation of `salePrice` and `promoterSurcharge`
purely from `metadata.agreed_price` / `metadata.promoter_surcharge` (current
lines 489–500) already works unchanged for this path — it was written to not
trust `amount_total` for exactly the BYOD-surcharge reason, which happens to
also make it rail-agnostic. No new logic needed here beyond what §5.1's
extraction already carries over.

## 6. Abandonment handling

Not a `stripe-webhook` change — the webhook only fires when Stripe has
something to report, and a wire that never arrives produces no event at all.
This needs a new scheduled function, following the existing pattern of
`auto-release-cron` / `nudge-stale-listings` / `expire-stale-acceptances`.

**New function**, e.g. `expire-stale-wires`, run on the same kind of cron
schedule as the existing stale-listing sweepers:

- Query `listings` where `status = 'awaiting_payment'` and
  `funding_type = 'wire'` (new column, §7) and `payment_started_at` is old
  enough to need action.
- **Day 2**: send a reminder email to the buyer (funding instructions again,
  a nudge that the wire hasn't been seen yet). One-shot — track with a
  `wire_reminder_sent_at` timestamp (§7) so the cron doesn't re-send on every
  run.
- **At the timeout** (§9): do NOT silently expire. Per the decision, this
  must "alert rather than fire silently" — `notifyAdmin` with the listing,
  buyer, seller, and elapsed time, for a human to actually chase before
  anything closes out. **Confirmed with Lampros 2026-08-28: auto-reopen +
  alert, both** — the listing reopens to `active` automatically (mirroring
  what `checkout.session.async_payment_failed` does for a bounced ACH debit)
  and the admin alert still fires. A car does not sit locked forever, and
  a human still finds out.

## 7. Data model additions

New columns on `listings` (or a small side table if preferred, but these are
few enough fields that columns are consistent with how `handover_date` /
`release_not_before` were added for ACH):

- `funding_type` (text: `'card' | 'ach_debit' | 'wire'`, nullable/default for
  existing rows) — lets the abandonment cron, admin views, and emails
  distinguish a wire-parked row from an ACH-parked row without inferring it
  from other fields. (ACH debit doesn't strictly need this today since
  `async_payment_failed` handles its own timeout via Stripe's own signal, but
  having it for wires costs little and closes a gap in admin visibility.)
- `payment_started_at` (timestamptz) — when the wire session was created;
  anchors the day-2 reminder and the timeout.
- `wire_reminder_sent_at` (timestamptz, nullable) — set once the day-2 email
  goes out, so `expire-stale-wires` doesn't resend it.
- `wire_reference_code` (text, nullable) — the reference the buyer's bank
  transfer must carry, if it's not simply retrievable from the Stripe
  PaymentIntent id at settlement time. May not be needed as a separate column
  if Stripe's own reference is used as displayed and reconciliation happens
  by `stripe_payment_intent_id` alone — confirm during implementation.

`guard_listings_settlement_columns` (the BEFORE UPDATE trigger blocking
settlement-field writes from non-service-role callers) needs these new
columns added to its guarded list, same as any new settlement-adjacent field
— easy to miss since it's a DB trigger, not something a TypeScript compiler
will catch.

## 8. New constant

`ACH_MIN_CENTS` now lives in `_shared/helpers.ts` (Task 1) and is reused
as-is for wire gating (§4) — no `WIRE_MIN_CENTS` needed. The abandonment
timeout (§9) should be its own named constant in `helpers.ts` —
`WIRE_ABANDONMENT_TIMEOUT_BUSINESS_DAYS` — rather than a literal inside
`expire-stale-wires`, so it can be tightened later (per §9) without hunting
through a cron function for a magic number, and so `create-wire-session`'s
buyer-facing copy ("your wire should arrive within N business days") and the
cron's actual timeout can't drift apart the way the Aug 25 notes flagged as a
general risk pattern in this codebase (see `settleReferral`'s comment on
`release-funds`/`confirm-handover` drifting).

## 9. Timeout length — confirmed: 10 business days

**Confirmed with Lampros 2026-08-28.** Aug 25 agreed on 5 business days as a
baseline, with a note to consider shipping at 10 and tightening after seeing
real wire behavior — ship at **10**. The failure modes aren't symmetric: a
too-long timeout costs a locked listing for a few extra days; a too-short one
means chasing a wire that was always going to clear, or reopening a listing
right as a late payment lands and having to manually reconcile it back in.
10 gives real data on actual wire behavior before tightening. Ship it as the
`WIRE_ABANDONMENT_TIMEOUT_BUSINESS_DAYS` constant from §8, so tightening
later is a one-line change.

## 10. Rollout / testing checklist

All four open questions from the first draft (mechanism, threshold,
underpayment absorption, timeout behavior) were confirmed with Lampros
2026-08-28 — see §3, §4, §5.4, §6. What's left is build-time verification,
not decisions:

- [ ] `settleSale()` extraction: run existing card and ACH-debit flows
      through it post-refactor before adding the wire path — this is a
      refactor of already-shipped, real-money code, and needs to be proven
      behavior-identical first, independent of anything wire-specific.
- [ ] Add the new columns and extend `guard_listings_settlement_columns`.
- [ ] Test-mode Stripe Customer Balance PaymentIntent, full happy path:
      create → funding instructions rendered → simulated bank transfer →
      `payment_intent.succeeded` → `pending_confirmation` → handover code →
      release.
- [ ] Underpayment test (short by $3 and by $8), overpayment test (over by
      $3 and by $8) — confirm each lands in the right branch of §5.4.
- [ ] Abandonment test: force `payment_started_at` back past day 2 and past
      the timeout, confirm reminder and alert both fire, confirm idempotent
      re-runs of the cron don't double-send.
- [ ] Confirm `isBankDebit()` genuinely returns `false` against a real
      Stripe Customer Balance charge object, not just by construction (§5.3).
