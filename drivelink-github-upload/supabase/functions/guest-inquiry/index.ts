// guest-inquiry
//
// Lets a signed-out visitor either
//   kind "message": email the seller about a car, or
//   kind "save":    email themselves a link to a car,
// with just an email address. No account, no password.
//
// The seller's address is never returned to the browser. A "message" goes to the
// seller with Reply-To set to the visitor, so the seller can answer straight from
// their inbox; the visitor gets a short confirmation.
//
// Abuse controls (this is an unauthenticated endpoint that sends email):
//   - honeypot field, silently accepted and dropped
//   - only active, non-private, non-test listings
//   - links in the message or name are rejected
//   - max 3 requests per email per hour, max 20 per listing per day
//   - message length 10-1000 characters
//
// Deploy with JWT verification OFF (visitors are not signed in):
//   supabase functions deploy guest-inquiry --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

// Self-contained on purpose: _shared/helpers.ts pulls in the Stripe SDK, which
// this function doesn't need.
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
// Sends from notifications@ like the other functions (a send-only address).
// Replies go to Reply-To, never to the From address.
const FROM = "DriveLink <notifications@drivelink.deals>";
const ADDRESS = "DriveLink LLC, 971 US Highway 202N, Ste N, Branchburg, NJ 08876";

const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const LINK_RE = /(https?:\/\/|www\.|\.com\/|\.net\/|\.org\/)/i;

type Lang = "en" | "es";

const COPY = {
  en: {
    confSubject: (car: string) => `We sent your message about the ${car}`,
    confBody: (car: string) =>
      `Your message about the ${car} is on its way to the seller. They will reply to this email address.`,
    saveSubject: (car: string) => `Your saved car: ${car}`,
    saveBody: (car: string) => `Here is the link to the ${car} you were looking at.`,
    view: "View the listing",
    tip: "Tip: don't send money before you have seen the car. DriveLink can hold the payment until the car and signed title change hands.",
    why: "You're getting this because you asked for it on drivelink.deals. We won't add you to a mailing list.",
  },
  es: {
    confSubject: (car: string) => `Enviamos tu mensaje sobre el ${car}`,
    confBody: (car: string) =>
      `Tu mensaje sobre el ${car} va en camino al vendedor. Te responderá a este correo.`,
    saveSubject: (car: string) => `Tu auto guardado: ${car}`,
    saveBody: (car: string) => `Aquí tienes el enlace al ${car} que estabas viendo.`,
    view: "Ver el anuncio",
    tip: "Consejo: no envíes dinero antes de ver el auto. DriveLink puede retener el pago hasta que el auto y el título firmado cambien de manos.",
    why: "Recibes esto porque lo pediste en drivelink.deals. No te agregaremos a ninguna lista de correo.",
  },
} as const;

