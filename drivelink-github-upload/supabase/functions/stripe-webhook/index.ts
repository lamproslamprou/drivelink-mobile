// POST /stripe-webhook
// Registered as your webhook endpoint in the Stripe Dashboard. This is what
// makes the flow automatic — replaces manually clicking "Mark Sold" for any
// sale that actually goes through real Stripe Checkout.
//
// Handles:
//  - checkout.session.completed: payment succeeded → listing goes to
//    "pending_confirmation", mirrors the fields the old markSold() set
//    (sale_price, sold_at, platform_fee, seller_net), plus auto_release_at.
//  - account.updated: a seller's Connect onboarding status changed.
//
// IMPORTANT FIX vs the old markSold() logic: that function always subtracted
// the 1% promoter fee from the seller's net, even when no referral existed —
// meaning sellers were shorted 1% with nobody receiving it. This version only
// deducts the promoter fee when a pending referral actually exists for the
// listing, computed once here and honored downstream by release-funds.
import { corsHeaders, jsonResponse, stripeClient, supabaseAdmin, PLATFORM_FEE, PROMOTER_FEE, AUTO_RELEASE_DAYS } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = stripeClient();
  const supabase = supabaseAdmin();
  const signature = req.headers.get("stripe-signature");

  // Two Stripe webhook endpoints point at this same function: one for
  // "your account" events (checkout.session.completed) and one for
  // "connected accounts" events (account.updated) — Stripe requires these
  // as separate endpoints, each with its own signing secret. Try both.
  const body = await req.text();
  const candidateSecrets = [
    Deno.env.get("STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("STRIPE_WEBHOOK_SECRET_CONNECT"),
  ].filter(Boolean) as string[];

  let event;
  let verified = false;
  for (const secret of candidateSecrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature!, secret);
      verified = true;
      break;
    } catch {
      // try the next secret
    }
  }
  if (!verified || !event) {
    console.error("Webhook signature verification failed against all known secrets");
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  // Idempotency: Stripe redelivers events on retry. If we've already logged
  // this event id, acknowledge and stop — don't double-process a sale.
  const { data: existing } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return jsonResponse({ received: true, duplicate: true });
  await supabase.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    if (event.type === "checkout.session.completed") {
      // Fetch the full session from Stripe's API rather than trusting the
      // webhook body directly — works whether Stripe sends a full ("snapshot")
      // or minimal ("thin") event payload, so we don't depend on which
      // payload style a given endpoint happens to be configured for.
      const sessionId = (event.data.object as { id: string }).id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const { listing_id, buyer_id } = session.metadata as Record<string, string>;

      const salePrice = Math.round((session.amount_total ?? 0) / 100);
      const platformFee = Math.round(salePrice * PLATFORM_FEE);

      // Only reserve a promoter cut if a pending referral actually exists —
      // this is the bug fix mentioned above.
      const { data: pendingRef } = await supabase
        .from("referrals")
        .select("id, promoter_id")
        .eq("listing_id", listing_id)
        .eq("status", "pending")
        .maybeSingle();

      const promoterFeeReserved = pendingRef ? Math.round(salePrice * PROMOTER_FEE) : 0;
      const sellerNet = salePrice - platformFee - promoterFeeReserved;

      const releaseAt = new Date();
      releaseAt.setDate(releaseAt.getDate() + AUTO_RELEASE_DAYS);

      await supabase
        .from("listings")
        .update({
          status: "pending_confirmation",
          buyer_id,
          sale_price: salePrice,
          platform_fee: platformFee,
          seller_net: sellerNet,
          stripe_payment_intent_id: session.payment_intent,
          sold_at: new Date().toISOString().slice(0, 10),
          auto_release_at: releaseAt.toISOString(),
        })
        .eq("id", listing_id);

      // Referral stays "pending" — it's marked "paid" and credited to the
      // promoter's balance in release-funds, same moment the seller is paid,
      // same as the existing confirmReceipt() behavior.
    }

    if (event.type === "account.updated") {
      // Same reasoning as above — fetch the full account object rather than
      // trusting fields on the event body.
      const accountId = (event.data.object as { id: string }).id;
      const account = await stripe.accounts.retrieve(accountId);
      await supabase
        .from("users")
        .update({ stripe_payouts_enabled: account.payouts_enabled })
        .eq("stripe_account_id", account.id);
    }

    return jsonResponse({ received: true });
  } catch (err) {
    console.error("stripe-webhook processing error:", err);
    // Still 200 so Stripe doesn't hammer retries on a bug we need to fix
    // server-side — but log loudly so it doesn't go unnoticed.
    return jsonResponse({ received: true, processingError: true });
  }
});
