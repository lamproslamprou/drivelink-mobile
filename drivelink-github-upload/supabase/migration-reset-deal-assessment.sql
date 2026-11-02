-- NOT YET APPLIED to the live project (the apply was cancelled on 2026-11-01).
-- Belt-and-braces for the page-side fix in App.jsx (freshAssessment): drop a
-- listing's saved AI deal check in the database itself whenever the facts it
-- was based on change, so it holds however the row is edited (seller form,
-- admin tools, SQL), not only through the app.
create or replace function public.reset_deal_assessment_on_listing_change()
returns trigger
language plpgsql
as $$
begin
  if new.deal_assessment is not distinct from old.deal_assessment
     and (new.price   is distinct from old.price
       or new.mileage is distinct from old.mileage
       or new.year    is distinct from old.year
       or new.make    is distinct from old.make
       or new.model   is distinct from old.model) then
    new.deal_assessment := null;
    new.deal_assessment_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_deal_assessment on public.listings;
create trigger trg_reset_deal_assessment
  before update of price, mileage, year, make, model on public.listings
  for each row execute function public.reset_deal_assessment_on_listing_change();

-- One-time cleanup of checks already out of date (edited since, or past the 14-day window).
update public.listings
   set deal_assessment = null, deal_assessment_at = null
 where deal_assessment is not null
   and (deal_assessment_at is null
        or deal_assessment_at < last_active_at
        or deal_assessment_at < now() - interval '14 days');
