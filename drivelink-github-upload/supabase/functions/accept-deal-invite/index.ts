// supabase/functions/accept-deal-invite/index.ts — v4
//
// POST /accept-deal-invite
//
// action: "preview" — no auth. Resolves a token to car details so the
//   counterparty can see what they were invited to before signing up.
// action: "accept"  — auth required. Attaches a party to the deal.
//
// Three shapes of invite reach this function:
//
//   creator_role = "seller"   — listing already exists, the opener is the buyer
//   creator_role = "buyer"    — no listing yet, the opener is the seller
//   creator_role = "promoter" — neither party attached. The first opener picks
//                               a side, the second gets what is left, and the
//                               listing is built only once both are known.
//
// Onboarding blocks the flow in every shape: a seller who cannot receive money
// is never recorded as the seller, because the buyer could then fund a deal
// whose proceeds have nowhere to go.
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

// Flat Promoter bounty. Never blocks or fails a join: any problem is logged and ignored.
// award_promoter_bounty applies every guard (ID-verified, not self, real deal, caps, kill switch).
// The referred user is whoever the Promoter brought: the deal's creator, or the joiner when the
// Promoter created the invite themselves.
// deno-lint-ignore no-explicit-any
async function awardPromoterBounty(supabase: any, invite: any, token: string, joinerId: string, listingId: string) {
  try {
    const { data: ref } = await supabase.from("referrals").select("id, promoter_id").eq("deal_id", token).maybeSingle();
    if (!ref) return;
    const referredUser = invite.creator_role === "promoter" ? joinerId : invite.created_by;
    const { data: outcome, error } = await supabase.rpc("award_promoter_bounty", {
      p_referral_id: String(ref.id),
      p_promoter_id: ref.promoter_id,
      p_referred_user: referredUser,
      p_listing_id: listingId,
    });
    if (error) console.error("promoter bounty rpc failed:", token, error.message);
    else console.log("promoter bounty:", token, outcome);
  } catch (err) {
    console.error("promoter bounty threw:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = supabaseAdmin();

  try {
    const { token, action = "preview", role: claimedRole } = await req.json();
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
    // "partial" expires on the same clock as "pending". A promoter deal with
    // one side claimed and nobody else coming is still an orphan.
    if (
      (invite.status === "pending" || invite.status === "partial") &&
      new Date(invite.expires_at) < new Date()
    ) {
      await supabase.from("deal_invites").update({ status: "expired" }).eq("token", token);
      return jsonResponse({ error: "This link has expired. Ask for a new one." }, 410);
    }
    if (invite.status === "expired") {
      return jsonResponse({ error: "This link has expired. Ask for a new one." }, 410);
    }

    const byPromoter = invite.creator_role === "promoter";

    // Which side the person opening the link takes.
    //
    // Two-party deals: the creator took one side, the opener gets the other.
    // Promoter deals: the promoter took neither, so this is null while both
    // sides are free and the client asks; once one side is claimed it resolves
    // to the remaining one.
    const remainingRole: "buyer" | "seller" | null = byPromoter
      ? (invite.buyer_id && invite.seller_id
        ? null
        : invite.buyer_id
        ? "seller"
        : invite.seller_id
        ? "buyer"
        : null)
      : (invite.creator_role === "seller" ? "buyer" : "seller");

    const joinerRole = remainingRole;

    const car = {
      year: invite.year,
      make: invite.make,
      model: invite.model,
      mileage: invite.mileage,
      vin: invite.vin,
      note: invite.note,
      price: invite.price, // CENTS — create-deal converted once at the door
      // Shown on the preview screen on purpose. Agreeing to a handover three
      // weeks out is a term of the deal, not a detail — whoever did not set it
      // needs to see it before they join, not after they have paid.
      handover_date: invite.handover_date ?? null,
    };
    const carLabel = `${invite.year} ${invite.make} ${invite.model}`;

    // -----------------------------------------------------------------------
    // preview
    // -----------------------------------------------------------------------
    if (action === "preview") {
      return jsonResponse({
        state: invite.status === "accepted" ? "already_accepted" : "open",
        // Null on a wide-open promoter deal: the client shows a buyer/seller
        // chooser rather than telling someone which side they are.
        your_role: joinerRole,
        arranged_by_promoter: byPromoter,
        choose_role: byPromoter && !invite.buyer_id && !invite.seller_id,
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

    // On a promoter deal this is also what enforces
    // deal_invites_promoter_not_party: the arranger cannot quietly become one
    // of the two parties and collect both the sale and the commission.
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
      const alreadyMine = invite.accepted_by === userId ||
        invite.buyer_id === userId ||
        invite.seller_id === userId;
      if (alreadyMine) {
        return jsonResponse({
          state: "ready_for_payment",
          listing_id: invite.listing_id,
          your_role: invite.seller_id === userId ? "seller" : "buyer",
        });
      }
      return jsonResponse({ error: "Someone has already joined this deal." }, 409);
    }

    // =======================================================================
    // Promoter-arranged
    // =======================================================================
    if (byPromoter) {
      // Reopening the link: after onboarding, or just checking back.
      if (invite.buyer_id === userId || invite.seller_id === userId) {
        return jsonResponse({
          state: invite.listing_id ? "ready_for_payment" : "waiting_for_other_party",
          listing_id: invite.listing_id,
          your_role: invite.seller_id === userId ? "seller" : "buyer",
          car,
        });
      }

      let takingRole: "buyer" | "seller";
      if (remainingRole) {
        takingRole = remainingRole; // one side already gone, no choice to offer
      } else {
        if (claimedRole !== "buyer" && claimedRole !== "seller") {
          return jsonResponse({ error: "Pick whether you are the buyer or the seller." }, 400);
        }
        takingRole = claimedRole;
      }

      // Nothing is written for an un-onboarded seller. They reopen the same
      // link once Stripe Connect is finished, and the side stays free until
      // then rather than locking the deal to someone who cannot be paid.
      if (takingRole === "seller" && !joiner?.stripe_payouts_enabled) {
        return jsonResponse({
          state: "needs_onboarding",
          your_role: "seller",
          car,
          message: "Set up payouts to receive the money, then reopen this link.",
        });
      }

      const column = takingRole === "buyer" ? "buyer_id" : "seller_id";
      const otherId = takingRole === "buyer" ? invite.seller_id : invite.buyer_id;

      // The .is(column, null) guard decides the race when two people open the
      // link at the same moment: only one update can match.
      const { data: claimed, error: claimErr } = await supabase
        .from("deal_invites")
        .update({
          [column]: userId,
          status: otherId ? "accepted" : "partial",
          ...(otherId
            ? { accepted_by: userId, accepted_at: new Date().toISOString() }
            : {}),
        })
        .eq("token", token)
        .is(column, null)
        .in("status", ["pending", "partial"])
        .select("*");

      if (claimErr) {
        console.error("promoter-deal claim failed:", claimErr.message);
        return jsonResponse({ error: "Could not join this deal." }, 500);
      }
      if (!claimed || claimed.length === 0) {
        return jsonResponse({ error: "Someone has already taken that side of this deal." }, 409);
      }

      const row = claimed[0];

      // Still waiting on the other party. No listing, nothing to pay.
      if (!row.buyer_id || !row.seller_id) {
        notifyAdmin({
          subject: `Promoter deal — ${takingRole} joined — ${carLabel} (${dollars(car.price / 100)})`,
          html: alertHtml(`A ${takingRole} joined a promoter-arranged deal`, [
            ["Vehicle", carLabel],
            ["Price", dollars(car.price / 100)],
            [
              takingRole === "buyer" ? "Buyer" : "Seller",
              `${joiner?.name ?? "—"} (${joiner?.email ?? "—"})`,
            ],
            ["Token", token],
          ], "Waiting for the other party to open the link."),
        });

        // The waiting screen tells them we'll be in touch. Without this that
        // is a promise nothing keeps — they have joined a deal with no
        // counterparty and no reason to come back.
        if (joiner?.email) {
          notifyAdmin({
            to: joiner.email,
            subject: `You've joined a deal — ${carLabel}`,
            html: alertHtml(`You're in as the ${takingRole}`, [
              ["Vehicle", carLabel],
              ["Agreed price", dollars(car.price / 100)],
              ...(car.handover_date ? [["Handover", String(car.handover_date)]] : []),
            ], takingRole === "buyer"
              ? "Nothing is charged yet. We'll email you as soon as the seller joins, and you'll be able to pay securely through DriveLink then."
              : "We'll email you as soon as the buyer joins. They pay first — you don't hand over anything until the payment is protected."),
          });
        }

        return jsonResponse({
          state: "waiting_for_other_party",
          your_role: takingRole,
          car,
          message: takingRole === "buyer"
            ? "You're in. Nothing is charged until the seller joins."
            : "You're in. The buyer can pay once they join.",
        });
      }

      // Both sides present — build the listing.
      const listingId = makeListingId();
      const { error: listingErr } = await supabase.from("listings").insert({
        id: listingId,
        seller_id: row.seller_id,
        buyer_id: row.buyer_id,
        is_private: true,
        year: invite.year,
        make: invite.make,
        model: invite.model,
        price: invite.price, // already cents
        mileage: invite.mileage,
        vin: invite.vin,
        description: invite.note,
        handover_date: invite.handover_date ?? null,
        status: "active",
        moderation_status: "approved",
        moderated_at: new Date().toISOString(),
        images: [],
      });

      if (listingErr) {
        console.error("promoter-deal listing insert failed:", listingErr.message);
        // Hand the claim back rather than leaving a deal that can never be
        // funded. They can retry on the same link.
        await supabase.from("deal_invites")
          .update({ [column]: null, status: "partial", accepted_by: null, accepted_at: null })
          .eq("token", token);
        return jsonResponse({ error: "Could not join this deal." }, 500);
      }

      const { error: linkErr } = await supabase
        .from("deal_invites")
        .update({ listing_id: listingId })
        .eq("token", token);

      if (linkErr) {
        await supabase.from("listings").delete().eq("id", listingId);
        console.error("promoter-deal invite link failed:", linkErr.message);
        return jsonResponse({ error: "Could not join this deal." }, 500);
      }

      // The party who joined first has been waiting on exactly this. They are
      // not on the page, so the email is the only thing that brings them back.
      const waitingId = takingRole === "buyer" ? row.seller_id : row.buyer_id;
      const { data: waitingUser } = await supabase
        .from("users")
        .select("email")
        .eq("id", waitingId)
        .maybeSingle();

      if (waitingUser?.email) {
        const waitingRole = takingRole === "buyer" ? "seller" : "buyer";
        notifyAdmin({
          to: waitingUser.email,
          subject: `Your deal is ready — ${carLabel}`,
          html: alertHtml("The other party has joined", [
            ["Vehicle", carLabel],
            ["Agreed price", dollars(car.price / 100)],
            ...(car.handover_date ? [["Handover", String(car.handover_date)]] : []),
          ], waitingRole === "buyer"
            ? "You can now pay securely. Sign in to DriveLink and open My Purchases."
            : "The buyer can now pay. You'll be notified when the payment is protected — don't hand over the car or title until then."),
        });
      }

      notifyAdmin({
        subject: `Promoter deal matched — ${carLabel} (${dollars(car.price / 100)})`,
        html: alertHtml("Both parties joined a promoter-arranged deal", [
          ["Vehicle", carLabel],
          ["Price", dollars(car.price / 100)],
          ["Joined last", `${joiner?.name ?? "—"} (${joiner?.email ?? "—"}) as ${takingRole}`],
          ["Listing ID", listingId],
        ], "The buyer can now pay. The arranging promoter earns a flat bounty if the referred user is ID-verified."),
      });

      await awardPromoterBounty(supabase, invite, token, userId, listingId);
      return jsonResponse({
        state: "ready_for_payment",
        listing_id: listingId,
        your_role: takingRole,
      });
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
        ], "Both parties are attached. The buyer can now pay."),
      });

      await awardPromoterBounty(supabase, invite, token, userId, String(invite.listing_id));
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
      // Copied from the invite for the same reason price is: the buyer set it
      // days ago, and this listing row is the only thing auto_release_at is
      // computed from. Dropping it here would silently revert the deal to
      // payment + 7d after the buyer was shown a later date.
      handover_date: invite.handover_date ?? null,
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
      ], "Both parties are attached. The buyer can now pay."),
    });

    await awardPromoterBounty(supabase, invite, token, userId, listingId);
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
