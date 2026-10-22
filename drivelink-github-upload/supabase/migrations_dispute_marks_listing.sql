-- Filing a dispute must put the sale on hold. The browser cannot change a listing
-- that has a sale in progress (guard_listings_settlement_columns), so the app's own
-- update to status='disputed' was silently filtered out by RLS and the purchase card
-- never showed the dispute. Do it here, as the platform.
create or replace function public.mark_listing_disputed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  old_claims text := current_setting('request.jwt.claims', true);
begin
  if new.status = 'open' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    update public.listings
       set status = 'disputed'
     where id = new.listing_id
       and status = 'pending_confirmation'
       and buyer_id = new.buyer_id;
    perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  end if;
  return new;
end;
$$;

drop trigger if exists disputes_mark_listing_disputed on public.disputes;
create trigger disputes_mark_listing_disputed
after insert on public.disputes
for each row execute function public.mark_listing_disputed();
