-- Guest inquiries: lets a signed-out visitor email a seller, or email themselves
-- a car, with no account. Written only by the guest-inquiry edge function (service
-- role), which also sends the emails and enforces rate limits.
--
-- RLS is ON with NO policies on purpose: the browser can neither read nor write
-- this table. Guests' email addresses and messages stay server-side.

create table if not exists public.guest_inquiries (
  id                 text primary key,
  listing_id         text not null references public.listings(id) on delete cascade,
  kind               text not null check (kind in ('message', 'save')),
  email              text not null,
  name               text,
  message            text,
  lang               text not null default 'en',
  seller_notified_at timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists guest_inquiries_email_created_idx
  on public.guest_inquiries (lower(email), created_at desc);
create index if not exists guest_inquiries_listing_created_idx
  on public.guest_inquiries (listing_id, created_at desc);

alter table public.guest_inquiries enable row level security;

-- Internal accounts (owner, admins, throwaway testers). The app flags the
-- browser as internal when one of these signs in, so their activity stays out
-- of the analytics funnel and the Google Ads conversions.
alter table public.users add column if not exists is_internal boolean not null default false;
