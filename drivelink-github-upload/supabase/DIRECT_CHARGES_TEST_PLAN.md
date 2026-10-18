# Direct-charge mode: test plan (Stripe TEST mode only)

Nothing here is deployed. Do all of this against a Stripe **test** account and a
Supabase **branch or test project**, never the live one, until every box is ticked.

## 0. One-time setup
1. Run `migrations_direct_charges.sql` (adds listing columns, extends the settlement guard).
2. Stripe dashboard (test) -> Developers -> Webhooks -> the **"Connected accounts"** endpoint must
   listen to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.dispute.created`, `charge.dispute.closed`,
   `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `payout.failed`,
   `account.updated`, `payment_intent.succeeded`. Its signing secret is `STRIPE_WEBHOOK_SECRET_CONNECT`.
3. Secrets: `DIRECT_CHARGES=on`, `CRON_SECRET=<random>`.
4. Deploy (test project): create-checkout-session, create-connect-account, stripe-webhook,
   release-funds, confirm-handover, refund-listing, create-wire-session, process-pending-payouts.
   All import `../_shared/helpers.ts`, `direct.ts`, `promoter.ts`.
5. Schedule `process-pending-payouts` every 30 min with header `x-cron-secret`.

## 1. Card sale, happy path
- [ ] Seller (test Express account, finished onboarding) lists a car; buyer pays with `4242 4242 4242 4242`.
- [ ] In Stripe, the charge is on the **seller's connected account**, not the platform; platform
      balance did NOT rise by the car price; platform got only the application fee.
- [ ] Seller account: payout schedule = manual; debit_negative_balances = true.
- [ ] `listings`: charge_mode=direct, charge_account_id set, payout_status=held, seller_net = Stripe net.
- [ ] Buyer got the 6-digit code; seller's bank was NOT paid at checkout.
- [ ] Seller enters the code -> `payouts` created on the seller's account for exactly seller_net;
      listing sold; completion emails sent; Promoter credited if attached.
- [ ] Payout amount == seller_net; application fee == platform fee (+ Promoter slice if any).

## 2. Funds still settling
- [ ] Use a card that settles slowly (or enter the code immediately after payment): response says
      "still settling"; listing payout_status=pending; admin alert sent.
- [ ] Run `process-pending-payouts`; once balance is available it pays and completes the sale.

## 3. Promoter deals
- [ ] Marketplace sale with a Promoter link: application fee = platform fee + 1%; seller_net
      reduced by 1%; commission credited at release; platform balance covers payout-promoter.
- [ ] Buyer-initiated BYOD with Promoter: buyer charged price + 1%; seller_net unchanged.

## 4. ACH (price >= $15,000, identity-verified buyer)
- [ ] First checkout: seller lacks ACH capability -> buyer sees card only; capability requested.
- [ ] After capability active: bank option shown; listing parks in awaiting_payment; code withheld.
- [ ] `async_payment_succeeded` settles, release_not_before = +3 business days, payout waits.
- [ ] Return the debit (test bank `000111111116` fail case) -> listing re-opens, nothing paid.

## 5. Refund / cancel before release
- [ ] Admin resolves a dispute with refund: refund created on seller account, application fee
      returned to buyer, listing back to active, charge_mode reset.

## 6. Chargeback
- [ ] Trigger a test dispute (`4000 0000 0000 0259`): admin alert fires, listings.stripe_dispute_id
      set, confirming the handover now says "under bank review" and pays nothing.
- [ ] Close as won: hold clears; a pending payout proceeds. Close as lost after payout: loss shows on
      the seller's balance, not the platform's.

## 7. Wire
- [ ] With DIRECT_CHARGES=on, `create-wire-session` returns the "not available" error.

## 8. Regression (flag off)
- [ ] `DIRECT_CHARGES` unset: a card sale behaves exactly as before (platform balance, transfer on release).

## Known limits
- Wire is switched off in direct mode until bank transfers are confirmed to work as direct charges.
- The Promoter slice is fixed at checkout. If a Promoter attaches/detaches between checkout and release,
  settleReferral still pays what the referral row says; the difference comes from DriveLink's fee.
- Existing sellers are switched to manual payouts at their next direct checkout (ensureHoldingAccount).
- Express (v1) accounts + direct charges is supported by the API but Stripe says it is not the recommended
  combination; confirm with Stripe in writing before going live.
