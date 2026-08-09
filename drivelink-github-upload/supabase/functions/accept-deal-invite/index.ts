// supabase/functions/accept-deal-invite/index.ts — v3, final
//
// POST /accept-deal-invite
//
// action: "preview" — no auth. Resolves a token to car details so the
//   counterparty can see what they were invited to before signing up.
// action: "accept"  — auth required. Attaches the counterparty to the deal.
//
// Onboarding blocks the flow: if the joiner is the seller and payouts are not
// enabled, the invite stays pending and needs_onboarding comes back. They
// reopen the same link after finishing Stripe Connect.
//
// Deploy with JWT verification OFF — preview must work for someone who has
// never seen DriveLink:
//   supabase functions deploy accept-deal-invite --no-verify-jwt
// The accept path does its own auth check below.

import {
  corsHeaders,
  jsonResponse,
  notifyAdmin,
  alertHtml,
  dollars,
  supabaseAdmin,
} from "../_shared/helpers.ts";

function makeListingId(): string {
  return `l${Date.now()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = supabaseAdmin();

  try {
    const { token, action = "preview" } = await req.json();
    if (!token || typeof token !== "string") {
      return jsonResponse({ error: "This link is not valid." }, 400);
    }

    const { data: invite, error: inviteErr } = await supabase
      .from("deal_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (inviteErr) {
      console.error("accept-deal-invite lookup failed:", inviteErr.message);
      return jsonResponse({ error: "Something went wrong." }, 500);
    }
    if (!invite) return jsonResponse({ error: "This link is not valid." }, 404);

    if (invite.status === "cancelled") {
      return jsonResponse({ error: "This deal was cancelled." }, 410);
    }
    if (invite.status === "pending" && new Date(invite.expires_at) < new Date()) {
      await supabase.from("deal_invites").update({ status: "expired" }).eq("token", token);
      return jsonResponse({ error: "This link has expired. Ask for a new one." }, 410);
    }
    if (invite.status === "expired") {
      return jsonResponse({ error: "This link has expired. Ask for a new one." }, 410);
    }

    // The role the person opening the link will take.
    const joinerRole = invite.creator_role === "seller" ? "buyer" : "seller";

    const car = {
      year: invite.year,
      make: invite.make,
      model: invite.model,
      mileage: invite.mileage,
      vin: invite.vin,
      note: invite.note,
      price: invite.price, // CENTS — create-deal converted once at the door
    };
    const carLabel = `${invite.year} ${invite.make} ${invite.model}`;

    // -----------------------------------------------------------------------
    // preview
    // -----------------------------------------------------------------------
    if (action === "preview") {
      return jsonResponse({
        state: invite.status === "accepted" ? "already_accepted" : "open",
        your_role: joinerRole,
        car,
      });
    }

    if (action !== "accept") return jsonResponse({ error: "Unknown action." }, 400);

    // -----------------------------------------------------------------------
    // accept
    // -----------------------------------------------------------------------
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Sign in to join this deal." }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return jsonResponse({ error: "Sign in to join this deal." }, 401);
    }
    const userId = authData.user.id;

    // Mirrors the self-referral block on Promoter.
    if (userId === invite.created_by) {
      return jsonResponse(
        { error: "You cannot join your own deal. Send this link to the other party." },
        403,
      );
    }

    const { data: joiner, error: joinerErr } = await supabase
      .from("users")
      .select("name, email, stripe_payouts_enabled, blocked_at, deleted_at")
      .eq("id", userId)
      .single();

    if (joinerErr) return jsonResponse({ error: "Could not load your account." }, 500);
    if (joiner?.blocked_at || joiner?.deleted_at) {
      return jsonResponse({ error: "This account cannot join a deal." }, 403);
    }

    if (invite.status === "accepted") {
      if (invite.accepted_by === userId) {
        return jsonResponse({
          state: "ready_for_payment",
          listing_id: invite.listing_id,
          your_role: joinerRole,
        });
      }
      return jsonResponse({ error: "Someone has already joined this deal." }, 409);
    }

    // ---- Joiner is the BUYER (seller created the deal) --------------------
    if (joinerRole === "buyer") {
      // The .is("buyer_id", null) guard makes this the race-condition winner.
      const { data: attached, error: attachErr } = await supabase
        .from("listings")
        .update({ buyer_id: userId })
        .eq("id", invite.listing_id)
        .is("buyer_id", null)
        .select("id");

      if (attachErr) {
        console.error("accept-deal-invite buyer attach failed:", attachErr.message);
        return jsonResponse({ error: "Could not join this deal." }, 500);
      }
      if (!attached || attached.length === 0) {
        return jsonResponse({ error: "Someone has already joined this deal." }, 409);
      }

      await supabase
        .from("deal_invites")
        .update({
          status: "accepted",
          accepted_by: userId,
          accepted_at: new Date().toISOString(),
        })
        .eq("token", token)
        .eq("status", "pending");

      notifyAdmin({
        subject: `BYOD deal matched — ${carLabel} (${dollars(car.price / 100)})`,
        html: alertHtml("A buyer joined a bring-your-own-deal", [
          ["Vehicle", carLabel],
          ["Price", dollars(car.price / 100)],
          ["Buyer", `${joiner?.name ?? "—"} (${joiner?.email ?? "—"})`],
          ["Listing ID", invite.listing_id],
        ], "Both parties are attached. The buyer can now fund escrow."),
      });

      return jsonResponse({
        state: "ready_for_payment",
        listing_id: invite.listing_id,
        your_role: "buyer",
      });
    }

    // ---- Joiner is the SELLER (buyer created the deal) --------------------
    if (!joiner?.stripe_payouts_enabled) {
      // Invite stays pending. They return to this same link after onboarding.
      return jsonResponse({
        state: "needs_onboarding",
        your_role: "seller",
        car,
        message: "Set up payouts to receive the money, then reopen this link.",
      });
    }

    const listingId = makeListingId();

    const { error: listingErr } = await supabase.from("listings").insert({
      id: listingId,
      seller_id: userId,
      buyer_id: invite.created_by,
      is_private: true,
      year: invite.year,
      make: invite.make,
      model: invite.model,
      // Already cents. Copied straight across — listings.price is cents.
      price: invite.price,
      mileage: invite.mileage,
      vin: invite.vin,
      description: invite.note,
      status: "active",
      moderation_status: "approved",
      moderated_at: new Date().toISOString(),
      images: [],
    });

    if (listingErr) {
      console.error("accept-deal-invite listing insert failed:", listingErr.message);
      return jsonResponse({ error: "Could not join this deal." }, 500);
    }

    const { data: accepted, error: acceptErr } = await supabase
      .from("deal_invites")
      .update({
        status: "accepted",
        accepted_by: userId,
        accepted_at: new Date().toISOString(),
        listing_id: listingId,
      })
      .eq("token", token)
      .eq("status", "pending")
      .select("token");

    if (acceptErr || !accepted || accepted.length === 0) {
      // Lost the race, or the update failed. Do not leave an orphan listing.
      await supabase.from("listings").delete().eq("id", listingId);
      return jsonResponse({ error: "Someone has already joined this deal." }, 409);
    }

    notifyAdmin({
      subject: `BYOD deal matched — ${carLabel} (${dollars(car.price / 100)})`,
      html: alertHtml("A seller joined a bring-your-own-deal", [
        ["Vehicle", carLabel],
        ["Price", dollars(car.price / 100)],
        ["Seller", `${joiner?.name ?? "—"} (${joiner?.email ?? "—"})`],
        ["Listing ID", listingId],
      ], "Both parties are attached. The buyer can now fund escrow."),
    });

    return jsonResponse({
      state: "ready_for_payment",
      listing_id: listingId,
      your_role: "seller",
    });
  } catch (err) {
    console.error("accept-deal-invite error:", err);
    return jsonResponse({ error: "Something went wrong." }, 500);
  }
});
