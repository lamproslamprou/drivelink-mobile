// supabase/functions/create-deal/index.ts — v3, final
//
// POST /create-deal
// Creates a bring-your-own-deal escrow and returns a shareable invite link.
// For a car the two parties already found elsewhere: no listing to browse, no
// marketplace, just the money handled safely.
//
// Seller-initiated: the seller must already have stripe_payouts_enabled. If
// not, nothing is created and needs_onboarding comes back, so no dead links
// exist. A private listing is created immediately with seller_id = caller.
//
// Buyer-initiated: no listing yet. listings.seller_id must always be the
// seller, because create-checkout-session and the transfer key off it, so the
// car details park on deal_invites until the seller joins and onboards.
//
// Prices are CENTS in storage, matching listings.price (migration
// 20260803_05_money_to_cents) and offers.amount. The client posts whole
// dollars, which is what a human types; this function is the single place
// that converts. deal_invites.price is cents too, so accept-deal-invite can
// copy it into listings.price without touching it.

import {
  corsHeaders,
  jsonResponse,
  notifyAdmin,
  alertHtml,
  dollars,
  supabaseAdmin,
} from "../_shared/helpers.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://drivelink.deals";
// Whole dollars — compared against the dollar figure the client posts, before
// the conversion to cents below.
const MAX_PRICE = 250_000;

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// listings.id is text with no default. Existing IDs look like l1782940413026 —
// 'l' plus epoch milliseconds. Matching that convention.
function makeListingId(): string {
  return `l${Date.now()}`;
}

