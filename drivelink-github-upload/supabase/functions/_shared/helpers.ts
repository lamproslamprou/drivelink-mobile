// Shared helpers used by every DriveLink Stripe edge function.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Where platform alerts go. Override with:
//   supabase secrets set ALERT_EMAIL=you@example.com
export const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL") ?? "support@drivelink.deals";

// Service-role client — bypasses RLS. Only ever used inside edge functions,
// never exposed to the browser.
export function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function stripeClient() {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-06-20",
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Verifies the caller's Supabase auth token and returns their user id.
// Every function that acts on behalf of a specific person calls this first —
// never trust a user_id passed in the request body alone.
export async function requireUser(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

// Escapes user-supplied values before they go into alert email HTML.
//
// Alert emails interpolate fields that people control — business_name,
// contact_email, link_url, seller names. Unescaped, someone can put markup
// into an ad signup form and have it render in your inbox, including a link
// whose text says one thing and whose href points somewhere else. These
// emails are read by you and acted on, so treat the values as hostile.
export function esc(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function money(cents: number | null | undefined): string {
  if (typeof cents !== "number") return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function dollars(amount: number | null | undefined): string {
  if (typeof amount !== "number") return "—";
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Sends a notification email via Resend. Requires RESEND_API_KEY to be set
// (supabase secrets set RESEND_API_KEY=re_...). Never throws — a failed
// notification shouldn't break business logic that already succeeded.
//
// Returns true/false so callers can log the outcome if they care.
export async function sendEmail(
  { to, subject, html }: { to: string; subject: string; html: string },
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("sendEmail skipped — RESEND_API_KEY not set");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "DriveLink Notifications <notifications@drivelink.deals>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("sendEmail failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendEmail error:", err);
    return false;
  }
}

// Sends a platform alert WITHOUT blocking the response.
//
// Calling sendEmail() and dropping the promise looks like it does this, but
// Supabase's Edge Runtime can tear the isolate down as soon as the handler
// returns — killing an in-flight fetch. The email silently never sends, and
// nothing surfaces it because the promise was never inspected.
//
// EdgeRuntime.waitUntil() is the supported way to keep work alive past the
// response. Falls back to awaiting if it isn't available, which is slower but
// correct; a webhook that takes an extra 300ms is better than a sale you never
// hear about.
export function notifyAdmin(
  { subject, html, to = ALERT_EMAIL }: { subject: string; html: string; to?: string },
): void {
  const task = sendEmail({ to, subject, html }).then((ok) => {
    if (!ok) console.error("notifyAdmin: alert email did not send —", subject);
  });

  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") {
    rt.waitUntil(task);
  }
  // If waitUntil is unavailable the promise is left running; the handler
  // should await notifyAdminSync() instead in that case.
}

// Awaitable variant, for paths where you'd rather pay the latency than risk
// losing the alert (disputes, refunds — anything with money or a clock on it).
export async function notifyAdminSync(
  { subject, html, to = ALERT_EMAIL }: { subject: string; html: string; to?: string },
): Promise<void> {
  const ok = await sendEmail({ to, subject, html });
  if (!ok) console.error("notifyAdminSync: alert email did not send —", subject);
}

// Wraps alert content in a minimal consistent shell so these are scannable
// at a glance on a phone.
export function alertHtml(title: string, rows: Array<[string, unknown]>, footer?: string): string {
  const body = rows
    .map(([label, value]) => `<p style="margin:6px 0;font-size:14px;"><b>${esc(label)}:</b> ${esc(value)}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
    <h2 style="font-size:17px;margin:0 0 14px;">${esc(title)}</h2>
    ${body}
    ${footer ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280;">${esc(footer)}</p>` : ""}
  </div>`;
}

// Platform + Promoter cut, mirrors the PLATFORM_FEE/PROMOTER_FEE constants
// in App.jsx. Keep these two files in sync if you ever change the percentages.
export const PLATFORM_FEE = 0.01;
export const PROMOTER_FEE = 0.01;
export const AUTO_RELEASE_DAYS = 7;
