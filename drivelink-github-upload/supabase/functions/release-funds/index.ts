
Claude finished the response
Confirms the click reaches the function and gets the 500. Reproduced, but it doesn't discriminate between my two remaining candidates.

I still need one of these:

sql
select id, email, name from users where name ilike '%john%';
If that id isn't b0887191-20b6-46f1-82b1-14300e63ddc4, the sale is attributed to a different account than the one signed in — and the card renders anyway because My Purchases reads the sales record, not listings.buyer_id. That's my leading theory now, since the UI and the guard are reading two different sources of truth.

Otherwise, _shared/helpers.ts — specifically requireUser. If it's returning the auth uid while listings.buyer_id stores users.id, and those diverge for this account, same symptom.

One of those two and I can write the fix.

Faster confirmation if you want it now: open devtools → Network → click Confirm Receipt → look at the release-funds response body. It'll show the error string, and if you also expand the request you can see the Authorization header's subject. But the SQL query is one line and settles it cleanly.

id,email,name
b0887191-20b6-46f1-82b1-14300e63ddc4,lampros.g.lamprou+test1@gmail.com,John Test


Diagnosed authentication mismatch between user identifiers
Diagnosed authentication mismatch between user identifiers
So listings.buyer_id matches John Test's users.id exactly. The guard compares those two values and still fails — which means requireUser(req) is not returning users.id.

Almost certainly it's returning the JWT subject, i.e. the auth.users uuid, and for this account that differs from the users row id. Your schema makes this easy to hit: users.id is text and gets written by your own signup flow rather than being a foreign key to auth.users, so the two can silently diverge. Every account created outside the happy path will fail this check.

Paste _shared/helpers.ts — requireUser specifically. That's the last piece and then I'll send you a complete corrected release-funds/index.ts.

If you want to confirm the theory in ten seconds first, run:

sql
select id, email from auth.users where email = 'lampros.g.lamprou+test1@gmail.com';
If that uuid is anything other than b0887191-..., that's your bug, and the fix is for requireUser to resolve the JWT subject through to users.id rather than returning it raw — plus a backfill so existing rows line up.

The three issues from my last message still stand independently: missing source_transaction (which will throw balance_insufficient the moment the guard passes, since the $48.25 is still pending), the $2 discrepancy between sale_price and seller_net, and the dollar-rounded commission.

id,email
b0887191-20b6-46f1-82b1-14300e63ddc4,lampros.g.lamprou+test1@gmail.com


Investigated authentication mismatch, pinpointed probable return type discrepancy
Investigated authentication mismatch, pinpointed probable return type discrepancy
Theory's dead — they match. So requireUser isn't returning a mismatched uuid; it's returning something that isn't a bare id string at all.

Most likely it returns the user object (or a { user } wrapper), and listing.buyer_id !== callerId compares a string to an object, which is always true. That would fail identically for every account, which fits: this has never once worked.

Paste _shared/helpers.ts. That's the last thing I need — I'll send back a complete corrected index.ts with the guard fixed plus source_transaction, the commission rounding, and whatever the fee math needs.


helpers.ts
285 lines

ts


Diagnosed authentication mismatch, identified code duplication, and pinpointed rounding bugs
Diagnosed authentication mismatch, identified code duplication, and pinpointed rounding bugs
requireUser is correct — it returns data.user.id, a plain string, and that uuid matches listings.buyer_id in the database. On paper the comparison should pass. It doesn't, so the runtime values differ from what the SQL shows, and I'm not going to keep guessing at which way.

Two candidates left, both settled by one log line:

The frontend sends a different listing_id. My Purchases renders from sales records, not from listings. If the card passes a stale or wrong id that resolves to some other listing row, you'd get exactly this error instead of "Listing not found."
The stored string isn't what it looks like. users.id is text, not uuid, so Postgres doesn't normalize it. Trailing whitespace or a case difference in buyer_id survives storage and breaks !==, and CSV output won't show it.
Here's the instrumented version with the diagnostic plus the three real bugs fixed:


Created a file, read a file
Created a file, read a file
What changed beyond the diagnostic:

source_transaction. Your transfer drew on the platform's available balance. The $48.25 is still pending settlement, so even once the guard passes, transfers.create would have thrown balance_insufficient. Naming the originating charge lets Stripe transfer against those specific funds immediately. This would have broken every sale, not just this one.

Idempotency key. Buyer double-clicks currently mean two transfers. Now the second is a no-op.

Uses settleReferral from helpers. Your index.ts still had its own inline copy of the referral logic. helpers.ts exports the shared version that auto-release-cron uses — the two had already drifted once, which is how the cron sat broken for weeks.

Deploy, click Confirm Receipt, and read the log line. It prints both values with lengths and both comparisons, so it'll name the cause outright.

