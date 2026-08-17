// supabase/functions/_shared/promoter.ts
//
// Shared Promoter code minting.
//
// Extracted from mint-promoter-code on 2026-08-17 so that release-funds can
// mint a seller's code at payout time without duplicating the collision-retry
// logic. Both callers now go through ensurePromoterCode().
//
// IDEMPOTENT BY CONTRACT. If the user already has an active code it is
// returned unchanged, created: false. A repeat seller keeps the same code
// across every sale, which matters because the code may already be printed in
// an ad they're running.
//
// NEVER THROWS. release-funds calls this after an irreversible Stripe
// transfer. A failure here must not surface as an error on a sale that
// succeeded — the caller checks .code and moves on if it's null.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// No 0/O/1/I — these get read aloud, typed from screenshots, and pasted out of
// Facebook ads.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomSuffix(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function slugFromName(name: string | null): string {
  const cleaned = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.length >= 2 ? cleaned : "DL";
}

export type PromoterCodeResult = {
  code: string | null;
  created: boolean;
  error?: string;
};

export async function ensurePromoterCode(
  admin: SupabaseClient,
  userId: string,
): Promise<PromoterCodeResult> {
  try {
    if (!userId) return { code: null, created: false, error: "no userId" };

    const { data: existing, error: existingErr } = await admin
      .from("promoter_codes")
      .select("code")
      .eq("user_id", userId)
      .eq("active", true)
      .maybeSingle();

    if (existingErr) {
      console.error("promoter_codes lookup failed:", existingErr);
      return { code: null, created: false, error: existingErr.message };
    }
    if (existing?.code) return { code: existing.code, created: false };

    const { data: profile } = await admin
      .from("users")
      .select("name")
      .eq("id", userId)
      .maybeSingle();

    const prefix = slugFromName(profile?.name ?? null);

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${prefix}-${randomSuffix()}`;
      const { error: insertErr } = await admin
        .from("promoter_codes")
        .insert({ code, user_id: userId, active: true });

      if (!insertErr) return { code, created: true };

      // 23505 covers two different collisions: the generated code already
      // exists (retry with a new suffix), or this user raced themselves into a
      // row between the lookup above and now (re-read and return theirs).
      if (insertErr.code === "23505") {
        const { data: raced } = await admin
          .from("promoter_codes")
          .select("code")
          .eq("user_id", userId)
          .eq("active", true)
          .maybeSingle();
        if (raced?.code) return { code: raced.code, created: false };
        continue;
      }

      console.error("promoter_codes insert failed:", insertErr);
      return { code: null, created: false, error: insertErr.message };
    }

    return { code: null, created: false, error: "exhausted collision retries" };
  } catch (err) {
    console.error("ensurePromoterCode threw:", err);
    return {
      code: null,
      created: false,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
