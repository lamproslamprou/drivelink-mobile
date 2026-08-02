// POST /create-connect-account
// Called when a seller clicks "Set up payouts". Creates a Stripe Express
// connected account if they don't have one yet, then returns a fresh
// onboarding link (these links expire quickly, so we generate one per call
// rather than storing it).
//
// BAN EVASION: a ban sets users.blocked_at and permanently bans the Supabase
// Auth user, but both are keyed to a single account and a new email address
// costs nothing. This is the chokepoint worth guarding — a banned buyer can
// only waste moderation's time, while a banned seller reaching payouts can
// take someone's money. is_banned_identity() matches on the normalized email
// (so "user+2@gmail.com" and "u.ser@gmail.com" resolve to the same inbox),
// the phone, and any Stripe account previously tied to a banned user.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await requireUser(req);
    const stripe = stripeClient();
    const supabase = supabaseAdmin();

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, email, phone, stripe_account_id, blocked_at")
      .eq("id", userId)
      .single();
    if (userErr || !user) throw new Error("User not found");

    // Already banned on this account. moderate-content checks this too, but
    // that only runs when someone posts — nothing stopped a blocked user from
    // walking straight to payout setup.
    if (user.blocked_at) {
      return jsonResponse({ error: "This account has been suspended. Contact support@drivelink.deals." }, 403);
    }

    // Same person, new account. Checked before any Stripe object is created,
    // so an evading user never gets a connected account to point funds at.
    const { data: evading, error: banErr } = await supabase.rpc("is_banned_identity", {
      p_email: user.email ?? null,
      p_phone: user.phone ?? null,
      p_stripe_account_id: user.stripe_account_id ?? null,
    });

    if (banErr) {
      // Fail closed. An unavailable ban check is not a reason to hand out a
      // payout account — the seller can retry, and the alternative is a hole
      // that opens whenever the database hiccups.
      console.error("is_banned_identity failed for user:", userId, banErr);
      throw new Error("Couldn't verify your account right now — please try again in a moment.");
    }

    if (evading === true) {
      console.warn("blocked payout onboarding for banned identity:", userId, user.email);
      return jsonResponse({
        error: "We can't set up payouts for this account. If you believe this is a mistake, contact support@drivelink.deals.",
      }, 403);
    }

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

    // account_onboarding resumes where an incomplete account left off rather
    // than starting over, so a seller who abandons partway can pick the link
    // up again. It is also what an existing seller needs in order to change
    // the bank account funds are paid out to — Stripe hosts that form, which
    // is why no bank details ever touch DriveLink.
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
