// POST /process-pending-payouts   (scheduled; no user JWT — see auth below)
//
// Finishes direct-charge sales whose handover is recorded but whose payout could
// not be created yet because the seller's Stripe balance was still settling
// (listings.payout_status = 'pending'). Card funds typically become available
// about 2 business days after the charge; the first payout on a new account can
// take longer.
//
// Re-checks everything that gates a release, because time has passed since the
// buyer confirmed: the risk gate, an open chargeback, and the ACH settlement
// floor. Then runs the same completeDirectRelease() the interactive paths use,
// whose per-listing idempotency key makes a double run harmless.
//
// Schedule it every 30 minutes (pg_cron or a Supabase scheduled function), with
// the header  x-cron-secret: <CRON_SECRET>.
import {
  alertHtml,
  corsHeaders,
  jsonResponse,
  notifyAdminSync,
  stripeClient,
  supabaseAdmin,
} from "../_shared/helpers.ts";
import { completeDirectRelease } from "../_shared/direct.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = supabaseAdmin();
  const stripe = stripeClient();

  const { data: rows, error } = await supabase
    .from("listings")
    .select(
      "id, seller_id, buyer_id, status, funds_released, seller_net, sale_price, referral_code, stripe_payment_intent_id, release_not_before, make, model, year, charge_mode, charge_account_id, stripe_dispute_id, confirmed_at",
    )
    .eq("charge_mode", "direct")
    .eq("payout_status", "pending")
    .eq("status", "pending_confirmation")
    .eq("funds_released", false)
    .limit(50);

  if (error) {
    console.error("process-pending-payouts query failed:", error);
    return jsonResponse({ error: error.message }, 500);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const listing of rows ?? []) {
    try {
      // Only listings whose buyer/seller already confirmed the handover are
      // ever put in 'pending'; confirmed_at is the proof.
      if (!listing.confirmed_at) {
        results.push({ id: listing.id, skipped: "not confirmed" });
        continue;
      }
      if (listing.stripe_dispute_id) {
        results.push({ id: listing.id, skipped: "open dispute" });
        continue;
      }
      if (listing.release_not_before && new Date(listing.release_not_before).getTime() > Date.now()) {
        results.push({ id: listing.id, skipped: "ACH floor" });
        continue;
      }
      const { data: blocked, error: riskErr } = await supabase.rpc("is_release_blocked", {
        p_listing_id: listing.id,
      });
      if (riskErr || blocked === true) {
        results.push({ id: listing.id, skipped: riskErr ? "risk check errored" : "risk blocked" });
        continue;
      }

      const r = await completeDirectRelease(supabase, stripe, listing, "handover_code");
      results.push({ id: listing.id, released: r.released, ...(r.released ? { payout: r.payoutId } : { reason: r.reason }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("pending payout failed:", listing.id, message);
      results.push({ id: listing.id, error: message });
      await notifyAdminSync({
        subject: `⚠️ Pending payout errored — ${listing.id}`,
        html: alertHtml("process-pending-payouts error", [["Listing ID", listing.id], ["Error", message]]),
      });
    }
  }

  return jsonResponse({ processed: results.length, results });
});
