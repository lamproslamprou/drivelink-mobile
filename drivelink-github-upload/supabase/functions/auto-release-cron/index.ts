// POST /auto-release-cron
// Not called by users — scheduled via pg_cron, currently every 6 hours. Finds
// every listing whose release window has passed with no buyer confirmation,
// and releases funds to the seller automatically, same math as release-funds.
//
// Note: no separate "dispute_status" check is needed here. fileDispute() flips
// listings.status to "disputed" the moment a buyer files one, which takes it
// out of this query's status="pending_confirmation" filter automatically — so
// a disputed sale is naturally skipped. is_release_blocked() checks the
// disputes table as well, belt and braces.
//
// Referral settlement is delegated to settleReferral() in _shared/helpers.ts.
// This function previously carried its own copy, which had drifted from the
// version in release-funds: it used .maybeSingle() (which errors when two
// Scouts shared a listing, silently paying nobody), ignored listings.referral_code
// attribution entirely, and had no self-referral check. A sale must settle the
// same way whether the buyer clicked confirm or the clock ran out.
//
// ── MONEY IS CENTS ──────────────────────────────────────────────────────────
// As of migration 20260803_05_money_to_cents, listings.seller_net and every
// other money column are CENTS, and Stripe transfers are cents. seller_net
// goes to Stripe unchanged. The previous `* 100` would transfer one hundred
// times the seller's proceeds out of the platform balance, and unlike an
// overcharged card nothing rejects that on the way out.
//
// ── RISK GATE ───────────────────────────────────────────────────────────────
// is_release_blocked() runs per listing before each transfer. It recomputes
// the flags at release time rather than trusting what was written at payment,
// because conditions change in between. A blocked listing is left exactly as
// it is — not marked sold, not released — and re-evaluated on the next run, so
// clearing the flags in the admin dashboard is all that's needed to complete
// the payout. Fail closed: an unreadable risk check holds the money.
//
// TRANSFERS ARE CHARGE-SOURCED. Every transfer names the originating charge via
// source_transaction. Without it the transfer draws on the platform's available
// balance, which fails with `balance_insufficient` whenever the charge hasn't
// settled — and on a new account with a rolling reserve that can be a week or
// more after the sale. This job runs precisely in that window, so unqualified
// transfers here fail as a rule rather than as an edge case: every run between
// 2026-07-29 and 2026-08-01 400'd for this reason.
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
  money,
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
      .select("id, seller_id, buyer_id, seller_net, sale_price, status, funds_released, auto_release_at, referral_code, stripe_payment_intent_id, make, model, year")
      .eq("status", "pending_confirmation")
      .eq("funds_released", false)
      .lte("auto_release_at", new Date().toISOString());

    if (error) throw error;

    for (const listing of dueListings ?? []) {
      const carLabel = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || listing.id;

      // ── Risk gate, before anything else costs money ─────────────────────
      const { data: blocked, error: riskErr } = await supabase.rpc("is_release_blocked", {
        p_listing_id: listing.id,
      });

      if (riskErr || blocked === true) {
        results.push({
          listing_id: listing.id,
          status: riskErr ? "held_risk_check_failed" : "held_for_review",
        });

        const { data: flags } = await supabase
          .from("v_listing_risk")
          .select("risk_score, open_flags")
          .eq("listing_id", listing.id)
          .maybeSingle();

        await notifyAdminSync({
          subject: riskErr
            ? `⚠️ Auto-release HELD — risk check errored on ${carLabel}`
            : `⚠️ Auto-release HELD for review — ${carLabel} (${money(Number(listing.sale_price))})`,
          html: alertHtml(
            riskErr
              ? "Automatic release skipped because the risk check could not run"
              : "Automatic release held pending review",
            [
              ["Vehicle", carLabel],
              ["Sale price", money(Number(listing.sale_price))],
              ["Would pay seller", money(Number(listing.seller_net))],
              ["Risk score", flags?.risk_score ?? "—"],
              ["Flags", Array.isArray(flags?.open_flags) ? flags.open_flags.join(", ") : "—"],
              ...(riskErr ? [["Risk check error", riskErr.message] as [string, unknown]] : []),
              ["Listing ID", listing.id],
            ],
            "No money moved and the listing is unchanged. Resolve the flags in the admin dashboard and this will release on the next run — no manual transfer needed.",
          ),
        });
        continue;
      }

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
            ["Amount owed", money(Number(listing.seller_net))],
            ["Listing ID", listing.id],
          ], "The release window has passed but the seller has not completed Stripe Connect onboarding. Funds remain on the platform balance."),
        });
        continue;
      }

      // Already cents. No conversion.
      const sellerNetCents = Number(listing.seller_net);

      try {
        if (!Number.isFinite(sellerNetCents) || sellerNetCents <= 0) {
          throw new Error("Listing has no valid seller_net to transfer");
        }

        // Resolve the charge behind this sale. Thrown errors land in the catch
        // below, which alerts and leaves the listing untouched for the next run.
        if (!listing.stripe_payment_intent_id) {
          throw new Error("Listing has no stripe_payment_intent_id — cannot source the transfer");
        }
        const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
        const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
        if (!chargeId) {
          throw new Error(`No charge found on payment intent ${listing.stripe_payment_intent_id}`);
        }

        const transfer = await stripe.transfers.create({
          amount: sellerNetCents,
          currency: "usd",
          destination: seller.stripe_account_id,
          transfer_group: `listing_${listing.id}`,
          source_transaction: chargeId,
        }, {
          // Shares the key with release-funds so a buyer confirming at the same
          // moment this job runs cannot produce two transfers for one sale.
          idempotencyKey: `release_${listing.id}`,
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
          subject: `Funds auto-released — ${carLabel} (${money(Number(listing.seller_net))})`,
          html: alertHtml("Release window elapsed, seller paid automatically", [
            ["Vehicle", carLabel],
            ["Sale price", money(Number(listing.sale_price))],
            ["Paid to seller", money(Number(listing.seller_net))],
            ["Seller", `${seller.name ?? "—"} (${seller.email ?? "—"})`],
            ["Transfer ID", transfer.id],
            ["Sourced from charge", chargeId],
            ["Referral", referral.outcome],
            ...(referral.commission
              ? [["Commission", money(referral.commission)] as [string, unknown]]
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
            ["Amount", money(Number(listing.seller_net))],
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
      ], "No funds were released on this run. Sales past their release window are still waiting."),
    });

    return jsonResponse({ error: msg }, 500);
  }
});
