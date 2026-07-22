// POST /stripe-webhook
// Registered as your webhook endpoint in the Stripe Dashboard. This is what
// makes the flow automatic — no more clicking "Mark Sold" by hand.
//
// Handles:
//  - checkout.session.completed: payment succeeded → listing goes to
//    "pending_confirmation", auto_release_at is set 7 days out.
//  - account.updated: a seller's Connect onboarding status changed.
import { corsHeaders, jsonResponse, stripeClient, supabaseAdmin, AUTO_RELEASE_DAYS } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = stripeClient();
  const supabase = supabaseAdmin();
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  let event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return jsonResponse({ error: "Invalid signature" }, 400);
  }

  // Idempotency: Stripe redelivers events on retry. If we've already logged
  // this event id, acknowledge and stop — don't double-process a sale.
  const { data: existing } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (existing) return jsonResponse({ received: true, duplicate: true });
  await supabase.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        payment_intent: string;
        metadata: Record<string, string>;
      };
      const { listing_id, buyer_id } = session.metadata;

      const releaseAt = new Date();
      releaseAt.setDate(releaseAt.getDate() + AUTO_RELEASE_DAYS);

      await supabase
        .from("listings")
        .update({
          status: "pending_confirmation",
          buyer_id,
          stripe_payment_intent_id: session.payment_intent,
          sold_at: new Date().toISOString().slice(0, 10),
          auto_release_at: releaseAt.toISOString(),
        })
        .eq("id", listing_id);

      // Scout commission stays on the existing manual payout tracker —
      // it's flagged as owed here, actually paid out separately, same as
      // before. We're only automating the seller side.
    }

    if (event.type === "account.updated") {
      const account = event.data.object as {
        id: string;
        payouts_enabled: boolean;
      };

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
