// POST /verify-vin
//
// Decodes a VIN against NHTSA vPIC server-side and sets listings.vin_verified.
//
// WHY THIS EXISTS
// The decode used to run in the browser, which then sent `vin_verified: true`
// along with the rest of the listing. Two problems with that:
//
//   1. It is a self-attested trust badge. Nothing stopped a crafted request
//      from setting vin_verified on a VIN that decodes to nothing, or to a
//      completely different car. The badge is shown to buyers as evidence the
//      platform checked something, so the platform has to be the one checking.
//
//   2. guard_listings_settlement_columns blocks vin_verified on UPDATE but is
//      BEFORE UPDATE only, so the create path went straight through. Editing a
//      listing after decoding a VIN failed with "Verification fields can only
//      be set by the platform", while creating one with the same field
//      succeeded. Verification was simultaneously impossible and forgeable.
//
// Now the client sends only `vin` — seller-declared data, which it should be —
// and this function is the sole writer of vin_verified.
//
// CROSS-CHECK: decoding alone is not enough. A valid VIN from a different car
// would otherwise verify a listing it has nothing to do with, which is exactly
// what a fabricated listing looks like. The decoded make, model and year must
// agree with the listing, or the VIN is recorded and vin_verified stays false.
import {
  corsHeaders,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/helpers.ts";

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";

// Model names are messy on both sides — NHTSA returns "Mustang" where a seller
// typed "Mustang GT", and the fake-listing import left values like
// " camry SE Sedan 4D". Compare loosely: one has to contain the other's first
// word. Make and year are compared strictly.
function looselyMatches(decoded: string, declared: string): boolean {
  const d = (decoded || "").trim().toLowerCase();
  const s = (declared || "").trim().toLowerCase();
  if (!d || !s) return false;
  if (d === s) return true;
  const dFirst = d.split(/\s+/)[0];
  const sFirst = s.split(/\s+/)[0];
  return d.includes(sFirst) || s.includes(dFirst);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const supabase = supabaseAdmin();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, seller_id, vin, make, model, year, vin_verified")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Only the seller (or an admin) can trigger verification on a listing.
    const { data: caller } = await supabase
      .from("users").select("role").eq("id", callerId).single();
    const isOwner = String(listing.seller_id ?? "").trim().toLowerCase() ===
      String(callerId ?? "").trim().toLowerCase();
    if (!isOwner && caller?.role !== "admin") {
      return jsonResponse({ error: "Not authorized to verify this listing" }, 403);
    }

    const vin = String(listing.vin ?? "").trim().toUpperCase();

    // No VIN, or a malformed one: make sure the badge is off and say so.
    if (vin.length !== 17) {
      await supabase.from("listings")
        .update({ vin_verified: false }).eq("id", listing.id);
      return jsonResponse({
        verified: false,
        reason: vin.length === 0 ? "no_vin" : "bad_length",
        message: "A VIN must be exactly 17 characters.",
      });
    }

    const res = await fetch(
      `${VPIC}/decodevin/${encodeURIComponent(vin)}?format=json`,
    );
    if (!res.ok) throw new Error(`NHTSA vPIC returned ${res.status}`);
    const data = await res.json();

    const results = data?.Results ?? [];
    const get = (name: string) =>
      results.find((r: { Variable?: string }) => r.Variable === name)?.Value || "";

    const errorCode = get("Error Code");
    const make = get("Make");
    const model = get("Model");
    const year = get("Model Year");

    if (!make || !model || !year || (errorCode && errorCode !== "0")) {
      await supabase.from("listings")
        .update({ vin_verified: false }).eq("id", listing.id);
      return jsonResponse({
        verified: false,
        reason: "undecodable",
        message: get("Error Text") || "This VIN could not be decoded.",
      });
    }

    // Cross-check against what the seller listed.
    const makeOk = looselyMatches(make, String(listing.make ?? ""));
    const modelOk = looselyMatches(model, String(listing.model ?? ""));
    const yearOk = String(year).trim() === String(listing.year ?? "").trim();

    const verified = makeOk && modelOk && yearOk;

    await supabase.from("listings")
      .update({ vin_verified: verified })
      .eq("id", listing.id);

    return jsonResponse({
      verified,
      reason: verified ? "ok" : "mismatch",
      decoded: { make, model, year, trim: get("Trim") },
      mismatch: verified ? null : {
        make: makeOk ? null : { decoded: make, listed: listing.make },
        model: modelOk ? null : { decoded: model, listed: listing.model },
        year: yearOk ? null : { decoded: year, listed: listing.year },
      },
      message: verified
        ? "VIN decoded and matches this listing."
        : "This VIN decodes to a different vehicle than the listing describes.",
    });
  } catch (err) {
    console.error("verify-vin error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
