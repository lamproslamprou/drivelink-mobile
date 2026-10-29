// wanted-alert
//
// A visitor with no account says what car they want (make, model, a top price)
// and leaves an email. notify-wanted (hourly cron) emails them when a matching
// car is listed. No account, no password, no mailing list: one request is
// emailed only about listings that match it, and every email has an unsubscribe
// link (the existing /unsubscribe page, via unsubscribe_lead).
//
// Abuse controls (unauthenticated endpoint that sends email):
//   - honeypot field, silently accepted and dropped
//   - at least a make or a top price is required (no "send me everything")
//   - links in the text fields are rejected
//   - max 3 open requests per email; max 60 new requests per hour overall
//
// Deploy with JWT verification OFF (visitors are not signed in):
//   supabase functions deploy wanted-alert --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const supabaseAdmin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE = "https://drivelink.deals";
const FROM = "DriveLink <support@drivelink.deals>";
const REPLY_TO = "support@drivelink.deals";
const ADDRESS = "DriveLink LLC, 971 US Highway 202N, Ste N, Branchburg, NJ 08876";

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const LINK_RE = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|@)/i;

type Lang = "en" | "es";

const COPY = {
  en: {
    subject: (what: string) => `We'll watch for ${what}`,
    h: "We're on the lookout",
    p: (what: string) => `When a ${what} is listed on DriveLink, we'll email you once for each match. We'll keep watching for 60 days.`,
    browse: "Browse cars now",
    why: "You're getting this because you asked for a car alert on drivelink.deals.",
    unsub: "Stop these alerts",
  },
  es: {
    subject: (what: string) => `Estaremos atentos: ${what}`,
    h: "Estamos pendientes",
    p: (what: string) => `Cuando se publique en DriveLink un ${what}, te enviaremos un correo por cada coincidencia. Seguiremos atentos durante 60 días.`,
    browse: "Ver autos ahora",
    why: "Recibes esto porque pediste una alerta de auto en drivelink.deals.",
    unsub: "Dejar de recibir estas alertas",
  },
} as const;

function describe(make: string | null, model: string | null, maxCents: number | null, lang: Lang) {
  const car = [make, model].filter(Boolean).join(" ") || (lang === "es" ? "auto" : "car");
  const price = maxCents ? (lang === "es" ? ` por hasta $${Math.round(maxCents / 100).toLocaleString("en-US")}` : ` for up to $${Math.round(maxCents / 100).toLocaleString("en-US")}`) : "";
  return `${car}${price}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "bad_request" }, 400);
  }

  // Honeypot: real visitors never see or fill this field. Pretend success.
  if (typeof body.hp === "string" && body.hp.trim() !== "") return jsonResponse({ ok: true });

  const email = String(body.email ?? "").trim().toLowerCase();
  const make = String(body.make ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const model = String(body.model ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const lang: Lang = body.lang === "es" ? "es" : "en";
  const dollars = body.max_price === "" || body.max_price == null ? null : Number(body.max_price);

  if (!EMAIL_RE.test(email) || email.length > 254) return jsonResponse({ error: "invalid_email" }, 400);
  if (LINK_RE.test(make) || LINK_RE.test(model)) return jsonResponse({ error: "bad_request" }, 400);
  if (dollars != null && (!Number.isFinite(dollars) || dollars < 500 || dollars > 500000)) {
    return jsonResponse({ error: "invalid_price" }, 400);
  }
  if (!make && dollars == null) return jsonResponse({ error: "need_criteria" }, 400);
  const maxCents = dollars == null ? null : Math.round(dollars * 100);

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();

  // Same email, same request: treat as success without a duplicate.
  const { data: open } = await admin
    .from("wanted_requests")
    .select("id, make, model, max_price")
    .ilike("email", email)
    .is("unsubscribed_at", null)
    .gt("expires_at", nowIso);
  const dup = (open ?? []).some((r) =>
    (r.make ?? "").toLowerCase() === make.toLowerCase() &&
    (r.model ?? "").toLowerCase() === model.toLowerCase() &&
    (r.max_price ?? null) === maxCents);
  if (dup) return jsonResponse({ ok: true });
  if ((open?.length ?? 0) >= 3) return jsonResponse({ error: "rate_limited" }, 429);

  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: recent } = await admin
    .from("wanted_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", hourAgo);
  if ((recent ?? 0) >= 60) return jsonResponse({ error: "rate_limited" }, 429);

  const id = "wr" + Date.now() + Math.random().toString(36).slice(2, 7);
  const { data: row, error: insErr } = await admin
    .from("wanted_requests")
    .insert({ id, email, make: make || null, model: model || null, max_price: maxCents, lang })
    .select("unsubscribe_token")
    .single();
  if (insErr || !row) {
    console.error("wanted-alert insert failed", insErr?.message);
    return jsonResponse({ error: "server_error" }, 500);
  }

  // Confirmation. The request is stored either way, so a failed email is logged
  // but the visitor is still told the alert is set (the matcher will email them).
  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
    const c = COPY[lang];
    const what = describe(make || null, model || null, maxCents, lang);
    const unsubUrl = `${SITE}/unsubscribe?t=${row.unsubscribe_token}`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px;">
<p style="margin:0 0 18px 0;font-size:15px;font-weight:700;"><span style="color:#FFB020;">&#9679;</span> DriveLink</p>
<h1 style="margin:0 0 12px 0;font-size:20px;">${esc(c.h)}</h1>
<p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;">${esc(c.p(what))}</p>
<p style="margin:0;"><a href="${SITE}/browse" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(c.browse)}</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">${esc(c.why)} <a href="${unsubUrl}" style="color:#64748b;">${esc(c.unsub)}</a><br>${esc(ADDRESS)}</td></tr>
</table></td></tr></table></body></html>`;
    const text = `${c.p(what)}\n\n${SITE}/browse\n\n${c.why}\n${c.unsub}: ${unsubUrl}\n${ADDRESS}`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: email, reply_to: REPLY_TO, subject: c.subject(what), html, text,
        headers: { "List-Unsubscribe": `<${unsubUrl}>` },
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("wanted-alert confirmation failed", (e as Error).message);
  }

  return jsonResponse({ ok: true });
});