Two things it doesn't fix, both needing your call:

The fee math is wrong. sale_price 50, platform_fee 1, seller_net 47 — $2 vanishes, and at your 1% the seller should net $49.50. That's in stripe-webhook, not here.

Commission rounds to whole dollars. Math.round(50 * 0.01) is 1, so a $0.50 commission pays $1. It's in settleReferral in helpers.ts and should be cents throughout. Both are worth fixing before real money moves — send me stripe-webhook/index.ts when you want to.


Index
TS 





Claude is AI and can make mistakes. Please double-check responses.
Index · TS
// POST /release-funds
// Called when the buyer clicks "Confirm Receipt", or by auto-release-cron
// after AUTO_RELEASE_DAYS with no confirmation and no dispute. Transfers the
// seller's net proceeds out of the platform's Stripe balance into the seller's
// connected account, then settles any attributed Scout referral.
//
// The platform fee is never transferred anywhere: it's the portion of the
// original charge left behind on the platform's Stripe balance once the
// seller's transfer goes out. That balance pays out to Mercury.
import {
  corsHeaders,
  jsonResponse,
  requireUser,
  settleReferral,
  stripeClient,
  supabaseAdmin,
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
        "id, seller_id, buyer_id, status, funds_released, seller_net, sale_price, referral_code, stripe_payment_intent_id",
      )
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");
 
    // ── Identity diagnostic ──────────────────────────────────────────────────
    // Logs the exact values being compared, with lengths and JSON quoting so
    // whitespace and case differences are visible. Remove once the mismatch
    // is understood.
    console.log("release-funds identity check:", JSON.stringify({
      requested_listing_id: listing_id,
      resolved_listing_id: listing.id,
      caller_id: callerId,
      caller_len: callerId?.length,
      buyer_id: listing.buyer_id,
      buyer_len: listing.buyer_id?.length,
      strict_equal: listing.buyer_id === callerId,
      trimmed_equal:
        String(listing.buyer_id ?? "").trim().toLowerCase() ===
        String(callerId ?? "").trim().toLowerCase(),
      status: listing.status,
    }));
 
    // Compare normalized. users.id is `text`, not `uuid`, so Postgres does not
    // canonicalize these — stray whitespace or case survives storage.
    const buyerId = String(listing.buyer_id ?? "").trim().toLowerCase();
    const caller = String(callerId ?? "").trim().toLowerCase();
 
    // Only the actual buyer can manually release funds — the cron job bypasses
    // this by calling with the service role, not a user token.
    if (!buyerId || buyerId !== caller) {
      throw new Error("Only the buyer can confirm receipt for this listing");
    }
    if (listing.status !== "pending_confirmation") {
      throw new Error("This listing isn't awaiting fund release");
    }
    if (listing.funds_released) {
      return jsonResponse({ alreadyReleased: true });
    }
 
    const { data: seller, error: sellerErr } = await supabase
      .from("users")
      .select("id, stripe_account_id")
      .eq("id", listing.seller_id)
      .single();
    if (sellerErr || !seller?.stripe_account_id) {
      throw new Error("Seller has no connected account");
    }
 
    // ── source_transaction ───────────────────────────────────────────────────
    // Without this, the transfer draws on the platform's *available* balance.
    // Card charges take ~2 business days to settle, so releasing before then
    // fails with `balance_insufficient`. Naming the originating charge lets
    // Stripe transfer against those specific funds while they're still pending.
    let sourceTransaction: string | undefined;
    if (listing.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(listing.stripe_payment_intent_id);
        const chargeId = typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : pi.latest_charge?.id;
        if (chargeId) sourceTransaction = chargeId;
        else console.warn("no charge on payment intent:", listing.stripe_payment_intent_id);
      } catch (err) {
        console.error("could not resolve charge for listing:", listing.id, err);
      }
    }
 
    const sellerNetCents = Math.round(Number(listing.seller_net) * 100);
    if (!Number.isFinite(sellerNetCents) || sellerNetCents <= 0) {
      throw new Error("Listing has no valid seller_net to transfer");
    }
 
    const transfer = await stripe.transfers.create({
      amount: sellerNetCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: `listing_${listing.id}`,
      ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
    }, {
      // Prevents a double payout if the buyer double-clicks or retries.
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
 
    // Referral settlement lives in _shared/helpers.ts so this path and
    // auto-release-cron behave identically. Never throws — the seller has
    // already been paid by the time it runs.
    const referral = await settleReferral(supabase, listing);
 
    return jsonResponse({
      transferred: sellerNetCents / 100,
      transferId: transfer.id,
      sourceTransaction: sourceTransaction ?? null,
      referral: referral.outcome,
    });
  } catch (err) {
    console.error("release-funds error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
 