function shell(inner: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px;">
<p style="margin:0 0 18px 0;font-size:15px;font-weight:700;"><span style="color:#FFB020;">&#9679;</span> DriveLink</p>
${inner}
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">${esc(footer)}<br>${esc(ADDRESS)}</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(opts: { to: string; subject: string; html: string; text: string; replyTo?: string }) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      reply_to: opts.replyTo ?? "support@drivelink.deals",
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
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

  const listingId = String(body.listing_id ?? "").slice(0, 80);
  const kind = body.kind === "save" ? "save" : body.kind === "message" ? "message" : null;
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const message = String(body.message ?? "").trim().slice(0, 1000);
  const lang: Lang = body.lang === "es" ? "es" : "en";

  if (!listingId || !kind) return jsonResponse({ error: "bad_request" }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return jsonResponse({ error: "invalid_email" }, 400);
  if (kind === "message") {
    if (message.length < 10) return jsonResponse({ error: "message_short" }, 400);
    if (LINK_RE.test(message) || LINK_RE.test(name)) return jsonResponse({ error: "no_links" }, 400);
  }

  const admin = supabaseAdmin();

  const { data: listing } = await admin
    .from("listings")
    .select("id, year, make, model, seller_id, status, is_private, is_test")
    .eq("id", listingId)
    .maybeSingle();
  if (!listing || listing.status !== "active" || listing.is_private === true || listing.is_test === true) {
    return jsonResponse({ error: "listing_unavailable" }, 404);
  }

  // Rate limits.
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: byEmail } = await admin
    .from("guest_inquiries")
    .select("id", { count: "exact", head: true })
    .ilike("email", email)
    .gte("created_at", hourAgo);
  if ((byEmail ?? 0) >= 3) return jsonResponse({ error: "rate_limited" }, 429);
  const { count: byListing } = await admin
    .from("guest_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("listing_id", listingId)
    .eq("kind", "message")
    .gte("created_at", dayAgo);
  if (kind === "message" && (byListing ?? 0) >= 20) return jsonResponse({ error: "rate_limited" }, 429);

  const id = "gi" + Date.now() + Math.random().toString(36).slice(2, 7);
  const { error: insErr } = await admin.from("guest_inquiries").insert({
    id, listing_id: listingId, kind, email, name: name || null, message: kind === "message" ? message : null, lang,
  });
  if (insErr) {
    console.error("guest-inquiry insert failed", insErr.message);
    return jsonResponse({ error: "server_error" }, 500);
  }

  const car = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");
  const url = `${SITE}/listing/${listing.id}`;
  const c = COPY[lang];

  try {
    if (kind === "message") {
      const { data: seller } = await admin.from("users").select("email, name").eq("id", listing.seller_id).maybeSingle();
      if (seller?.email) {
        const who = name || email;
        const html = shell(
          `<h1 style="margin:0 0 12px 0;font-size:20px;">Someone is interested in your ${esc(car)}</h1>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;"><b>${esc(who)}</b> sent you this message from your DriveLink listing:</p>
<blockquote style="margin:0 0 18px 0;padding:12px 16px;background:#f1f5f9;border-radius:8px;font-size:15px;line-height:1.55;white-space:pre-wrap;">${esc(message)}</blockquote>
<p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;">Reply to this email to answer them directly. Their address is ${esc(email)}.</p>
<p style="margin:0 0 6px 0;"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">View your listing</a></p>
<p style="margin:18px 0 0 0;font-size:13px;line-height:1.5;color:#475569;">Staying safe: don't accept checks or overpayments, and don't hand over a signed title until the payment is secured. If you both agree on a price, DriveLink can hold the payment until the car and title change hands.</p>`,
          "You're getting this because a visitor contacted you about your listing on drivelink.deals.",
        );
        const text = `Someone is interested in your ${car}\n\n${who} wrote:\n\n${message}\n\nReply to this email to answer them directly (${email}).\n\nYour listing: ${url}\n\nStaying safe: don't accept checks or overpayments, and don't hand over a signed title until the payment is secured.\n\n${ADDRESS}`;
        await sendEmail({ to: seller.email, subject: `New inquiry about your ${car}`, html, text, replyTo: email });
        await admin.from("guest_inquiries").update({ seller_notified_at: new Date().toISOString() }).eq("id", id);
      } else {
        console.error("guest-inquiry: seller has no email", listing.seller_id);
      }
      const html = shell(
        `<h1 style="margin:0 0 12px 0;font-size:20px;">${esc(c.confSubject(car))}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">${esc(c.confBody(car))}</p>
<p style="margin:0 0 18px 0;"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(c.view)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#475569;">${esc(c.tip)}</p>`,
        c.why,
      );
      await sendEmail({ to: email, subject: c.confSubject(car), html, text: `${c.confBody(car)}\n\n${url}\n\n${c.tip}\n\n${c.why}\n${ADDRESS}` });
    } else {
      const html = shell(
        `<h1 style="margin:0 0 12px 0;font-size:20px;">${esc(c.saveSubject(car))}</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">${esc(c.saveBody(car))}</p>
<p style="margin:0 0 18px 0;"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(c.view)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#475569;">${esc(c.tip)}</p>`,
        c.why,
      );
      await sendEmail({ to: email, subject: c.saveSubject(car), html, text: `${c.saveBody(car)}\n\n${url}\n\n${c.tip}\n\n${c.why}\n${ADDRESS}` });
    }
  } catch (e) {
    // The row is stored, so nothing is lost; the visitor is told it didn't go.
    console.error("guest-inquiry email failed", (e as Error).message);
    return jsonResponse({ error: "email_failed" }, 502);
  }

  return jsonResponse({ ok: true });
});
