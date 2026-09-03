-- Inspector directory feature (added 2026-09-03)
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- New table: pre-purchase-inspection (PPI) businesses that DriveLink buyers can
-- discover and contact before completing a purchase. Free to list, no paid
-- placement — deliberately kept fee-free to stay consistent with the existing
-- no-fee PPI mechanic outreach stance and to avoid touching the open
-- brokering / money-transmitter licensure question (see PPI outreach notes).
-- No inspector login/dashboard in v1: submissions go into a moderation queue
-- an admin approves or rejects from the Admin Panel, same shape as `reports`.

create table if not exists inspectors (
  id text primary key,
  business_name text not null,
  contact_email text not null,
  contact_phone text,
  service_area text,        -- free text, e.g. "NY/NJ/CT tri-state"
  price_range text,         -- free text, e.g. "$150-$250"
  booking_link text,        -- external contact/booking URL buyers are sent to
  notes text,               -- short blurb shown on the public listing card
  status text not null default 'pending', -- pending | approved | rejected
  created_at timestamptz default now()
);
alter table inspectors enable row level security;

-- Self-serve "list your business" form — no account required, so the insert
-- itself carries no identity check. status is forced to 'pending' so a
-- submission can never insert itself as already-approved.
create policy "anyone can submit an inspector listing" on inspectors
  for insert with check (status = 'pending');

-- Public directory only shows approved listings.
create policy "anyone can read approved inspectors" on inspectors
  for select using (status = 'approved');

-- Admins can see and moderate everything, pending included. A second SELECT
-- policy is additive (Postgres OR's permissive policies together) rather than
-- replacing the public one above — same pattern as the `reports` table.
create policy "admins can read all inspectors" on inspectors
  for select using (exists (select 1 from users where users.id = auth.uid()::text and users.role = 'admin'));
create policy "admins can update inspectors" on inspectors
  for update using (exists (select 1 from users where users.id = auth.uid()::text and users.role = 'admin'));
create policy "admins can delete inspectors" on inspectors
  for delete using (exists (select 1 from users where users.id = auth.uid()::text and users.role = 'admin'));
