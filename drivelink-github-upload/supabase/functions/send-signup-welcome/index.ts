// send-signup-welcome
//
// Sends a one-time welcome email to people who create a DriveLink account
// (rows in public.users). Run by pg_cron every 10 minutes.
//
// Each account gets at most one welcome email:
//   - rows are CLAIMED atomically (welcome_claimed_at) before sending, so two
//     overlapping runs can't both email the same person;
//   - welcome_sent_at is stamped only after Resend accepts the message, so a
//     failed send is retried on a later run (claims older than 15 minutes are
//     retried);
//   - the scheduled run only looks at accounts created after LAUNCH and in the
//     last 3 days, so switching this on never emails the existing user base;
//   - internal, deleted and blocked accounts are skipped.
//
// Modes (all need the bearer CRON_SHARED_SECRET):
//   POST {}                      scheduled run (pg_cron)
//   POST {"user_id": "..."}      one-off welcome for one account, even if it
//                                is older than LAUNCH; still at most once
//   POST {"user_id": "...", "plain": true}
//                                same, but sends only the plain-text note
//                                (no footer) for a note approved word for word
//   POST {"test_to": "..."}      render and send a [TEST] copy to an allow-
//                                listed internal address; touches no rows
//   ?dry=1                       count pending accounts, send nothing
//
// The email is mostly service content for a new account, but it still names
// why the person is getting it, offers an opt-out by reply (a valid opt-out
// mechanism under CAN-SPAM) and carries the registered-agent postal address.
//
// Deploy: supabase functions deploy send-signup-welcome --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SHARED_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const SITE = "https://drivelink.deals";
const FROM = "DriveLink <support@drivelink.deals>";
const REPLY_TO = "support@drivelink.deals";
const ADDRESS = "DriveLink LLC, 971 US Highway 202N, Ste N, Branchburg, NJ 08876";
const LAUNCH = "2026-11-17T00:00:00Z"; // accounts created before this only via {user_id}
const MAX_PER_RUN = 25;
const TEST_ALLOW = [/^lampros\.g\.lamprou\+[a-z0-9._-]+@gmail\.com$/i, /^support@drivelink\.deals$/i];

type Variant = "fresh" | "late";

