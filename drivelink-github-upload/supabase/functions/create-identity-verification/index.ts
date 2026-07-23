// POST /create-identity-verification
// Called from the Profile page when a user clicks "Verify Your Identity".
// Creates a Stripe Identity VerificationSession in hosted mode (Stripe's own
// UI handles document capture + selfie liveness check — nothing to build
// client-side) and returns the URL to redirect the user to. On completion,
// Stripe fires identity.verification_session.verified (or .requires_input)
// to the webhook, which is what actually flips users.verified — this
// function only *starts* the flow.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const callerId = await requireUser(req);
    const supabase = supabaseAdmin();
    const stripe = stripeClient();

    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, identity_verification_status")
      .eq("id", callerId)
      .single();
    if (userErr || !user) throw new Error("User not found");

    if (user.identity_verification_status === "verified") {
      return jsonResponse({ alreadyVerified: true });
    }

    const origin = req.headers.get("origin") || "https://drivelink.deals";

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      metadata: { drivelink_user_id: callerId },
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      return_url: `${origin}/?identity_return=true`,
    });

    await supabase
      .from("users")
      .update({ identity_verification_status: "pending", stripe_identity_session_id: session.id })
      .eq("id", callerId);

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("create-identity-verification error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
