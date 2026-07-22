// POST /auto-release-cron
// Not called by users — schedule this with Supabase's pg_cron or an external
// scheduler (e.g. once a day). Finds every listing whose 7-day window has
// passed with no buyer confirmation and no open dispute, and releases funds
// to the seller automatically, same math as release-funds.
//
// Deployed with --no-verify-jwt since the scheduler isn't a logged-in user;
// there's no requireUser() check here on purpose — protect this endpoint by
// keeping its URL out of the frontend and, ideally, checking a shared secret
// header if your scheduler supports sending one.
import { corsHeaders, jsonResponse, stripeClient, supabaseAdmin, PLATFORM_FEE, SCOUT_FEE } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = supabaseAdmin();
  const stripe = stripeClient();

  const results: Array<{ listing_id: string; status: string }> = [];

  try {
    const { data: dueListings, error } = await supabase
      .from("listings")
      .select("id, price, seller_id, status, funds_released, auto_release_at, referred_by_scout_id, dispute_status")
      .eq("status", "pending_confirmation")
      .eq("funds_released", false)
      .lte("auto_release_at", new Date().toISOString());

    if (error) throw error;

    for (const listing of dueListings ?? []) {
      // Skip anything under an open dispute — a human needs to resolve that
      // via refund-listing before money moves either direction.
      if (listing.dispute_status === "open") {
        results.push({ listing_id: listing.id, status: "skipped_dispute" });
        continue;
      }

      const { data: seller } = await supabase
        .from("users")
        .select("stripe_account_id")
        .eq("id", listing.seller_id)
        .single();

      if (!seller?.stripe_account_id) {
        results.push({ listing_id: listing.id, status: "skipped_no_connect_account" });
        continue;
      }

      const priceCents = Math.round(Number(listing.price) * 100);
      const feeRate = listing.referred_by_scout_id ? PLATFORM_FEE + SCOUT_FEE : PLATFORM_FEE;
      const sellerNetCents = Math.round(priceCents * (1 - feeRate));

      try {
        const transfer = await stripe.transfers.create({
          amount: sellerNetCents,
          currency: "usd",
          destination: seller.stripe_account_id,
          transfer_group: `listing_${listing.id}`,
        });

        await supabase
          .from("listings")
          .update({ status: "sold", funds_released: true, stripe_transfer_id: transfer.id })
          .eq("id", listing.id);

        results.push({ listing_id: listing.id, status: "released" });
      } catch (transferErr) {
        console.error(`auto-release failed for listing ${listing.id}:`, transferErr);
        results.push({ listing_id: listing.id, status: "transfer_failed" });
      }
    }

    return jsonResponse({ processed: results.length, results });
  } catch (err) {
    console.error("auto-release-cron error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
