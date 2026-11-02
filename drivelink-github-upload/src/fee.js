// ============================================================================
// DriveLink — platform fee schedule (frontend)
//
// ONE place for the DriveLink fee shown to users and used in estimates.
// Mirrors platformFeeRate() in supabase/functions/_shared/helpers.ts — the
// server is the source of truth for what is actually charged at payment time.
// If you change a date or rate here, change it there too.
//
// October 2026 thank-you promo: DriveLink's own fee is halved (1% -> 0.5%).
// Promoters are paid a flat bounty by DriveLink; there is no Promoter percentage.
//
// The promo window is date-gated, so the fee reverts to 1% on its own at
// midnight Eastern on Nov 1 2026 — no deploy needed. (EDT is UTC-4 until
// 2:00 AM that morning, so 04:00Z is exactly 12:00 AM ET.)
// ============================================================================

export const PLATFORM_FEE_STANDARD = 0.01; // 1%
export const PLATFORM_FEE_PROMO = 0.005; // 0.5%
export const PROMO_START_ISO = "2026-10-01T04:00:00Z"; // Oct 1 2026, 12:00 AM ET
export const PROMO_END_ISO = "2026-11-01T04:00:00Z"; // Nov 1 2026, 12:00 AM ET (exclusive)

export function promoActive(now = new Date()) {
  const t = now.getTime();
  return t >= Date.parse(PROMO_START_ISO) && t < Date.parse(PROMO_END_ISO);
}

// Fractional rate, e.g. 0.005 during the promo and 0.01 otherwise.
export function platformFeeRate(now = new Date()) {
  return promoActive(now) ? PLATFORM_FEE_PROMO : PLATFORM_FEE_STANDARD;
}

// Display string for the current rate: "0.5%" or "1%".
export function platformFeeLabel(now = new Date()) {
  return promoActive(now) ? "0.5%" : "1%";
}

// Kept for callers that used the old platform-fee-plus-Promoter label.
export function maxFeeLabel(now = new Date()) {
  return platformFeeLabel(now); // no Promoter add-on any more
}

// ---------------------------------------------------------------------------
// Payment processing (Stripe), by rail. DriveLink does not charge or keep this:
// it comes out of the seller's proceeds, so it belongs in every "what does it
// cost / what do I keep" figure next to our own fee. Dollars in, dollars out.
// App.jsx's seller payout preview and the listing-page rail note do the same
// arithmetic in cents; keep the three rates below in step with them.
//   card: about 2.9% + $0.30
//   wire (Stripe bank transfer): about 0.8%, capped at $5
// ---------------------------------------------------------------------------
export const CARD_PROCESSING_PCT = 0.029;
export const CARD_PROCESSING_FIXED_USD = 0.3;
export const WIRE_PROCESSING_PCT = 0.008;
export const WIRE_PROCESSING_CAP_USD = 5;

export function cardProcessingUsd(priceUsd) {
  return Math.ceil(priceUsd * CARD_PROCESSING_PCT + CARD_PROCESSING_FIXED_USD);
}

export function wireProcessingUsd(priceUsd) {
  return Math.min(Math.ceil(priceUsd * WIRE_PROCESSING_PCT), WIRE_PROCESSING_CAP_USD);
}