const TOOLS = [
  { label: "Seller Toolkit", url: `${SITE}/seller-toolkit` },
  { label: "Is this listing a scam? checker", url: `${SITE}/tools/is-this-listing-a-scam` },
  { label: "A printable bill of sale", url: `${SITE}/tools/car-bill-of-sale` },
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function build(variant: Variant, plain = false) {
  const subject = variant === "late" ? "Anything we can help with on your car?" : "Welcome to DriveLink";
  const p1 = variant === "late"
    ? "Thanks for creating a DriveLink account last week. Are you buying or selling a car right now?"
    : "Thanks for creating a DriveLink account. Are you buying or selling a car right now?";
  const p2 = "If you've already agreed on a car with someone, you can set up a protected payment in a few minutes at drivelink.deals/start-deal. The seller is paid once the buyer has the car.";
  const p3 = "If you have a question, just reply to this email and we'll get back to you.";
  const es = "¿Prefieres español? Responde a este correo y te ayudamos en español.";
  const why = "You're getting this one-time email because you created an account on drivelink.deals. If you'd rather not hear from us, reply and tell us.";

  const toolsHtml = TOOLS.map((t) =>
    `<li style="margin:0 0 6px 0;"><a href="${t.url}" style="color:#1d4ed8;">${esc(t.label)}</a></li>`
  ).join("");
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="padding:28px 28px 8px 28px;font-size:15px;line-height:1.55;">
  <p style="margin:0 0 18px 0;font-size:15px;font-weight:700;"><span style="color:#FFB020;">&#9679;</span> DriveLink</p>
  <p style="margin:0 0 14px 0;">Hi there,</p>
  <p style="margin:0 0 14px 0;">${esc(p1)}</p>
  <p style="margin:0 0 18px 0;">${esc(p2.replace(" at drivelink.deals/start-deal", ""))}</p>
  <p style="margin:0 0 22px 0;"><a href="${SITE}/start-deal" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">Secure a deal</a></p>
  <p style="margin:0 0 6px 0;">A few free tools that might help:</p>
  <ul style="margin:0 0 18px 0;padding:0 0 0 20px;">${toolsHtml}</ul>
  <p style="margin:0 0 14px 0;">${esc(p3)}</p>
  <p style="margin:0 0 22px 0;">The DriveLink team<br><a href="mailto:${REPLY_TO}" style="color:#1d4ed8;">${REPLY_TO}</a></p>
  <p style="margin:0 0 20px 0;color:#475569;font-size:14px;">${esc(es)}</p>
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">
  ${esc(why)}<br>${esc(ADDRESS)}
</td></tr>
</table></td></tr></table></body></html>`;

  const core = [
    "Hi there,",
    "",
    p1,
    "",
    p2,
    "",
    "A few free tools that might help:",
    ...TOOLS.map((t) => `• ${t.label}: ${t.url.replace("https://", "")}`),
    "",
    p3,
    "",
    "The DriveLink team",
    REPLY_TO,
  ];
  // plain: the exact note a person approved word for word, text only, no footer.
  if (plain) return { subject, html: null, text: core.join("\n") };
  const text = [
    ...core,
    "",
    es,
    "",
    "--",
    why,
    ADDRESS,
  ].join("\n");
  return { subject, html, text };
}

async function sendOne(to: string, variant: Variant, test = false, plain = false) {
  const { subject, html, text } = build(variant, plain);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to,
      reply_to: REPLY_TO,
      subject: test ? `[TEST] ${subject}` : subject,
      ...(html ? { html } : {}),
      text,
      headers: { "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=unsubscribe>` },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  const body = await res.json().catch(() => ({}));
  return body?.id as string | undefined;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function variantFor(createdAt: string | null): Variant {
  if (!createdAt) return "fresh";
  const ageDays = (Date.now() - new Date(createdAt + (createdAt.endsWith("Z") ? "" : "Z")).getTime()) / 86400_000;
  return ageDays >= 2 ? "late" : "fresh";
}

Deno.serve(async (req) => {
  // Authorization. The `!expected` arm matters: an unset secret must reject, not accept.
  const expected = CRON_SECRET;
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || got !== expected) return json({ error: "unauthorized" }, 401);
  if (!RESEND_API_KEY) {
    console.error("send-signup-welcome: RESEND_API_KEY not set");
    return json({ error: "email not configured" }, 500);
  }

  let body: { user_id?: string; test_to?: string; variant?: Variant; plain?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body = scheduled run */ }

  // Test mode: allow-listed internal addresses only, no database access.
  if (body.test_to) {
    const to = String(body.test_to).trim();
    if (!TEST_ALLOW.some((r) => r.test(to))) return json({ error: "test address not allowed" }, 400);
    const variant: Variant = body.variant === "late" ? "late" : "fresh";
    try {
      const id = await sendOne(to, variant, true, body.plain === true);
      console.log(`send-signup-welcome test (${variant}) accepted by Resend: ${id}`);
      return json({ test: true, variant, resend_id: id });
    } catch (e) {
      console.error("send-signup-welcome test failed:", (e as Error).message);
      return json({ error: "send failed" }, 502);
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const staleClaim = new Date(now - 15 * 60_000).toISOString();
  const since = new Date(Math.max(now - 3 * 24 * 3600_000, Date.parse(LAUNCH))).toISOString();

  if (new URL(req.url).searchParams.get("dry") === "1") {
    const { count } = await supabase
      .from("users").select("id", { count: "exact", head: true })
      .is("welcome_sent_at", null).is("deleted_at", null).is("blocked_at", null)
      .not("is_internal", "is", true).not("email", "is", null).gte("created_at", since);
    return json({ dry: true, pending: count ?? 0 });
  }

  // Atomic claim: UPDATE ... RETURNING only the rows this run won.
  let q = supabase
    .from("users")
    .update({ welcome_claimed_at: nowIso })
    .is("welcome_sent_at", null).is("deleted_at", null).is("blocked_at", null)
    .not("is_internal", "is", true).not("email", "is", null)
    .or(`welcome_claimed_at.is.null,welcome_claimed_at.lt.${staleClaim}`);
  q = body.user_id ? q.eq("id", String(body.user_id)) : q.gte("created_at", since);
  const { data: claimed, error: claimErr } = await q.select("id,email,created_at").limit(MAX_PER_RUN);
  if (claimErr) {
    console.error("send-signup-welcome claim failed:", claimErr.message);
    return json({ error: "claim failed" }, 500);
  }

  let sent = 0;
  let failed = 0;
  for (const u of claimed ?? []) {
    try {
      await sendOne(u.email, variantFor(u.created_at), false, Boolean(body.user_id && body.plain === true));
      const { error } = await supabase.from("users").update({ welcome_sent_at: new Date().toISOString() }).eq("id", u.id);
      if (error) console.error(`send-signup-welcome stamp failed for ${u.id}:`, error.message);
      sent++;
    } catch (e) {
      failed++;
      console.error(`send-signup-welcome send failed for ${u.id}:`, (e as Error).message);
    }
  }
  console.log(`send-signup-welcome: claimed ${claimed?.length ?? 0}, sent ${sent}, failed ${failed}`);
  return json({ claimed: claimed?.length ?? 0, sent, failed });
});
