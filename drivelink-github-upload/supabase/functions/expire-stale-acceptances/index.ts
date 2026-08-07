// expire-stale-acceptances
//
// Closes out accepted offers whose 48-hour payment window has lapsed. Without
// this, an acceptance the buyer never acts on strands the listing forever: the
// seller sees "waiting for them to complete purchase" indefinitely and other
// buyers see a car that looks spoken for.
//
// An expiry is the same soft state change the seller's "Cancel acceptance"
// button performs, tagged rescinded_by = 'system' so a later dispute can tell
// an automatic expiry apart from a seller who pulled out.
//
// GUARD: only offers whose listing is still 'active' expire. Once a listing
// moves to pending_confirmation / sold / disputed there is money in flight and
// the acceptance must stay exactly as it is — it is the record of what the two
// parties agreed to.
//
// AUTH: this endpoint cancels sellers' accepted offers, so it requires the
// service-role key as a bearer token. It previously accepted any request that
// reached the URL — the listing-state guard below limited what an attacker
// could destroy, but that is a blast-radius argument, not access control.
// Whatever schedules this function must send the header; see CALLER below.
//
// Deploy:
//   supabase functions deploy expire-stale-acceptances
//
// Dry run (changes nothing, reports what WOULD expire):
//   curl "https://<ref>.supabase.co/functions/v1/expire-stale-acceptances?dry=1" \
//     -H "Authorization: Bearer <service-role-key>"
//
// Every run logs a line whether or not it changed anything. auto-release-cron
// sat dead for weeks because a broken run and an idle run looked identical from
// the outside; a zero-row run here still prints "expired 0 of 0".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Listing states where money is in flight and an acceptance must not be touched.
const LOCKED_LISTING_STATES = ["pending_confirmation", "sold", "disputed"];

Deno.serve(async (req) => {
  // 0. Authorization. Constant-time-ish comparison isn't warranted here — the
  //    secret isn't guessable byte-by-byte over a network round trip — but the
  //    length check avoids comparing against an empty env var, which would let
  //    a bare "Bearer " through if SERVICE_ROLE were ever unset.
  const expected = SERVICE_ROLE ? `Bearer ${SERVICE_ROLE}` : null;
  const presented = req.headers.get("Authorization");
  if (!expected || presented !== expected) {
    console.warn("expire-stale-acceptances: rejected unauthorized request");
    return json({ error: "unauthorized" }, 401);
  }

  const startedAt = Date.now();
  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Candidates: accepted, past deadline. Rows with a null deadline predate
  //    the deadline column and are left alone rather than guessed at.
  const nowIso = new Date().toISOString();
  const { data: candidates, error: readErr } = await supabase
    .from("offers")
    .select("id, listing_id, buyer_id, seller_id, amount, payment_deadline")
    .eq("status", "accepted")
    .not("payment_deadline", "is", null)
    .lt("payment_deadline", nowIso);

  if (readErr) {
    console.error("expire-stale-acceptances: read failed", readErr.message);
    return json({ ok: false, stage: "read", error: readErr.message }, 500);
  }

  if (!candidates || candidates.length === 0) {
    console.log("expire-stale-acceptances: expired 0 of 0 (nothing past deadline)");
    return json({ ok: true, dryRun, candidates: 0, expired: 0, skipped: [] });
  }

  // 2. Pull the parent listings in one query so the guard costs one round trip
  //    rather than one per offer.
  const listingIds = [...new Set(candidates.map((o) => o.listing_id))];
  const { data: listings, error: listErr } = await supabase
    .from("listings")
    .select("id, status")
    .in("id", listingIds);

  if (listErr) {
    console.error("expire-stale-acceptances: listing read failed", listErr.message);
    return json({ ok: false, stage: "listings", error: listErr.message }, 500);
  }

  const statusById = new Map((listings ?? []).map((l) => [l.id, l.status]));

  const toExpire: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const offer of candidates) {
    const listingStatus = statusById.get(offer.listing_id);
    if (!listingStatus) {
      skipped.push({ id: offer.id, reason: "listing not found" });
      continue;
    }
    if (LOCKED_LISTING_STATES.includes(listingStatus)) {
      skipped.push({ id: offer.id, reason: `listing is ${listingStatus}` });
      continue;
    }
    toExpire.push(offer.id);
  }

  if (dryRun) {
    console.log(
      `expire-stale-acceptances: DRY RUN — would expire ${toExpire.length} of ${candidates.length}`,
      { toExpire, skipped },
    );
    return json({ ok: true, dryRun: true, candidates: candidates.length, wouldExpire: toExpire, skipped });
  }

  // 3. Update. The .eq("status","accepted") is repeated here deliberately: a
  //    buyer could complete the purchase between the read above and this write,
  //    and that race must resolve in favour of the completed sale.
  let expired = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const offerId of toExpire) {
    const { data, error } = await supabase
      .from("offers")
      .update({
        status: "rescinded",
        rescinded_at: new Date().toISOString(),
        rescinded_by: "system",
        rescind_reason: "payment window elapsed",
      })
      .eq("id", offerId)
      .eq("status", "accepted")
      .select("id");

    if (error) {
      failures.push({ id: offerId, error: error.message });
      continue;
    }
    // Zero rows means the status changed underneath us — the buyer won the race.
    if (data && data.length > 0) expired += 1;
    else skipped.push({ id: offerId, reason: "status changed during run" });
  }

  const ms = Date.now() - startedAt;
  console.log(
    `expire-stale-acceptances: expired ${expired} of ${candidates.length} candidates in ${ms}ms`,
    { skipped, failures },
  );

  return json({
    ok: failures.length === 0,
    dryRun: false,
    candidates: candidates.length,
    expired,
    skipped,
    failures,
    ms,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
