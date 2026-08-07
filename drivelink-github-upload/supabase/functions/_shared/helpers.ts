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

// Calendar date for date-only columns (listings.sold_at, referrals.paid_at).
//
// new Date().toISOString().slice(0,10) returns the UTC date, which runs a day
// ahead of Eastern from 8pm onward (7pm in winter). Edge Functions run in UTC,
// so a car sold at 9pm Eastern was recorded as sold the following day — a date
// in the future to everyone reading it. DriveLink is a US business on Eastern
// time, so the calendar date is resolved in that zone. en-CA formats as
// YYYY-MM-DD, which is what a Postgres date column expects.
//
// Timestamp columns (confirmed_at, created_at, auto_release_at) are unaffected:
// those store a real instant and were always correct.
//
// Takes an optional Date so derived dates (an ad placement's end_date, say)
// format in the same zone as the day they were computed from.
export function todayET(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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
// response. Falls back to leaving the promise running if unavailable.
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
}

// Awaitable variant, for paths where you'd rather pay the latency than risk
// losing the alert (disputes, refunds, cron jobs — anything with money or a
// clock on it, and anything with no user waiting on a response).
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

// ── Referral settlement ──────────────────────────────────────────────────────
//
// Decides which Scout (if any) earns the commission on a completed sale, and
// credits them. Lives here because BOTH release paths need identical behavior:
// release-funds (buyer confirmed) and confirm-handover (seller entered the
// buyer's code). auto-release-cron no longer settles anything — as of
// 2026-08-06 it only escalates silent sales to manual review. They
// had drifted — auto-release-cron still used .maybeSingle(), which errors when
// two Scouts shared the same listing, silently paying nobody, and skipped the
// self-referral check entirely. A sale settling differently depending on
// whether the buyer happened to click a button is not acceptable.
//
// Never throws. The seller has already been paid by the time this runs, so a
// referral problem must not surface as a failed release.
export type ReferralOutcome =
  | "none"
  | "paid"
  | "flagged_ambiguous"
  | "flagged_self_referral"
  | "attributed_not_pending"
  | "lookup_failed";

export async function settleReferral(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  listing: {
    id: string;
    buyer_id: string | null;
    sale_price: number | null;
    referral_code?: string | null;
  },
): Promise<{ outcome: ReferralOutcome; promoterId?: string; commission?: number }> {
  const commission = Math.round(Number(listing.sale_price ?? 0) * PROMOTER_FEE);

  // Fetch ALL pending referrals rather than using .maybeSingle(): a listing
  // shared by several Scouts returns multiple rows, and maybeSingle() errors
  // on that. Reading only `data` and discarding the error means a contested
  // listing silently pays nobody at all.
  const { data: pendingRefs, error: refsErr } = await supabase
    .from("referrals")
    .select("id, promoter_id, share_code")
    .eq("listing_id", listing.id)
    .eq("status", "pending");

  if (refsErr) {
    console.error("referral lookup failed for listing:", listing.id, refsErr);
    return { outcome: "lookup_failed" };
  }

  const refs = (pendingRefs ?? []) as Array<{ id: string; promoter_id: string; share_code: string | null }>;
  if (refs.length === 0) return { outcome: "none" };

  let ref: { id: string; promoter_id: string; share_code: string | null } | null = null;
  let ambiguous = false;

  // listings.referral_code is written at checkout from the buyer's stored
  // attribution, after being validated against a real pending referral. It
  // names one specific Scout, so it wins whenever it's present.
  if (listing.referral_code) {
    ref = refs.find(
      (r) => (r.share_code ?? "").toUpperCase() === String(listing.referral_code).toUpperCase(),
    ) ?? null;
    if (!ref) {
      console.warn("attributed referral not pending:", listing.referral_code, listing.id);
      return { outcome: "attributed_not_pending" };
    }
  } else if (refs.length === 1) {
    ref = refs[0]; // only one candidate — nothing to guess between
  } else {
    ambiguous = true; // several Scouts shared this car, no attribution recorded
  }

  if (ambiguous) {
    // Never pick arbitrarily and never pay everyone. Flag them all so the
    // admin Approve/Deny UI can settle it against the real evidence.
    await supabase
      .from("referrals")
      .update({ status: "flagged", commission_amount: commission })
      .in("id", refs.map((r) => r.id));
    console.warn("ambiguous referral on listing:", listing.id, refs.length, "competing scouts");
    return { outcome: "flagged_ambiguous", commission };
  }

  if (!ref) return { outcome: "none" };

  // Self-dealing check: a promoter buying through their own referral link
  // should never earn a commission. Flag for admin review rather than
  // transferring money automatically.
  if (ref.promoter_id === listing.buyer_id) {
    await supabase
      .from("referrals")
      .update({ status: "flagged", commission_amount: commission })
      .eq("id", ref.id);
    return { outcome: "flagged_self_referral", promoterId: ref.promoter_id, commission };
  }

  await supabase
    .from("referrals")
    .update({
      status: "paid",
      commission_amount: commission,
      paid_at: todayET(),
    })
    .eq("id", ref.id);

  const { data: promoter } = await supabase
    .from("users")
    .select("balance")
    .eq("id", ref.promoter_id)
    .single();

  await supabase
    .from("users")
    .update({ balance: (Number(promoter?.balance) || 0) + commission })
    .eq("id", ref.promoter_id);

  return { outcome: "paid", promoterId: ref.promoter_id, commission };
}

// Platform + Promoter cut, mirrors the PLATFORM_FEE/PROMOTER_FEE constants
// in App.jsx. Keep these two files in sync if you ever change the percentages.
export const PLATFORM_FEE = 0.01;
export const PROMOTER_FEE = 0.01;
// Days from payment (or from the agreed handover date, whichever is later)
// before an unconfirmed sale is escalated to manual review. This has NOT
// released funds since 2026-08-06 — the name is kept because stripe-webhook,
// create-checkout-session and the guard trigger all reference auto_release_at,
// and renaming it buys nothing. See auto-release-cron for what it now drives.
export const AUTO_RELEASE_DAYS = 7;
