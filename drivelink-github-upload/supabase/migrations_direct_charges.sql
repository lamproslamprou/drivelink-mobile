-- Direct-charge mode (DriveLink never receives buyer money).
-- Additive and safe to run before deploying any code: every column defaults to
-- the legacy behaviour, so existing sales are untouched.

alter table public.listings
  add column if not exists charge_mode text not null default 'platform'
    check (charge_mode in ('platform', 'direct')),
  add column if not exists charge_account_id text,
  add column if not exists payout_status text not null default 'n/a'
    check (payout_status in ('n/a', 'held', 'pending', 'paid', 'failed')),
  add column if not exists stripe_payout_id text,
  add column if not exists stripe_dispute_id text;

create index if not exists listings_pending_payouts_idx
  on public.listings (payout_status)
  where payout_status = 'pending';

-- ── Guard: browsers must never write these ─────────────────────────────────
-- Same function that already protects seller_net / funds_released / etc.,
-- recreated verbatim (read from the live database 2026-10-16) plus one block
-- for the new money-routing columns.
create or replace function public.guard_listings_settlement_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if public.is_admin() then return new; end if;
  if new.seller_id                 is distinct from old.seller_id
     or new.buyer_id               is distinct from old.buyer_id
     or new.sale_price             is distinct from old.sale_price
     or new.seller_net             is distinct from old.seller_net
     or new.platform_fee           is distinct from old.platform_fee
     or new.referral_code          is distinct from old.referral_code
     or new.funds_released         is distinct from old.funds_released
     or new.confirmed_at           is distinct from old.confirmed_at
     or new.sold_at                is distinct from old.sold_at
     or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.stripe_payment_intent_id   is distinct from old.stripe_payment_intent_id
     or new.stripe_transfer_id         is distinct from old.stripe_transfer_id
     or new.funding_type           is distinct from old.funding_type
     or new.payment_started_at     is distinct from old.payment_started_at
     or new.wire_reminder_sent_at  is distinct from old.wire_reminder_sent_at
     or new.wire_reference_code    is distinct from old.wire_reference_code
     -- NEW: direct-charge routing and payout state
     or new.charge_mode            is distinct from old.charge_mode
     or new.charge_account_id      is distinct from old.charge_account_id
     or new.payout_status          is distinct from old.payout_status
     or new.stripe_payout_id       is distinct from old.stripe_payout_id
     or new.stripe_dispute_id      is distinct from old.stripe_dispute_id
  then
    raise exception 'Settlement fields can only be changed by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.final_notice_sent_at is distinct from old.final_notice_sent_at then
    raise exception 'Notification state can only be changed by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.auto_release_at is distinct from old.auto_release_at then
    raise exception 'The release schedule can only be changed by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.release_not_before is distinct from old.release_not_before then
    raise exception 'The release schedule can only be changed by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.dispute_status is distinct from old.dispute_status then
    raise exception 'Dispute status can only be changed by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.vin_verified is distinct from old.vin_verified
     or new.deal_assessment    is distinct from old.deal_assessment
     or new.deal_assessment_at is distinct from old.deal_assessment_at
  then
    raise exception 'Verification fields can only be set by the platform.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.last_active_at is distinct from old.last_active_at then
    new.last_active_at := now();
  end if;
  if old.status in ('awaiting_payment', 'pending_confirmation', 'sold', 'disputed')
     and new.status is distinct from old.status
  then
    raise exception 'A listing with a sale in progress cannot be changed from the app.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('active', 'pending', 'archived', 'removed')
  then
    raise exception 'A listing cannot be moved into that state from the app.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;