// Records a standing-Promoter referral against a BYOD deal.
//
// Best-effort by design: a deal that succeeds must not be rolled back because
// attribution failed. An unknown or inactive code, or a promoter referring
// themselves, simply records nothing.
//
// referrals rows carry either listing_id or deal_id, never both — enforced by
// the referrals_one_target check constraint. BYOD rows use deal_id, holding the
// invite token.
async function recordPromoterReferral(
  supabase: ReturnType<typeof supabaseAdmin>,
  token: string,
  rawCode: unknown,
  initiatorId: string,
): Promise<void> {
  if (typeof rawCode !== "string" || !rawCode || rawCode.length > 64) return;

  try {
    const { data: pc, error: pcErr } = await supabase
      .from("promoter_codes")
      .select("code, user_id")
      .ilike("code", rawCode)
      .eq("active", true)
      .maybeSingle();

    if (pcErr) {
      console.error("promoter code lookup failed:", rawCode, pcErr.message);
      return;
    }
    if (!pc) return;

    // Referring yourself pays nothing. Mirrors the self-referral block in
    // create-checkout-session.
    if (pc.user_id === initiatorId) {
      console.log("self-referral ignored on deal:", pc.code, initiatorId);
      return;
    }

    const { error: refErr } = await supabase.from("referrals").insert({
      id: `r${Date.now()}`,
      promoter_id: pc.user_id,
      listing_id: null,
      deal_id: token,
      // Deliberately null. referrals.share_code carries a UNIQUE index from the
      // marketplace design, where every code encoded one listing and could
      // therefore only appear once. A standing Promoter code is reused across
      // every deal that broker refers, so writing it here lets the first deal
      // through and rejects every one after it with a duplicate key error.
      //
      // Nothing needs it: promoter_id identifies who earns, and the code itself
      // is recoverable from promoter_codes.
      share_code: null,
      status: "pending",
      commission_amount: 0,
    });

    if (refErr) console.error("BYOD referral insert failed:", token, refErr.message);
  } catch (err) {
    console.error("recordPromoterReferral threw:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = supabaseAdmin();

  try {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Sign in to start a deal." }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !authData?.user) {
      return jsonResponse({ error: "Sign in to start a deal." }, 401);
    }
    const userId = authData.user.id;

    const { data: caller, error: callerError } = await supabase
      .from("users")
      .select("name, email, stripe_payouts_enabled, blocked_at, deleted_at")
      .eq("id", userId)
      .single();

    if (callerError) return jsonResponse({ error: "Could not load your account." }, 500);
    if (caller?.blocked_at || caller?.deleted_at) {
      return jsonResponse({ error: "This account cannot start a deal." }, 403);
    }

    const body = await req.json();

    const role = body.role;
    if (role !== "seller" && role !== "buyer" && role !== "promoter") {
      return jsonResponse({ error: "Pick whether you are the buyer or the seller." }, 400);
    }

    // A promoter is arranging a deal between two other people and is neither
    // party to it. Gated on holding an active code so this branch cannot be
    // used as a way to create unattached deals in bulk.
    let promoterCode: string | null = null;
    if (role === "promoter") {
      const { data: pc, error: pcErr } = await supabase
        .from("promoter_codes")
        .select("code")
        .eq("user_id", userId)
        .eq("active", true)
        .maybeSingle();
      if (pcErr) {
        console.error("create-deal promoter code lookup failed:", pcErr.message);
        return jsonResponse({ error: "Could not verify your Promoter code." }, 500);
      }
      if (!pc) {
        return jsonResponse({
          error: "Create your Promoter code first, then you can set up deals for other people.",
        }, 403);
      }
      promoterCode = pc.code;
    }

    // --- validate the car (year, make, model are NOT NULL on listings) -----
    const year = Number(body.year);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 2) {
      return jsonResponse({ error: "Enter the model year." }, 400);
    }

    const make = String(body.make ?? "").trim();
    const model = String(body.model ?? "").trim();
    if (!make || !model) return jsonResponse({ error: "Enter the make and model." }, 400);

    const priceInput = Number(body.price);
    if (!Number.isFinite(priceInput) || priceInput <= 0) {
      return jsonResponse({ error: "Enter the agreed sale price." }, 400);
    }
    if (priceInput > MAX_PRICE) {
      return jsonResponse({ error: `Deals above ${dollars(MAX_PRICE)} need to be arranged manually.` }, 400);
    }
    // Stored in cents. This is the ONLY conversion point: everything
    // downstream (deal_invites, listings, create-checkout-session, Stripe)
    // reads cents. Getting this wrong charges the buyer 1/100th of the agreed
    // price and pays the seller the same, after they have shipped a car.
    const priceCents = Math.round(priceInput * 100);

    const mileageInput = Number(body.mileage);
    const mileage = Number.isFinite(mileageInput) && mileageInput >= 0
      ? Math.round(mileageInput)
      : 0;

    const vin = String(body.vin ?? "").trim().toUpperCase() || null;
    if (vin && vin.length !== 17) return jsonResponse({ error: "A VIN is 17 characters." }, 400);

    const note = String(body.note ?? "").trim().slice(0, 500) || null;

    // --- handover date (optional) ------------------------------------------
    // The date the car actually changes hands. auto_release_at is computed as
    // max(payment + 7d, handover_date + 7d), so on a deal shipping across the
    // country this is the difference between escalating a week after payment —
    // while the car is still on a truck — and a week after it arrives.
    //
    // Validated here rather than trusted from the client because the client is
    // not the only caller this function will ever have, and because the same
    // value is written to two tables on two different code paths.
    let handoverDate: string | null = null;
    if (body.handover_date != null && String(body.handover_date).trim() !== "") {
      const raw = String(body.handover_date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return jsonResponse({ error: "Enter the handover date as YYYY-MM-DD." }, 400);
      }
      // Parsed as UTC midnight on purpose. `new Date("2026-08-20")` is already
      // UTC, but comparing it against a local-timezone `today` would let a
      // deal created in the evening in New Jersey reject its own same-day date.
      const parsed = new Date(`${raw}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        return jsonResponse({ error: "That handover date is not a real date." }, 400);
      }
      const todayUtc = new Date();
      const todayMidnight = Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate());
      if (parsed.getTime() < todayMidnight) {
        return jsonResponse({ error: "The handover date cannot be in the past." }, 400);
      }
      // Matches HANDOVER_MAX_DAYS in App.jsx and the deal_invites check
      // constraint. All three have to agree or a deal fails at insert with a
      // database error the buyer cannot act on.
      if (parsed.getTime() > todayMidnight + 90 * 86400000) {
        return jsonResponse({ error: "Handover dates more than 90 days out need to be arranged manually." }, 400);
      }
      handoverDate = raw;
    }

    const token = makeToken();
    const carLabel = `${year} ${make} ${model}`;

    // ---------------------------------------------------------------------
    // Promoter-initiated: neither party is attached yet.
    //
    // No listing is created here. listings.seller_id drives the payout, and
    // nobody has claimed the seller side — accept-deal-invite builds the
    // listing once both sides are known and the seller has onboarded.
    //
    // The invite expires faster than a two-party deal on purpose: a broker who
    // sends ten links and gets two takers otherwise leaves eight rows sitting
    // open with nobody committed to them.
    // ---------------------------------------------------------------------
    if (role === "promoter") {
      const PROMOTER_INVITE_DAYS = 7;
      const { error: inviteErr } = await supabase.from("deal_invites").insert({
        token,
        created_by: userId,
        creator_role: "promoter",
        listing_id: null,
        buyer_id: null,
        seller_id: null,
        year, make, model, mileage, vin, note,
        price: priceCents,
        handover_date: handoverDate,
        expires_at: new Date(Date.now() + PROMOTER_INVITE_DAYS * 86400000).toISOString(),
      });

      if (inviteErr) {
        console.error("create-deal promoter invite insert failed:", inviteErr.message);
        return jsonResponse({ error: "Could not create the deal." }, 500);
      }

      // Attribution is the promoter's own code, not one passed in the body.
      // recordPromoterReferral skips self-referrals by comparing the code owner
      // to the initiator, which would reject this — here the initiator IS the
      // promoter and that is the intended arrangement, so the row is written
      // directly.
      const { error: refErr } = await supabase.from("referrals").insert({
        id: `r${Date.now()}`,
        promoter_id: userId,
        listing_id: null,
        deal_id: token,
        share_code: null,
        status: "pending",
        commission_amount: 0,
      });
      if (refErr) console.error("promoter-deal referral insert failed:", token, refErr.message);

      notifyAdmin({
        subject: `New promoter-arranged deal — ${carLabel} (${dollars(priceCents / 100)})`,
        html: alertHtml("A promoter set up a deal between two other people", [
          ["Vehicle", carLabel],
          ["Price", dollars(priceCents / 100)],
          ["Promoter", `${caller?.name ?? "—"} (${caller?.email ?? "—"})`],
          ["Promoter code", promoterCode ?? "—"],
          ["Link", `${SITE_URL}/d/${token}`],
        ], "Neither party has joined yet. Worth a look if the same promoter keeps appearing with the same counterparties."),
      });

      return jsonResponse({
        token,
        url: `${SITE_URL}/d/${token}`,
        listing_id: null,
        role: "promoter",
      });
    }

    // ---------------------------------------------------------------------
    // Seller-initiated
    // ---------------------------------------------------------------------
    if (role === "seller") {
      if (!caller?.stripe_payouts_enabled) {
        // Onboarding blocks the flow. Nothing is created.
        return jsonResponse({
          needs_onboarding: true,
          message:
            "Set up payouts before you send the link. The buyer cannot fund a deal until you can receive the money.",
        });
      }

      const listingId = makeListingId();

      const { error: listingErr } = await supabase.from("listings").insert({
        id: listingId,
        seller_id: userId,
        is_private: true,
        year,
        make,
        model,
        price: priceCents,
        mileage,
        vin,
        description: note,
        status: "active",
        // Private deals skip moderation. Only two people ever see them, and a
        // 'pending' row is unreadable to the buyer under
        // listings_hide_unapproved.
        moderation_status: "approved",
        moderated_at: new Date().toISOString(),
        images: [],
        handover_date: handoverDate,
      });

      if (listingErr) {
        console.error("create-deal listing insert failed:", listingErr.message);
        return jsonResponse({ error: "Could not create the deal." }, 500);
      }

      const { error: inviteErr } = await supabase.from("deal_invites").insert({
        token,
        created_by: userId,
        creator_role: "seller",
        listing_id: listingId,
        year, make, model, mileage, vin, note,
        price: priceCents,
        handover_date: handoverDate,
      });

      if (inviteErr) {
        await supabase.from("listings").delete().eq("id", listingId);
        console.error("create-deal invite insert failed:", inviteErr.message);
        return jsonResponse({ error: "Could not create the deal." }, 500);
      }

      await recordPromoterReferral(supabase, token, body.promoter_code, userId);

      notifyAdmin({
        subject: `New BYOD deal started (seller) — ${carLabel} (${dollars(priceCents / 100)})`,
        html: alertHtml("Bring-your-own-deal created by a seller", [
          ["Vehicle", carLabel],
          ["Price", dollars(priceCents / 100)],
          ["Seller", `${caller?.name ?? "—"} (${caller?.email ?? "—"})`],
          ["Listing ID", listingId],
          ["Link", `${SITE_URL}/d/${token}`],
        ], "Waiting for the buyer to open the link."),
      });

      return jsonResponse({
        token,
        url: `${SITE_URL}/d/${token}`,
        listing_id: listingId,
        role: "seller",
      });
    }

    // ---------------------------------------------------------------------
    // Buyer-initiated: park the details until a seller joins.
    // ---------------------------------------------------------------------
    const { error: inviteErr } = await supabase.from("deal_invites").insert({
      token,
      created_by: userId,
      creator_role: "buyer",
      listing_id: null,
      year, make, model, mileage, vin, note,
      price: priceCents,
      handover_date: handoverDate,
    });

    if (inviteErr) {
      console.error("create-deal invite insert failed:", inviteErr.message);
      return jsonResponse({ error: "Could not create the deal." }, 500);
    }

    await recordPromoterReferral(supabase, token, body.promoter_code, userId);

    notifyAdmin({
      subject: `New BYOD deal started (buyer) — ${carLabel} (${dollars(priceCents / 100)})`,
      html: alertHtml("Bring-your-own-deal created by a buyer", [
        ["Vehicle", carLabel],
        ["Price", dollars(priceCents / 100)],
        ["Buyer", `${caller?.name ?? "—"} (${caller?.email ?? "—"})`],
        ["Link", `${SITE_URL}/d/${token}`],
      ], "No listing exists yet. It is created when the seller joins and completes Connect onboarding."),
    });

    return jsonResponse({
      token,
      url: `${SITE_URL}/d/${token}`,
      listing_id: null,
      role: "buyer",
    });
  } catch (err) {
    console.error("create-deal error:", err);
    return jsonResponse({ error: "Something went wrong." }, 500);
  }
});
