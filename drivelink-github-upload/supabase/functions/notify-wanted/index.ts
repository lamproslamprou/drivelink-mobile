// notify-wanted
//
// Hourly cron (pg_cron -> net.http_post, same Vault secret as the other jobs).
// Emails people who asked for a car alert (wanted_requests) when a matching
// car has been listed since they asked.
//
//   - a listing matches when it is active, public, not a test listing, was
//     created after the request, its make/model contain the requested text
//     (case-insensitive) and its price is within the requested maximum;
//   - one email per request per run, listing up to 3 matches;
//   - (request, listing) is recorded in wanted_notifications only after Resend
//     accepts the email, so a failed send is retried next run and a listing is
//     never sent twice;
//   - unsubscribed and expired (60 days) requests are skipped.
//
// AUTH: bearer CRON_SHARED_SECRET. Deploy: supabase functions deploy notify-wanted --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const SITE = "https://drivelink.deals";
const FROM = "DriveLink <support@drivelink.deals>";
const REPLY_TO = "support@drivelink.deals";
const ADDRESS = "DriveLink LLC, 971 US Highway 202N, Ste N, Branchburg, NJ 08876";
const MAX_REQUESTS_PER_RUN = 100;
const MAX_LISTINGS_PER_EMAIL = 3;

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const usd = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const COPY = {
  en: {
    subject: (n: number) => (n === 1 ? "A car you were watching for is listed" : `${n} cars you were watching for are listed`),
    h: (n: number) => (n === 1 ? "A match was just listed" : `${n} matches were just listed`),
    view: "View the listing",
    tip: "Tip: don't send money before you have seen the car. DriveLink can hold the payment until the car and signed title change hands.",
    why: "You're getting this because you asked for a car alert on drivelink.deals.",
    unsub: "Stop these alerts",
  },
  es: {
    subject: (n: number) => (n === 1 ? "Se publicó un auto que buscabas" : `Se publicaron ${n} autos que buscabas`),
    h: (n: number) => (n === 1 ? "Se acaba de publicar una coincidencia" : `Se acaban de publicar ${n} coincidencias`),
    view: "Ver el anuncio",
    tip: "Consejo: no envíes dinero antes de ver el auto. DriveLink puede retener el pago hasta que el auto y el título firmado cambien de manos.",
    why: "Recibes esto porque pediste una alerta de auto en drivelink.deals.",
    unsub: "Dejar de recibir estas alertas",
  },
} as const;

Deno.serve(async (req) => {
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!CRON_SECRET || got !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!RESEND_API_KEY) {
    console.error("notify-wanted: RESEND_API_KEY not set");
    return new Response(JSON.stringify({ error: "email not configured" }), { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const nowIso = new Date().toISOString();

  const { data: requests, error: reqErr } = await supabase
    .from("wanted_requests")
    .select("id, email, make, model, max_price, lang, unsubscribe_token, created_at")
    .is("unsubscribed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(MAX_REQUESTS_PER_RUN);
  if (reqErr) {
    console.error("notify-wanted requests failed:", reqErr.message);
    return new Response(JSON.stringify({ error: "query failed" }), { status: 500 });
  }
  if (!requests?.length) return new Response(JSON.stringify({ requests: 0, sent: 0 }), { status: 200 });

  const earliest = requests[0].created_at;
  const { data: listings, error: lErr } = await supabase
    .from("listings")
    .select("id, year, make, model, price, mileage, location_text, created_at")
    .eq("status", "active")
    .or("is_private.is.null,is_private.eq.false")
    .or("is_test.is.null,is_test.eq.false")
    .gte("created_at", earliest)
    .order("created_at", { ascending: false })
    .limit(500);
  if (lErr) {
    console.error("notify-wanted listings failed:", lErr.message);
    return new Response(JSON.stringify({ error: "query failed" }), { status: 500 });
  }
  if (!listings?.length) return new Response(JSON.stringify({ requests: requests.length, sent: 0 }), { status: 200 });

  const { data: already } = await supabase
    .from("wanted_notifications")
    .select("request_id, listing_id")
    .in("request_id", requests.map((r) => r.id));
  const seen = new Set((already ?? []).map((n) => `${n.request_id}|${n.listing_id}`));

  let sent = 0;
  let failed = 0;
  for (const r of requests) {
    const rMake = norm(r.make);
    const rModel = norm(r.model);
    const matches = listings
      .filter((l) => new Date(l.created_at).getTime() > new Date(r.created_at).getTime())
      .filter((l) => !seen.has(`${r.id}|${l.id}`))
      .filter((l) => !rMake || norm(l.make).includes(rMake) || rMake.includes(norm(l.make)))
      .filter((l) => !rModel || norm(l.model).includes(rModel) || rModel.includes(norm(l.model)))
      .filter((l) => r.max_price == null || Number(l.price) <= r.max_price)
      .slice(0, MAX_LISTINGS_PER_EMAIL);
    if (!matches.length) continue;

    const c = COPY[r.lang === "es" ? "es" : "en"];
    const unsubUrl = `${SITE}/unsubscribe?t=${r.unsubscribe_token}`;
    const items = matches.map((l) => {
      const title = [l.year, l.make, l.model].filter(Boolean).join(" ");
      const meta = [usd(Number(l.price)), l.mileage != null ? `${Number(l.mileage).toLocaleString("en-US")} mi` : "", l.location_text ?? ""].filter(Boolean).join(" · ");
      const url = `${SITE}/listing/${l.id}`;
      return { title, meta, url };
    });
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px;">
<p style="margin:0 0 18px 0;font-size:15px;font-weight:700;"><span style="color:#FFB020;">&#9679;</span> DriveLink</p>
<h1 style="margin:0 0 16px 0;font-size:20px;">${esc(c.h(items.length))}</h1>
${items.map((i) => `<div style="margin:0 0 16px 0;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;"><div style="font-size:16px;font-weight:700;">${esc(i.title)}</div><div style="font-size:14px;color:#475569;margin:4px 0 12px 0;">${esc(i.meta)}</div><a href="${i.url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:8px;">${esc(c.view)}</a></div>`).join("")}
<p style="margin:0;font-size:13px;line-height:1.5;color:#475569;">${esc(c.tip)}</p>
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">${esc(c.why)} <a href="${unsubUrl}" style="color:#64748b;">${esc(c.unsub)}</a><br>${esc(ADDRESS)}</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${c.h(items.length)}\n\n${items.map((i) => `${i.title}\n${i.meta}\n${i.url}`).join("\n\n")}\n\n${c.tip}\n\n${c.why}\n${c.unsub}: ${unsubUrl}\n${ADDRESS}`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM, to: r.email, reply_to: REPLY_TO, subject: c.subject(items.length), html, text,
          headers: { "List-Unsubscribe": `<${unsubUrl}>` },
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      const { error } = await supabase
        .from("wanted_notifications")
        .insert(matches.map((l) => ({ request_id: r.id, listing_id: l.id })));
      if (error) console.error(`notify-wanted record failed for ${r.id}:`, error.message);
      sent++;
    } catch (e) {
      failed++;
      console.error(`notify-wanted send failed for ${r.id}:`, (e as Error).message);
    }
  }
  console.log(`notify-wanted: requests ${requests.length}, sent ${sent}, failed ${failed}`);
  return new Response(JSON.stringify({ requests: requests.length, sent, failed }), { status: 200 });
});
