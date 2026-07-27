// POST /auto-release-cron
// Not called by users — scheduled via pg_cron, currently every 6 hours. Finds
// every listing whose 7-day window has passed with no buyer confirmation, and
// releases funds to the seller automatically, same math as release-funds.
//
// Note: no separate "dispute_status" check is needed here. fileDispute() flips
// listings.status to "disputed" the moment a buyer files one, which takes it
// out of this query's status="pending_confirmation" filter automatically — so
// a disputed sale is naturally skipped.
//
// Referral settlement is delegated to settleReferral() in _shared/helpers.ts.
// This function previously carried its own copy, which had drifted from the
// version in release-funds: it used .maybeSingle() (which errors when two
// Scouts shared a listing, silently paying nobody), ignored listings.referral_code
// attribution entirely, and had no self-referral check. A sale must settle the
// same way whether the buyer clicked confirm or the clock ran out.
//
// This function is unattended by definition — nobody is watching a response.
// Every outcome that moves money or fails to therefore sends an alert, and the
// alerts are awaited rather than fire-and-forget.
//
// Deployed with --no-verify-jwt since the scheduler isn't a logged-in user.
import {
  corsHeaders,
  jsonResponse,
  notifyAdminSync,
  alertHtml,
  dollars,
  settleReferral,
  stripeClient,
  supabaseAdmin,
} from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = supabaseAdmin();
  const stripe = stripeClient();
  const results: Array<{ listing_id: string; status: string; detail?: string }> = [];

  try {
    const { data: dueListings, error } = await supabase
      .from("listings")
      .select("id, seller_id, buyer_id, seller_net, sale_price, status, funds_released, auto_release_at, referral_code, make, model, year")
      .eq("status", "pending_confirmation")
      .eq("funds_released", false)
      .lte("auto_release_at", new Date().toISOString());

    if (error) throw error;

    for (const listing of dueListings ?? []) {
      const carLabel = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || listing.id;

      const { data: seller } = await supabase
        .from("users")
        .select("stripe_account_id, name, email")
        .eq("id", listing.seller_id)
        .single();

      if (!seller?.stripe_account_id) {
        results.push({ listing_id: listing.id, status: "skipped_no_connect_account" });

        // The buyer's money is sitting on the platform balance with no way to
        // reach the seller. This does not resolve itself — it needs you.
        await notifyAdminSync({
          subject: `Auto-release blocked — ${carLabel} has no payout account`,
          html: alertHtml("Seller cannot be paid", [
            ["Vehicle", carLabel],
            ["Seller", `${seller?.name ?? "—"} (${seller?.email ?? "—"})`],
            ["Amount owed", dollars(Number(listing.seller_net))],
            ["Listing ID", listing.id],
          ], "The 7-day window has passed but the seller has not completed Stripe Connect onboarding. Funds remain on the platform balance."),
        });
        continue;
      }

      const sellerNetCents = Math.round(Number(listing.seller_net) * 100);

      try {
        const transfer = await stripe.transfers.create({
          amount: sellerNetCents,
          currency: "usd",
          destination: seller.stripe_account_id,
          transfer_group: `listing_${listing.id}`,
        });

        await supabase
          .from("listings")
          .update({
            status: "sold",
            confirmed_at: new Date().toISOString(),
            funds_released: true,
            stripe_transfer_id: transfer.id,
          })
          .eq("id", listing.id);

        const referral = await settleReferral(supabase, listing);

        results.push({ listing_id: listing.id, status: "released", detail: referral.outcome });

        await notifyAdminSync({
          subject: `Funds auto-released — ${carLabel} (${dollars(Number(listing.seller_net))})`,
          html: alertHtml("7-day window elapsed, seller paid automatically", [
            ["Vehicle", carLabel],
            ["Sale price", dollars(Number(listing.sale_price))],
            ["Paid to seller", dollars(Number(listing.seller_net))],
            ["Seller", `${seller.name ?? "—"} (${seller.email ?? "—"})`],
            ["Transfer ID", transfer.id],
            ["Referral", referral.outcome],
            ...(referral.commission
              ? [["Commission", dollars(referral.commission)] as [string, unknown]]
              : []),
            ["Listing ID", listing.id],
          ], referral.outcome.startsWith("flagged")
            ? "A referral on this sale needs manual review in the admin dashboard."
            : "The buyer never confirmed receipt. Released on the automatic schedule."),
        });
      } catch (transferErr) {
        const msg = transferErr instanceof Error ? transferErr.message : String(transferErr);
        console.error(`auto-release failed for listing ${listing.id}:`, transferErr);
        results.push({ listing_id: listing.id, status: "transfer_failed", detail: msg });

        await notifyAdminSync({
          subject: `⚠️ Auto-release TRANSFER FAILED — ${carLabel}`,
          html: alertHtml("Stripe transfer failed", [
            ["Vehicle", carLabel],
            ["Amount", dollars(Number(listing.seller_net))],
            ["Seller", `${seller.name ?? "—"} (${seller.email ?? "—"})`],
            ["Stripe error", msg],
            ["Listing ID", listing.id],
          ], "The listing was NOT marked sold and funds were NOT released. This will retry on the next run."),
        });
      }
    }

    return jsonResponse({ processed: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("auto-release-cron error:", err);

    // A failure here means the whole job did nothing. pg_cron will still log
    // "succeeded" because the HTTP post was queued fine, so without this alert
    // the job can fail silently for weeks — which is exactly what happened
    // between 2026-07-22 and 2026-07-27 with a stale column reference.
    await notifyAdminSync({
      subject: "⚠️ auto-release-cron failed",
      html: alertHtml("Automatic fund release job errored", [
        ["Error", msg],
        ["Time", new Date().toISOString()],
      ], "No funds were released on this run. Sales past their 7-day window are still waiting."),
    });

    return jsonResponse({ error: msg }, 500);
  }
});
