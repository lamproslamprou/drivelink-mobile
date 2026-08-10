// POST /release-funds
// Called when the buyer clicks "Confirm Receipt", or by an admin pressing
// Force Confirm on the listing in the dashboard. Transfers the seller's net
// proceeds out of the platform's Stripe balance into the seller's connected
// account, then settles any attributed Promoter referral.
//
// NOT called by auto-release-cron. That job stopped moving money on
// 2026-08-06 when buyer silence ceased to count as consent; it now only warns
// both parties and escalates a stalled sale to manual review. The other path
// that pays a seller is confirm-handover, where the seller enters the buyer's
// 6-digit code.
//
// The platform fee is never transferred anywhere: it's the portion of the
// original charge left behind on the platform's Stripe balance once the
// seller's transfer goes out. That balance pays out to Mercury.
//
// ── MONEY IS CENTS ──────────────────────────────────────────────────────────
// As of migration 20260803_05_money_to_cents, listings.seller_net and every
// other money column are CENTS, and Stripe transfers are cents. seller_net is
// passed to Stripe unchanged. The previous `* 100` here would transfer one
// hundred times the seller's proceeds out of the platform balance — and unlike
// an overcharged card, nothing rejects that on the way out.
//
// ── RISK GATE ───────────────────────────────────────────────────────────────
// is_release_blocked() runs before the transfer. It must gate THIS path and
// not only auto-release-cron: in the card cash-out pattern the fraudster IS
// the buyer clicking Confirm, minutes after paying with a stolen card. That is
// exactly what the INSTANT_CONFIRM flag detects, and gating only the cron
// would leave the fast version of the attack completely unguarded.
//
// Note the ordering below: confirmed_at is written BEFORE the risk evaluation.
// evaluate_listing_risk() derives INSTANT_CONFIRM from confirmed_at minus
// paid_at, so evaluating first would mean the flag can never fire on the one
// path it exists for.
//
// A blocked release is NOT an error and NOT a refusal — the buyer's
// confirmation is recorded and the money stays put. Recovery is two steps in
// the admin dashboard: resolve the open flags on the listing row, then press
// Force Confirm, which calls this function again. The gate recomputes from
// scratch on every call (is_release_blocked runs evaluate_listing_risk first),
// so a cleared listing passes on the retry.
//
// NOTHING PICKS THIS UP AUTOMATICALLY. Until 2026-08-07 this file told the
// admin that auto-release-cron would finish the payout once the flags were
// cleared, which had been false since the escrow-safety rewrite the day
// before — the money would simply have sat there while everyone waited on a
// job that no longer transfers. Fail closed: if the risk check itself errors,
// hold the funds rather than pay out blind.
import {
  corsHeaders,
  jsonResponse,
  requireUser,
  settleReferral,
  stripeClient,
  supabaseAdmin,
  notifyAdminSync,
  alertHtml,
  money,
  sendCompletionEmails,
} from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const callerId = await requireUser(req);
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const supabase = supabaseAdmin();
    const stripe = stripeClient();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select(
        "id, seller_id, buyer_id, status, funds_released, seller_net, sale_price, referral_code, stripe_payment_intent_id, make, model, year",
      )
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Compare normalized. users.id is `text`, not `uuid`, so Postgres does not
    // canonicalize these — stray whitespace or case survives storage and would
    // make a strict !== reject the legitimate buyer.
    const buyerId = String(listing.buyer_id ?? "").trim().toLowerCase();
    const caller = String(callerId ?? "").trim().toLowerCase();

    // Normally only the buyer releases funds. Admins can too, via Force Confirm
    // in the dashboard — the recourse when the buyer has the car and simply
    // stops responding.
    //
    // FIXED 2026-08-09. The header of this file has always claimed Force
    // Confirm worked, and the held-release email tells the admin to press it.
    // Neither was true: the button calls this same function, and this check
    // rejected anyone who wasn't the buyer. Every held release was
    // unrecoverable through the UI.
    //
    // The risk gate below still runs for admins. Force Confirm is a way to act
    // on a silent buyer, not a way to skip fraud checks — an admin who hasn't
    // resolved the open flags gets the same hold the buyer would.
    let callerIsAdmin = false;
    if (buyerId !== caller) {
      const { data: callerRow, error: callerErr } = await supabase
        .from("users")
        .select("role")
        .eq("id", callerId)
        .maybeSingle();

      if (callerErr) {
        console.error("caller role lookup failed:", callerId, callerErr);
        throw new Error("Could not verify your account");
      }
      callerIsAdmin = callerRow?.role === "admin";
    }

    if (!callerIsAdmin && (!buyerId || buyerId !== caller)) {
      throw new Error("Only the buyer can confirm receipt for this listing");
    }
    if (listing.status !== "pending_confirmation") {
      throw new Error("This listing isn't awaiting fund release");
    }
    if (listing.funds_released) {
      return jsonResponse({ alreadyReleased: true });
    }

    const carLabel = [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || listing.id;

    // ── Record the confirmation BEFORE evaluating risk ──────────────────────
    // INSTANT_CONFIRM is computed from confirmed_at - paid_at. Writing it here
    // is what lets the gate below see a confirmation that arrived four minutes
    // after payment. It also means the buyer's action is never lost if the
    // release is held.
    await supabase
      .from("listings")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", listing.id);

    // ── Risk gate ───────────────────────────────────────────────────────────
    const { data: blocked, error: riskErr } = await supabase.rpc("is_release_blocked", {
      p_listing_id: listing.id,
    });

    // Fail closed. An unreadable risk check is a reason to hold money, never
    // a reason to release it.
    if (riskErr || blocked === true) {
      const { data: flags } = await supabase
        .from("v_listing_risk")
        .select("risk_score, open_flags")
        .eq("listing_id", listing.id)
        .maybeSingle();

      await notifyAdminSync({
        subject: riskErr
          ? `⚠️ Release HELD — risk check errored on ${carLabel}`
          : `⚠️ Release HELD for review — ${carLabel} (${money(Number(listing.sale_price))})`,
        html: alertHtml(
          riskErr
            ? "Buyer confirmed receipt but the risk check could not run"
            : "Buyer confirmed receipt, funds held pending review",
          [
            ["Vehicle", carLabel],
            ["Sale price", money(Number(listing.sale_price))],
            ["Would pay seller", money(Number(listing.seller_net))],
            ["Risk score", flags?.risk_score ?? "—"],
            ["Flags", Array.isArray(flags?.open_flags) ? flags.open_flags.join(", ") : "—"],
            ...(riskErr ? [["Risk check error", riskErr.message] as [string, unknown]] : []),
            ["Listing ID", listing.id],
          ],
          "The buyer's confirmation is recorded and no money has moved. Nothing will release this on its own. In the admin dashboard, open the Listings tab, resolve the open flags shown on this listing's row, then press Force Confirm on the same row to pay the seller.",
        ),
      });

      return jsonResponse({
        heldForReview: true,
        message:
          "Your confirmation has been recorded. This transaction is under a short review before funds are released to the seller.",
      });
    }

    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller?.stripe_account_id) {
      throw new Error("Seller has no connected account");
    }

    // source_transaction: without it, the transfer draws on the platform's
    // *available* balance. Card charges take days to settle — longer on a new
    // account with a rolling reserve — so releasing before then fails with
    // `balance_insufficient`. Naming the originating charge lets Stripe
    // transfer against those specific funds while they are still pending.
    if (!listing.stripe_payment_intent_id) {
      throw new Error("Listing has no stripe_payment_intent_id — cannot release safely");
    }
    const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
    const sourceTransaction = typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id;
    if (!sourceTransaction) {
      throw new Error("No charge found on the payment intent for this listing");
    }

    // Already cents. No conversion.
    const sellerNetCents = Number(listing.seller_net);
    if (!Number.isFinite(sellerNetCents) || sellerNetCents <= 0) {
      throw new Error("Listing has no valid seller_net to transfer");
    }

    const transfer = await stripe.transfers.create({
      amount: sellerNetCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: `listing_${listing.id}`,
      source_transaction: sourceTransaction,
    }, {
      // Shared with confirm-handover so a buyer confirming receipt at the same
      // moment the seller enters the handover code cannot produce two
      // transfers for one sale.
      idempotencyKey: `release_${listing.id}`,
    });

    await supabase
      .from("listings")
      .update({
        status: "sold",
        funds_released: true,
        stripe_transfer_id: transfer.id,
      })
      .eq("id", listing.id);

    // Referral settlement lives in _shared/helpers.ts so this path and
    // confirm-handover behave identically. Never throws — the seller has
    // already been paid by the time it runs.
    const referral = await settleReferral(supabase, listing);

    // Tells the two people in the transaction that it completed. Never throws:
    // by this point the transfer is irreversible, and reporting an email
    // failure to the caller would show an error for a sale that succeeded.
    const notified = await sendCompletionEmails(supabase, listing, {
      transferId: transfer.id,
      amountCents: sellerNetCents,
      releasedVia: callerIsAdmin ? "admin_force_confirm" : "buyer_confirm",
    });

    return jsonResponse({
      notified: notified.ok,
      // Kept in dollars so the existing client-side toast renders unchanged.
      transferred: sellerNetCents / 100,
      transferredCents: sellerNetCents,
      transferId: transfer.id,
      sourceTransaction,
      referral: referral.outcome,
    });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
