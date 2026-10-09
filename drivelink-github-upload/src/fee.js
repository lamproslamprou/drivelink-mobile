// ============================================================================
// DriveLink — platform fee schedule (frontend)
//
// ONE place for the DriveLink fee shown to users and used in estimates.
// Mirrors platformFeeRate() in supabase/functions/_shared/helpers.ts — the
// server is the source of truth for what is actually charged at payment time.
// If you change a date or rate here, change it there too.
//
// October 2026 thank-you promo: DriveLink's own fee is halved (1% -> 0.5%).
// The Promoter's 1% is NOT part of this and is never touched by the promo.
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

// Platform fee + the Promoter's 1% (unchanged by the promo): "1.5%" or "2%".
export function maxFeeLabel(now = new Date()) {
  return promoActive(now) ? "1.5%" : "2%";
}
