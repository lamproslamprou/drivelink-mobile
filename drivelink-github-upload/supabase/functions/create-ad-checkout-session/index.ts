// POST /create-ad-checkout-session
// Called when someone submits the "Advertise on DriveLink" form. Creates a
// one-time Stripe Checkout session for the selected plan and a pending
// ad_placements row. Unlike car-sale checkouts, this money is yours outright
// — no Connect transfer needed, it's platform revenue from the start, so it
// simply lands on your normal Stripe balance and pays out to Mercury like
// everything else already does.
//
// Prices are defined here, server-side, and never trusted from the client.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

// Keep these in sync with the prices shown in AdvertiseView in App.jsx.
const PLANS: Record<string, { label: string; months: number; amountCents: number }> = {
  "3mo": { label: "3 months", months: 3, amountCents: 45000 },   // $450 ($150/mo)
  "6mo": { label: "6 months", months: 6, amountCents: 75000 },   // $750 ($125/mo)
  "12mo": { label: "12 months", months: 12, amountCents: 120000 }, // $1,200 ($100/mo)
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await requireUser(req);
    const { plan, business_name, contact_email, image_url, link_url } = await req.json();

    if (!plan || !PLANS[plan]) throw new Error("Invalid plan selected");
    if (!business_name?.trim()) throw new Error("Business name is required");
    if (!link_url?.trim()) throw new Error("A destination link URL is required");

    const stripe = stripeClient();
    const supabase = supabaseAdmin();
    const selectedPlan = PLANS[plan];
    const origin = req.headers.get("origin") ?? "https://drivelink.deals";

    const adId = "ad" + Date.now();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: selectedPlan.amountCents,
            product_data: { name: `DriveLink sidebar ad — ${selectedPlan.label}` },
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "ad_placement",
        ad_id: adId,
        plan,
      },
      success_url: `${origin}/?ad_purchase=success`,
      cancel_url: `${origin}/?ad_purchase=cancelled`,
    });

    const { error: insertErr } = await supabase.from("ad_placements").insert({
      id: adId,
      user_id: userId,
      business_name: business_name.trim(),
      contact_email: contact_email?.trim() || null,
      image_url: image_url || null,
      link_url: link_url.trim(),
      plan,
      amount_cents: selectedPlan.amountCents,
      status: "pending_payment",
      stripe_checkout_session_id: session.id,
    });
    if (insertErr) throw new Error(`Couldn't save ad placement: ${insertErr.message}`);

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("create-ad-checkout-session error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
