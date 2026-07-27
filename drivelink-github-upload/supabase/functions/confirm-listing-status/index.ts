// confirm-listing-status
//
// Handles the one-click links in the pre-archive notice email.
//
//   ?id=<listingId>&action=renew|remove&exp=<unix>&sig=<hmac>
//
// renew  — bumps last_active_at to now(), resetting the archive clock and (via
//          trg_reset_listing_notice_flag) clearing final_notice_sent_at so the
//          listing can be warned again if it goes stale later.
// remove — archives the listing.
//
// This function renders NO HTML. Supabase's gateway forces Content-Type
// text/plain and "Content-Security-Policy: default-src 'none'; sandbox" onto
// every *.supabase.co function response, so markup served from here arrives as
// visible source with scripts, styles and forms blocked. All user-facing pages
// therefore live at SITE_URL/listing-status.html and this function only 302s to
// them with a status parameter.
//
// GET on "renew" acts immediately: harmless and idempotent.
// GET on "remove" redirects to a confirmation page; the archive happens on the
// POST that page submits back here. Mail scanners follow GET links
// automatically and must not be able to delete a seller's listing.
//
// Deploy with JWT verification OFF (sellers click from email, unauthenticated):
//   supabase functions deploy confirm-listing-status --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyToken } from "./token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LINK_SECRET = Deno.env.get("LISTING_LINK_SECRET")!;
const SITE = Deno.env.get("SITE_URL") ?? "https://drivelink.deals";
const ARCHIVE_DAYS = Number(Deno.env.get("ARCHIVE_DAYS") ?? 30);

const RESULT_PAGE = `${SITE}/listing-status.html`;

function redirect(params: Record<string, string>) {
  const url = new URL(RESULT_PAGE);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  let id = "", action = "", exp = "", sig = "";
  if (req.method === "POST") {
    const form = await req.formData();
    id = String(form.get("id") ?? "");
    action = String(form.get("action") ?? "");
    exp = String(form.get("exp") ?? "");
    sig = String(form.get("sig") ?? "");
  } else {
    id = url.searchParams.get("id") ?? "";
    action = url.searchParams.get("action") ?? "";
    exp = url.searchParams.get("exp") ?? "";
    sig = url.searchParams.get("sig") ?? "";
  }

  if (action !== "renew" && action !== "remove") {
    return redirect({ s: "invalid" });
  }

  const check = await verifyToken(LINK_SECRET, id, action, Number(exp), sig);
  if (!check.ok) {
    return redirect({ s: check.reason === "expired" ? "expired" : "invalid" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: listing, error: readErr } = await supabase
    .from("listings")
    .select("id, make, model, year, status")
    .eq("id", id)
    .maybeSingle();

  if (readErr || !listing) {
    return redirect({ s: "notfound" });
  }

  const car = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || "Your listing";

  if (listing.status !== "active") {
    return redirect({ s: "inactive", car });
  }

  // Destructive action: confirm on POST, never on a prefetched GET.
  if (action === "remove" && req.method !== "POST") {
    return redirect({ s: "confirm", car, id, exp, sig });
  }

  if (action === "renew") {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("listings")
      .update({ last_active_at: now, confirmed_at: now })
      .eq("id", id);

    if (error) return redirect({ s: "error", car });
    return redirect({ s: "renewed", car, days: String(ARCHIVE_DAYS) });
  }

  const { error } = await supabase
    .from("listings")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return redirect({ s: "error", car });
  return redirect({ s: "removed", car });
});
