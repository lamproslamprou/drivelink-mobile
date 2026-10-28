// Free breached-password check using the Have I Been Pwned range API.
// k-anonymity: only the first 5 hex chars of the SHA-1 hash leave the browser,
// never the password. Fails open (returns false) on any network/API problem so
// a third-party outage can never block sign-up or password changes.
export async function isPasswordPwned(password) {
  try {
    if (!password || !window.crypto?.subtle) return false;
    const bytes = new TextEncoder().encode(password);
    const buf = await window.crypto.subtle.digest("SHA-1", bytes);
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text();
    return text.split("\n").some((line) => {
      const [h, count] = line.trim().split(":");
      return h === suffix && parseInt(count, 10) > 0;
    });
  } catch {
    return false;
  }
}
