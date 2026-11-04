// Links that people type in (an inspector's booking link, an ad's link, dispute
// evidence) are shown as <a href>. React still renders a "javascript:" URL and
// runs it on click, so a submitted link could run code in whoever clicks it,
// an admin included. Only web and mail links get through; anything else
// becomes undefined, which renders a plain, unclickable element.
export function safeHref(url, { allowMailto = false } = {}) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  const ok = parsed.protocol === "https:" || parsed.protocol === "http:" ||
    (allowMailto && parsed.protocol === "mailto:");
  return ok ? parsed.href : undefined;
}
