-- DriveLink Phase 2 — Domestic Wire Rail: data model additions
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to re-run: every ALTER TABLE uses "if not exists".
--
-- Reference: supabase/functions/stripe-webhook/PHASE2_WIRE_RAIL_SPEC.md §7.
--
-- STATUS: ALREADY APPLIED LIVE — 2026-08-28, via the Supabase MCP
-- (apply_migration, name `wire_rail_columns_and_guard`), directly against
-- project ykzovtfwcjkaigwznrsi. This file is now a historical record of
-- what was run, not a to-do. Both parts below reflect what actually landed
-- on the live database — Part 2 in particular is no longer placeholder
-- instructions: guard_listings_settlement_columns()'s real definition was
-- pulled live via `select pg_get_functiondef(oid) from pg_proc where
-- proname = 'guard_listings_settlement_columns'` and extended
-- byte-for-byte, with the four new columns added to the existing
-- settlement-fields check and nothing else touched. Re-running this file
-- is safe (Part 1's ALTERs are `if not exists`; Part 2's CREATE OR REPLACE
-- is idempotent) but should not be necessary.

-- ── Part 1: new columns on listings ─────────────────────────────────────────
alter table listings add column if not exists funding_type text;
alter table listings add column if not exists payment_started_at timestamptz;
alter table listings add column if not exists wire_reminder_sent_at timestamptz;
alter table listings add column if not exists wire_reference_code text;

comment on column listings.funding_type is
  'card | ach_debit | wire. Nullable — existing rows and card/ACH sales predate this column. Lets expire-stale-wires, admin views, and emails distinguish a wire-parked row from an ACH-parked row without inferring it from other fields.';
comment on column listings.payment_started_at is
  'When a wire (Customer Balance) payment session was created. Anchors the day-2 reminder and the WIRE_ABANDONMENT_TIMEOUT_BUSINESS_DAYS timeout in expire-stale-wires.';
comment on column listings.wire_reminder_sent_at is
  'Set once the day-2 buyer reminder email goes out, so expire-stale-wires does not resend it on every run. NULL until sent.';
comment on column listings.wire_reference_code is
  'The reference the buyer''s bank transfer should carry, if not simply reconstructable from stripe_payment_intent_id at settlement time. May end up unused — confirmed during create-wire-session implementation (see spec §7).';

-- ── Part 2: extend guard_listings_settlement_columns ────────────────────────
-- Real definition, pulled live via pg_get_functiondef and extended with only
-- the four new columns (funding_type, payment_started_at,
-- wire_reminder_sent_at, wire_reference_code) added to the existing
-- settlement-fields check. Everything else — the service_role/admin bypass,
-- the notification/schedule/dispute/verification checks below it, the
-- last_active_at and status-transition guards — is byte-for-byte identical
-- to what was live before this migration.

create or replace function public.guard_listings_settlement_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if public.is_admin() then return new; end if;
  if new.seller_id is distinct from old.seller_id
     or new.buyer_id is distinct from old.buyer_id
     or new.sale_price is distinct from old.sale_price
     or new.seller_net is distinct from old.seller_net
     or new.platform_fee is distinct from old.platform_fee
     or new.referral_code is distinct from old.referral_code
     or new.funds_released is distinct from old.funds_released
     or new.confirmed_at is distinct from old.confirmed_at
     or new.sold_at is distinct from old.sold_at
     or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.stripe_transfer_id is distinct from old.stripe_transfer_id
     or new.funding_type is distinct from old.funding_type
     or new.payment_started_at is distinct from old.payment_started_at
     or new.wire_reminder_sent_at is distinct from old.wire_reminder_sent_at
     or new.wire_reference_code is distinct from old.wire_reference_code
  then
    raise exception 'Settlement fields can only be changed by the platform.' using errcode = 'insufficient_privilege';
  end if;
  if new.final_notice_sent_at is distinct from old.final_notice_sent_at then raise exception 'Notification state can only be changed by the platform.' using errcode = 'insufficient_privilege'; end if;
  if new.auto_release_at is distinct from old.auto_release_at then raise exception 'The release schedule can only be changed by the platform.' using errcode = 'insufficient_privilege'; end if;
  if new.release_not_before is distinct from old.release_not_before then raise exception 'The release schedule can only be changed by the platform.' using errcode = 'insufficient_privilege'; end if;
  if new.dispute_status is distinct from old.dispute_status then raise exception 'Dispute status can only be changed by the platform.' using errcode = 'insufficient_privilege'; end if;
  if new.vin_verified is distinct from old.vin_verified or new.deal_assessment is distinct from old.deal_assessment or new.deal_assessment_at is distinct from old.deal_assessment_at then raise exception 'Verification fields can only be set by the platform.' using errcode = 'insufficient_privilege'; end if;
  if new.last_active_at is distinct from old.last_active_at then new.last_active_at := now(); end if;
  if old.status in ('awaiting_payment', 'pending_confirmation', 'sold', 'disputed') and new.status is distinct from old.status then raise exception 'A listing with a sale in progress cannot be changed from the app.' using errcode = 'insufficient_privilege'; end if;
  if new.status is distinct from old.status and new.status not in ('active', 'pending', 'archived', 'removed') then raise exception 'A listing cannot be moved into that state from the app.' using errcode = 'insufficient_privilege'; end if;
  return new;
end;
$function$;

-- Pre-existing gap, noticed incidentally while reading this trigger's live
-- source (not introduced by and not fixed by this migration): `paid_at` and
-- `handover_date` on `listings` are NOT in the guarded column list above,
-- so the app can write them directly. Out of scope for wire rail — flagging
-- here so it isn't lost.

-- ── Part 3: schedule the abandonment cron ───────────────────────────────────
-- expire-stale-wires re-uses the same `cron_shared_secret` Vault entry and
-- pattern already in place for expire-stale-acceptances / auto-release-cron
-- (project-wide Edge Function secrets — no new secret was needed).
select cron.schedule(
  'expire-stale-wires',
  '23 * * * *',
  $$
  select net.http_post(
    url := 'https://ykzovtfwcjkaigwznrsi.supabase.co/functions/v1/expire-stale-wires',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'cron_shared_secret'
      )
    )
  );
  $$
);
