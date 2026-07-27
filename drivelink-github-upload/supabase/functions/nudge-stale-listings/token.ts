// Signed one-click action tokens for listing emails.
//
// A bare listing ID in the URL would let anyone archive or renew any listing by
// guessing IDs (they are sequential-ish: "l" + Date.now()). These tokens bind
// the listing, the action, and an expiry under an HMAC so a link only does the
// one thing it was minted for, and only for a limited window.
//
// Copy this file into BOTH function folders — Edge Functions do not share code
// across directories unless you set up an import map.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function key(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

export async function mintToken(
  secret: string,
  listingId: string,
  action: string,
  ttlDays: number,
): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const sig = await sign(secret, `${listingId}:${action}:${exp}`);
  return { exp, sig };
}

export async function verifyToken(
  secret: string,
  listingId: string,
  action: string,
  exp: number,
  sig: string,
): Promise<{ ok: true } | { ok: false; reason: "expired" | "invalid" }> {
  if (!listingId || !action || !exp || !sig) return { ok: false, reason: "invalid" };
  if (Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: "expired" };

  const expected = await sign(secret, `${listingId}:${action}:${exp}`);

  // Constant-time compare so the signature can't be recovered byte by byte.
  if (expected.length !== sig.length) return { ok: false, reason: "invalid" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid" };
}
