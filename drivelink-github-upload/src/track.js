// One place for product analytics.
//
// Every event goes to HeyCatch and to GA4 together, and both are skipped on
// browsers flagged as internal (admin, test accounts, ?internal=1), so owner
// and tester activity never reaches the funnel or the Google Ads conversions.
//
// Analytics must never break the page, so every call is wrapped.
import { analytics } from "@heycatch/sdk";

const GA_ID = "G-ZR5N15ZQZ1";
const FLAG = "dl_internal";

export function isInternalBrowser() {
  try {
    if (window.location.pathname.startsWith("/admin")) return true;
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

// Flags this browser as internal for good (until ?internal=0). Also switches
// GA4 off for the rest of this page load, because gtag is already running.
export function markInternalBrowser() {
  try { localStorage.setItem(FLAG, "1"); } catch { /* private mode */ }
  try { window["ga-disable-" + GA_ID] = true; } catch { /* ignore */ }
}

export function clearInternalBrowser() {
  try { localStorage.removeItem(FLAG); } catch { /* private mode */ }
  try { window["ga-disable-" + GA_ID] = false; } catch { /* ignore */ }
}

// True for accounts that belong to us rather than to a customer: admins,
// anything flagged users.is_internal in the database, the +test aliases used
// for throwaway buyers, and the drivelink.deals mailboxes.
export function isInternalAccount(authUser, dbUser) {
  try {
    if (dbUser?.role === "admin") return true;
    if (dbUser?.is_internal === true) return true;
    const email = String(authUser?.email || "").toLowerCase();
    if (!email) return false;
    if (/\+test[^@]*@/.test(email)) return true;
    if (email.endsWith("@drivelink.deals")) return true;
  } catch { /* fall through */ }
  return false;
}

// Names used for the funnel. "Goal" events are the ones that mean a real
// buyer or seller took a step toward a deal; GA4 gets the matching
// recommended event name so Google Ads can import it as a conversion.
export const GOAL_EVENTS = ["inquiry_sent", "deal_started", "offer_made", "deal_created"];

const GA_NAME = {
  inquiry_sent: "generate_lead",
};

export function trackEvent(name, params) {
  if (isInternalBrowser()) return;
  try { analytics.trackEvent(name, params); } catch { /* ignore */ }
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", GA_NAME[name] || name, params);
    }
  } catch { /* ignore */ }
}
