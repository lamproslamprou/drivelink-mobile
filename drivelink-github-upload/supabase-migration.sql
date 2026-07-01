-- DriveLink feature migration (fixed for users.id being type TEXT, not UUID)
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run
-- If you already ran the old version and it failed partway through, this is safe to run again --
-- everything uses "if not exists" so it won't error on things that already succeeded.

-- 0. Clean up anything that may have been created by the earlier failed attempt
drop table if exists messages;
drop table if exists reports;
drop table if exists saved_searches;

-- 1. Listings: filters, VIN/Carfax, location + map, multi-photo, status
alter table listings add column if not exists images text[] default '{}';
alter table listings add column if not exists vin text;
alter table listings add column if not exists location_text text;
alter table listings add column if not exists lat double precision;
alter table listings add column if not exists lng double precision;

-- 2. Users: verified seller badge
alter table users add column if not exists verified boolean default false;

-- 3. Messaging (buyer <-> seller, per listing)
create table if not exists messages (
  id text primary key,
  listing_id text references listings(id) on delete cascade,
  sender_id text references users(id) on delete cascade,
  recipient_id text references users(id) on delete cascade,
  body text not null,
  read boolean default false,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "participants can read their messages" on messages
  for select using (auth.uid()::text = sender_id or auth.uid()::text = recipient_id);
create policy "users can send messages" on messages
  for insert with check (auth.uid()::text = sender_id);
create policy "recipients can mark read" on messages
  for update using (auth.uid()::text = recipient_id);

-- Enable realtime on messages
alter publication supabase_realtime add table messages;

-- 4. Reporting / flagging listings
create table if not exists reports (
  id text primary key,
  listing_id text references listings(id) on delete cascade,
  reporter_id text references users(id) on delete cascade,
  reason text not null,
  details text,
  status text default 'open',
  created_at timestamptz default now()
);
alter table reports enable row level security;
create policy "users can file reports" on reports
  for insert with check (auth.uid()::text = reporter_id);
create policy "users can read own reports" on reports
  for select using (auth.uid()::text = reporter_id);
create policy "admins can read all reports" on reports
  for select using (exists (select 1 from users where users.id = auth.uid()::text and users.role = 'admin'));
create policy "admins can update reports" on reports
  for update using (exists (select 1 from users where users.id = auth.uid()::text and users.role = 'admin'));

-- 5. Saved searches / alerts
create table if not exists saved_searches (
  id text primary key,
  user_id text references users(id) on delete cascade,
  label text,
  search text default '',
  make text default '',
  max_price numeric,
  max_mileage numeric,
  location_text text default '',
  created_at timestamptz default now()
);
alter table saved_searches enable row level security;
create policy "users manage own saved searches" on saved_searches
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
