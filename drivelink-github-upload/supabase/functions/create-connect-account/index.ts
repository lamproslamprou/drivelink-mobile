// POST /create-connect-account
// Called when a seller clicks "Set up payouts". Creates a Stripe Express
// connected account if they don't have one yet, then returns a fresh
// onboarding link (these links expire quickly, so we generate one per call
// rather than storing it).
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await requireUser(req);
    const stripe = stripeClient();
    const supabase = supabaseAdmin();

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, email, stripe_account_id")
      .eq("id", userId)
      .single();
    if (userErr || !user) throw new Error("User not found");

    let accountId = user.stripe_account_id as string | null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email ?? undefined,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        business_type: "individual",
      });
      accountId = account.id;

      await supabase
        .from("users")
        .update({ stripe_account_id: accountId })
        .eq("id", userId);
    }

    const origin = req.headers.get("origin") ?? "https://drivelink.deals";

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/?refresh=true`,
      return_url: `${origin}/?onboarded=true`,
      type: "account_onboarding",
    });

    return jsonResponse({ url: accountLink.url });
  } catch (err) {
    console.error("create-connect-account error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
