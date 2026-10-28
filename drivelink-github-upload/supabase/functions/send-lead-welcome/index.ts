// send-lead-welcome
//
// Sends the one-time welcome email to people who asked for the free NJ private
// car sale packet (rows in public.email_leads). Run by pg_cron every 5 minutes.
//
// Each lead gets at most one welcome email:
//   - rows are CLAIMED atomically (welcome_claimed_at) before sending, so two
//     overlapping runs can't both email the same address;
//   - welcome_sent_at is stamped only after Resend accepts the message, so a
//     failed send is retried on a later run (claims older than 15 minutes are
//     retried); leads older than 3 days are never welcomed late;
//   - anyone with unsubscribed_at set is skipped.
//
// The email delivers the file they asked for, so it is mostly service content,
// but it still carries an unsubscribe link, a List-Unsubscribe header and the
// registered-agent postal address, as every DriveLink marketing-adjacent
// email must.
//
// AUTH: bearer CRON_SHARED_SECRET (same pattern as expire-stale-acceptances).
// Deploy: supabase functions deploy send-lead-welcome --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const SITE = "https://drivelink.deals";
const FROM = "DriveLink <hello@drivelink.deals>";
const REPLY_TO = "support@drivelink.deals";
const ADDRESS = "DriveLink LLC, 971 US Highway 202N, Ste N, Branchburg, NJ 08876";
const MAX_PER_RUN = 25;

