// POST /auto-release-cron
// Not called by users — scheduled via pg_cron (see DEPLOY.md), currently
// every 6 hours. Finds every listing whose 7-day window has passed with no
// buyer confirmation, and releases funds to the seller automatically, same
// math as release-funds.
//
// Note: no separate "dispute_status" check is needed here. Your existing
// fileDispute() already flips listings.status to "disputed" the moment a
// buyer files one, which takes it out of this query's status="pending_confirmation"
// filter automatically — so a disputed sale is naturally skipped.
//
// Deployed with --no-verify-jwt since the scheduler isn't a logged-in user.
import { corsHeaders, jsonResponse, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = supabaseAdmin();
  const stripe = stripeClient();
  const results: Array<{ listing_id: string; status: string }> = [];

  try {
    const { data: dueListings, error } = await supabase
      .from("listings")
      .select("id, seller_id, seller_net, sale_price, status, funds_released, auto_release_at")
      .eq("status", "pending_confirmation")
      .eq("funds_released", false)
      .lte("auto_release_at", new Date().toISOString());

    if (error) throw error;

    for (const listing of dueListings ?? []) {
      const { data: seller } = await supabase
        .from("users")
        .select("stripe_account_id")
        .eq("id", listing.seller_id)
        .single();

      if (!seller?.stripe_account_id) {
        results.push({ listing_id: listing.id, status: "skipped_no_connect_account" });
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
          .update({ status: "sold", confirmed_at: new Date().toISOString(), funds_released: true, stripe_transfer_id: transfer.id })
          .eq("id", listing.id);

        const { data: ref } = await supabase
          .from("referrals")
          .select("id, promoter_id")
          .eq("listing_id", listing.id)
          .eq("status", "pending")
          .maybeSingle();

        if (ref) {
          const commission = Math.round(Number(listing.sale_price) * 0.01);
          await supabase
            .from("referrals")
            .update({ status: "paid", commission_amount: commission, paid_at: new Date().toISOString().slice(0, 10) })
            .eq("id", ref.id);
          const { data: promoter } = await supabase.from("users").select("balance").eq("id", ref.promoter_id).single();
          await supabase.from("users").update({ balance: (promoter?.balance || 0) + commission }).eq("id", ref.promoter_id);
        }

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
