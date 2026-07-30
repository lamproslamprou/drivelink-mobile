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
// Prices are WHOLE DOLLARS throughout, matching listings.price and the
// salePrice arithmetic in stripe-webhook.

import {
  corsHeaders,
  jsonResponse,
  notifyAdmin,
  alertHtml,
  dollars,
  supabaseAdmin,
} from "../_shared/helpers.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://drivelink.deals";
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
    if (role !== "seller" && role !== "buyer") {
      return jsonResponse({ error: "Pick whether you are the buyer or the seller." }, 400);
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
    const price = Math.round(priceInput);

    const mileageInput = Number(body.mileage);
    const mileage = Number.isFinite(mileageInput) && mileageInput >= 0
      ? Math.round(mileageInput)
      : 0;

    const vin = String(body.vin ?? "").trim().toUpperCase() || null;
    if (vin && vin.length !== 17) return jsonResponse({ error: "A VIN is 17 characters." }, 400);

    const note = String(body.note ?? "").trim().slice(0, 500) || null;

    const token = makeToken();
    const carLabel = `${year} ${make} ${model}`;

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
        price,
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
        year, make, model, mileage, vin, note, price,
      });

      if (inviteErr) {
        await supabase.from("listings").delete().eq("id", listingId);
        console.error("create-deal invite insert failed:", inviteErr.message);
        return jsonResponse({ error: "Could not create the deal." }, 500);
      }

      notifyAdmin({
        subject: `New BYOD deal started (seller) — ${carLabel} (${dollars(price)})`,
        html: alertHtml("Bring-your-own-deal created by a seller", [
          ["Vehicle", carLabel],
          ["Price", dollars(price)],
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
      year, make, model, mileage, vin, note, price,
    });

    if (inviteErr) {
      console.error("create-deal invite insert failed:", inviteErr.message);
      return jsonResponse({ error: "Could not create the deal." }, 500);
    }

    notifyAdmin({
      subject: `New BYOD deal started (buyer) — ${carLabel} (${dollars(price)})`,
      html: alertHtml("Bring-your-own-deal created by a buyer", [
        ["Vehicle", carLabel],
        ["Price", dollars(price)],
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