const COPY = {
  en: {
    subject: "Your New Jersey private car sale packet",
    pre: "Your free 3-page packet is ready.",
    h: "Here's your packet",
    p1: "Thanks for asking for the New Jersey private car sale packet. It has a seller checklist, a buyer checklist and a bill of sale you can print or keep on your phone.",
    btn: "Download the packet (PDF)",
    tipsH: "Three things to remember",
    tips: [
      "Don't hand over a signed title until the payment is secured, and don't pay until you've checked the VIN and the title.",
      "In New Jersey the plates go with the seller, not the car, so the seller needs to take them off.",
      "A New Jersey or dealer-reassigned title should be transferred within 10 working days of the sale to avoid a $25 penalty.",
    ],
    guides: "More guides:",
    g1: "How to transfer a car title in New Jersey",
    g2: "Sold your car in New Jersey? Plates, insurance and paperwork",
    prod: "Already found a car and want the payment protected until the car and signed title change hands? DriveLink can do that.",
    cta: "Secure a deal",
    why: "You're getting this because you asked for the free packet on drivelink.deals.",
    unsub: "Unsubscribe",
    note: "General information, not legal advice. Rules and fees change, so confirm with the NJ MVC.",
    pdf: `${SITE}/downloads/drivelink-nj-private-car-sale-packet.pdf`,
    gl1: `${SITE}/guides/new-jersey-car-title-transfer`,
    gl2: `${SITE}/guides/new-jersey-after-you-sell-your-car`,
  },
  es: {
    subject: "Tu paquete para vender o comprar un auto en Nueva Jersey",
    pre: "Tu paquete gratuito de 3 páginas está listo.",
    h: "Aquí está tu paquete",
    p1: "Gracias por pedir el paquete para ventas privadas de autos en Nueva Jersey. Incluye una lista para el vendedor, una para el comprador y un contrato de compraventa que puedes imprimir o guardar en tu teléfono.",
    btn: "Descargar el paquete (PDF)",
    tipsH: "Tres cosas para recordar",
    tips: [
      "No entregues un título firmado hasta que el pago esté asegurado, y no pagues hasta revisar el VIN y el título.",
      "En Nueva Jersey las placas son del vendedor, no del auto, así que el vendedor debe quitarlas.",
      "Un título de Nueva Jersey o reasignado por un concesionario debe transferirse dentro de los 10 días hábiles de la venta para evitar una multa de $25.",
    ],
    guides: "Más guías:",
    g1: "Cómo transferir el título de un auto en Nueva Jersey",
    g2: "¿Vendiste tu auto en Nueva Jersey? Placas, seguro y documentos",
    prod: "¿Ya encontraste un auto y quieres que el pago esté protegido hasta que el auto y el título firmado cambien de manos? DriveLink puede hacerlo.",
    cta: "Asegurar un trato",
    why: "Recibes este correo porque pediste el paquete gratuito en drivelink.deals.",
    unsub: "Cancelar suscripción",
    note: "Información general, no es asesoría legal. Las reglas y tarifas cambian, confírmalas con el MVC de NJ.",
    pdf: `${SITE}/downloads/drivelink-paquete-venta-auto-nueva-jersey.pdf`,
    gl1: `${SITE}/guides/new-jersey-car-title-transfer`,
    gl2: `${SITE}/guides/new-jersey-after-you-sell-your-car`,
  },
} as const;

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function build(lang: "en" | "es", token: string) {
  const c = COPY[lang];
  const unsubUrl = `${SITE}/unsubscribe?t=${token}`;
  const tips = c.tips.map((t) => `<li style="margin:0 0 8px 0;">${esc(t)}</li>`).join("");
  const html = `<!doctype html>
<html lang="${lang}"><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.pre)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px 28px 8px 28px;">
  <p style="margin:0 0 18px 0;font-size:15px;font-weight:700;color:#0f172a;"><span style="color:#FFB020;">&#9679;</span> DriveLink</p>
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.25;">${esc(c.h)}</h1>
  <p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;">${esc(c.p1)}</p>
  <p style="margin:0 0 24px 0;"><a href="${c.pdf}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(c.btn)}</a></p>
  <h2 style="margin:0 0 8px 0;font-size:16px;">${esc(c.tipsH)}</h2>
  <ul style="margin:0 0 18px 0;padding:0 0 0 20px;font-size:14.5px;line-height:1.5;">${tips}</ul>
  <p style="margin:0 0 6px 0;font-size:14px;">${esc(c.guides)}</p>
  <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;"><a href="${c.gl1}" style="color:#1d4ed8;">${esc(c.g1)}</a><br><a href="${c.gl2}" style="color:#1d4ed8;">${esc(c.g2)}</a></p>
  <p style="margin:0 0 10px 0;font-size:14.5px;line-height:1.55;">${esc(c.prod)}</p>
  <p style="margin:0 0 24px 0;font-size:14.5px;"><a href="${SITE}/start-deal" style="color:#1d4ed8;font-weight:600;">${esc(c.cta)} &rarr;</a></p>
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">
  ${esc(c.note)}<br><br>
  ${esc(c.why)} <a href="${unsubUrl}" style="color:#64748b;">${esc(c.unsub)}</a><br>
  ${esc(ADDRESS)}
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    c.h,
    "",
    c.p1,
    "",
    `${c.btn}: ${c.pdf}`,
    "",
    c.tipsH + ":",
    ...c.tips.map((t) => `- ${t}`),
    "",
    `${c.g1}: ${c.gl1}`,
    `${c.g2}: ${c.gl2}`,
    "",
    c.prod,
    `${c.cta}: ${SITE}/start-deal`,
    "",
    "--",
    c.note,
    c.why,
    `${c.unsub}: ${unsubUrl}`,
    ADDRESS,
  ].join("\n");
  return { subject: c.subject, html, text, unsubUrl };
}

async function sendOne(to: string, lang: "en" | "es", token: string) {
  const { subject, html, text, unsubUrl } = build(lang, token);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to,
      reply_to: REPLY_TO,
      subject,
      html,
      text,
      headers: { "List-Unsubscribe": `<${unsubUrl}>` },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  // Authorization. The `!expected` arm matters: an unset secret must reject, not accept.
  const expected = CRON_SECRET;
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!RESEND_API_KEY) {
    console.error("send-lead-welcome: RESEND_API_KEY not set");
    return new Response(JSON.stringify({ error: "email not configured" }), { status: 500 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const now = Date.now();
  const staleClaim = new Date(now - 15 * 60_000).toISOString();
  const oldest = new Date(now - 3 * 24 * 3600_000).toISOString();

  if (dry) {
    const { count } = await supabase
      .from("email_leads")
      .select("id", { count: "exact", head: true })
      .is("welcome_sent_at", null)
      .is("unsubscribed_at", null)
      .gte("created_at", oldest);
    console.log(`send-lead-welcome dry: ${count ?? 0} pending`);
    return new Response(JSON.stringify({ dry: true, pending: count ?? 0 }), { status: 200 });
  }

  // Atomic claim: UPDATE ... RETURNING only the rows this run won.
  const { data: claimed, error: claimErr } = await supabase
    .from("email_leads")
    .update({ welcome_claimed_at: new Date(now).toISOString() })
    .is("welcome_sent_at", null)
    .is("unsubscribed_at", null)
    .gte("created_at", oldest)
    .or(`welcome_claimed_at.is.null,welcome_claimed_at.lt.${staleClaim}`)
    .select("id,email,lang,unsubscribe_token")
    .limit(MAX_PER_RUN);
  if (claimErr) {
    console.error("send-lead-welcome claim failed:", claimErr.message);
    return new Response(JSON.stringify({ error: "claim failed" }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  for (const lead of claimed ?? []) {
    try {
      await sendOne(lead.email, lead.lang === "es" ? "es" : "en", lead.unsubscribe_token);
      const { error } = await supabase
        .from("email_leads")
        .update({ welcome_sent_at: new Date().toISOString() })
        .eq("id", lead.id);
      if (error) console.error(`send-lead-welcome stamp failed for lead ${lead.id}:`, error.message);
      sent++;
    } catch (e) {
      failed++;
      console.error(`send-lead-welcome send failed for lead ${lead.id}:`, (e as Error).message);
    }
  }
  console.log(`send-lead-welcome: claimed ${claimed?.length ?? 0}, sent ${sent}, failed ${failed}`);
  return new Response(JSON.stringify({ claimed: claimed?.length ?? 0, sent, failed }), { status: 200 });
});
