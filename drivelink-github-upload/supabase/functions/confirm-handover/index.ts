// POST /confirm-handover
// The SELLER submits the 6-digit code the BUYER read to them at handover.
// A correct code is proof the buyer was physically present and willing, and it
// is the primary way funds leave escrow now that nothing releases on a timer.
//
// Deploy: supabase functions deploy confirm-handover
// (JWT verification ON — the caller must be the authenticated seller.)
//
// ── WHY THE SELLER ENTERS IT AND NOT THE BUYER ──────────────────────────────
// The buyer already has release-funds ("Confirm Receipt"), which they can tap
// from anywhere. That path assumes the buyer has signal, has the app open, and
// remembers. In practice a handover ends with two people in a parking lot and
// the buyer driving away. Making the seller enter a code the buyer holds means
// the release happens in the moment, in person, and requires the buyer's active
// participation — the seller cannot complete it alone.
//
// ── WHAT THIS DOES NOT PROVE ────────────────────────────────────────────────
// A correct code proves the buyer chose to give it up. It does NOT prove the
// car or title changed hands — a seller can ask for the code before handing
// over the keys. There is no server-side fix for that; it is addressed in the
// buyer-facing copy, which must tell the buyer to withhold the code until the
// car and signed title are in their possession. Treat that copy as part of this
// security control, not as marketing text.
//
// ── BRUTE FORCE ─────────────────────────────────────────────────────────────
// Six digits is a million combinations. Five wrong attempts locks the listing's
// code for an hour and alerts, which caps a seller at ~120 guesses a day
// against 1,000,000 — and makes the attempt itself loud. Counting is done in
// the database, not in memory, because Edge Functions are stateless and a
// per-instance counter resets on every cold start.
//
// ── MONEY IS CENTS ──────────────────────────────────────────────────────────
// listings.seller_net is cents (migration 20260803_05_money_to_cents) and goes
// to Stripe unchanged. No conversion. See release-funds for the full note.
//
// The release path below is deliberately identical to release-funds: same risk
// gate, same source_transaction sourcing, same idempotencyKey, same
// settleReferral. It shares idempotencyKey `release_${listing_id}` with BOTH
// release-funds and auto-release-cron, so a buyer tapping Confirm at the same
// moment the seller enters the code cannot produce two transfers for one sale.
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
} from "../_shared/helpers.ts";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { listing_id, code } = await req.json();

    if (!listing_id) throw new Error("listing_id is required");
    const submitted = String(code ?? "").replace(/\D/g, "");
    if (submitted.length !== 6) {
      return jsonResponse({ error: "Enter the 6-digit code from the buyer." }, 400);
    }

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

    const carLabel =
      [listing.year, listing.make, listing.model].filter(Boolean).join(" ") || listing.id;

    // users.id is `text`, not `uuid` — Postgres does not canonicalize these, so
    // compare normalized exactly as release-funds does.
    const sellerId = String(listing.seller_id ?? "").trim().toLowerCase();
    const caller = String(callerId ?? "").trim().toLowerCase();
    if (!sellerId || sellerId !== caller) {
      throw new Error("Only the seller can enter the handover code for this listing");
    }

    if (listing.status !== "pending_confirmation") {
      throw new Error("This listing isn't awaiting fund release");
    }
    if (listing.funds_released) {
      return jsonResponse({ alreadyReleased: true });
    }

    // ── Fetch the code row ────────────────────────────────────────────────
    const { data: handover, error: handoverErr } = await supabase
      .from("escrow_handovers")
      .select("listing_id, code, attempts, locked_until, confirmed_at")
      .eq("listing_id", listing.id)
      .maybeSingle();

    if (handoverErr) throw handoverErr;
    if (!handover) {
      // The trigger should have issued one at payment. If it did not, this is a
      // real defect and the seller must not be left with an unpayable sale.
      await notifyAdminSync({
        subject: `⚠️ No handover code exists for ${carLabel}`,
        html: alertHtml("Seller tried to confirm handover but no code was ever issued", [
          ["Vehicle", carLabel],
          ["Listing ID", listing.id],
        ], "trg_issue_handover_code did not fire for this sale. Issue a code manually and contact the buyer."),
      });
      throw new Error("No handover code has been issued for this sale. Support has been notified.");
    }

    if (handover.locked_until && new Date(handover.locked_until) > new Date()) {
      const mins = Math.ceil(
        (new Date(handover.locked_until).getTime() - Date.now()) / 60000,
      );
      return jsonResponse(
        { error: `Too many incorrect attempts. Try again in ${mins} minute(s).`, lockedForMinutes: mins },
        429,
      );
    }

    // ── Compare ───────────────────────────────────────────────────────────
    if (String(handover.code).trim() !== submitted) {
      const attempts = Number(handover.attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;

      await supabase
        .from("escrow_handovers")
        .update({
          attempts,
          locked_until: lock
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
            : null,
        })
        .eq("listing_id", listing.id);

      if (lock) {
        // Repeated wrong codes on a sale where the seller holds the car is the
        // signature of a seller trying to release without the buyer present.
        await notifyAdminSync({
          subject: `⚠️ Handover code locked — ${MAX_ATTEMPTS} failed attempts on ${carLabel}`,
          html: alertHtml("Seller failed the handover code repeatedly", [
            ["Vehicle", carLabel],
            ["Sale price", money(Number(listing.sale_price))],
            ["Seller ID", listing.seller_id],
            ["Buyer ID", listing.buyer_id],
            ["Attempts", attempts],
            ["Listing ID", listing.id],
          ], "Funds are held. This may be an honest typo, or a seller attempting to release without the buyer. Worth a look at both accounts."),
        });
      }

      return jsonResponse(
        {
          error: lock
            ? `That code is incorrect. Too many attempts — locked for ${LOCKOUT_MINUTES} minutes.`
            : `That code is incorrect. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
          attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts),
        },
        400,
      );
    }

    // ── Correct. Record it before anything can fail ───────────────────────
    // Mirrors release-funds writing confirmed_at ahead of the risk gate:
    // evaluate_listing_risk() derives INSTANT_CONFIRM from confirmed_at minus
    // paid_at, so evaluating first would stop that flag ever firing. It also
    // means the buyer's participation is never lost if the transfer is held.
    const nowIso = new Date().toISOString();

    await supabase
      .from("escrow_handovers")
      .update({ confirmed_at: nowIso, confirmed_by: callerId, attempts: 0, locked_until: null })
      .eq("listing_id", listing.id);

    await supabase
      .from("listings")
      .update({ confirmed_at: nowIso })
      .eq("id", listing.id);

    // ── Risk gate. Fail closed ────────────────────────────────────────────
    const { data: blocked, error: riskErr } = await supabase.rpc("is_release_blocked", {
      p_listing_id: listing.id,
    });

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
            ? "Handover code accepted but the risk check could not run"
            : "Handover code accepted, funds held pending review",
          [
            ["Vehicle", carLabel],
            ["Sale price", money(Number(listing.sale_price))],
            ["Would pay seller", money(Number(listing.seller_net))],
            ["Risk score", flags?.risk_score ?? "—"],
            ["Flags", Array.isArray(flags?.open_flags) ? flags.open_flags.join(", ") : "—"],
            ...(riskErr ? [["Risk check error", riskErr.message] as [string, unknown]] : []),
            ["Listing ID", listing.id],
          ],
          "The handover is recorded and no money has moved. Clear the flags in the admin dashboard, then release from there — auto-release-cron no longer completes held payouts on its own.",
        ),
      });

      return jsonResponse({
        heldForReview: true,
        message:
          "Handover confirmed. This transaction is under a short review before funds are released.",
      });
    }

    // ── Transfer ──────────────────────────────────────────────────────────
    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller?.stripe_account_id) {
      throw new Error("Seller has no connected account");
    }

    if (!listing.stripe_payment_intent_id) {
      throw new Error("Listing has no stripe_payment_intent_id — cannot release safely");
    }
    const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
    const sourceTransaction =
      typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
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
      // Shared with release-funds and auto-release-cron. One sale, one transfer.
      idempotencyKey: `release_${listing.id}`,
    });

    await supabase
      .from("listings")
      .update({
        status: "sold",
        funds_released: true,
        stripe_transfer_id: transfer.id,
        review_flagged_at: null,
      })
      .eq("id", listing.id);

    const referral = await settleReferral(supabase, listing);

    return jsonResponse({
      released: true,
      transferred: sellerNetCents / 100,
      transferredCents: sellerNetCents,
      transferId: transfer.id,
      sourceTransaction,
      referral: referral.outcome,
    });
  } catch (err) {
    console.error("confirm-handover error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
