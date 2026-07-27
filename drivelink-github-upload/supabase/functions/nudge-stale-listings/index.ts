// nudge-stale-listings
//
// Daily cron. Finds active listings that are ARCHIVE_DAYS - WARN_BEFORE_DAYS old
// (by last_active_at, the same column archive_stale_listings() reads) and emails
// the seller a renew-or-lose-it notice with one-click signed links.
//
// Sends once per listing: final_notice_sent_at is stamped on success, and the
// trg_reset_listing_notice_flag trigger nulls it again whenever last_active_at
// moves, so a renewed listing can be warned again if it goes stale later.
//
// Deploy with JWT verification OFF (pg_cron posts without an auth header):
//   supabase functions deploy nudge-stale-listings --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { mintToken } from "./token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const LINK_SECRET = Deno.env.get("LISTING_LINK_SECRET")!;

const FROM = Deno.env.get("NUDGE_FROM_EMAIL") ?? "DriveLink <notifications@drivelink.deals>";
const SITE = Deno.env.get("SITE_URL") ?? "https://drivelink.deals";
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

const ARCHIVE_DAYS = Number(Deno.env.get("ARCHIVE_DAYS") ?? 30);
const WARN_BEFORE_DAYS = Number(Deno.env.get("WARN_BEFORE_DAYS") ?? 5);
const WARN_AT_DAYS = ARCHIVE_DAYS - WARN_BEFORE_DAYS;

// Link stays valid past the archive date so a seller who opens the mail late
// can still act on it.
const TOKEN_TTL_DAYS = WARN_BEFORE_DAYS + 14;

const AMBER = "#FFB020";
const INK = "#0f172a";

const money = (n: number | null) =>
  typeof n === "number" ? "$" + n.toLocaleString("en-US") : "";

function emailHtml(opts: {
  sellerName: string;
  carLabel: string;
  price: number | null;
  image: string | null;
  daysLeft: number;
  renewUrl: string;
  removeUrl: string;
}) {
  const { sellerName, carLabel, price, image, daysLeft, renewUrl, removeUrl } = opts;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">

        <tr><td style="background:${INK};padding:20px 28px;">
          <span style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-0.02em;">Drive<span style="color:${AMBER};">Link</span></span>
        </td></tr>

        <tr><td style="padding:28px 28px 8px 28px;">
          <p style="margin:0 0 14px 0;font-size:15px;color:${INK};">Hi ${sellerName},</p>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;color:#374151;">
            Your listing hasn't had any activity in ${WARN_AT_DAYS} days. Listings are
            removed from DriveLink after ${ARCHIVE_DAYS} days, so this one comes down in
            <b>${daysLeft} days</b> unless you let us know it's still for sale.
          </p>
        </td></tr>

        ${image ? `<tr><td style="padding:0 28px 4px 28px;">
          <img src="${image}" alt="" width="464" style="width:100%;max-width:464px;border-radius:12px;display:block;" />
        </td></tr>` : ""}

        <tr><td style="padding:12px 28px 4px 28px;">
          <div style="font-size:16px;font-weight:700;color:${INK};">${carLabel}</div>
          ${price ? `<div style="font-size:14px;color:#6b7280;margin-top:2px;">${money(price)}</div>` : ""}
        </td></tr>

        <tr><td style="padding:22px 28px 8px 28px;">
          <a href="${renewUrl}" style="display:block;background:${INK};color:#ffffff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:15px;font-weight:700;">
            Yes — it's still for sale
          </a>
          <a href="${removeUrl}" style="display:block;color:#6b7280;text-decoration:underline;text-align:center;padding:14px 20px;font-size:13px;">
            No longer available — remove it
          </a>
        </td></tr>

        <tr><td style="padding:6px 28px 28px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
            One click, no sign-in needed. Editing your listing at
            <a href="${SITE}" style="color:#6b7280;">drivelink.deals</a> also keeps it active.
          </p>
        </td></tr>

      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#9ca3af;">DriveLink · drivelink.deals</p>
    </td></tr>
  </table>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req) => {
  // Optional shared-secret gate. pg_cron can send it as a header; without it
  // this endpoint is open, same as auto-release-cron.
  const gate = Deno.env.get("CRON_SECRET");
  if (gate && req.headers.get("x-cron-secret") !== gate) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const results = { considered: 0, sent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  try {
    const cutoff = new Date(Date.now() - WARN_AT_DAYS * 86400_000).toISOString();

    const { data: listings, error } = await supabase
      .from("listings")
      .select("id, seller_id, make, model, year, price, image, images, last_active_at")
      .eq("status", "active")
      .is("final_notice_sent_at", null)
      .not("last_active_at", "is", null)
      .lt("last_active_at", cutoff);

    if (error) throw error;
    results.considered = listings?.length ?? 0;

    for (const l of listings ?? []) {
      try {
        const { data: seller } = await supabase
          .from("users")
          .select("id, name, email")
          .eq("id", l.seller_id)
          .maybeSingle();

        if (!seller?.email) {
          results.skipped++;
          continue;
        }

        const renew = await mintToken(LINK_SECRET, l.id, "renew", TOKEN_TTL_DAYS);
        const remove = await mintToken(LINK_SECRET, l.id, "remove", TOKEN_TTL_DAYS);

        const q = (action: string, t: { exp: number; sig: string }) =>
          `${FN_BASE}/confirm-listing-status?id=${encodeURIComponent(l.id)}` +
          `&action=${action}&exp=${t.exp}&sig=${encodeURIComponent(t.sig)}`;

        const carLabel = [l.year, l.make, l.model].filter(Boolean).join(" ") || "Your listing";
        const image = l.image || (Array.isArray(l.images) ? l.images[0] : null) || null;

        // Days remaining from this listing's own clock, not the nominal 5 —
        // if the cron missed a day, the email still states the truth.
        const ageDays = Math.floor(
          (Date.now() - new Date(l.last_active_at).getTime()) / 86400_000,
        );
        const daysLeft = Math.max(1, ARCHIVE_DAYS - ageDays);

        await sendEmail(
          seller.email,
          `${carLabel} — still for sale?`,
          emailHtml({
            sellerName: seller.name || "there",
            carLabel,
            price: l.price ?? null,
            image,
            daysLeft,
            renewUrl: q("renew", renew),
            removeUrl: q("remove", remove),
          }),
        );

        // Stamp only after Resend accepts it, so a send failure retries tomorrow.
        await supabase
          .from("listings")
          .update({ final_notice_sent_at: new Date().toISOString() })
          .eq("id", l.id);

        results.sent++;
      } catch (e) {
        results.failed++;
        results.errors.push(`${l.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), ...results }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
