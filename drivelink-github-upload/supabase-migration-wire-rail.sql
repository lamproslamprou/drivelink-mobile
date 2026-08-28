-- DriveLink Phase 2 — Domestic Wire Rail: data model additions
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to re-run: every ALTER TABLE uses "if not exists".
--
-- Reference: supabase/functions/stripe-webhook/PHASE2_WIRE_RAIL_SPEC.md §7.
--
-- IMPORTANT — READ BEFORE RUNNING PART 2:
-- This migration could NOT locate the SQL source of your
-- guard_listings_settlement_columns trigger anywhere in this repo (checked
-- supabase-migration.sql at the repo root — it predates this feature and
-- doesn't touch `listings` settlement columns — and there is no
-- supabase/migrations folder). That trigger was almost certainly applied
-- directly through the Supabase dashboard SQL editor and isn't
-- version-controlled here. Part 1 below (the four new columns) is safe to
-- run regardless. Part 2 (extending the guard) needs YOU to paste in the
-- trigger's real current definition first — see the instructions in Part 2.
-- Skipping Part 2 does not break anything today (create-wire-session, which
-- would actually write these columns, is out of scope for this build
-- session and hasn't been built yet) — but it MUST be done before
-- create-wire-session ships, or these four columns are writable by anyone,
-- not just service_role/admins, defeating the whole point of the guard.

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
-- Run this query FIRST to get your trigger function's real current
-- definition (Supabase Dashboard -> SQL Editor):
--
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where proname = 'guard_listings_settlement_columns';
--
-- Take whatever list of guarded column names that definition contains
-- (something like sale_price, platform_fee, seller_net, status,
-- release_not_before, auto_release_at, stripe_payment_intent_id, sold_at,
-- paid_at, handover_date — but use what the real function actually says,
-- not this guess) and add these four to it:
--
--   funding_type, payment_started_at, wire_reminder_sent_at, wire_reference_code
--
-- Then `create or replace function guard_listings_settlement_columns()` with
-- the updated list, keeping everything else about the function (the
-- service_role/admin bypass check, the trigger's timing and table binding)
-- byte-for-byte identical to what pg_get_functiondef returned. This
-- migration deliberately does not attempt that CREATE OR REPLACE itself —
-- guessing at a live security trigger's body and overwriting it is a worse
-- failure mode than leaving four columns unguarded for the short window
-- before create-wire-session ships.
