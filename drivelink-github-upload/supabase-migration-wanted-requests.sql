-- Wanted-car alerts: a visitor with no account says what they are looking for
-- and gets one email when a matching car is listed. Written only by the
-- wanted-alert edge function (service role); matched and emailed by the
-- notify-wanted edge function on an hourly cron.
--
-- RLS is ON with NO policies on purpose: the browser can neither read nor write
-- these tables. Visitors' email addresses stay server-side.

create table if not exists public.wanted_requests (
  id                 text primary key,
  email              text not null,
  make               text,
  model              text,
  max_price          integer,              -- cents, like every price here; null = any
  lang               text not null default 'en',
  unsubscribe_token  uuid not null default gen_random_uuid() unique,
  unsubscribed_at    timestamptz,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default (now() + interval '60 days')
);

create index if not exists wanted_requests_email_created_idx
  on public.wanted_requests (lower(email), created_at desc);
create index if not exists wanted_requests_open_idx
  on public.wanted_requests (created_at desc)
  where unsubscribed_at is null;

create table if not exists public.wanted_notifications (
  request_id text not null references public.wanted_requests(id) on delete cascade,
  listing_id text not null references public.listings(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (request_id, listing_id)
);

alter table public.wanted_requests enable row level security;
alter table public.wanted_notifications enable row level security;

-- The existing /unsubscribe page calls unsubscribe_lead(token). Extend it so the
-- same link also stops a wanted-car alert. Behavior for email_leads is unchanged.
create or replace function public.unsubscribe_lead(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare n int; m int;
begin
  update public.email_leads
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token;
  get diagnostics n = row_count;

  update public.wanted_requests
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token;
  get diagnostics m = row_count;

  return (n + m) > 0;
end $function$;

-- Hourly matcher. Uses the same Vault secret as the other cron jobs.
select cron.schedule(
  'notify-wanted',
  '11 * * * *',
  $$
  select net.http_post(
    url := 'https://ykzovtfwcjkaigwznrsi.supabase.co/functions/v1/notify-wanted',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_shared_secret'))
  );
  $$
);
