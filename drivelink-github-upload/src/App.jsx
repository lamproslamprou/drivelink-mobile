import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";
import Auth from "./Auth.jsx";
import ResetPassword from "./ResetPassword.jsx";
import { useLang, LangToggle, LangSwitchLink } from "./i18n.jsx";
import Landing from "./Landing.jsx";
import ImageUpload from "./ImageUpload.jsx";
import CompAdForm from "./CompAdForm.jsx";
import Messages from "./Messages.jsx";
import ListingsMap, { geocode } from "./ListingsMap.jsx";
import logoIcon from "./assets/logo-icon.png";
import { StartDealView, JoinDealView } from "./DealViews.jsx";
import FAQView from "./FAQView.jsx";
import EscrowExplained from "./EscrowExplained.jsx";
import LienPayoffNJ from "./guides/LienPayoffNJ.jsx";
import LienPayoffPA from "./guides/LienPayoffPA.jsx";
import LienPayoffNY from "./guides/LienPayoffNY.jsx";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── MONEY IS CENTS ──────────────────────────────────────────────────────────
// Every money column in the database is CENTS as of migration
// 20260803_05_money_to_cents: listings.price/sale_price/platform_fee/
// seller_net, offers.amount/counter_amount, payouts.amount,
// referrals.commission_amount, users.balance, saved_searches.max_price.
//
// fmt() therefore takes CENTS. Pass it a database value directly. Anything a
// user typed into a dollar field goes through toCents() first; anything being
// loaded back INTO a dollar field goes through fromCents().
//
// Whole dollars render without decimals (a $10,000 car reads "$10,000"), but
// anything with cents shows them — which is the point, since a $1.25 platform
// fee used to be unrepresentable and displayed as $1.
const fmt = (cents) => {
  const c = Number(cents);
  if (!Number.isFinite(c)) return "—";
  const whole = c % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(c / 100);
};

// Dollars typed by a person -> integer cents for the database.
const toCents = (dollars) => {
  const d = Number(dollars);
  if (!Number.isFinite(d)) return 0;
  return Math.round(d * 100);
};

// Cents from the database -> a dollar number for a form input's value.
const fromCents = (cents) => {
  const c = Number(cents);
  if (!Number.isFinite(c)) return "";
  return c / 100;
};
const STRIPE_LINK = "https://buy.stripe.com/4gM4gz0z05sNaa9afu4Vy00";
// Calendar date for date-only columns (sold_at, paid_at).
//
// new Date().toISOString().slice(0,10) returns the UTC date, which is a day
// ahead of Eastern from 8pm onward (7pm in winter). A car sold at 9pm on the
// 1st was being recorded as sold on the 2nd — a date in the future to everyone
// looking at it. DriveLink is a US business operating on Eastern time, so the
// calendar date is resolved in that zone rather than UTC. en-CA formats as
// YYYY-MM-DD, which is what a Postgres date column expects.
//
// Timestamp columns (confirmed_at, created_at) are unaffected — those store a
// real instant and were always correct.
function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const PLATFORM_FEE = 0.01; // 1% platform fee
const PROMOTER_FEE = 0.01; // 1% promoter commission
// $15,000 (cents). Mirrors ACH_MIN_CENTS in supabase/functions/_shared/helpers.ts —
// the backend re-enforces this gate itself (create-wire-session throws if the
// charged total is below it), so this constant only controls whether the
// "pay by wire transfer" button is even shown. Keep the two in sync if the
// threshold ever changes.
const WIRE_MIN_CENTS = 1_500_000;
const HIGH_VALUE_LISTING_THRESHOLD = 20000; // above this price, nudge buyers if the seller isn't ID-verified
const STALE_WARN_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // show "seller inactive" badge after 30 days
const ACCEPTANCE_WINDOW_MS = 48 * 60 * 60 * 1000;    // buyer has 48h to close before an acceptance expires
// Auto-archive at 60 days is enforced by the archive-stale-listings pg_cron job,
// not from the client — see auto-archive-cron.sql. Change the threshold there.

// ── Shareable URLs ────────────────────────────────────────────────────────────
// Every listing now has a real, linkable URL. Two shapes exist:
//   /listing/:id  — canonical listing page (ads, SEO, direct sharing)
//   /s/:code      — Promoter referral link; records attribution, then forwards
//                   to the canonical /listing/:id for that code.
const SITE_ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://drivelink.deals";
const listingUrl = (id) => `${SITE_ORIGIN}/listing/${id}`;
const promoterUrl = (code) => `${SITE_ORIGIN}/s/${code}`;
// Standing Promoter link. Unlike promoterUrl() this points at no particular car:
// /p/:code stores the code and drops the visitor straight into Start a Deal,
// which is the path a transport broker's customer actually takes.
const standingUrl = (code) => `${SITE_ORIGIN}/p/${code}`;

// ── Promoter code generation ─────────────────────────────────────────────────
// O/0 and I/1 are left out on purpose: these codes get read aloud on the phone
// and typed off a business card, and that pair is where transcription fails.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const randomSuffix = (n = 6) => {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, v => CODE_ALPHABET[v % CODE_ALPHABET.length]).join("");
};
const slugFromName = (name) => {
  const s = (name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return s || "PROMO";
};

// ── Promoter attribution ─────────────────────────────────────────────────────────
// When someone lands via /s/:code we remember the code locally for 30 days so a
// purchase made later still credits the Promoter who sent them.
const ATTRIB_KEY = "dl_promoter_ref";
const ATTRIB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function saveAttribution(code, listingId) {
  try {
    localStorage.setItem(ATTRIB_KEY, JSON.stringify({ code, listing_id: listingId, at: Date.now() }));
  } catch { /* private mode / storage disabled — attribution is best-effort */ }
}

function getAttribution(listingId) {
  try {
    const raw = localStorage.getItem(ATTRIB_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (!a?.code || Date.now() - a.at > ATTRIB_TTL_MS) { localStorage.removeItem(ATTRIB_KEY); return null; }
    if (listingId && a.listing_id !== listingId) return null; // attribution is per-listing
    return a;
  } catch { return null; }
}

// Share codes are built as FIRSTNAME-LISTINGID, so the listing can be recovered
// from the code alone. This is the fallback when the referrals table isn't
// readable (e.g. a signed-out visitor opening a Promoter link).
function listingIdFromShareCode(code) {
  const parts = (code || "").split("-");
  if (parts.length < 2) return null;
  return parts.slice(1).join("-").toLowerCase();
}

// ── Standing Promoter codes (BYOD) ───────────────────────────────────────────
// Separate from ATTRIB_KEY: that one is per-listing and only applies to the car
// it was saved against. A standing code isn't tied to anything, so it gets its
// own slot and applies to whatever deal the visitor starts next.
const PROMO_KEY = "dl_promoter_code";
const PROMO_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function savePromoterCode(code) {
  try {
    localStorage.setItem(PROMO_KEY, JSON.stringify({ code, at: Date.now() }));
  } catch { /* private mode / storage disabled — attribution is best-effort */ }
}

function getPromoterCode() {
  try {
    const raw = localStorage.getItem(PROMO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p?.code || Date.now() - p.at > PROMO_TTL_MS) {
      localStorage.removeItem(PROMO_KEY);
      return null;
    }
    return p.code;
  } catch { return null; }
}

// ── Share sheet on mobile, clipboard everywhere else ──────────────────────────
async function shareOrCopy(url, title) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try { await navigator.share({ title, url }); return "shared"; }
    catch (e) { if (e?.name === "AbortError") return "cancelled"; /* else fall through to copy */ }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; }
  catch {
    // Clipboard API needs a secure context and can be blocked — fall back to the
    // old execCommand trick so the button is never a no-op.
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); return "copied"; }
    catch { return "failed"; }
    finally { document.body.removeChild(ta); }
  }
}

// ── Minimal history-based routing ─────────────────────────────────────────────
// Deliberately dependency-free: the app's page switching still runs on `view`
// state, and this only tracks the browser path so listings are linkable and the
// back button behaves.
function usePath() {
  const [path, setPath] = useState(() => (typeof window === "undefined" ? "/" : window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return [path, setPath];
}

// ── Free, keyless VIN decoder via NHTSA's public vPIC API. This validates that a
// VIN is real and decodes make/model/year/trim from the VIN itself — it does NOT
// pull accident or title history (that requires a paid provider like Carfax/
// AutoCheck, which needs a backend to keep the API key secret).
async function decodeVin(vin) {
  const clean = (vin || "").trim().toUpperCase();
  if (clean.length !== 17) return { valid: false, error: "VIN must be exactly 17 characters." };
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(clean)}?format=json`);
    const data = await res.json();
    const results = data?.Results || [];
    const get = (name) => results.find(r => r.Variable === name)?.Value || "";
    const errorCode = get("Error Code");
    const make = get("Make");
    const model = get("Model");
    const year = get("Model Year");
    if (!make || !model || !year || (errorCode && errorCode !== "0")) {
      return { valid: false, error: get("Error Text") || "Couldn't decode this VIN — double check it's correct." };
    }
    return { valid: true, make, model, year, trim: get("Trim"), engine: get("Engine Model") || get("Displacement (L)") };
  } catch {
    return { valid: false, error: "Couldn't reach the VIN decoder — check your connection and try again." };
  }
}

// ── ROUTE TABLE ───────────────────────────────────────────────────────────────
// Module scope, not component scope, because the initial `view` is derived from
// the URL at mount (see useState below). Defined inside the component, it would
// not exist yet when that initializer runs.
//
// "/" is the marketing landing page and "/browse" is the listing grid — two
// different pages with different intent that used to share one URL.
const VIEW_PATHS = {
  landing:       "/",
  home:          "/browse",
  auth:          "/signin",
  myListings:    "/my-listings",
  myPurchases:   "/my-purchases",
  myOffers:      "/my-offers",
  savedSearches: "/saved-searches",
  favorites:     "/favorites",
  dashboard:     "/dashboard",
  promoter:      "/promoter",
  resetPassword: "/reset-password",
  profile:       "/profile",
  blocked:       "/blocked",
  postListing:   "/sell",
  messages:      "/messages",
  admin:         "/admin",
  advertise:     "/advertise",
  startDeal:     "/start-deal",
  success:       "/purchase-complete",
  terms:         "/terms",
  privacy:       "/privacy",
  safety:        "/safety",
  about:         "/about",
  faq:           "/faq",
  // Sent party-to-party mid-negotiation, not navigated to from inside the app.
  escrow:        "/escrow",
  // Search-traffic guide. Nested path so the cluster has somewhere to grow.
  lienPayoffNJ:  "/guides/lien-payoff-nj",
  lienPayoffPA:  "/guides/lien-payoff-pa",
  lienPayoffNY:  "/guides/lien-payoff-ny",
};
const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([v, p]) => [p, v]),
);
// Trailing slashes, query strings and hashes all resolve to the bare path.
const normalizePath = (p) => (p || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";

// Views a signed-out visitor may use. Everything else routes through sign-in
// and resumes afterwards. Browsing without an account is deliberate — asking
// someone to register before they have seen a single car loses them.
const PUBLIC_VIEWS = new Set([
  "landing", "auth", "home", "advertise", "terms", "privacy", "safety", "about", "startDeal",
  // Linked from outreach email and ad extensions — must open without an account.
  "faq",
  // The counterparty page. One side of a deal sends this to the other to
  // explain what DriveLink is. The recipient has no account and no reason to
  // make one yet — a sign-in wall here kills the deal it exists to save.
  "escrow",
  // Arrives from organic search, mid-deal, with no account and no intention of
  // making one yet. Gating a guide behind sign-in is how a guide earns nothing.
  "lienPayoffNJ",
  "lienPayoffPA",
  "lienPayoffNY",
  // Arrived at from an emailed recovery link, necessarily signed out.
  "resetPassword",
  // Brokers arrive here from an outreach email that has already made the case.
  // Bouncing them to a bare sign-up form threw that away and asked a stranger
  // to commit with nothing on screen explaining why.
  "promoter",
]);

// The view to paint on first render, read from the address bar.
//
// This is what stops the flash. `view` used to initialize to "landing"
// unconditionally, so loading /sell painted the marketing page, then an effect
// read the URL and repainted the sell form — a visible flicker on every load
// and every refresh. Deep links (/listing/:id, /s/:code, /d/:token) resolve to
// "home" because their own effects open the right modal on top of the grid.
function initialViewFromPath() {
  if (typeof window === "undefined") return "landing";
  const p = normalizePath(window.location.pathname);
  if (/^\/(listing|s|d)\//.test(p)) return "home";
  // /p/:code is consumed on arrival and replaced with /start-deal. Painting
  // "landing" here first meant a broker's customer saw the marketing page
  // flash before the deal form — and left `view` stale for the view→URL
  // effect, which then navigated back to "/" and threw the code away.
  if (/^\/p\//.test(p)) return "startDeal";
  if (p === "/reset-password") return "resetPassword";
  return PATH_TO_VIEW[p] || "landing";
}

export default function App() {
  const { t, lang } = useLang();
  const [currentUser, setCurrentUser] = useState(null);
  const [dbUser, setDbUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [userReports, setUserReports] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [promoterCode, setPromoterCode] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [openThread, setOpenThread] = useState(null);
  const [view, setView] = useState(initialViewFromPath);
  const [homeResetKey, setHomeResetKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null); // { status: 'success' | 'error', message? }
  // Where to send someone once they finish signing in. Set when a signed-out
  // visitor lands on a view that needs an account — typically from a shared
  // link like /sell — so they continue to what they came for instead of being
  // dumped on the home grid.
  //
  // Generalises returnToAdvertise, which only ever remembered one destination
  // (the advertise page). Any gated view can be resumed now.
  const [pendingView, setPendingView] = useState(null);
  // Live ads for the sidebar rail (public view), and the full placement rows
  // for the admin tab (empty for non-admins under RLS).
  const [publicAds, setPublicAds] = useState([]);
  // Per-listing view and favourite counts, keyed by listing id. Own listings
  // only — the database view enforces that, not the frontend.
  const [listingStats, setListingStats] = useState({});
  // Buyer-only. RLS on escrow_handovers grants SELECT to the buyer of the
  // listing and nobody else, so this comes back empty for sellers by design —
  // the seller must be told the code in person.
  const [handoverCodes, setHandoverCodes] = useState({});
  const [adPlacements, setAdPlacements] = useState([]);
  // Open risk flags, keyed by listing_id. RLS returns rows to admins only, so
  // this is an empty object for everyone else and the panel simply never
  // renders. Only unresolved flags are loaded — a resolved flag is history and
  // belongs in an audit view, not in the queue of things blocking a payout.
  const [riskFlags, setRiskFlags] = useState({});
  const [viewingListing, setViewingListing] = useState(null); // { listing, seller, myRef, sellerRating, sellerReviewCount, myOffer }
  // Funding instructions returned by create-wire-session, or null when the
  // wire modal is closed. Unlike handleBuyNow (which redirects to a Stripe-
  // hosted Checkout page), a wire has no hosted page — Stripe's Customer
  // Balance flow returns routing/account/reference details directly, which
  // this state feeds to WireInstructionsModal.
  const [wireInstructions, setWireInstructions] = useState(null);
  const [wireLoading, setWireLoading] = useState(false);
  const [path, setPath] = usePath();
  // Set by the URL→view effect immediately before it calls setView, and read
  // by the view→URL effect to suppress the write-back. Both effects run in the
  // SAME commit after a popstate, and at that moment the second one still
  // closes over the OLD view — so without this it "corrects" the address bar
  // straight back to where the user just navigated away from. That fight is
  // what the flash on back-from-/start-deal was.
  const syncingFromUrl = useRef(false);
  // Bring-your-own-deal invite links: /d/:token. Kept separate from the main
  // route-resolution effect below because that one waits on `loading`, and the
  // join page fetches its own data through the accept-deal-invite function —
  // it must render for a signed-out stranger before any listings arrive.
  const [dealToken, setDealToken] = useState(null);

  // ── Unread message count for the nav badge ──────────────────────────────────
  // Lives here rather than in Messages.jsx because that component only mounts
  // once you're already on the Messages view — a badge you can only see after
  // clicking through is no badge at all. Uses a head-count query so it stays
  // cheap, and listens on the same realtime table so it updates without a
  // reload. INSERT alone isn't enough: messages arrive with
  // moderation_status='pending' and only become visible to the recipient on the
  // UPDATE that approves them.
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!currentUser) { setUnreadCount(0); return; }
    let cancelled = false;
    const refresh = async () => {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", currentUser.id)
        .eq("read", false);
      if (!cancelled) setUnreadCount(count || 0);
    };
    refresh();
    const channel = supabase
      .channel("unread-" + currentUser.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refresh)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [currentUser?.id, view]);

  // ── Account dropdown. The nav used to carry 13 destinations in one scrolling
  // row; everything account-scoped now lives behind the avatar instead.
  const accountMenuRef = useRef(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Close the account dropdown on an outside click or Escape.
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) setAccountMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setAccountMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountMenuOpen]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Mint a standing Promoter code ──────────────────────────────────────────
  // Self-serve by design: brokers get a link without us in the loop. The insert
  // is RLS-scoped to the caller, and the partial unique index on (user_id) where
  // active is what actually stops a double-tap producing two live codes — the
  // guard below just turns that race into a silent re-read instead of an error.
  const mintPromoterCode = async () => {
    if (!currentUser) { setView("auth"); return null; }
    const slug = slugFromName(dbUser?.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `${slug}-${randomSuffix()}`;
      const { data, error } = await supabase
        .from("promoter_codes")
        .insert({ code, user_id: currentUser.id, active: true })
        .select()
        .single();
      if (!error) {
        setPromoterCode(data);
        showToast("Your Promoter code is live.");
        return data;
      }
      if (error.code === "23505" && /one_active_per_user/.test(error.message || "")) {
        const { data: existing } = await supabase.from("promoter_codes").select("*").eq("active", true).limit(1);
        if (existing?.[0]) { setPromoterCode(existing[0]); return existing[0]; }
        break;
      }
      if (error.code === "23505") continue; // code collision — reroll the suffix
      showToast(error.message || "Couldn't create your code — try again.", "error");
      return null;
    }
    showToast("Couldn't create your code — try again.", "error");
    return null;
  };

  const loadData = async () => {
    const { data: listingsData } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
    const { data: referralsData } = await supabase.from("referrals").select("*");
    // Under RLS, `users` returns only your own row (or everything, if you're an
    // admin). Seller names and badges across the marketplace come from the
    // public_profiles view instead, which exposes display fields only. Merge the
    // two so full rows win wherever they're available.
    const { data: profilesData } = await supabase.from("public_profiles").select("*");
    const { data: usersData } = await supabase.from("users").select("*");
    const { data: reportsData } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
    const { data: feedbackData } = await supabase.from("feedback").select("*").order("created_at", { ascending: false });
    const { data: userReportsData } = await supabase.from("user_reports").select("*").order("created_at", { ascending: false });
    const { data: reviewsData } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    const { data: payoutsData } = await supabase.from("payouts").select("*").order("paid_at", { ascending: false });
    // RLS on promoter_codes is SELECT-scoped to the owner, so this returns your
    // own row or nothing at all — no filter on user_id is needed or trusted.
    const { data: promoterCodeData } = await supabase.from("promoter_codes").select("*").eq("active", true).limit(1);
    const { data: disputesData } = await supabase.from("disputes").select("*").order("created_at", { ascending: false });
    const { data: offersData } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
    // Two sources on purpose. public_ads is a display-only view any visitor can
    // read (it powers the sidebar rail). ad_placements is the full table, which
    // RLS returns only to admins — everyone else gets an empty array and the
    // admin tab simply has nothing to show.
    const { data: publicAdsData } = await supabase.from("public_ads").select("*");
    // Returns only your own listings (or all, for an admin) — the view filters
    // on auth.uid() since views can't carry RLS.
    const { data: statsData } = await supabase.from("listing_stats").select("*");
    // admin_ads is admin-only at the database level and returns zero rows for
    // everyone else. Reading ad_placements directly here showed an admin only
    // the ads they had bought themselves, which made the Ads tab report zero
    // running while one was live in the rail.
    const { data: adPlacementsData } = await supabase.from("admin_ads").select("*").order("created_at", { ascending: false });
    let finalListings = listingsData || [];
    // Stale-listing auto-archive runs server-side in the archive-stale-listings
    // pg_cron job, not here. It used to run opportunistically from whichever
    // browser loaded the app, which meant writing to other sellers' rows — now
    // blocked by RLS — and only happening when someone happened to visit.
    if (finalListings) setListings(finalListings);
    if (referralsData) setReferrals(referralsData);
    if (profilesData || usersData) {
      const byId = new Map((profilesData || []).map(p => [p.id, p]));
      for (const u of usersData || []) byId.set(u.id, { ...(byId.get(u.id) || {}), ...u });
      setUsers([...byId.values()]);
    }
    if (reportsData) setReports(reportsData);
    if (publicAdsData) setPublicAds(publicAdsData);
    if (statsData) setListingStats(Object.fromEntries(statsData.map(s => [s.listing_id, s])));
    if (adPlacementsData) setAdPlacements(adPlacementsData);
    if (feedbackData) setFeedback(feedbackData);
    if (userReportsData) setUserReports(userReportsData);
    if (reviewsData) setReviews(reviewsData);
    if (payoutsData) setPayouts(payoutsData);
    setPromoterCode(promoterCodeData?.[0] || null);
    if (disputesData) setDisputes(disputesData);
    if (offersData) setOffers(offersData);

    // ── Handover codes (buyer only) ───────────────────────────────────────
    // Fetched separately rather than joined onto listings: RLS on this table is
    // the security control, and a join would make it easy to widen the listings
    // select later without noticing the code came along for the ride. A seller
    // running this gets zero rows.
    const { data: handoverData } = await supabase
      .from("escrow_handovers")
      .select("listing_id, code, confirmed_at");
    if (handoverData) {
      setHandoverCodes(Object.fromEntries(handoverData.map(h => [h.listing_id, h])));
    }

    // Same shape as handoverCodes above and the same reasoning: admin-only at
    // the database level, so no role check is needed here.
    const { data: riskFlagData } = await supabase
      .from("listing_risk_flags")
      .select("*")
      .is("resolved_at", null)
      .order("score", { ascending: false });
    if (riskFlagData) {
      const byListing = {};
      for (const f of riskFlagData) {
        (byListing[f.listing_id] ||= []).push(f);
      }
      setRiskFlags(byListing);
    }

    setLoading(false);
  };

  const loadSavedSearches = async (userId) => {
    const { data } = await supabase.from("saved_searches").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (data) setSavedSearches(data);
  };

  const loadFavorites = async (userId) => {
    const { data } = await supabase.from("favorites").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (data) setFavorites(data);
  };

  const loadBlocks = async (userId) => {
    const { data } = await supabase.from("blocks").select("*").eq("blocker_id", userId).order("created_at", { ascending: false });
    if (data) setBlocks(data);
  };

  const loadDbUser = async (authUser) => {
    if (!authUser) { setDbUser(null); setSavedSearches([]); setFavorites([]); setBlocks([]); return; }
    const { data } = await supabase.from("users").select("*").eq("id", authUser.id).single();
    setDbUser(data);
    loadSavedSearches(authUser.id);
    loadFavorites(authUser.id);
    loadBlocks(authUser.id);
  };

  // ── Detect a Supabase email-confirmation redirect (link clicked in the confirmation email)
  useEffect(() => {
    const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const type = params.get("type");
    const hashError = params.get("error") || params.get("error_code");

    if (hashError) {
      setConfirmResult({
        status: "error",
        message: (params.get("error_description") || "This confirmation link is invalid or has expired.").replace(/\+/g, " "),
      });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } else if (type === "signup" || type === "email_change") {
      setConfirmResult({ status: "success" });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // ── Detect a return from Stripe Connect onboarding (?onboarded=true). The
  // account.updated webhook that flips stripe_payouts_enabled to true can lag
  // slightly behind Stripe's redirect back to the site, so a single page-load
  // fetch of dbUser can occasionally still show the old "not set up" state.
  // Poll for a few seconds instead of trusting a single fetch.
  const onboardedCheckStarted = useRef(false);
  useEffect(() => {
    if (!currentUser || onboardedCheckStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("onboarded") !== "true") return;
    onboardedCheckStarted.current = true;
    window.history.replaceState(null, "", window.location.pathname);

    let attempts = 0;
    const maxAttempts = 6; // ~12 seconds total
    const poll = async () => {
      attempts++;
      const { data } = await supabase.from("users").select("*").eq("id", currentUser.id).single();
      if (data?.stripe_payouts_enabled) {
        setDbUser(data);
        showToast("Payouts are set up — you're ready to get paid.");
        return;
      }
      if (attempts < maxAttempts) {
        setTimeout(poll, 2000);
      } else {
        showToast("Payout setup is still finalizing — refresh in a moment if the banner doesn't clear.", "info");
      }
    };
    poll();
  }, [currentUser]);

  // handle_new_user parks the signup name in pending_name and shows "Member"
  // until moderation clears it; guard_display_name blocks any client-side
  // promotion, so only the service-role Edge Function can do it. The profile
  // editor calls this on every name change — signup never did, so accounts
  // sat on "Member" indefinitely.
  //
  // This lives on the session effect rather than Auth's onAuth because the
  // email-confirmation path never calls onAuth: the user returns from the
  // link with a session already established and Auth is never rendered.
  // onAuthStateChange is the one point every path passes through.
  //
  // The ref caps it at one attempt per user per page load. Without it, a
  // name the moderator holds rather than approves stays pending, and the
  // loadDbUser-on-users-change effect would re-invoke the function forever.
  const namePromotionTried = useRef(new Set());
  const promotePendingName = async (user) => {
    if (!user || namePromotionTried.current.has(user.id)) return;
    namePromotionTried.current.add(user.id);
    try {
      const { data: row } = await supabase
        .from("users").select("name_status, pending_name").eq("id", user.id).single();
      if (row?.name_status !== "pending" || !row?.pending_name) return;
      const mod = await moderateRecord("profile");
      await loadDbUser(user);
      if (mod?.status === "blocked" || mod?.status === "rejected") showToast(mod.reason, "error");
    } catch {
      // Never block sign-in on this — the name stays "Member" and the next
      // page load retries.
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      loadDbUser(session?.user ?? null);
      setAuthChecked(true);
      if (session?.user) promotePendingName(session.user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      loadDbUser(session?.user ?? null);
      if (session?.user) promotePendingName(session.user);
    });
    loadData();
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (currentUser) loadDbUser(currentUser);
  }, [users]);

  // ── Scroll to top on every view change. Without this, navigating between
  // views (e.g. clicking "Browse Cars" from partway down the Landing page)
  // preserves whatever scroll position you were at, so you land in the
  // middle of the new view instead of at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);

  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setDbUser(null);
    setView("home");
  };

  // ── Buy Now — creates a real Stripe Checkout session at the listing's price
  // via the create-checkout-session Edge Function, instead of the old static
  // payment link. Funds land on the platform's Stripe balance and are held
  // until the buyer confirms receipt or the seller enters the buyer's handover
  // code. Nothing releases on a timer.
  const handleBuyNow = async (listing) => {
    showToast("Redirecting to secure checkout…", "info");
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { listing_id: listing.id, share_code: getAttribution(listing.id)?.code || null },
    });
    if (error || !data?.url) {
      showToast(data?.error || error?.message || "Couldn't start checkout — try again.", "error");
      return;
    }
    window.location.href = data.url;
  };

  // ── Pay by wire transfer — high-value listings ($15k+) only. Unlike
  // handleBuyNow, there's no Stripe-hosted page to redirect to: Customer
  // Balance PaymentIntents return routing/account/reference details directly,
  // which create-wire-session hands back as JSON. This just opens
  // WireInstructionsModal with that data instead of navigating away.
  const handleBuyByWire = async (listing) => {
    setWireLoading(true);
    const { data, error } = await supabase.functions.invoke("create-wire-session", {
      body: { listing_id: listing.id, share_code: getAttribution(listing.id)?.code || null },
    });
    setWireLoading(false);
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't start a wire transfer — try again.", "error");
      return;
    }
    setWireInstructions({ ...data, carLabel: `${listing.year} ${listing.make} ${listing.model}` });
  };

  // ── Seller sets up (or resumes) Stripe Connect onboarding so they can
  // receive automated payouts. Opens Stripe's hosted onboarding flow.
  const setupPayouts = async () => {
    const { data, error } = await supabase.functions.invoke("create-connect-account");
    if (error || !data?.url) {
      showToast(data?.error || error?.message || "Couldn't start payout setup — try again.", "error");
      return;
    }
    window.location.href = data.url;
  };

  // ── Content moderation
  const moderateRecord = async (surface, contentId) => {
    try {
      const { data, error } = await supabase.functions.invoke("moderate-content", {
        body: contentId ? { surface, contentId } : { surface },
      });
      if (error) {
        let parsed = null;
        try { parsed = await error.context?.json?.(); } catch {}
        return parsed?.status ? parsed : { status: "pending", reason: "Your content is under review." };
      }
      return data;
    } catch {
      return { status: "pending", reason: "Your content is under review." };
    }
  };

  // Returns true if the caller should stop (content did not go live).
  const handleModerationResult = async (mod, successMessage) => {
    if (mod.status === "blocked") {
      showToast(mod.reason, "error");
      await supabase.auth.signOut();
      return true;
    }
    if (mod.status === "rejected") { showToast(mod.reason, "error"); return true; }
    if (mod.status === "held" || mod.status === "pending") {
      showToast(mod.reason, "info");
      return true;
    }
    showToast(successMessage);
    return false;
  };

  // ── Post listing
  const postListing = async (data) => {
    const coords = await geocode(data.location_text);
    const newListing = {
      id: "l" + Date.now(),
      seller_id: currentUser.id,
      ...data,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      status: "active",
      // The language the seller was writing in. Used to decide whether to
      // offer a translation at all — without it, an English reader on an
      // English listing gets a "Translate to English" button, which reads as
      // broken. Detecting the language of the text after the fact is guesswork;
      // the interface they typed it into is not.
      description_lang: lang || "en",
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("listings").insert(newListing);
    if (error) { showToast("Error posting listing", "error"); return; }

    // VIN verification runs server-side against NHTSA and cross-checks the
    // decode against the make/model/year on the listing. Failure is non-fatal:
    // the listing is live either way, it just doesn't carry the badge.
    if (newListing.vin && String(newListing.vin).trim().length === 17) {
      await supabase.functions.invoke("verify-vin", { body: { listing_id: newListing.id } });
    }

    // Listing inserts with moderation_status = 'pending', which the
    // listings_hide_unapproved RLS policy keeps hidden from buyers until this
    // returns. The seller sees it in My Listings the whole time.
    const mod = await moderateRecord("listing", newListing.id);
    await loadData();
    setView("myListings");
    await handleModerationResult(mod, "Listing posted successfully!");
  };

  // ── Mark sold (admin manual override)
  const markSold = async (listingId, salePrice, buyerEmail) => {
    const platformFee = Math.round(salePrice * PLATFORM_FEE);
    const promoterCommission = Math.round(salePrice * PROMOTER_FEE);
    const sellerNet = salePrice - platformFee - promoterCommission;
    const buyer = buyerEmail ? users.find(u => u.email.toLowerCase() === buyerEmail.trim().toLowerCase()) : null;
    if (buyerEmail && !buyer) {
      showToast("No account found with that buyer email — sale recorded without linking a buyer.", "info");
    }
    // Sale goes into "pending_confirmation" — payment fee & promoter commission are
    // computed now but not released until the buyer confirms receipt in-app (or an
    // admin force-confirms it). This isn't real payment escrow — Stripe already
    // captured the charge instantly — it's a safeguard on when payouts are finalized.
    await supabase.from("listings").update({ 
      status: "pending_confirmation", 
      sale_price: salePrice, 
      sold_at: todayET(),
      platform_fee: platformFee,
      seller_net: sellerNet,
      buyer_id: buyer?.id || null,
    }).eq("id", listingId);
    await loadData();
    showToast(`Sale recorded — awaiting buyer confirmation before payout. Platform fee: ${fmt(platformFee)} • Promoter: ${fmt(promoterCommission)} • Seller nets: ${fmt(sellerNet)}`);
  };

  // ── Buyer confirms they received the car (or admin force-confirms on their behalf).
  // This is the moment the sale becomes final: promoter commission is credited and
  // the listing flips from "pending_confirmation" to "sold".
  const confirmReceipt = async (listingId) => {
    const listing = listings.find(l => l.id === listingId);
    if (!listing) return;
    // Both branches now run server-side on the service role. Sales with a real
    // Stripe charge go to release-funds, which also transfers the seller's net.
    // Manually recorded cash/off-platform sales go to confirm-manual-sale, which
    // settles the referral without moving money through Stripe. Neither can run
    // in the browser: crediting users.balance from a client means any client can
    // credit itself.
    const fn = listing.stripe_payment_intent_id ? "release-funds" : "confirm-manual-sale";
    const { data, error } = await supabase.functions.invoke(fn, { body: { listing_id: listingId } });
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't confirm this sale — try again.", "error");
      return;
    }
    await loadData();
    if (data?.referral === "flagged_ambiguous") {
      showToast("Sale confirmed. Several Promoters shared this listing, so the commission is flagged for review before it's paid.", "info");
    } else if (data?.referral === "flagged_self_referral") {
      showToast("Sale confirmed. The referral looks like a self-purchase and has been flagged for review.", "info");
    } else if (listing.stripe_payment_intent_id) {
      showToast("Receipt confirmed — funds released to the seller. It takes a few business days to reach their bank.");
    } else {
      showToast("Receipt confirmed — sale finalized and commission released.");
    }
  };

  // ── Seller enters the buyer's 6-digit handover code to release funds.
  // This is the primary release path as of 2026-08-06. Nothing pays out on a
  // timer any more: auto-release-cron only escalates silent sales to review.
  // The code proves the buyer was present and willing at handover — which is
  // why the SELLER submits it and the BUYER holds it.
  const confirmHandover = async (listingId, code) => {
    const { data, error } = await supabase.functions.invoke("confirm-handover", {
      body: { listing_id: listingId, code },
    });
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't verify that code — try again.", "error");
      return false;
    }
    await loadData();
    if (data?.heldForReview) {
      showToast("Handover confirmed. This sale is under a short review before funds are released.", "info");
    } else if (data?.referral === "flagged_ambiguous" || data?.referral === "flagged_self_referral") {
      showToast("Handover confirmed and funds released. The Promoter commission is flagged for review before it's paid.", "info");
    } else {
      showToast("Handover confirmed — funds released to your Stripe account. Expect them in your bank within a few business days.");
    }
    return true;
  };

  // ── Buyer disputes a pending sale instead of confirming receipt (car not as
  // described, seller no-show, etc). Flips the listing to "disputed" so it's out
  // of the normal flow until an admin reviews it.
  const fileDispute = async (listingId, reason, details, evidenceUrls) => {
  const listing = listings.find(l => l.id === listingId);
  if (!listing) return;
  const row = { id: "disp" + Date.now(), listing_id: listingId, buyer_id: currentUser.id, seller_id: listing.seller_id, reason, details, status: "open", evidence_urls: evidenceUrls?.length ? evidenceUrls : null };
  const { error } = await supabase.from("disputes").insert(row);
  if (error) { showToast("Couldn't file dispute", "error"); return; }
  await supabase.from("listings").update({ status: "disputed" }).eq("id", listingId);
  await loadData();
  showToast("Dispute filed. Our team will review it — the sale is on hold until then.");
};

  // ── Admin resolves a dispute. "refunded" now issues a REAL Stripe refund via
  // the refund-listing Edge Function (for sales that went through real Checkout)
  // and puts the listing back up for sale. Dismissing sends it back to the
  // normal awaiting-confirmation flow, same as before.
  const resolveDispute = async (disputeId, resolution, resolutionNote) => {
    const dispute = disputes.find(d => d.id === disputeId);
    if (!dispute) return;

    if (resolution === "refunded") {
      const { data, error } = await supabase.functions.invoke("refund-listing", {
        body: { dispute_id: disputeId, resolution_note: resolutionNote },
      });
      if (error || data?.error) {
        showToast(data?.error || error?.message || "Couldn't issue refund — try again.", "error");
        return;
      }
      await loadData();
      showToast("Refund issued and listing relisted.");
      return;
    }

    await supabase.from("disputes").update({ status: resolution, resolution_note: resolutionNote, resolved_at: new Date().toISOString() }).eq("id", disputeId);
    await supabase.from("listings").update({ status: "pending_confirmation" }).eq("id", dispute.listing_id);
    showToast("Dispute dismissed — sale returned to awaiting confirmation.");
    await loadData();
  };

  // ── Admin resolves a risk flag ────────────────────────────────────────────
  // is_release_blocked() counts only flags with resolved_at IS NULL, so writing
  // that column is what unblocks a held payout. It does not release anything by
  // itself: after clearing the last blocking flag you still press Force Confirm
  // on the listing, which re-runs the gate and pays the seller.
  //
  // The four resolutions are recorded rather than collapsed into a boolean
  // because they mean different things later. false_positive says the rule
  // misfired and should be tuned; released says the rule was right and a human
  // overrode it. Only those two clear the way for a payout — held and refunded
  // are decisions NOT to pay, recorded here so the reason survives if the
  // seller disputes it months from now. Refunding itself happens in Stripe.
  //
  // Writes only the four resolution columns. The admin UPDATE policy on this
  // table is not column-scoped, so the restraint lives here.
  const resolveRiskFlag = async (flagId, resolution, reviewerNotes) => {
    const { error } = await supabase
      .from("listing_risk_flags")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: currentUser?.id ?? null,
        resolution,
        reviewer_notes: reviewerNotes || null,
      })
      .eq("id", flagId);

    if (error) {
      showToast(error.message || "Couldn't resolve that flag — try again.", "error");
      return;
    }

    const cleared = resolution === "false_positive" || resolution === "released";
    showToast(
      cleared
        ? "Flag cleared. If it was the last one blocking, press Force Confirm to pay the seller."
        : "Flag recorded. Funds stay held.",
    );
    await loadData();
  };

// ── Admin approves a flagged referral (pays the commission normally) or
// denies it (zeroes it out, no payout) after reviewing a suspected
// self-referral or other suspicious pattern.
const approveFlaggedReferral = async (refId) => {
  const ref = referrals.find(r => r.id === refId);
  if (!ref) return;
  const commission = ref.commission_amount || 0;
  await supabase.from("referrals").update({ status: "paid", paid_at: todayET() }).eq("id", refId);
  const promoter = users.find(u => u.id === ref.promoter_id);
  await supabase.from("users").update({ balance: (promoter?.balance || 0) + commission }).eq("id", ref.promoter_id);
  await loadData();
  showToast("Referral approved — commission released.");
};

const denyFlaggedReferral = async (refId) => {
  await supabase.from("referrals").update({ status: "denied", commission_amount: 0 }).eq("id", refId);
  await loadData();
  showToast("Referral denied — no commission paid.");
};

  // ── Buyer makes an offer on a listing. Note: this doesn't change what Stripe
  // charges at checkout (that's a fixed payment link) — if a seller accepts an
  // offer, the two of you close the deal the same way any negotiated in-person
  // sale works: the seller marks it sold and types in the agreed price there.
  const makeOffer = async (listingId, sellerId, amount, message) => {
    const row = { id: "off" + Date.now(), listing_id: listingId, buyer_id: currentUser.id, seller_id: sellerId, amount, message, status: "pending" };
    const { error } = await supabase.from("offers").insert(row);
    if (error) { showToast("Couldn't submit offer", "error"); return; }
    await loadData();
    showToast("Offer sent to the seller.");
  };

  // ── Seller accepts, declines, or counters an offer.
  const respondToOffer = async (offerId, action, counterAmount, counterMessage) => {
    const now = new Date();
    const patch = { status: action, responded_at: now.toISOString() };
    if (action === "countered") { patch.counter_amount = counterAmount; patch.counter_message = counterMessage; }
    // An acceptance without an expiry strands the listing forever when the buyer
    // goes quiet. 48 hours, stamped at acceptance so the cron and the UI agree.
    if (action === "accepted") {
      patch.payment_deadline = new Date(now.getTime() + ACCEPTANCE_WINDOW_MS).toISOString();
    }
    await supabase.from("offers").update(patch).eq("id", offerId);
    await loadData();
    showToast(
      action === "accepted" ? "Offer accepted — you have 48 hours to close with the buyer, or the acceptance expires."
      : action === "declined" ? "Offer declined."
      : "Counter-offer sent."
    );
  };

  // ── Seller cancels an acceptance the buyer never acted on ───────────────────
  // Soft state change, never a delete: the row stays for dispute evidence with
  // rescinded_by recording who pulled out. Blocked once a sale is in flight —
  // hiding an acceptance mid-transaction would leave a dispute unarbitrable.
  // The .eq() chain scopes the write to your own still-accepted offer so a stale
  // client can't clobber a row that changed underneath it.
  const rescindOffer = async (offerId) => {
    const offer = offers.find(o => o.id === offerId);
    if (!offer) return;
    if (offer.status !== "accepted") {
      showToast("Only an accepted offer can be cancelled.", "error");
      return;
    }
    const listing = listings.find(l => l.id === offer.listing_id);
    if (listing && listing.status !== "active") {
      showToast("This car already has a sale in progress — the acceptance can't be cancelled now.", "error");
      return;
    }
    const { error } = await supabase
      .from("offers")
      .update({
        status: "rescinded",
        rescinded_at: new Date().toISOString(),
        rescinded_by: currentUser.id,
      })
      .eq("id", offerId)
      .eq("seller_id", currentUser.id)
      .eq("status", "accepted");
    if (error) {
      showToast("Couldn't cancel that acceptance — try again.", "error");
      return;
    }
    await loadData();
    showToast("Acceptance cancelled — the listing is open to other offers again.");
  };

  // ── Buyer accepts a seller's counter-offer, or withdraws their offer entirely.
  const respondToCounter = async (offerId, accept) => {
    await supabase.from("offers").update({ status: accept ? "accepted" : "withdrawn", responded_at: new Date().toISOString() }).eq("id", offerId);
    await loadData();
    showToast(accept ? "Counter-offer accepted — the seller will follow up to close the sale." : "Offer withdrawn.");
  };

  // ── Promoter retracts their own pending referral ───────────────────────────────
  // Deletes the row so the /s/:code link stops resolving. Guarded three ways:
  // status must still be pending, the car must not have a sale in flight, and
  // the delete is scoped by promoter_id so it can only ever hit your own row.
  // The matching RLS policy enforces the same conditions server-side — these
  // client checks are for the error message, not for security.
  const retractReferral = async (refId) => {
    const ref = referrals.find(r => r.id === refId);
    if (!ref) return;
    if (ref.status !== "pending") {
      showToast("Only pending referrals can be retracted.", "error");
      return;
    }
    const listing = listings.find(l => l.id === ref.listing_id);
    if (listing && listing.status !== "active") {
      showToast("This car already has a sale in progress — the referral can't be retracted now.", "error");
      return;
    }
    const { error } = await supabase
      .from("referrals")
      .delete()
      .eq("id", refId)
      .eq("promoter_id", currentUser.id)
      .eq("status", "pending");
    if (error) {
      showToast("Couldn't retract that referral — try again.", "error");
      return;
    }
    await loadData();
    showToast("Referral retracted — that share link no longer works.");
  };

  // ── Generate share link
  const generateShare = async (listingId) => {
  const listing = listings.find(l => l.id === listingId);
  if (listing?.seller_id === currentUser.id) {
    showToast("You can't generate a Promoter link for your own listing.", "error");
    return null;
  }
  const existing = referrals.find(r => r.listing_id === listingId && r.promoter_id === currentUser.id);
  if (existing) { showToast("Your Promoter link is ready — " + promoterUrl(existing.share_code), "info"); return existing.share_code; }
    const code = (dbUser?.name || "USER").split(" ")[0].toUpperCase() + "-" + listingId.toUpperCase();
    const newRef = { id: "r" + Date.now(), promoter_id: currentUser.id, listing_id: listingId, share_code: code, status: "pending", commission_amount: 0 };
    await supabase.from("referrals").insert(newRef);
    await loadData();
    showToast("Promoter link created — " + promoterUrl(code), "info");
    return code;
  };

  // ── Seller edits their own listing's details
  const updateListing = async (listingId, data) => {
    const coords = data.location_text ? await geocode(data.location_text) : null;
    const patch = { ...data, last_active_at: new Date().toISOString() };
    if (coords) { patch.lat = coords.lat; patch.lng = coords.lng; }
    const { error } = await supabase.from("listings").update(patch).eq("id", listingId);
    if (error) { showToast("Error updating listing", "error"); return; }

    // Re-verify after an edit: changing make, model, year or VIN can turn a
    // matching VIN into a mismatched one, and the badge must follow.
    if (patch.vin && String(patch.vin).trim().length === 17) {
      await supabase.functions.invoke("verify-vin", { body: { listing_id: listingId } });
    }

    // A database trigger resets moderation_status to 'pending' whenever a
    // moderated field changes, so an edited listing is hidden until this
    // re-approves it. Without this call it would stay hidden forever.
    const mod = await moderateRecord("listing", listingId);
    await loadData();
    await handleModerationResult(mod, "Listing updated.");
  };

  // ── Seller deletes their own listing ────────────────────────────────────
  // Soft delete. The row stays because it is the FK anchor for offers,
  // listing_views, price history, risk flags and message threads — and
  // because a seller who can erase a listing can erase the evidence of what
  // they sold. status = 'removed' hides it everywhere public; the seller can
  // restore it from the Deleted section.
  //
  // guard_listing_removal() refuses this transition when a sale is in flight
  // and expires any open offers on the way out. The check below is for the
  // error message, not for security.
  const deleteListing = async (listingId) => {
    const listing = listings.find(l => l.id === listingId);
    if (listing && ["awaiting_payment", "pending_confirmation", "sold", "disputed"].includes(listing.status)) {
      showToast("This car has a sale in progress — it can't be deleted until that settles.", "error");
      return;
    }
    const { error } = await supabase
      .from("listings")
      .update({ status: "removed" })
      .eq("id", listingId)
      .eq("seller_id", currentUser.id);
    if (error) { showToast("Couldn't delete that listing — try again.", "error"); return; }
    await loadData();
    showToast("Listing deleted. You can restore it from the Deleted section.");
  };

  // ── Seller restores a deleted listing ───────────────────────────────────
  const restoreListing = async (listingId) => {
    const { error } = await supabase
      .from("listings")
      .update({ status: "active" })
      .eq("id", listingId)
      .eq("seller_id", currentUser.id);
    if (error) { showToast("Couldn't restore that listing — try again.", "error"); return; }
    await loadData();
    showToast("Listing restored — it's live again.");
  };

  // ── Remove listing (admin)
  // The error check is not optional. Without it this reported "Listing
  // archived." whether or not the write landed — a guard trigger rejection,
  // an RLS denial and a success all looked identical from the dashboard.
  const archiveListing = async (listingId) => {
    const { error } = await supabase
      .from("listings")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", listingId);
    if (error) { showToast(error.message || "Couldn't archive that listing.", "error"); return; }
    await loadData();
    showToast("Listing archived.");
  };

  // ── Seller toggles their own listing between active/pending (e.g. "sale in progress")
  const setListingStatus = async (listingId, status) => {
    const { error } = await supabase
      .from("listings")
      .update({ status, last_active_at: new Date().toISOString() })
      .eq("id", listingId);
    if (error) { showToast(error.message || "Couldn't update that listing.", "error"); return; }
    await loadData();
    showToast(status === "pending" ? "Listing marked as pending." : "Listing is active again.");
  };

  // ── Flag/report a listing
  const fileReport = async (listingId, reason, details) => {
    const row = { id: "rep" + Date.now(), listing_id: listingId, reporter_id: currentUser.id, reason, details, status: "open" };
    const { error } = await supabase.from("reports").insert(row);
    if (error) { showToast("Couldn't submit report", "error"); return; }
    await loadData();
    showToast("Report submitted. Our team will review it.");
  };

  const resolveReport = async (reportId, status) => {
    await supabase.from("reports").update({ status }).eq("id", reportId);
    await loadData();
    showToast("Report updated.");
  };

  // ── Admin toggles a seller's verified badge
  const toggleVerified = async (userId, verified) => {
    await supabase.from("users").update({ verified }).eq("id", userId);
    await loadData();
    showToast(verified ? "Seller verified." : "Verification removed.");
  };

  // ── Saved searches / alerts
  const saveSearch = async (criteria) => {
    const row = { id: "ss" + Date.now(), user_id: currentUser.id, ...criteria };
    await supabase.from("saved_searches").insert(row);
    await loadSavedSearches(currentUser.id);
    showToast("Search saved — we'll surface new matches for you.");
  };

  const deleteSavedSearch = async (id) => {
    await supabase.from("saved_searches").delete().eq("id", id);
    await loadSavedSearches(currentUser.id);
  };

  const toggleFavorite = async (listingId) => {
    if (!currentUser) { setView("auth"); return; }
    const existing = favorites.find(f => f.listing_id === listingId);
    if (existing) {
      await supabase.from("favorites").delete().eq("id", existing.id);
    } else {
      await supabase.from("favorites").insert({ id: "fav" + Date.now(), user_id: currentUser.id, listing_id: listingId });
    }
    await loadFavorites(currentUser.id);
  };

  const toggleBlock = async (userId) => {
    if (!currentUser) { setView("auth"); return; }
    const existing = blocks.find(b => b.blocked_id === userId);
    if (existing) {
      await supabase.from("blocks").delete().eq("id", existing.id);
      showToast("User unblocked.");
    } else {
      await supabase.from("blocks").insert({ id: "blk" + Date.now(), blocker_id: currentUser.id, blocked_id: userId });
      showToast("User blocked. You won't see their listings or receive messages from them.");
    }
    await loadBlocks(currentUser.id);
  };

  const reportUserAction = async (userId, reason, details) => {
    const row = { id: "urep" + Date.now(), reporter_id: currentUser.id, reported_user_id: userId, reason, details, status: "open" };
    const { error } = await supabase.from("user_reports").insert(row);
    if (error) { showToast("Couldn't submit report", "error"); return; }
    await loadData();
    showToast("Report submitted. Our team will review it.");
  };

  const resolveUserReport = async (reportId, status) => {
    await supabase.from("user_reports").update({ status }).eq("id", reportId);
    await loadData();
    showToast("Report updated.");
  };

  const submitReview = async (listingId, sellerId, rating, comment) => {
    const row = { id: "rev" + Date.now(), listing_id: listingId, seller_id: sellerId, buyer_id: currentUser.id, rating, comment };
    const { error } = await supabase.from("reviews").insert(row);
    if (error) { showToast("Couldn't submit review — you may have already reviewed this purchase.", "error"); return; }
    await loadData();
    showToast("Thanks for the review!");
  };

  // ── Admin removes a user's account. Two modes:
  //
  //   anonymize (default) — scrubs their name, email, phone and address,
  //     deletes their listings and messages, but KEEPS the users row so
  //     orders, transactions, payouts, referrals and ad placements still
  //     resolve to something. The row shows as "[deleted]" in this list.
  //     Correct for anyone with real transaction history.
  //
  //   purge — removes the users row entirely, so nothing is left behind.
  //     Fails loudly rather than half-completing if anything still
  //     references them. For test and junk accounts.
  //
  // Both delete the Supabase Auth login, so they can no longer sign in.
  const deleteUser = async (userId, userName, mode = "anonymize") => {
    const warning = mode === "purge"
      ? `PERMANENTLY remove ${userName} and all their data?\n\nThis deletes the account row itself along with their listings. Use this only for test or junk accounts — if they have any transaction history, cancel and use Delete Account instead.`
      : `Delete ${userName}'s account? They will no longer be able to sign in, and their personal details will be scrubbed. A "[deleted]" placeholder row remains so past transactions still resolve.`;
    if (!window.confirm(warning)) return;

    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { user_id: userId, mode },
    });

    if (error || data?.error) {
      // The function returns 409 with an `events` list when a purge would
      // destroy moderation evidence. Surface that rather than swallowing it.
      // Read `error`, not `reason` — the function has no `reason` field, so
      // the previous version silently discarded every message it returned.
      // The 409 evidence guard ("this account has hard moderation violations
      // on record") was surfacing to the admin as "try again", which is why a
      // purge could appear to fail for no reason at all.
      let detail = data?.error || null;
      if (!detail && error?.context && typeof error.context.json === "function") {
        try {
          const body = await error.context.json();
          detail = body?.error || null;
        } catch { /* body wasn't JSON — fall through */ }
      }
      if (!detail) detail = error?.message || null;
      showToast(detail || "Couldn't delete user — try again.", "error");
      return;
    }

    await loadData();
    showToast(mode === "purge"
      ? `${userName} has been permanently removed.`
      : `${userName}'s account has been deleted.`);
  };

  // ── Admin records that a promoter's balance was paid out via an external method
  // (bank transfer, PayPal, Venmo, etc). This app doesn't move real money — it just
  // tracks that the payout happened and zeroes out the tracked balance to match.
  const recordPayout = async (userId, amount, method, note) => {
    const user = users.find(u => u.id === userId);
    if (!user || amount <= 0 || amount > (user.balance || 0)) { showToast("Invalid payout amount.", "error"); return; }
    const row = { id: "po" + Date.now(), user_id: userId, amount, method, note };
    const { error } = await supabase.from("payouts").insert(row);
    if (error) { showToast("Couldn't record payout", "error"); return; }
    await supabase.from("users").update({ balance: (user.balance || 0) - amount }).eq("id", userId);
    await loadData();
    showToast(`Payout of ${fmt(amount)} recorded for ${user.name}.`);
  };

  // ── Admin pays a promoter for real via Stripe transfer, instead of just
  // recording that it happened elsewhere. Only works once the promoter has
  // completed Stripe Connect onboarding (stripe_payouts_enabled).
  const payoutPromoterViaStripe = async (userId, amount, note) => {
    const { data, error } = await supabase.functions.invoke("payout-promoter", { body: { user_id: userId, amount, note } });
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't send payout — try again.", "error");
      return;
    }
    await loadData();
    showToast(`${fmt(amount)} sent via Stripe.`);
  };

  // ── AI Deal Check — asks the assess-deal Edge Function to compare this listing
  // against other active DriveLink listings, falling back to real web search
  // when there isn't enough internal data. Result is cached server-side per
  // listing, so repeat views don't re-trigger the AI call.
  const checkDealAssessment = async (listingId) => {
    const { data, error } = await supabase.functions.invoke("assess-deal", { body: { listing_id: listingId } });
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't run the price check — try again.", "error");
      return null;
    }
    setListings(prev => prev.map(l => l.id === listingId ? { ...l, deal_assessment: data.assessment, deal_assessment_at: new Date().toISOString() } : l));
    return data.assessment;
  };

  // ── On-demand translation of a listing's seller-written text ────────────
  // The static i18n dictionary handles every label on the page, but the
  // description and the AI price-check summary are free prose that only exists
  // in the language it was written in. This translates on request and caches
  // server-side. The original is never replaced — see translate-listing.
  const translateListing = async (listingId, lang) => {
    const { data, error } = await supabase.functions.invoke("translate-listing", {
      body: { listing_id: listingId, lang },
    });
    if (error || data?.error) {
      showToast(data?.error || error?.message || "Couldn't translate this listing.", "error");
      return null;
    }
    return data;
  };

  // ── Seller starts (or resumes) real Stripe Identity verification. Opens
  // Stripe's hosted document + selfie capture flow. The actual users.verified
  // flip happens server-side via the stripe-webhook function once Stripe
  // confirms the verification — this just kicks off the session.
  const startIdentityVerification = async () => {
    const { data, error } = await supabase.functions.invoke("create-identity-verification");
    if (error || !data?.url) {
      if (data?.alreadyVerified) { showToast("You're already verified.", "info"); return; }
      // On a non-2xx response supabase-js leaves `data` null and sets a
      // generic error.message ("non-2xx status code" / "Failed to send a
      // request"). The function's actual message is in error.context, an
      // unread Response. Without this, a clear server-side explanation —
      // "Your account is not set up to use Identity", say — is discarded and
      // shown to the user as a transport failure, which sends you debugging
      // the wrong layer entirely.
      let detail = null;
      try {
        if (error?.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          detail = body?.error || null;
        }
      } catch { /* body wasn't JSON — fall through to the generic message */ }
      showToast(detail || data?.error || error?.message || "Couldn't start verification — try again.", "error");
      return;
    }
    window.location.href = data.url;
  };

  // ── Profile page handlers.
  // Simple fields live on the users table row.
  const updateProfile = async (patch) => {
    const { error } = await supabase.from("users").update(patch).eq("id", currentUser.id);
    if (error) { showToast("Couldn't save changes.", "error"); return; }

    // A database trigger parks a changed display name in users.pending_name
    // and leaves the visible `name` untouched, so an offensive name is never
    // shown even for an instant. This promotes it once it passes.
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      const mod = await moderateRecord("profile");
      await loadDbUser(currentUser);
      await handleModerationResult(mod, "Profile updated.");
      return;
    }

    await loadDbUser(currentUser);
    showToast("Profile updated.");
  };

  // Email changes go through Supabase Auth, not the users table — this
  // triggers a confirmation email to the NEW address, and the change only
  // takes effect once that link is clicked.
  const changeEmail = async (newEmail) => {
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    if (error) { showToast(error.message || "Couldn't update email.", "error"); return; }
    showToast("Check your new email address for a confirmation link to finish the change.");
  };

  // Password changes also go through Supabase Auth — never stored on the
  // users table.
  const changePassword = async (newPassword) => {
    if (!newPassword || newPassword.length < 8) { showToast("Password must be at least 8 characters.", "error"); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { showToast(error.message || "Couldn't update password.", "error"); return; }
    showToast("Password updated.");
  };

  // ── Advertiser submits the "Advertise on DriveLink" form — creates a real
  // Stripe Checkout session for the selected plan.
  const createAdCheckout = async ({ plan, business_name, contact_email, image_url, link_url }) => {
    const { data, error } = await supabase.functions.invoke("create-ad-checkout-session", {
      body: { plan, business_name, contact_email, image_url, link_url },
    });
    if (error || !data?.url) {
      showToast(data?.error || error?.message || "Couldn't start checkout — try again.", "error");
      return;
    }
    window.location.href = data.url;
  };


  // ── Admin: comp an ad placement ─────────────────────────────────────────────
  // Writes a live placement with no payment so the ad rail can be seeded. An
  // empty rail is the same problem as an empty listings grid: it tells a
  // visitor nothing is happening here.
  //
  // Not a 100%-off discount code. Stripe rejects zero-value checkouts, and a
  // shareable code is a liability — comping is a different action from paying
  // and modelling it as a discounted payment makes both paths worse.
  //
  // The insert is gated by ad_placements_admin_comp_insert, which refuses
  // anything that is not comped=true, amount_cents=0, status='active'. That is
  // not decoration: without it a bug here could fabricate a paid-looking row
  // and inflate the ad revenue figure shown on the same screen as the button.
  //
  // Returns { ok } rather than throwing — the form renders failures inline
  // beside the fields rather than behind a toast that covers them.
  const compAdPlacement = async (row) => {
    const { error } = await supabase
      .from("ad_placements")
      .insert({ ...row, user_id: dbUser?.id ?? null, comped_by: dbUser?.id ?? null })
      .select("id")
      .single();

    if (error) {
      console.error("comp ad insert failed:", error);
      return {
        ok: false,
        message: /row-level security/i.test(error.message)
          ? "Blocked by RLS — has comped-ads-migration.sql been run on this project?"
          : error.message,
      };
    }
    showToast(`Comped placement created for ${row.business_name}.`, "success");
    return { ok: true };
  };

  // ── Admin: delete a stale ad placement ──────────────────────────────────────
  // Abandoned checkouts and finished runs only. A live placement is refused by
  // the ad_placements_admin_delete RLS policy, not just hidden in the UI — the
  // row is the customer's receipt as much as it is the ad.
  const deleteAdPlacement = async (adId) => {
    // .select() so the response reports what was actually removed. Without it,
    // a delete blocked by RLS returns success with zero rows and no error —
    // indistinguishable from a real delete, which is how this shipped showing
    // a green toast over a row that never went anywhere.
    const { data: removed, error } = await supabase
      .from("ad_placements")
      .delete()
      .eq("id", adId)
      .select("id");

    if (error) {
      showToast(`Couldn't delete that placement: ${error.message}`, "error");
      return;
    }
    if (!removed || removed.length === 0) {
      showToast("Nothing was deleted — the database refused it. Running placements can't be removed.", "error");
      return;
    }
    await loadData();
    showToast("Ad placement deleted.");
  };

  const messageSeller = (listing) => {
    if (listing.seller_id === currentUser.id) return;
    if (blocks.some(b => b.blocked_id === listing.seller_id)) { showToast("You've blocked this seller.", "error"); return; }
    setOpenThread({ listingId: listing.id, otherId: listing.seller_id });
    setView("messages");
  };

  // ── Admin: wipe test data. Deletes rows from selected tables; optionally resets
  // user balances to 0. Never deletes user accounts themselves (would break auth).
  const resetTestData = async (options) => {
    const { activeListings: wipeActive, soldListings: wipeSold, archivedListings: wipeArchived, referrals: wipeReferrals, messages: wipeMessages, reports: wipeReports, savedSearchesFlag, feedbackFlag, resetBalances } = options;
    // is_private guard: a live bring-your-own-deal may have a buyer's money in
    // escrow against it. Test-data wipes must never reach one.
    if (wipeActive) await supabase.from("listings").delete().eq("status", "active").eq("is_private", false);
    if (wipeSold) await supabase.from("listings").delete().eq("status", "sold");
    if (wipeArchived) await supabase.from("listings").delete().eq("status", "archived");
    if (wipeReferrals) await supabase.from("referrals").delete().not("id", "is", null);
    if (wipeMessages) await supabase.from("messages").delete().not("id", "is", null);
    if (wipeReports) await supabase.from("reports").delete().not("id", "is", null);
    if (savedSearchesFlag) await supabase.from("saved_searches").delete().not("id", "is", null);
    if (feedbackFlag) await supabase.from("feedback").delete().not("id", "is", null);
    if (resetBalances) await supabase.from("users").update({ balance: 0 }).not("id", "is", null);
    await loadData();
    showToast("Test data cleared.");
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  // VIEW_PATHS / PATH_TO_VIEW / normalizePath live at module scope above, so
  // the initial view can be derived from the URL before the first paint.
  const navigate = (to, { replace = false } = {}) => {
    // No-op when we are already there, INCLUDING on replace. The old guard
    // exempted replace, so every redirect-to-current-path still called
    // replaceState and setPath. Several of the effects below call navigate on
    // dependency arrays that change on every loadData(), so a redirect that
    // should have settled instead re-fired on each refresh — enough history
    // calls in a burst for Chrome to throttle navigation and for the page to
    // visibly flash.
    if (normalizePath(window.location.pathname) === normalizePath(to)) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", to);
    setPath(to);
  };

  // Builds the payload the detail modal expects, from a bare listing row. Used
  // both by in-app clicks and by direct /listing/:id loads.
  const buildListingPayload = (l) => {
    const seller = users.find(u => u.id === l.seller_id);
    const myRef = currentUser ? referrals.find(r => r.listing_id === l.id && r.promoter_id === currentUser.id) : null;
    const sellerReviews = reviews?.filter(r => r.seller_id === l.seller_id) || [];
    const sellerRating = sellerReviews.length ? sellerReviews.reduce((s, r) => s + r.rating, 0) / sellerReviews.length : null;
    const myOffer = currentUser
      ? offers?.find(o => o.listing_id === l.id && o.buyer_id === currentUser.id && o.status !== "withdrawn" && o.status !== "declined")
      : null;
    return { listing: l, seller, myRef, sellerRating, sellerReviewCount: sellerReviews.length, myOffer };
  };

  const openListing = (payload) => {
    if (!payload?.listing) return;
    setViewingListing(payload);
    navigate(`/listing/${payload.listing.id}`);

    // Fire and forget. A failed view count must never interfere with actually
    // showing someone the car — the whole feature is decoration compared to
    // that. Dedupe (one row per viewer per listing, ever — seller's own views
    // excluded) happens in record_listing_view, not here.
    try {
      let key = localStorage.getItem("dl_viewer_key");
      if (!key) {
        key = (crypto?.randomUUID?.() || `k${Date.now()}${Math.random()}`);
        localStorage.setItem("dl_viewer_key", key);
      }
      supabase.rpc("record_listing_view", {
        p_listing_id: payload.listing.id,
        p_viewer_key: key,
      }).then(({ error }) => { if (error) console.warn("view not recorded:", error.message); });
    } catch { /* private browsing blocks localStorage; skip the count */ }
  };

  const closeListing = () => {
    setViewingListing(null);
    // Back to the grid, not the marketing page — "/" is the landing view now.
    if (window.location.pathname.startsWith("/listing/")) navigate(VIEW_PATHS.home);
  };

  // ── Route resolution ────────────────────────────────────────────────────────
  // Runs whenever the path or the loaded data changes. Handles /s/:code Promoter
  // links and /listing/:id deep links; any other path clears the modal.
  useEffect(() => {
    if (loading) return;

    // /p/:code — standing Promoter link. No lookup happens here: promoter_codes
    // is RLS-scoped to its owner, so a visitor can't read someone else's row.
    // The code is stored optimistically and validated server-side by create-deal;
    // an unknown code simply results in no attribution.
    const standingMatch = path.match(/^\/p\/([^/?#]+)\/?$/);
    if (standingMatch) {
      savePromoterCode(decodeURIComponent(standingMatch[1]).toUpperCase());
      // This navigate is the URL becoming correct, not the user moving. Without
      // the flag the view→URL effect runs next with the pre-setView value and
      // navigates to whatever that stale view maps to — which is how /p/:code
      // ended up redirecting to the landing page.
      syncingFromUrl.current = true;
      setView("startDeal");
      navigate(VIEW_PATHS.startDeal, { replace: true });
      return;
    }

    const promoterMatch = path.match(/^\/s\/([^/?#]+)\/?$/);
    if (promoterMatch) {
      const code = decodeURIComponent(promoterMatch[1]).toUpperCase();
      const ref = referrals.find(r => (r.share_code || "").toUpperCase() === code);
      const targetId = ref?.listing_id || listingIdFromShareCode(code);
      if (targetId && listings.some(l => l.id === targetId)) {
        saveAttribution(code, targetId);
        setView("home");
        navigate(`/listing/${targetId}`, { replace: true });
      } else {
        showToast("That share link is no longer valid — showing all listings instead.", "info");
        setView("home");
        navigate(VIEW_PATHS.home, { replace: true });
      }
      return;
    }

    const listingMatch = path.match(/^\/listing\/([^/?#]+)\/?$/);
    if (listingMatch) {
      const id = decodeURIComponent(listingMatch[1]);
      const l = listings.find(x => x.id === id);
      if (!l) {
        // Listings may not have arrived yet — only redirect once we know they have.
        if (listings.length) {
          showToast("That listing isn't available anymore.", "info");
          setView("home");
          navigate(VIEW_PATHS.home, { replace: true });
        }
        return;
      }
      setView("home");
      setViewingListing(buildListingPayload(l));
      return;
    }

    if (viewingListing) setViewingListing(null);

    // ── URL → view ────────────────────────────────────────────────────────────
    // Makes the back button, refresh, and pasted links all work. Without this,
    // navigating back from /terms to /browse left `view` on "terms" and the
    // view→URL effect below immediately pushed /terms again — the back button
    // would appear frozen.
    const mapped = PATH_TO_VIEW[normalizePath(path)];
    if (mapped && mapped !== view) {
      // Guard against kicking someone out of a view that has no URL. This
      // effect re-runs on every data refresh, so if a view is ever added
      // without a VIEW_PATHS entry, the stale URL here would silently yank the
      // user back to whatever that URL maps to mid-session.
      if (!VIEW_PATHS[view]) return;
      // /admin is a real URL but not a real permission. Anyone can type it, so
      // it is checked here rather than trusted from the address bar. The admin
      // components are also gated on dbUser?.role separately — this only stops
      // the view from being entered at all.
      // Wait for the profile before judging. dbUser is null for a moment after
      // sign-in while loadDbUser() runs, and the old check read that null as
      // "not an admin" — bouncing a real admin off /admin to /browse before
      // their own record had arrived. Deciding nothing until dbUser resolves
      // costs one render and makes the answer correct.
      if (mapped === "admin" && currentUser && !dbUser) {
        return;
      }
      if (mapped === "admin" && dbUser?.role !== "admin") {
        navigate(currentUser ? VIEW_PATHS.home : VIEW_PATHS.landing, { replace: true });
      } else {
        // The URL is the source of truth for this change. Tell the view→URL
        // effect to stand down for this commit — it is about to run with the
        // pre-setView value and would otherwise navigate straight back.
        syncingFromUrl.current = true;
        setView(mapped);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // dbUser is a dependency because the admin guard above defers until it
    // loads — without it here, that early return would strand the view.
  }, [path, loading, listings, referrals, users, reviews, offers, currentUser, dbUser]);

  // ── view → URL ──────────────────────────────────────────────────────────────
  // The other half of the sync. 39 setView() call sites throughout the app stay
  // exactly as they are; this effect gives each of them a URL as a side effect,
  // which is why this is not a react-router migration.
  //
  // Deep-link paths own the address bar while they are active: an open listing
  // modal sets view to "home", and without this guard that would rewrite
  // /listing/abc to /browse and break sharing the link you are looking at.
  useEffect(() => {
    if (loading) return;
    // A popstate just drove the view. `view` in this closure is still the old
    // one, so any navigate() here would undo the user's back button. Clear the
    // flag and let the next commit — where view and path agree — run normally.
    if (syncingFromUrl.current) {
      syncingFromUrl.current = false;
      return;
    }
    const target = VIEW_PATHS[view];
    if (!target) return;
    const current = normalizePath(window.location.pathname);
    if (viewingListing || /^\/(listing|s|d)\//.test(current)) return;
    if (current !== target) navigate(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, viewingListing]);

  // ── Auth gate for deep links ────────────────────────────────────────────────
  // A signed-out visitor opening /sell used to get the marketing page with the
  // URL still reading /sell and no way forward — a dead end on exactly the link
  // you would send a prospective seller. Now they get the sign-in screen, and
  // pendingView carries them to the sell form once they are in.
  //
  // "auth" and "landing" are excluded or this would re-enter itself. Public
  // views stay reachable signed out: browsing without an account is the point.
  useEffect(() => {
    if (loading || currentUser) return;
    if (PUBLIC_VIEWS.has(view)) return;
    setPendingView(view);
    setView("auth");
  }, [currentUser, view, loading]);

  // ── GA4 ─────────────────────────────────────────────────────────────────────
  // A single-page app fires exactly one automatic page_view, on first load.
  // Every navigation after that was invisible, which is why analytics showed
  // one "/" hit per session no matter how far someone got. gtag is loaded in
  // index.html; the typeof check keeps an ad blocker from throwing here.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.gtag !== "function") return;
    window.gtag("event", "page_view", {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [path]);

  useEffect(() => {
    const m = path.match(/^\/d\/([^/?#]+)\/?$/);
    setDealToken(m ? decodeURIComponent(m[1]) : null);
  }, [path]);

  // `!l.is_private` keeps bring-your-own-deal listings out of the public grid.
  // RLS already hides them from everyone else; this hides them from the two
  // parties, who would otherwise see their own private deal while browsing.
  const activeListings = listings.filter(l => l.status === "active" && !l.is_private && !blocks.some(b => b.blocked_id === l.seller_id));
  const archivedListings = listings.filter(l => l.status === "archived");

  // Invite links render before the auth/data gate: the recipient is usually a
  // stranger who has never signed in, and the page has to show them the car
  // before asking for an account.
  if (dealToken) return (
    <JoinDealView
      token={dealToken}
      currentUser={currentUser}
      showToast={showToast}
      onNavigate={(v) => { navigate("/"); setView(v); }}
      onJoined={async (listingId) => {
        // loadData() first, or the /listing/:id route resolver will not find
        // the new row in state and will bounce to home.
        await loadData();
        navigate(`/listing/${listingId}`);
      }}
    />
  );

  if (view === "startDeal") return (
    <StartDealView
      currentUser={currentUser}
      promoterCode={promoterCode?.code || null}
      showToast={showToast}
      onBack={() => { navigate("/"); setView("home"); }}
      onNavigate={setView}
    />
  );

  if (!authChecked || loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, fontFamily: "Inter, sans-serif" }}>
      <img src={logoIcon} alt="DriveLink" style={{ height: 64, width: "auto" }} />
      <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>Loading DriveLink…</div>
    </div>
  );

  if (confirmResult) return (
    <ConfirmedView
      result={confirmResult}
      onContinue={() => {
        setConfirmResult(null);
        setView(currentUser ? "home" : "auth");
      }}
    />
  );

  if (view === "terms" || view === "privacy") return (
    <LegalPageView type={view} onBack={() => setView(currentUser ? "home" : "landing")} />
  );

  if (view === "about") return (
    <AboutView
      onBack={() => setView(currentUser ? "home" : "landing")}
      onBrowse={() => setView("home")}
      onSafety={() => setView("safety")}
    />
  );

  if (view === "safety") return (
    <SafetyTipsView onBack={() => setView(currentUser ? "home" : "landing")} />
  );

  if (view === "faq") return (
    <FAQView
      onBack={() => setView(currentUser ? "home" : "landing")}
      onSafety={() => setView("safety")}
    />
  );

  if (view === "escrow") return (
    <EscrowExplained
      onBack={() => setView(currentUser ? "home" : "landing")}
      onStart={() => setView("startDeal")}
    />
  );

  // The lien guide cluster. Each takes onNavigate so the "other states" links
  // at the foot of each page move between them without a full page load.
  if (view === "lienPayoffNJ" || view === "lienPayoffPA" || view === "lienPayoffNY") {
    const Guide =
      view === "lienPayoffPA" ? LienPayoffPA :
      view === "lienPayoffNY" ? LienPayoffNY :
      LienPayoffNJ;
    return (
      <Guide
        onBack={() => setView(currentUser ? "home" : "landing")}
        onStart={() => setView("escrow")}
        onNavigate={setView}
      />
    );
  }

  if (view === "landing") return (
    <>
      <Landing
        onSignIn={() => setView("auth")}
        onBrowse={() => setView("home")}
        onNavigate={setView}
        signedIn={!!currentUser}
      />
      <InstallPrompt />
    </>
  );

  // ── Post-sign-in landing ────────────────────────────────────────────────────
  // setView() alone is not enough here. The address bar still reads /signin at
  // this moment, and the URL→view effect runs on the next render, reads that
  // stale path, maps it to "auth" and overwrites whatever we just set. Because
  // currentUser is populated by then, the `view === "auth"` branch below no
  // longer matches either — so NO view block renders and the user gets the nav
  // bar above an empty page, with the two effects trading /signin and /browse
  // until one of them wins. Moving the URL in the same handler keeps path and
  // view agreeing, which is what stops it.
  const completeSignIn = (user) => {
    setCurrentUser(user);
    loadDbUser(user);
    loadData();
    // Continue to whatever they were trying to reach, else the grid.
    const target = pendingView && pendingView !== "auth" ? pendingView : "home";
    setView(target);
    setPendingView(null);
    if (VIEW_PATHS[target]) navigate(VIEW_PATHS[target], { replace: true });
  };

  // Checked before everything else. Supabase turns the recovery token into a
  // real session, so by the time the app renders the visitor looks signed in —
  // any later gate would route them to Browse and they would never be asked
  // for a new password.
  if (view === "resetPassword") {
    return <ResetPassword onDone={() => { setView(currentUser ? "home" : "auth"); navigate(currentUser ? VIEW_PATHS.home : VIEW_PATHS.auth, { replace: true }); }} />;
  }
  // Rendered before the auth gate for the same reason resetPassword is: this
  // is the one view whose whole job is to persuade someone who is not signed in.
  if (!currentUser && view === "promoter") {
    return (
      <div style={styles.app}>
        <style>{css}</style>
        <PromoterSignedOut onSignUp={() => { setPendingView("promoter"); setView("auth"); navigate(VIEW_PATHS.auth); }} onBack={() => { setView("landing"); navigate(VIEW_PATHS.landing); }} />
      </div>
    );
  }
  if (!currentUser && view === "auth") return <Auth onAuth={completeSignIn} />;

  if (!currentUser && !PUBLIC_VIEWS.has(view)) return (
    // Belt and braces: the effect above normally converts this case to the
    // sign-in screen before render. This catches the frame in between.
    <Auth onAuth={completeSignIn} />
  );

  return (
    <div style={styles.app}>
      <style>{css}</style>
      <nav style={styles.nav}>
        <div style={styles.navInner} className="app-nav-inner">
          {/* Signed-out visitors go to the marketing landing page at "/" —
              that's the page the domain resolves to and what they expect from
              a logo. Signed-in users go to the browse grid instead: sending
              someone who already has an account back to a "create an account"
              pitch is a step backwards. Was a div with an onClick, so it was
              unreachable by keyboard and invisible to screen readers. */}
          <div
            style={styles.logo}
            className="app-logo"
            role="button"
            tabIndex={0}
            aria-label="DriveLink — home"
            onClick={() => { setView(currentUser ? "home" : "landing"); setHomeResetKey(k => k + 1); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setView(currentUser ? "home" : "landing");
                setHomeResetKey(k => k + 1);
              }
            }}
          >
            <img src={logoIcon} alt="DriveLink" style={styles.logoImg} />
            <span style={styles.logoText}>DriveLink</span>
          </div>
          {/* Primary row: only things anyone might want to DO. Everything that
              belongs to "my account" moved into the avatar dropdown, which is
              what let this drop from 13 items to 5 and killed the drag-scroll. */}
          <div style={styles.navLinks} className="app-nav-links">
            <NavBtn active={view === "home"} onClick={() => { setView("home"); setHomeResetKey(k => k + 1); }}>{t("nav.browse")}</NavBtn>
            {currentUser && <NavBtn active={view === "myListings"} onClick={() => setView("myListings")}>{t("nav.myListings")}</NavBtn>}
            {currentUser && <NavBtn active={view === "postListing"} onClick={() => setView("postListing")}>{t("nav.postListing")}</NavBtn>}
            <NavBtn active={view === "startDeal"} onClick={() => setView("startDeal")}>{t("nav.startDeal")}</NavBtn>
            <NavBtn active={view === "advertise"} onClick={() => setView("advertise")}>{t("nav.advertise")}</NavBtn>
            {/* Not an action like the rest of this row, but it answers the one
                objection that stops a first-time visitor from paying at all.
                Literal strings: i18n.jsx has no nav.faq key yet. */}
            <NavBtn active={view === "faq"} onClick={() => setView("faq")}>{lang === "es" ? "¿Es seguro?" : "Is this safe?"}</NavBtn>
          </div>
          <div style={styles.navRight} className="app-nav-right">
            {currentUser ? (
              <div style={styles.userChip} className="app-user-chip">
                <button
                  style={{ ...styles.navBtn, ...(view === "messages" ? styles.navBtnActive : {}), position: "relative", display: "flex", alignItems: "center", gap: 6 }}
                  onClick={() => setView("messages")}
                >
                  {t("nav.messages")}
                  {unreadCount > 0 && (
                    <span style={styles.navUnread}>{unreadCount > 9 ? "9+" : unreadCount}</span>
                  )}
                </button>
                {dbUser?.balance > 0 && <span style={styles.balanceBadge}>{fmt(dbUser.balance)}</span>}
                <div style={{ position: "relative" }} ref={accountMenuRef}>
                  <button
                    style={styles.avatarBtn}
                    onClick={() => setAccountMenuOpen(o => !o)}
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    title={dbUser?.name || currentUser.email}
                  >
                    <span style={styles.avatar}>{(dbUser?.name || currentUser.email)[0].toUpperCase()}</span>
                    <span style={styles.caret}>▾</span>
                  </button>
                  {accountMenuOpen && (
                    <div style={styles.menu} role="menu">
                      <div style={styles.menuHeader}>
                        <div style={styles.userName}>{dbUser?.name || currentUser.email}</div>
                        <div style={styles.userRole}>{dbUser?.role === "admin" ? t("nav.adminRole") : t("nav.member")}</div>
                      </div>
                      {[
                        ["myPurchases", t("nav.myPurchases")],
                        ["myOffers", `💰 ${t("nav.myOffers")}`],
                        ["favorites", `❤️ ${t("nav.favorites")}`],
                        ["savedSearches", t("nav.savedSearches")],
                        ["dashboard", t("nav.dashboard")],
                        ["promoter", "\ud83c\udfab Promoter code"],
                        ["blocked", `🚫 ${t("nav.blocked")}`],
                        ["profile", `⚙️ ${t("nav.profile")}`],
                      ].map(([v, label]) => (
                        <button
                          key={v}
                          role="menuitem"
                          style={{ ...styles.menuItem, ...(view === v ? styles.menuItemActive : {}) }}
                          onClick={() => { setView(v); setAccountMenuOpen(false); }}
                        >
                          {label}
                        </button>
                      ))}
                      {dbUser?.role === "admin" && (
                        <>
                          <div style={styles.menuDivider} />
                          <button
                            role="menuitem"
                            style={{ ...styles.menuItem, ...(view === "admin" ? styles.menuItemActive : {}) }}
                            onClick={() => { setView("admin"); setAccountMenuOpen(false); }}
                          >
                            {t("nav.admin")}
                          </button>
                        </>
                      )}
                      <div style={styles.menuDivider} />
                      <div style={styles.menuRow}>
                        <span style={styles.menuRowLabel}>{t("lang.label")}</span>
                        <LangToggle />
                      </div>
                      <div style={styles.menuDivider} />
                      <button role="menuitem" style={{ ...styles.menuItem, color: "#b91c1c" }} onClick={logout}>{t("nav.signOut")}</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <button style={styles.signInBtn} onClick={() => setView("auth")}>{t("auth.signin")}</button>
                <LangToggle style={{ marginLeft: 8 }} />
              </>
            )}
          </div>
        </div>
      </nav>

      {toast && <div style={{ ...styles.toast, background: toast.type === "info" ? "#1d4ed8" : toast.type === "error" ? "#dc2626" : "#16a34a" }} className="app-toast">{toast.msg}</div>}

      <div className="app-content-row">
        {/* Desktop-only ad rail — hidden on mobile/tablet/narrow desktop via .app-ad-rail CSS below.
            Sits as a real layout column beside main content (position: sticky), not floating
            on top of it — avoids overlapping the hero banner and any click-through issues that
            came with the old fixed-position version. */}
        <div className="app-ad-rail">
          <AdRail ads={publicAds} onPromoClick={() => setView("advertise")} />
        </div>

      <main style={styles.main} className="app-main">
        {view === "advertise" && <AdvertiseView currentUser={dbUser} onSubmit={createAdCheckout} onSignIn={() => { setPendingView("advertise"); setView("auth"); }} />}
        {view === "home" && <HomeView key={homeResetKey} listings={activeListings} allListings={listings} currentUser={dbUser} users={users} onShare={generateShare} onBuy={handleBuyNow} referrals={referrals} onSignIn={() => setView("auth")} onMessageSeller={messageSeller} onReport={fileReport} onSaveSearch={saveSearch} favorites={favorites} onToggleFavorite={toggleFavorite} onToggleBlock={toggleBlock} onReportUser={reportUserAction} blocks={blocks} reviews={reviews} offers={offers} onMakeOffer={makeOffer} onOpenListing={openListing} />}
        {view === "myListings" && <MyListingsView listings={listings.filter(l => l.seller_id === currentUser?.id)} referrals={referrals} users={users} offers={offers} stats={listingStats} onMarkSold={markSold} onSetStatus={setListingStatus} onUpdate={updateListing} onRespondToOffer={respondToOffer} onRescindOffer={rescindOffer} onOpenSafety={() => setView("safety")} onConfirmHandover={confirmHandover} currentUser={dbUser} onSetupPayouts={setupPayouts} onDelete={deleteListing} onRestore={restoreListing} />}
        {view === "myPurchases" && <MyPurchasesView listings={listings.filter(l => l.buyer_id === currentUser?.id)} users={users} reviews={reviews} currentUser={currentUser} handoverCodes={handoverCodes} onSubmitReview={submitReview} onConfirmReceipt={confirmReceipt} onFileDispute={fileDispute} onBuy={handleBuyNow} onBrowse={() => setView("home")} onOpenSafety={() => setView("safety")} />}
        {view === "myOffers" && <MyOffersView offers={offers.filter(o => o.buyer_id === currentUser?.id)} listings={listings} onRespondToCounter={respondToCounter} onBuy={handleBuyNow} onBrowse={() => setView("home")} onOpenListing={(l) => openListing(buildListingPayload(l))} />}
        {view === "postListing" && <PostListingView onPost={postListing} />}
        {view === "messages" && currentUser && <Messages currentUser={{ ...dbUser, id: currentUser.id }} listings={listings} users={users} openThread={openThread} onOpened={() => setOpenThread(null)} />}
        {view === "savedSearches" && <SavedSearchesView savedSearches={savedSearches} onDelete={deleteSavedSearch} onBrowse={() => setView("home")} />}
        {view === "favorites" && <FavoritesView favorites={favorites} listings={listings} users={users} referrals={referrals} currentUser={dbUser} onShare={generateShare} onBuy={handleBuyNow} onMessageSeller={messageSeller} onReport={fileReport} onToggleFavorite={toggleFavorite} onBrowse={() => setView("home")} onOpenListing={openListing} />}
        {view === "blocked" && <BlockedUsersView blocks={blocks} users={users} onToggleBlock={toggleBlock} onBrowse={() => setView("home")} />}
        {view === "dashboard" && <PromoterDashboard currentUser={dbUser} referrals={referrals.filter(r => r.promoter_id === currentUser?.id)} listings={listings} payouts={payouts} standingCode={promoterCode?.code || null} onSetupPayouts={setupPayouts} onRetract={retractReferral} onGetCode={() => setView("promoter")} />}
        {view === "promoter" && <PromoterCodeView currentUser={dbUser} promoterCode={promoterCode} onMint={mintPromoterCode} onSetupPayouts={setupPayouts} onViewEarnings={() => setView("dashboard")} />}
        {view === "profile" && <ProfileView dbUser={dbUser} authEmail={currentUser?.email} onUpdateProfile={updateProfile} onChangeEmail={changeEmail} onChangePassword={changePassword} onSetupPayouts={setupPayouts} onStartIdentityVerification={startIdentityVerification} />}
       {view === "admin" && <AdminView listings={listings} users={users} riskFlags={riskFlags} onResolveRiskFlag={resolveRiskFlag} referrals={referrals} reports={reports} feedback={feedback} userReports={userReports} reviews={reviews} payouts={payouts} disputes={disputes} adPlacements={adPlacements} onDeleteAd={deleteAdPlacement} onCompAd={compAdPlacement} onRefreshAds={loadData} onArchive={archiveListing} onMarkSold={markSold} onConfirmReceipt={confirmReceipt} onResolveReport={resolveReport} onResolveUserReport={resolveUserReport} onToggleVerified={toggleVerified} onResetData={resetTestData} onRecordPayout={recordPayout} onPayoutViaStripe={payoutPromoterViaStripe} onResolveDispute={resolveDispute} onDeleteUser={deleteUser} onApproveFlaggedReferral={approveFlaggedReferral} onDenyFlaggedReferral={denyFlaggedReferral} />}
        {view === "success" && <SuccessView onHome={() => setView("home")} />}
      </main>

      <div className="app-ad-rail">
        <AdRail ads={publicAds} onPromoClick={() => setView("advertise")} />
      </div>
      </div>
      <InstallPrompt />
      <footer style={styles.appFooter}>
        <button style={styles.appFooterLink} onClick={() => setView("about")}>About DriveLink</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("safety")}>🛡️ Safety Tips</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("faq")}>How your money is protected</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("terms")}>Terms of Service</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("privacy")}>Privacy Policy</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <a href="mailto:support@drivelink.deals" style={styles.appFooterLink}>support@drivelink.deals</a>
        <span style={{ color: "#d1d5db" }}>·</span>
        <a
          href="https://instagram.com/drivelink_deals"
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...styles.appFooterLink, display: "inline-flex", alignItems: "center", gap: 4 }}
          aria-label="DriveLink on Instagram"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.5" y2="6.5"></line>
          </svg>
          Instagram
        </a>
      </footer>
      {viewingListing && (
        <ListingDetailModal
          data={viewingListing}
          currentUser={dbUser}
          isFavorited={favorites?.some(f => f.listing_id === viewingListing.listing.id)}
          isBlocked={blocks?.some(b => b.blocked_id === viewingListing.listing.seller_id)}
          onClose={closeListing}
          onBuy={handleBuyNow}
          onBuyWire={handleBuyByWire}
          wireLoading={wireLoading}
          onShare={generateShare}
          onMessageSeller={messageSeller}
          onReport={fileReport}
          onReportUser={reportUserAction}
          onToggleFavorite={toggleFavorite}
          onToggleBlock={toggleBlock}
          onMakeOffer={makeOffer}
          onSignIn={() => setView("auth")}
          onCheckDeal={checkDealAssessment}
          onTranslate={translateListing}
        />
      )}
      {wireInstructions && (
        <WireInstructionsModal data={wireInstructions} onClose={() => setWireInstructions(null)} />
      )}
    </div>
  );
}

// Shown after create-wire-session succeeds. Unlike card/ACH checkout, a wire
// buyer never leaves DriveLink — there's no Stripe-hosted page for Customer
// Balance payments, so the routing number, virtual account number, and
// reference code returned by the backend are rendered here directly. The
// buyer also gets these by email (create-wire-session sends it), so this
// modal is a convenience, not the only record they have of it.
function WireInstructionsModal({ data, onClose }) {
  const { carLabel, amount, reference, routing_number, account_number, hosted_instructions_url, abandonment_timeout_business_days } = data;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          maxWidth: 480,
          width: "92%",
          margin: "40px auto",
          padding: 28,
          position: "relative",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#6b7280" }}
        >
          ✕
        </button>

        <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
          Complete your wire transfer
        </div>
        <div style={{ fontSize: 14, color: "#374151", marginBottom: 18 }}>
          For the <b>{carLabel}</b>. Send a domestic wire using the details below — we've also emailed this to you.
        </div>

        <div style={{ background: "#FFF8E7", border: "1px solid #FFB020", borderRadius: 8, padding: 16, fontSize: 14, lineHeight: 1.9 }}>
          <div><b>Amount:</b> {fmt(amount)}</div>
          {routing_number && <div><b>Routing number:</b> {routing_number}</div>}
          {account_number && <div><b>Account number:</b> {account_number}</div>}
          {reference && (
            <div>
              <b>Reference (required):</b>{" "}
              <span style={{ fontFamily: "monospace", background: "#fff", padding: "2px 6px", borderRadius: 4, border: "1px solid #FFB020" }}>
                {reference}
              </span>
            </div>
          )}
        </div>

        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 14, lineHeight: 1.6 }}>
          Include the reference code exactly as shown so the transfer matches to your purchase. This listing is reserved
          for you for up to {abandonment_timeout_business_days ?? 10} business days — we'll email you the moment the
          transfer clears with your handover code. Nothing releases to the seller until then.
        </div>

        {hosted_instructions_url && (
          <a
            href={hosted_instructions_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: 16, fontSize: 13, color: "#1d4ed8", textDecoration: "underline" }}
          >
            View official Stripe transfer instructions →
          </a>
        )}

        <button
          onClick={onClose}
          style={{ ...styles.buyBtn, width: "100%", marginTop: 20 }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function NavBtn({ children, active, onClick }) {
  return <button style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }} onClick={onClick}>{children}</button>;
}

function LegalPageView({ type, onBack }) {
  const isTerms = type === "terms";
  return (
    <div style={styles.legalPage}>
      <style>{css}</style>
      <div style={styles.legalInner}>
        <button style={styles.legalBackBtn} onClick={onBack}>← Back to DriveLink</button>
        <h1 style={styles.legalTitle}>{isTerms ? "Terms of Service" : "Privacy Policy"}</h1>
        <p style={styles.legalUpdated}>Last updated: July 2026</p>

        {isTerms ? (
          <div style={styles.legalBody} className="legalBody">
            <h2>1. What DriveLink Is</h2>
            <p>DriveLink is a peer-to-peer marketplace that connects car sellers directly with buyers. We are not a dealership, we do not own, inspect, or guarantee any vehicle listed on the platform, and we are not a party to the sale between a buyer and seller.</p>

            <h2>2. Accounts</h2>
            <p>You must create an account to list a car, message another user, or complete a purchase. You're responsible for the accuracy of the information you provide and for keeping your login credentials secure.</p>

            <h2>3. Listings</h2>
            <p>Sellers agree that listing information (price, mileage, condition, photos, VIN) is accurate to the best of their knowledge. DriveLink may remove any listing that is misleading, fraudulent, or violates these terms, at our discretion, with or without notice.</p>

            <h2>4. Fees</h2>
            <p>Listing a car is free. When a listing sells, DriveLink charges a 1% platform fee on the final sale price. Card processing is charged separately by our payment provider at approximately 2.9% + $0.30 per transaction and is also deducted from the seller's proceeds. If a buyer arrived through a promoter's shared link, an additional 1% commission is paid to that promoter. The exact amount you'll receive is shown before you publish a listing.</p>

            <h2>5. Payments</h2>
            <p>Checkout is processed through Stripe. DriveLink does not store your payment card details. Once a buyer completes checkout, the transaction between buyer and seller — including vehicle handoff, title transfer, and any related paperwork — is the responsibility of the two parties.</p>

            <h2>6. Buyer &amp; Seller Responsibilities</h2>
            <p>Buyers are strongly encouraged to inspect a vehicle (and its VIN history) before completing a purchase. Sellers are responsible for complying with their state's title transfer and sales tax requirements. DriveLink is not responsible for verifying vehicle condition, ownership, or title status.</p>

            <h2>7. Prohibited Conduct</h2>
            <p>You may not use DriveLink to list a vehicle you don't have the legal right to sell, harass or defraud other users, circumvent platform fees by arranging an off-platform sale after connecting through DriveLink, or post false, misleading, or duplicate listings.</p>

            <h2>8. Reviews, Blocking &amp; Reports</h2>
            <p>Reviews must reflect genuine transactions. Fake or retaliatory reviews may be removed. You may block or report another user for abusive, fraudulent, or unsafe behavior; DriveLink may suspend accounts found to violate these terms.</p>

            <h2>9. Referral Program</h2>
            <p>Promoters earn a 1% commission when a buyer completes a purchase through their shared link. Commissions are credited to the promoter's account balance once a sale is confirmed and are subject to review for fraudulent referral activity.</p>

            <h2>10. Disclaimers &amp; Limitation of Liability</h2>
            <p>DriveLink is provided "as is." We do not guarantee the accuracy of any listing, the condition of any vehicle, or the conduct of any user. To the fullest extent permitted by law, DriveLink is not liable for damages arising from a transaction between a buyer and seller.</p>

            <h2>11. Changes to These Terms</h2>
            <p>We may update these terms from time to time. Continued use of DriveLink after a change means you accept the updated terms.</p>

            <h2>12. Contact</h2>
            <p>Questions about these terms can be sent through the feedback form on our homepage, or emailed to <a href="mailto:support@drivelink.deals" style={styles.vinLink}>support@drivelink.deals</a>.</p>
          </div>
        ) : (
          <div style={styles.legalBody} className="legalBody">
            <h2>1. What We Collect</h2>
            <p>When you create a DriveLink account, we collect your name, email address, and any information you add to listings (photos, vehicle details, price, location). When you message another user, we store that conversation so both parties can see message history.</p>

            <h2>2. Payment Information</h2>
            <p>Checkout is handled entirely by Stripe. DriveLink never sees or stores your card number, expiration date, or CVC — Stripe processes and secures that data directly.</p>

            <h2>3. Location Data</h2>
            <p>The city or ZIP code you enter on a listing is converted to approximate map coordinates (via OpenStreetMap's Nominatim service) so your car can appear on the listings map. We don't collect precise device location.</p>

            <h2>4. How We Use Your Information</h2>
            <p>We use your information to operate the marketplace: displaying listings, enabling buyer-seller messaging, calculating referral commissions, processing reviews, and sending you account-related notifications. We do not sell your personal information to third parties.</p>

            <h2>5. What Other Users Can See</h2>
            <p>Your name and verified-seller status are visible on your listings. Your email is only visible to DriveLink and is not shown to other users unless you choose to share it (for example, in a message).</p>

            <h2>6. Blocking &amp; Reports</h2>
            <p>If you block another user, we retain a record of that block to enforce it (hiding their listings from you and preventing new messages). Reports you file are visible to DriveLink's admin team for review.</p>

            <h2>7. Data Retention</h2>
            <p>We keep account and transaction data for as long as your account is active, and for a reasonable period after in case it's needed for dispute resolution, fraud prevention, or legal compliance.</p>

            <h2>8. Your Choices</h2>
            <p>You can edit or delete your listings at any time. To delete your account or request a copy of your data, contact us through the feedback form on our homepage, or email <a href="mailto:support@drivelink.deals" style={styles.vinLink}>support@drivelink.deals</a>.</p>

            <h2>9. Cookies &amp; Analytics</h2>
            <p>DriveLink uses standard session storage to keep you signed in. We don't currently use third-party advertising trackers.</p>

            <h2>10. Changes to This Policy</h2>
            <p>If we materially change how we handle your data, we'll update this page and adjust the "last updated" date above.</p>

            <h2>11. Contact</h2>
            <p>Questions about this policy can be sent through the feedback form on our homepage, or emailed to <a href="mailto:support@drivelink.deals" style={styles.vinLink}>support@drivelink.deals</a>.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SafetyTipsView({ onBack }) {
  return (
    <div style={styles.legalPage}>
      <style>{css}</style>
      <div style={styles.legalInner}>
        <button style={styles.legalBackBtn} onClick={onBack}>← Back to DriveLink</button>
        <h1 style={styles.legalTitle}>🛡️ Meetup Safety Tips</h1>
        <p style={styles.legalUpdated}>DriveLink connects you directly with the other person — here's how to make the handoff safe.</p>
        <div style={styles.legalBody} className="legalBody">
          <h2>Before you meet</h2>
          <p>Message a bit first through DriveLink's built-in chat before agreeing to meet — it's an easy way to confirm the other person seems legitimate and to keep a record of what was agreed.</p>
          <p>Never send money — deposits included — outside of the platform's checkout to "hold" a car. That request alone is one of the most common scam patterns in car sales.</p>

          <h2>Where to meet</h2>
          <p>Meet in a public place during daylight hours whenever possible. Many local police departments offer a designated "safe exchange zone" in their parking lot, often covered by security cameras — search "[your city] police safe exchange zone" to find one nearby.</p>
          <p>If a test drive is involved, meet at a public location first, then drive a route you're comfortable with — a busy public parking lot, not the seller's or buyer's home address, especially for a first meeting.</p>

          <h2>Bring backup</h2>
          <p>Bring a friend or family member if you can. If you're going alone, tell someone where you're headed, who you're meeting, and when you expect to be back.</p>

          <h2>Before you hand over the car or the money</h2>
          <p>Buyers: verify the VIN on the dashboard or door frame matches the listing, and confirm the seller's ID matches the name on the title. Sellers: your payment is already held by DriveLink before you meet — you don't need to accept a check, a screenshot, or a promise.</p>

          <h2>Your handover code</h2>
          <p>When a buyer pays, DriveLink gives them a 6-digit handover code. That code is the key to the money: the moment the seller enters it, the funds are released and the sale is final.</p>
          <p><strong>Buyers — do not give out your code until the car and the signed title are physically in your hands.</strong> Not when you arrive, not while you're inspecting, not as a gesture of good faith. A seller who asks for it early is asking to be paid before you have anything. Read it out in person rather than texting it.</p>
          <p>Sellers — ask for the code once the buyer has taken the car and the signed title. Entering it pays you immediately.</p>
          <p>If something isn't right, don't hand over the code. Report a problem in DriveLink instead and we'll hold the funds while we look into it. Nothing is released automatically, so there's no clock forcing you to decide on the spot.</p>

          <h2>Trust your instincts</h2>
          <p>If something feels off — pressure to rush, reluctance to meet in public, requests for unusual payment methods — it's okay to walk away. You can always report a listing or a user directly from DriveLink if something seems wrong.</p>

          <h2>After the sale</h2>
          <p>Complete your state's title transfer promptly — requirements vary, so check your local DMV's website for the exact steps. Keep a copy of the signed bill of sale for your records.</p>
        </div>
      </div>
    </div>
  );
}

function ConfirmedView({ result, onContinue }) {
  const isSuccess = result.status === "success";
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20, boxSizing: "border-box" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 40, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,.1)", boxSizing: "border-box", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>{isSuccess ? "✅" : "⚠️"}</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginBottom: 12, letterSpacing: "-0.02em" }}>
          {isSuccess ? "You're confirmed!" : "Link didn't work"}
        </h2>
        <p style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.6, marginBottom: 28 }}>
          {isSuccess
            ? "Your email is verified and your DriveLink account is ready to go."
            : (result.message || "This confirmation link is invalid or has expired. Try signing up again to get a new one.")}
        </p>
        <button
          style={{ width: "100%", background: "#0f172a", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700 }}
          onClick={onContinue}
        >
          {isSuccess ? "Continue to DriveLink →" : "Back to sign in"}
        </button>
      </div>
    </div>
  );
}

function SuccessView({ onHome }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px" }}>
      <div style={{ fontSize: 64, marginBottom: 24 }}>🎉</div>
      <h2 style={{ fontSize: 32, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>Payment Successful!</h2>
      <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 8 }}>Your payment is held safely by DriveLink — the seller has not been paid yet.</p>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 32, maxWidth: 520, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
        We've emailed you a <strong>6-digit handover code</strong>, and it's on your Purchases page. Give it to the seller only once the car and the signed title are in your hands — that's what releases the money.
      </p>
      <button style={styles.confirmBtn} onClick={onHome}>Back to Browse</button>
    </div>
  );
}

function HomeView({ listings, allListings, currentUser, users, onShare, onBuy, referrals, onSignIn, onMessageSeller, onReport, onSaveSearch, favorites, onToggleFavorite, onToggleBlock, onReportUser, blocks, reviews, offers, onMakeOffer, onOpenListing }) {
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [make, setMake] = useState("all");
  const [vehicleType, setVehicleType] = useState("all");
  // Cents, so it compares directly against listings.price and saves as cents.
  const [maxPrice, setMaxPrice] = useState(20000000);
  const [maxMileage, setMaxMileage] = useState(300000);
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState("newest");
  const [mode, setMode] = useState("grid"); // grid | map
  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const MAX_COMPARE = 3;

  const toggleCompare = (listingId) => {
    setCompareIds(prev => {
      if (prev.includes(listingId)) return prev.filter(id => id !== listingId);
      if (prev.length >= MAX_COMPARE) return prev; // capped — button disables itself below
      return [...prev, listingId];
    });
  };

  // Only makes present in the current type's listings — selecting Motorcycle
  // then seeing Chevrolet in the make list would be nonsense.
  const makes = [...new Set(
    listings
      .filter(l => vehicleType === "all" || (l.vehicle_type || "car") === vehicleType)
      .map(l => l.make)
      .filter(Boolean)
  )].sort();

  // Types that actually have listings, so the filter never offers an empty set.
  const availableTypes = VEHICLE_TYPES.filter(vt =>
    listings.some(l => (l.vehicle_type || "car") === vt.value)
  );

  const seeSimilar = (l) => {
    setMake(l.make);
    setSearch(l.model);
    setMode("grid");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = listings
    .filter(l => `${l.year} ${l.make} ${l.model}`.toLowerCase().includes(search.toLowerCase()))
    .filter(l => make === "all" || l.make === make)
    .filter(l => vehicleType === "all" || (l.vehicle_type || "car") === vehicleType)
    .filter(l => l.price <= maxPrice)
    .filter(l => (l.mileage || 0) <= maxMileage)
    .filter(l => !location.trim() || (l.location_text || "").toLowerCase().includes(location.toLowerCase()))
    .sort((a, b) => sort === "newest" ? new Date(b.created_at) - new Date(a.created_at) : sort === "priceLow" ? a.price - b.price : b.price - a.price);

  // Average price per make+model, for the "priced below/above similar listings" comparison
 const avgByModel = {};
for (const l of allListings.filter(l => l.status === "active")) {
  const key = `${l.make}|${l.model}`;
  if (!avgByModel[key]) avgByModel[key] = [];
  avgByModel[key].push(l.price);
}

  // Public-facing social proof, so internal test sales must not inflate it.
  // is_test is written only by the platform (trg_guard_listings_test_flag).
  const soldCount = allListings.filter(l => l.status === "sold" && !l.is_test).length;

  return (
    <div>
      <div style={styles.hero} className="app-hero">
        <div style={styles.heroInner}>
          <div style={styles.heroBadge}>{t("home.badge")}</div>
          <h1 style={styles.heroTitle} className="app-hero-title">{t("home.title")}<br /><span style={styles.heroAccent}>{t("home.titleAccent")}</span></h1>
          <p style={styles.heroSub}>{t("home.sub")}</p>
          <LangSwitchLink />
          <div style={styles.heroStats} className="app-hero-stats">
            {/* Matches the soldCount gate below: "1 Active listings" on a
                brand-new marketplace reads as empty rather than early, so
                this only shows once there's enough inventory to look like
                a real count rather than a confession. Threshold is a guess
                — raise it if 5 still feels thin once we're there. */}
            {listings.length >= 5 && (
              <>
                <div style={styles.heroStat}><span style={styles.heroStatNum}>{listings.length}</span><span style={styles.heroStatLabel}>{t("home.statListings")}</span></div>
                <div style={styles.heroStatDiv} />
              </>
            )}
            {soldCount > 0 && (
              <>
                <div style={styles.heroStat}><span style={styles.heroStatNum}>{soldCount}</span><span style={styles.heroStatLabel}>{t("home.statSold")}</span></div>
                <div style={styles.heroStatDiv} />
              </>
            )}
            <div style={styles.heroStat}><span style={styles.heroStatNum}>1%</span><span style={styles.heroStatLabel}>{t("home.statPromoter")}</span></div>
          </div>
        </div>
      </div>
      <div style={styles.filterBar}>
        <input style={styles.searchInput} placeholder={t("home.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
        {/* Only shown once there is more than one type on the platform —
            a lone "All types" dropdown is a control that does nothing. */}
        {availableTypes.length > 1 && (
          <select
            style={styles.selectInput}
            value={vehicleType}
            onChange={e => { setVehicleType(e.target.value); setMake("all"); }}
          >
            <option value="all">{t("browse.allTypes")}</option>
            {availableTypes.map(vt => (
              <option key={vt.value} value={vt.value}>{vt.emoji} {vt.label}</option>
            ))}
          </select>
        )}
        <select style={styles.selectInput} value={make} onChange={e => setMake(e.target.value)}>
          <option value="all">{t("browse.allMakes")}</option>
          {makes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>{t("browse.maxPrice")}: {fmt(maxPrice)}</label>
          <input type="range" min={500000} max={20000000} step={100000} value={maxPrice} onChange={e => setMaxPrice(+e.target.value)} style={styles.rangeInput} />
        </div>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>{t("browse.maxMileage")}: {maxMileage.toLocaleString()} {t("card.mi")}</label>
          <input type="range" min={0} max={300000} step={5000} value={maxMileage} onChange={e => setMaxMileage(+e.target.value)} style={styles.rangeInput} />
        </div>
        <input style={{ ...styles.searchInput, minWidth: 140 }} placeholder={t("browse.locationPlaceholder")} value={location} onChange={e => setLocation(e.target.value)} />
        <select style={styles.selectInput} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">{t("browse.sortNewest")}</option>
          <option value="priceLow">{t("browse.sortPriceLow")}</option>
          <option value="priceHigh">{t("browse.sortPriceHigh")}</option>
        </select>
        <div style={styles.viewToggle}>
          <button style={{ ...styles.viewToggleBtn, ...(mode === "grid" ? styles.viewToggleBtnActive : {}) }} onClick={() => setMode("grid")}>⊞ Grid</button>
          <button style={{ ...styles.viewToggleBtn, ...(mode === "map" ? styles.viewToggleBtnActive : {}) }} onClick={() => setMode("map")}>📍 Map</button>
        </div>
        {currentUser && (
          <button
            style={styles.saveSearchBtn}
            onClick={() => onSaveSearch({ label: search || make !== "all" ? `${make !== "all" ? make + " " : ""}${search}`.trim() || "Saved search" : "Saved search", search, make: make === "all" ? "" : make, max_price: maxPrice, max_mileage: maxMileage, location_text: location })}
          >
            🔔 Save this search
          </button>
        )}
      </div>

      {mode === "map" ? (
        <ListingsMap listings={filtered} />
      ) : (
        <div style={styles.grid} className="app-grid">
          {filtered.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🚗</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{t("browse.noMatch")}</div>
              <div style={{ fontSize: 14 }}>{t("browse.widenSearch")}</div>
            </div>
          )}
          {filtered.map(l => {
            const myRef = currentUser ? referrals.find(r => r.listing_id === l.id && r.promoter_id === currentUser.id) : null;
            const seller = users.find(u => u.id === l.seller_id);
            const comparablePrices = avgByModel[`${l.make}|${l.model}`] || [];
            const avgPrice = comparablePrices.length > 1 ? comparablePrices.reduce((s, p) => s + p, 0) / comparablePrices.length : null;
            const otherComparableCount = Math.max(0, comparablePrices.length - 1); // exclude this listing itself
            const sellerReviews = reviews?.filter(r => r.seller_id === l.seller_id) || [];
            const sellerRating = sellerReviews.length ? sellerReviews.reduce((s, r) => s + r.rating, 0) / sellerReviews.length : null;
            const myOffer = currentUser ? offers?.find(o => o.listing_id === l.id && o.buyer_id === currentUser.id && o.status !== "withdrawn" && o.status !== "declined") : null;
            return (
              <CarCard
                key={l.id}
                listing={l}
                seller={seller}
                avgPrice={avgPrice}
                similarCount={otherComparableCount}
                onSeeSimilar={() => seeSimilar(l)}
                currentUser={currentUser}
                onShare={onShare}
                onBuy={onBuy}
                myRef={myRef}
                onSignIn={onSignIn}
                onMessageSeller={onMessageSeller}
                onReport={onReport}
                isFavorited={favorites?.some(f => f.listing_id === l.id)}
                onToggleFavorite={onToggleFavorite}
                isBlocked={blocks?.some(b => b.blocked_id === l.seller_id)}
                onToggleBlock={onToggleBlock}
                onReportUser={onReportUser}
                sellerRating={sellerRating}
                sellerReviewCount={sellerReviews.length}
                myOffer={myOffer}
                onMakeOffer={onMakeOffer}
                onOpenListing={() => onOpenListing({ listing: l, seller, myRef, sellerRating, sellerReviewCount: sellerReviews.length, myOffer })}
                isComparing={compareIds.includes(l.id)}
                onToggleCompare={toggleCompare}
                compareDisabled={compareIds.length >= MAX_COMPARE}
              />
            );
          })}
        </div>
      )}

      {compareIds.length > 0 && (
        <div style={styles.compareBar} className="app-compare-bar">
          <div style={styles.compareBarInner}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, overflowX: "auto" }}>
              {compareIds.map(id => {
                const l = listings.find(x => x.id === id) || allListings.find(x => x.id === id);
                if (!l) return null;
                const cover = (l.images && l.images[0]) || l.image;
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <img src={cover} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 6 }} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=100&q=60"; }} />
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", color: "#0f172a" }}>{l.year} {l.make} {l.model}</span>
                    <button type="button" style={styles.compareBarRemove} onClick={() => toggleCompare(id)}>✕</button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              style={{ ...styles.confirmBtn, opacity: compareIds.length >= 2 ? 1 : 0.5, whiteSpace: "nowrap" }}
              onClick={() => setShowCompare(true)}
              disabled={compareIds.length < 2}
            >
              ⚖️ Compare ({compareIds.length})
            </button>
            <button type="button" style={styles.compareBarClear} onClick={() => setCompareIds([])}>{t("browse.clear")}</button>
          </div>
        </div>
      )}

      {showCompare && (
        <CompareModal
          listings={compareIds.map(id => listings.find(x => x.id === id) || allListings.find(x => x.id === id)).filter(Boolean)}
          users={users}
          onRemove={(id) => { toggleCompare(id); if (compareIds.length <= 2) setShowCompare(false); }}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

function CarCard({ listing, seller, avgPrice, similarCount, onSeeSimilar, currentUser, onShare, onBuy, myRef, onSignIn, onMessageSeller, onReport, isFavorited, onToggleFavorite, isBlocked, onToggleBlock, onReportUser, sellerRating, sellerReviewCount, myOffer, onMakeOffer, onOpenListing, isComparing, onToggleCompare, compareDisabled }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportingUser, setReportingUser] = useState(false);
  const [offering, setOffering] = useState(false);
  const handleShare = async () => {
    const code = await onShare(listing.id);
    if (!code) return; // blocked (own listing) or failed — onShare already explained why
    const result = await shareOrCopy(promoterUrl(code), `${listing.year} ${listing.make} ${listing.model} on DriveLink`);
    if (result === "cancelled" || result === "failed") return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  const cover = (listing.images && listing.images[0]) || listing.image;
  const isOwnListing = currentUser && listing.seller_id === currentUser.id;

  let priceCompare = null;
  if (avgPrice) {
    const diffPct = Math.round(((listing.price - avgPrice) / avgPrice) * 100);
    if (Math.abs(diffPct) >= 3) {
      priceCompare = diffPct < 0
        ? { text: `${Math.abs(diffPct)}% below similar listings (avg ${fmt(Math.round(avgPrice))})`, good: true }
        : { text: `${diffPct}% above similar listings (avg ${fmt(Math.round(avgPrice))})`, good: false };
    }
  }

  const isStale = listing.status === "active" && listing.last_active_at && (Date.now() - new Date(listing.last_active_at).getTime()) > STALE_WARN_DAYS_MS;

  return (
    <div style={styles.card} className="car-card">
      <div style={{ ...styles.cardImgWrap, cursor: onOpenListing ? "pointer" : "default" }} onClick={() => onOpenListing?.()}>
        <img src={cover} alt={`${listing.make} ${listing.model}`} style={styles.cardImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&q=80"; }} />
        <div style={styles.cardPrice}>{fmt(listing.price)}</div>
        {listing.status === "pending" && <div style={styles.pendingRibbon}>{t("card.salePending")}</div>}
        {isStale && <div style={{ ...styles.pendingRibbon, background: "#6b7280", top: listing.status === "pending" ? 40 : 12 }}>{t("card.sellerInactive")}</div>}
        {onToggleFavorite && (
          <button
            type="button"
            style={styles.favoriteBtn}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(listing.id); }}
            title={isFavorited ? "Remove from saved cars" : "Save this car"}
          >
            {isFavorited ? "❤️" : "🤍"}
          </button>
        )}
      </div>
      <div style={styles.cardBody}>
        <div style={styles.cardTitleRow}>
          <div style={{ ...styles.cardTitle, cursor: onOpenListing ? "pointer" : "default" }} onClick={() => onOpenListing?.()}>{listing.year} {listing.make} {listing.model}</div>
          {seller?.verified && <span style={styles.verifiedBadge} title={t("card.verifiedTitle")}>✓ {t("card.verified")}</span>}
          {!seller?.verified && listing.price >= HIGH_VALUE_LISTING_THRESHOLD && <span style={styles.unverifiedBadge} title={t("card.unverifiedTitle")}>🔒 {t("card.unverifiedSeller")}</span>}
          {sellerRating != null && <span style={styles.ratingBadge} title={`${sellerReviewCount} review${sellerReviewCount === 1 ? "" : "s"}`}>⭐ {sellerRating.toFixed(1)} ({sellerReviewCount})</span>}
        </div>
        <div style={styles.cardMeta}>
          <span>🛣 {listing.mileage?.toLocaleString()} {t("card.mi")}</span>
          <span>🎨 {listing.color}</span>
          {listing.location_text && <span>📍 {listing.location_text}</span>}
        </div>
        {priceCompare && (
          <div style={{ ...styles.priceCompare, color: priceCompare.good ? "#15803d" : "#b45309", background: priceCompare.good ? "#f0fdf4" : "#fffbeb" }}>
            {priceCompare.good ? "▼" : "▲"} {priceCompare.text}
          </div>
        )}
        {similarCount > 0 && onSeeSimilar && (
          <button type="button" style={styles.similarLink} onClick={onSeeSimilar}>
            🔍 See {similarCount} similar {listing.make} {listing.model} listing{similarCount === 1 ? "" : "s"} →
          </button>
        )}
        {onToggleCompare && (
          <button
            type="button"
            style={{ ...styles.compareToggleBtn, ...(isComparing ? styles.compareToggleBtnActive : {}) }}
            onClick={(e) => { e.stopPropagation(); onToggleCompare(listing.id); }}
            disabled={!isComparing && compareDisabled}
            title={!isComparing && compareDisabled ? "Remove a car to compare a different one (max 3)" : undefined}
          >
            {isComparing ? "✓ Comparing" : "⚖️ Add to Compare"}
          </button>
        )}
        <p style={styles.cardDesc}>{listing.description}</p>
        {listing.vin && (
          <div style={styles.vinRow}>
            VIN: {listing.vin} {listing.vin_verified && <span style={styles.verifiedBadge} title="VIN was decoded and matches the make/model/year on this listing">✓ VIN Verified</span>} · <a href="https://www.carfax.com/vehicle-history-reports/" target="_blank" rel="noreferrer noopener" style={styles.vinLink}>{t("detail.carfax")} →</a> · <a href="https://www.nicb.org/vincheck" target="_blank" rel="noreferrer noopener" style={styles.vinLink}>{t("detail.nicb")} →</a>
          </div>
        )}
        {myRef && <div style={styles.refTag}>{myRef.status === "paid" ? `✅ Commission paid: ${fmt(myRef.commission_amount)}` : "🔗 Your Promoter link is live — you'll earn 1% if this sells through it"}</div>}
        <div style={styles.cardActions}>
          {currentUser && !isOwnListing && (
            <button style={styles.buyBtn} onClick={() => onBuy(listing)}>💳 {t("action.buyNow")}</button>
          )}
          {currentUser && !isOwnListing && (
            <button style={{ ...styles.shareBtn, background: copied ? "#16a34a" : "#1d4ed8" }} onClick={handleShare}>
              {copied ? "✓ " + t("card.linkCopied") : myRef ? t("card.shareAgain") : t("card.shareEarn")}
            </button>
          )}
          {!currentUser && (
            <button style={styles.buyBtn} onClick={onSignIn}>{t("action.signInToBuy")}</button>
          )}
        </div>
        {currentUser && !isOwnListing && onMakeOffer && (
          myOffer ? (
            <div style={styles.offerStatusRow}>
              {myOffer.status === "pending" && <span>💰 {t("card.offerPending", { amount: fmt(myOffer.amount) })}</span>}
              {myOffer.status === "countered" && <span>💰 {t("card.offerCountered", { amount: fmt(myOffer.counter_amount) })}</span>}
              {myOffer.status === "accepted" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span>✅ {t("card.offerAccepted", { amount: fmt(myOffer.amount) })}</span>
                  <button style={styles.buyBtn} onClick={() => onBuy(listing)}>{t("card.completePurchase")} — {fmt(myOffer.amount)}</button>
                </div>
              )}
              {myOffer.status === "declined" && <span>{t("card.offerDeclined")}</span>}
              {myOffer.status === "withdrawn" && <span>{t("card.offerWithdrawn")}</span>}
            </div>
          ) : (
            <button style={styles.offerBtn} onClick={() => setOffering(true)}>💰 {t("card.makeOffer")}</button>
          )
        )}
        {currentUser && !isOwnListing && (
          <div style={styles.cardSecondaryActions}>
            <button style={styles.messageLink} onClick={() => onMessageSeller(listing)}>💬 {t("card.messageSeller")}</button>
            <button style={styles.reportLink} onClick={() => setReporting(true)}>🚩 {t("card.report")}</button>
            {onToggleBlock && (
              <button style={styles.reportLink} onClick={() => onToggleBlock(listing.seller_id)}>
                {isBlocked ? "✅ " + t("card.unblockSeller") : "🚫 " + t("card.blockSeller")}
              </button>
            )}
            {onReportUser && (
              <button style={styles.reportLink} onClick={() => setReportingUser(true)}>⚠️ {t("card.reportSeller")}</button>
            )}
          </div>
        )}
      </div>
      {offering && (
        <OfferModal
          listing={listing}
          onCancel={() => setOffering(false)}
          onSubmit={(amount, message) => { onMakeOffer(listing.id, listing.seller_id, amount, message); setOffering(false); }}
        />
      )}
      {reporting && (
        <ReportModal
          onCancel={() => setReporting(false)}
          onSubmit={(reason, details) => { onReport(listing.id, reason, details); setReporting(false); }}
        />
      )}
      {reportingUser && (
        <ReportUserModal
          onCancel={() => setReportingUser(false)}
          onSubmit={(reason, details) => { onReportUser(listing.seller_id, reason, details); setReportingUser(false); }}
        />
      )}
    </div>
  );
}

// ── Side-by-side comparison table for up to 3 listings a user has flagged
// with "Add to Compare" on the Browse grid. Highlights the better value in
// green for purely numeric fields (lowest price, lowest mileage) — doesn't
// try to score subjective fields like color or description.
function CompareModal({ listings, users, onRemove, onClose }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modalBox, maxWidth: 900, width: "95%", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={styles.modalTitle}>Compare Cars</h3>
          <button type="button" onClick={onClose} style={styles.compareCloseBtn} aria-label={t("detail.close")}>✕</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.compareTable}>
            <thead>
              <tr>
                <th style={styles.compareTableHeaderCell}></th>
                {listings.map(l => {
                  const cover = (l.images && l.images[0]) || l.image;
                  return (
                    <th key={l.id} style={styles.compareTableHeaderCell}>
                      <img src={cover} alt={`${l.make} ${l.model}`} style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 10, marginBottom: 8 }} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{l.year} {l.make} {l.model}</div>
                      <button type="button" style={{ ...styles.compareBarRemove, marginTop: 6 }} onClick={() => onRemove(l.id)}>Remove</button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Price" values={listings.map(l => fmt(l.price))} rankBy={listings.map(l => l.price)} lowerIsBetter />
              <CompareRow label="Mileage" values={listings.map(l => `${l.mileage?.toLocaleString() || "—"} mi`)} rankBy={listings.map(l => l.mileage || 0)} lowerIsBetter />
              <CompareRow label="Year" values={listings.map(l => l.year || "—")} />
              <CompareRow label="Color" values={listings.map(l => l.color || "—")} />
              <CompareRow label="Location" values={listings.map(l => l.location_text || "—")} />
              <CompareRow label="Seller" values={listings.map(l => users.find(u => u.id === l.seller_id)?.name || "—")} />
              <CompareRow label="VIN Verified" values={listings.map(l => l.vin_verified ? "✓ Yes" : "—")} />
              <CompareRow label="Description" values={listings.map(l => l.description || "—")} wrap />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompareRow({ label, values, rankBy, lowerIsBetter, wrap }) {
  let bestIdx = -1;
  if (rankBy && rankBy.length > 1 && rankBy.every(v => typeof v === "number" && !isNaN(v))) {
    const target = lowerIsBetter ? Math.min(...rankBy) : Math.max(...rankBy);
    // Only highlight if values actually differ — no point marking a "winner" in a tie.
    if (new Set(rankBy).size > 1) bestIdx = rankBy.indexOf(target);
  }
  return (
    <tr>
      <td style={styles.compareTableLabelCell}>{label}</td>
      {values.map((v, i) => (
        <td key={i} style={{ ...styles.compareTableCell, ...(i === bestIdx ? styles.compareTableCellBest : {}), ...(wrap ? { whiteSpace: "normal", maxWidth: 220 } : {}) }}>{v}</td>
      ))}
    </tr>
  );
}

function ListingDetailModal({ data, currentUser, isFavorited, isBlocked, onClose, onBuy, onBuyWire, wireLoading, onShare, onMessageSeller, onReport, onReportUser, onToggleFavorite, onToggleBlock, onMakeOffer, onSignIn, onCheckDeal, onTranslate }) {
  const { t } = useLang();
  const { listing, seller, myRef, sellerRating, sellerReviewCount, myOffer } = data;
  const [activeImg, setActiveImg] = useState(0);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [offering, setOffering] = useState(false);

  const images = (listing.images && listing.images.length ? listing.images : [listing.image]).filter(Boolean);
  const isOwnListing = currentUser && listing.seller_id === currentUser.id;
  // Treat an unknown/missing seller record as "fine" so this can never hide
  // checkout on a legitimate listing — only an explicit false gates it.
  const payoutsReady = seller?.stripe_payouts_enabled !== false;

  const handleShare = async () => {
    const code = await onShare(listing.id);
    if (!code) return; // blocked (own listing) or failed — onShare already explained why
    const result = await shareOrCopy(promoterUrl(code), `${listing.year} ${listing.make} ${listing.model} on DriveLink`);
    if (result === "cancelled" || result === "failed") return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.detailBox} onClick={e => e.stopPropagation()}>
        <button style={styles.detailCloseBtn} onClick={onClose} aria-label={t("detail.close")}>✕</button>

        <div style={styles.detailGalleryWrap}>
          <img src={images[activeImg]} alt={`${listing.make} ${listing.model}`} style={styles.detailMainImg}
            onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=900&q=80"; }} />
          {images.length > 1 && (
            <>
              <button style={{ ...styles.detailGalleryNav, left: 12 }} onClick={() => setActiveImg(i => (i - 1 + images.length) % images.length)}>‹</button>
              <button style={{ ...styles.detailGalleryNav, right: 12 }} onClick={() => setActiveImg(i => (i + 1) % images.length)}>›</button>
              <div style={styles.detailGalleryCount}>{activeImg + 1} / {images.length}</div>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div style={styles.detailThumbRow}>
            {images.map((url, i) => (
              <img key={i} src={url} alt="" style={{ ...styles.detailThumb, outline: i === activeImg ? "2px solid #0f172a" : "2px solid transparent" }} onClick={() => setActiveImg(i)} />
            ))}
          </div>
        )}

        <div style={styles.detailBody}>
          <div style={styles.cardTitleRow}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{listing.year} {listing.make} {listing.model}</div>
            {seller?.verified && <span style={styles.verifiedBadge} title={t("card.verifiedTitle")}>✓ {t("card.verified")}</span>}
            {!seller?.verified && listing.price >= HIGH_VALUE_LISTING_THRESHOLD && <span style={styles.unverifiedBadge} title={t("card.unverifiedTitle")}>🔒 {t("card.unverifiedSeller")}</span>}
            {sellerRating != null && <span style={styles.ratingBadge}>⭐ {sellerRating.toFixed(1)} ({sellerReviewCount})</span>}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "6px 0 14px" }}>{fmt(listing.price)}</div>

          {/* Escrow reassurance, shown right where the money question forms.
              Only shows the "pending" variant when we positively know payouts
              are off — an unknown seller record behaves as before. */}
          {payoutsReady ? (
            <div style={styles.escrowBox}>
              <div style={styles.escrowBoxTitle}>{t("escrow.title")}</div>
              <div style={styles.escrowBoxText}>
                {t("escrow.body")}
                {/* Only asserted when the seller actually completed Stripe
                    Identity. Note this is NOT payoutsReady — that is Connect
                    onboarding, a different Stripe product. A seller can take
                    payment without ever having verified an ID document. */}
                {seller?.verified ? ` ${t("escrow.idVerified")}` : ""}
              </div>
            </div>
          ) : (
            <div style={styles.escrowBoxPending}>
              <div style={styles.escrowBoxTitle}>{t("escrow.notReady.title")}</div>
              <div style={styles.escrowBoxText}>
                {t("detail.payoutsPending")}
              </div>
            </div>
          )}

          <div style={styles.cardMeta}>
            <span>🛣 {listing.mileage?.toLocaleString()} {t("card.mi")}</span>
            <span>🎨 {listing.color}</span>
            {listing.location_text && <span>📍 {listing.location_text}</span>}
            {seller?.name && <span>👤 {t("detail.soldBy")} {seller.name}</span>}
          </div>

          {listing.description && (
            <TranslatableDescription
              listing={listing}
              onTranslate={onTranslate}
            />
          )}

          {listing.vin && (
            <div style={styles.vinRow}>
              VIN: {listing.vin} {listing.vin_verified && <span style={styles.verifiedBadge}>✓ {t("detail.vinVerified")}</span>} · <a href="https://www.carfax.com/vehicle-history-reports/" target="_blank" rel="noreferrer noopener" style={styles.vinLink}>{t("detail.carfax")} →</a> · <a href="https://www.nicb.org/vincheck" target="_blank" rel="noreferrer noopener" style={styles.vinLink}>{t("detail.nicb")} →</a>
            </div>
          )}

          {myRef && <div style={styles.refTag}>{myRef.status === "paid" ? `✅ Commission paid: ${fmt(myRef.commission_amount)}` : "🔗 Your Promoter link is live — you'll earn 1% if this sells through it"}</div>}

          <div style={styles.cardActions}>
            {currentUser && !isOwnListing && payoutsReady && <button style={styles.buyBtn} onClick={() => onBuy(listing)}>💳 {t("action.buyNow")}</button>}
            {currentUser && !isOwnListing && payoutsReady && onBuyWire && listing.price >= WIRE_MIN_CENTS && (
              <button
                style={{ ...styles.buyBtn, background: "#0f172a" }}
                disabled={wireLoading}
                onClick={() => onBuyWire(listing)}
                title="Pay via domestic wire transfer instead of card — available on purchases of $15,000 or more"
              >
                🏦 {wireLoading ? "Starting…" : "Pay by wire transfer"}
              </button>
            )}
            {currentUser && !isOwnListing && (
              <button style={{ ...styles.shareBtn, background: copied ? "#16a34a" : "#1d4ed8" }} onClick={handleShare}>
                {copied ? "✓ " + t("card.linkCopied") : myRef ? t("card.shareAgain") : t("card.shareEarn")}
              </button>
            )}
            {!currentUser && <button style={styles.buyBtn} onClick={onSignIn}>{t("action.signInToBuy")}</button>}
            {/* Plain link to this car, no commission attached. Only shown when
                the Promoter button isn't available — sellers on their own listing,
                and signed-out visitors — so there's never more than one share
                button competing for the same tap. */}
            {(isOwnListing || !currentUser) && (
              <button
                style={{ ...styles.shareBtn, background: linkCopied ? "#16a34a" : "#475569" }}
                onClick={async () => {
                  const result = await shareOrCopy(listingUrl(listing.id), `${listing.year} ${listing.make} ${listing.model} on DriveLink`);
                  if (result === "cancelled" || result === "failed") return;
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 2500);
                }}
              >
                {linkCopied ? "✓ " + t("card.linkCopied") : "🔗 " + t("detail.copyLink")}
              </button>
            )}
          </div>

          {currentUser && !isOwnListing && onMakeOffer && (
            myOffer ? (
              <div style={styles.offerStatusRow}>
                {myOffer.status === "pending" && <span>💰 {t("card.offerPending", { amount: fmt(myOffer.amount) })}</span>}
                {myOffer.status === "countered" && <span>💰 {t("card.offerCountered", { amount: fmt(myOffer.counter_amount) })}</span>}
                {myOffer.status === "accepted" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span>✅ {t("card.offerAcceptedShort")}</span>
                    {payoutsReady
                      ? <button style={styles.buyBtn} onClick={() => onBuy(listing)}>{t("card.completePurchase")} — {fmt(myOffer.amount)}</button>
                      : <span style={{ fontSize: 12, color: "#b45309" }}>{t("card.awaitingPayouts")}</span>}
                  </div>
                )}
              </div>
            ) : (
              <button style={styles.offerBtn} onClick={() => setOffering(true)}>💰 {t("card.makeOffer")}</button>
            )
          )}

          <DealCheckButton listing={listing} onCheckDeal={onCheckDeal} />

          {currentUser && !isOwnListing && (
            <div style={styles.cardSecondaryActions}>
              <button style={styles.messageLink} onClick={() => onMessageSeller(listing)}>💬 {t("card.messageSeller")}</button>
              <button style={styles.reportLink} onClick={() => setReporting(true)}>🚩 {t("card.report")}</button>
              {onToggleBlock && (
                <button style={styles.reportLink} onClick={() => onToggleBlock(listing.seller_id)}>
                  {isBlocked ? "✅ " + t("card.unblockSeller") : "🚫 " + t("card.blockSeller")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {offering && (
        <OfferModal
          listing={listing}
          onCancel={() => setOffering(false)}
          onSubmit={(amount, message) => { onMakeOffer(listing.id, listing.seller_id, amount, message); setOffering(false); }}
        />
      )}
      {reporting && (
        <ReportModal
          onCancel={() => setReporting(false)}
          onSubmit={(reason, details) => { onReport(listing.id, reason, details); setReporting(false); }}
        />
      )}
    </div>
  );
}

// ── AI Price Check button/panel. Calls the assess-deal Edge Function (which
// compares against other DriveLink listings for free, or falls back to real
// web search when there isn't enough internal data) and shows the cached
// result once available. Result is cached server-side per listing, so this
// only makes a real call the first time (or after cache expiry).
// ── Translatable description ────────────────────────────────────────────────
// Shows the seller's own words by default and offers a translation on request.
// The original is one click away at all times and is never overwritten: this
// is a car sale, and a buyer must be able to read the condition disclosure
// exactly as the seller wrote it.
//
// The button only appears when the interface language differs from the site's
// default authoring language — a Spanish reader sees "Traducir al español", an
// English reader on a Spanish-written listing sees "Translate to English".
// There is no language detection on the text itself: guessing wrong hides the
// button on a listing that needed it, which is worse than showing an
// occasionally redundant one.
function TranslatableDescription({ listing, onTranslate }) {
  const { t, lang } = useLang();
  const [translated, setTranslated] = useState(null);
  const [showing, setShowing] = useState(false);
  const [loading, setLoading] = useState(false);

  // Only offer a translation when the seller wrote in a different language.
  // Listings created before description_lang existed are treated as English,
  // which is accurate — the Spanish interface shipped with no Spanish sellers.
  const sourceLang = listing.description_lang || "en";
  const canTranslate = Boolean(onTranslate) && sourceLang !== lang;

  const run = async () => {
    if (translated) { setShowing(true); return; }
    if (!onTranslate) return;
    setLoading(true);
    const result = await onTranslate(listing.id, lang);
    setLoading(false);
    if (!result || result.nothingToTranslate) return;
    setTranslated(result.description || "");
    setShowing(true);
  };

  const body = showing && translated ? translated : listing.description;

  return (
    <div style={{ marginTop: 12 }}>
      <p style={styles.cardDesc}>{body}</p>
      {showing && translated && (
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>{t("translate.notice")}</div>
      )}
      {onTranslate && canTranslate && (
        <button
          type="button"
          style={styles.translateLink}
          onClick={() => (showing ? setShowing(false) : run())}
          disabled={loading}
        >
          {loading
            ? t("translate.working")
            : showing
              ? t("translate.showOriginal")
              : lang === "es"
                ? t("translate.toSpanish")
                : t("translate.toEnglish")}
        </button>
      )}
    </div>
  );
}

function DealCheckButton({ listing, onCheckDeal }) {
  const { t } = useLang();
  const [loading, setLoading] = useState(false);
  const [assessment, setAssessment] = useState(listing.deal_assessment || null);

  // Cars only, deliberately. assess-deal compares against Auto.dev comparables,
  // which is car data — on a motorcycle it returns nothing useful or, worse,
  // something confidently wrong. A price verdict that is wrong is more damaging
  // than no verdict on a platform whose entire pitch is trust, so powersports
  // listings get no button rather than a bad number.
  if ((listing.vehicle_type || "car") !== "car") return null;

  const run = async () => {
    setLoading(true);
    const result = await onCheckDeal(listing.id);
    if (result) setAssessment(result);
    setLoading(false);
  };

  const styleFor = {
    great_deal: { bg: "#dcfce7", color: "#15803d", label: `🟢 ${t("deal.greatDeal")}` },
    fair_price: { bg: "#fef9c3", color: "#854d0e", label: `🟡 ${t("deal.fairPrice")}` },
    above_market: { bg: "#fee2e2", color: "#b91c1c", label: `🔴 ${t("deal.aboveMarket")}` },
    not_enough_data: { bg: "#f1f5f9", color: "#6b7280", label: `⚪ ${t("deal.notEnoughData")}` },
  };

  if (!assessment) {
    return (
      <button type="button" style={styles.dealCheckBtn} onClick={run} disabled={loading}>
        {loading ? t("deal.checking") : `🤖 ${t("deal.check")}`}
      </button>
    );
  }

  const s = styleFor[assessment.rating] || styleFor.fair_price;
  const sourceLabel = assessment.source === "web_search"
    ? t("deal.liveResearch")
    : assessment.comparable_count > 0
      ? (assessment.comparable_count === 1
          ? t("deal.basedOnOne")
          : t("deal.basedOn", { count: assessment.comparable_count }))
      : null;

  return (
    <div style={{ ...styles.dealCheckPanel, background: s.bg }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.label}</div>
      <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>{assessment.summary}</div>
      {assessment.estimated_market_range && (
        <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{t("deal.marketRange")}: {assessment.estimated_market_range}</div>
      )}
      {sourceLabel && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{sourceLabel}</div>}
      <button type="button" style={styles.dealCheckRefresh} onClick={run} disabled={loading}>
        {loading ? "Refreshing…" : "↻ Re-check"}
      </button>
    </div>
  );
}

function ReportModal({ onCancel, onSubmit }) {
  const { t } = useLang();
  const [reason, setReason] = useState("Misleading listing");
  const [details, setDetails] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>{t("report.listingTitle")}</h3>
        <label style={styles.fieldLabel}>{t("report.reason")}</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option value="Misleading listing">{t("report.r.misleading")}</option>
          <option value="Suspected scam">{t("report.r.scam")}</option>
          <option value="Wrong price / bait and switch">{t("report.r.bait")}</option>
          <option value="Car already sold elsewhere">{t("report.r.soldElsewhere")}</option>
          <option value="Inappropriate content">{t("report.r.inappropriate")}</option>
          <option value="Other">{t("common.other")}</option>
        </select>
        <label style={styles.fieldLabel}>{t("report.details")}</label>
        <textarea style={styles.textarea} rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder={t("report.detailsPlaceholder")} />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details)}>{t("report.submit")}</button>
        </div>
      </div>
    </div>
  );
}

function ReportUserModal({ onCancel, onSubmit }) {
  const { t } = useLang();
  const [reason, setReason] = useState("Suspicious / scam behavior");
  const [details, setDetails] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>{t("report.userTitle")}</h3>
        <label style={styles.fieldLabel}>{t("report.reason")}</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option value="Suspicious / scam behavior">{t("report.u.suspicious")}</option>
          <option value="Harassment or abusive messages">{t("report.u.harassment")}</option>
          <option value="Never showed up / wasted my time">{t("report.u.noShow")}</option>
          <option value="Asked to pay outside the platform">{t("report.u.offPlatform")}</option>
          <option value="Other">{t("common.other")}</option>
        </select>
        <label style={styles.fieldLabel}>{t("report.details")}</label>
        <textarea style={styles.textarea} rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder={t("report.detailsPlaceholder")} />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details)}>{t("report.submit")}</button>
        </div>
      </div>
    </div>
  );
}

function SavedSearchesView({ savedSearches, onDelete, onBrowse }) {
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Saved Searches</h2>
      {savedSearches.length === 0 && <p style={{ color: "#6b7280" }}>No saved searches yet. Browse listings and use "Save this search" to get notified about new matches next time you visit.</p>}
      <div style={styles.tableWrap}>
        {savedSearches.map(s => (
          <div key={s.id} style={styles.listingRow} className="app-listing-row">
            <div style={styles.rowInfo} className="app-row-info">
              <div style={styles.rowTitle}>{s.label || "Saved search"}</div>
              <div style={styles.rowMeta}>
                {[s.make, s.search, s.max_price ? `under ${fmt(s.max_price)}` : null, s.max_mileage ? `under ${s.max_mileage.toLocaleString()} mi` : null, s.location_text].filter(Boolean).join(" • ") || "All listings"}
              </div>
            </div>
            <button style={styles.removeBtn} onClick={() => onDelete(s.id)}>Remove</button>
          </div>
        ))}
      </div>
      <div style={styles.infoBox}>New matching listings are highlighted for you automatically when you revisit Browse.</div>
      <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
    </div>
  );
}

function FavoritesView({ favorites, listings, users, referrals, currentUser, onShare, onBuy, onMessageSeller, onReport, onToggleFavorite, onBrowse, onOpenListing }) {
  const { t } = useLang();
  const favoritedListings = favorites
    .map(f => listings.find(l => l.id === f.listing_id))
    .filter(Boolean);

  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const MAX_COMPARE = 3;

  const toggleCompare = (listingId) => {
    setCompareIds(prev => {
      if (prev.includes(listingId)) return prev.filter(id => id !== listingId);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, listingId];
    });
  };

  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>❤️ Saved Cars</h2>
      {favoritedListings.length === 0 ? (
        <>
          <p style={{ color: "#6b7280" }}>No saved cars yet. Tap the heart on any listing to add it here.</p>
          <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
        </>
      ) : (
        <div style={styles.grid} className="app-grid">
          {favoritedListings.map(l => {
            const myRef = currentUser ? referrals.find(r => r.listing_id === l.id && r.promoter_id === currentUser.id) : null;
            const seller = users.find(u => u.id === l.seller_id);
            return (
              <CarCard
                key={l.id}
                listing={l}
                seller={seller}
                avgPrice={null}
                currentUser={currentUser}
                onShare={onShare}
                onBuy={onBuy}
                myRef={myRef}
                onSignIn={() => {}}
                onMessageSeller={onMessageSeller}
                onReport={onReport}
                isFavorited={true}
                onToggleFavorite={onToggleFavorite}
                onOpenListing={() => onOpenListing({ listing: l, seller, myRef, sellerRating: null, sellerReviewCount: 0, myOffer: null })}
                isComparing={compareIds.includes(l.id)}
                onToggleCompare={toggleCompare}
                compareDisabled={compareIds.length >= MAX_COMPARE}
              />
            );
          })}
        </div>
      )}

      {compareIds.length > 0 && (
        <div style={styles.compareBar} className="app-compare-bar">
          <div style={styles.compareBarInner}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flex: 1, overflowX: "auto" }}>
              {compareIds.map(id => {
                const l = favoritedListings.find(x => x.id === id);
                if (!l) return null;
                const cover = (l.images && l.images[0]) || l.image;
                return (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <img src={cover} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 6 }} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=100&q=60"; }} />
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", color: "#0f172a" }}>{l.year} {l.make} {l.model}</span>
                    <button type="button" style={styles.compareBarRemove} onClick={() => toggleCompare(id)}>✕</button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              style={{ ...styles.confirmBtn, opacity: compareIds.length >= 2 ? 1 : 0.5, whiteSpace: "nowrap" }}
              onClick={() => setShowCompare(true)}
              disabled={compareIds.length < 2}
            >
              ⚖️ Compare ({compareIds.length})
            </button>
            <button type="button" style={styles.compareBarClear} onClick={() => setCompareIds([])}>{t("browse.clear")}</button>
          </div>
        </div>
      )}

      {showCompare && (
        <CompareModal
          listings={compareIds.map(id => favoritedListings.find(x => x.id === id)).filter(Boolean)}
          users={users}
          onRemove={(id) => { toggleCompare(id); if (compareIds.length <= 2) setShowCompare(false); }}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

function BlockedUsersView({ blocks, users, onToggleBlock, onBrowse }) {
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>🚫 Blocked Users</h2>
      {blocks.length === 0 && <p style={{ color: "#6b7280" }}>You haven't blocked anyone. Blocked sellers' listings are hidden from your browse view and they can't message you.</p>}
      <div style={styles.tableWrap}>
        {blocks.map(b => {
          const user = users.find(u => u.id === b.blocked_id);
          return (
            <div key={b.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.avatar}>{(user?.name || "?")[0]?.toUpperCase()}</div>
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{user?.name || "Unknown user"}</div>
                <div style={styles.rowMeta}>{user?.email}</div>
              </div>
              <button style={styles.removeBtn} onClick={() => onToggleBlock(b.blocked_id)}>Unblock</button>
            </div>
          );
        })}
      </div>
      <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
    </div>
  );
}

// Seller-side 6-digit entry. Local state only — the code is never stored on the
// seller's side, and a wrong entry is answered by the server, not guessed at
// here. Server enforces 5 attempts then a 60-minute lockout; this component
// deliberately does no client-side attempt counting, because a counter the
// browser owns is a counter the browser can reset.
function HandoverCodeEntry({ listingId, onSubmit }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (code.replace(/\D/g, "").length !== 6 || busy) return;
    setBusy(true);
    const ok = await onSubmit(listingId, code.replace(/\D/g, ""));
    setBusy(false);
    if (!ok) setCode("");
  };

  return (
    <div style={{ marginTop: 10, padding: 12, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
        Buyer's handover code
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 1.5 }}>
        Ask for this <strong>after</strong> the buyer has the car and the signed title. Entering it releases your funds immediately.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="off"
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          style={{
            flex: "1 1 140px", padding: "10px 12px", fontSize: 18, letterSpacing: 4,
            fontFamily: "monospace", border: "1px solid #d1d5db", borderRadius: 6, minWidth: 0,
          }}
        />
        <button
          style={{ ...styles.soldBtn, opacity: code.length === 6 && !busy ? 1 : 0.5 }}
          disabled={code.length !== 6 || busy}
          onClick={submit}
        >
          {busy ? "Checking…" : "Release Funds"}
        </button>
      </div>
    </div>
  );
}

function MyListingsView({ listings, referrals, users, offers, stats, onMarkSold, onSetStatus, onUpdate, onRespondToOffer, onRescindOffer, onOpenSafety, onConfirmHandover, currentUser, onSetupPayouts, onDelete, onRestore }) {
  const [editing, setEditing] = useState(null);
  const [markingSold, setMarkingSold] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const hasHandoffPending = listings.some(l => l.status === "pending_confirmation");
  // Deleted listings live in their own collapsed section rather than the main
  // list — a seller scanning their cars shouldn't have to read past ones they
  // removed on purpose.
  const liveListings = listings.filter(l => l.status !== "removed");
  const deletedListings = listings.filter(l => l.status === "removed");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>My Listings</h2>
      {currentUser && !currentUser.stripe_payouts_enabled && (
        <div style={styles.safetyBanner}>
          💳 Set up payouts to get paid automatically when a listing sells.{" "}
          <button style={styles.safetyBannerLink} onClick={onSetupPayouts}>Set up payouts</button>
        </div>
      )}
      {currentUser && currentUser.stripe_payouts_enabled && (
        <div style={{ fontSize: 13, color: "#16a34a", marginBottom: 12 }}>✅ Payouts are set up — funds reach your bank a few business days after a sale is confirmed.</div>
      )}
      {hasHandoffPending && (
        <div style={styles.safetyBanner}>
          🛡️ Meeting a buyer to hand off a car? <button style={styles.safetyBannerLink} onClick={onOpenSafety}>Review our safety tips</button> before you meet.
        </div>
      )}
      {liveListings.length === 0 && deletedListings.length === 0 && <p style={{ color: "#6b7280" }}>You haven't posted any listings yet.</p>}
      <div style={styles.tableWrap}>
        {liveListings.map(l => {
          const ref = referrals.find(r => r.listing_id === l.id);
          const promoter = ref ? users.find(u => u.id === ref.promoter_id) : null;
          const cover = (l.images && l.images[0]) || l.image;
          const listingOffers = (offers || []).filter(o => o.listing_id === l.id && (o.status === "pending" || o.status === "countered"));
          const acceptedOffer = (offers || []).find(o => o.listing_id === l.id && o.status === "accepted");
          const acceptedOfferBuyer = acceptedOffer ? users.find(u => u.id === acceptedOffer.buyer_id) : null;
          return (
            <div key={l.id}>
              <div style={styles.listingRow} className="app-listing-row">
                <img src={cover} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{l.year} {l.make} {l.model}<VehicleTypeBadge vehicleType={l.vehicle_type} /></div>
                  <div style={styles.rowMeta}>{fmt(l.price)} • {l.mileage?.toLocaleString()} mi</div>
                  {/* Interest, for active listings only. On a sold car the
                      numbers are history and just add noise. */}
                  {l.status === "active" && (() => {
                    const s = stats?.[l.id];
                    const views = s?.view_count ?? 0;
                    const saves = s?.favorite_count ?? 0;
                    const recent = s?.views_7d ?? 0;

                    // Below this, a precise number does more harm than good. A
                    // brand-new listing legitimately sitting at 3 views reads as
                    // failure to the person who just spent twenty minutes
                    // photographing their car, and the honest signal at that
                    // point ("too early to tell") is not what "3" communicates.
                    // Admins see the raw number via listing_stats regardless.
                    const MIN_VIEWS_TO_SHOW = 10;

                    if (views < MIN_VIEWS_TO_SHOW) {
                      return (
                        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                          Just listed — not enough activity yet to show numbers. Sharing your link is the fastest way to get eyes on it.
                        </div>
                      );
                    }

                    return (
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <span>👁 {views} view{views === 1 ? "" : "s"}{recent > 0 && views !== recent ? ` (${recent} this week)` : ""}</span>
                        <span>❤️ {saves} save{saves === 1 ? "" : "s"}</span>
                      </div>
                    );
                  })()}
                  {l.status === "sold" && <div style={styles.soldBadge}>SOLD for {fmt(l.sale_price)} on {l.sold_at}</div>}
                  {l.status === "sold" && l.funds_released && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
                      💸 {fmt(l.seller_net)} released to your Stripe account. Card payments take a few business days to settle before Stripe pays out to your bank — expect it within about 5–7 business days of the sale. New accounts can take longer on the first payout.
                    </div>
                  )}
                  {/* ACH in flight. The buyer has committed but the money has not
                      arrived, so there is no handover code and nothing to enter.
                      The one thing that matters on this screen is that the seller
                      does NOT hand over the car yet — say it loudly. */}
                  {l.status === "awaiting_payment" && (
                    <>
                      <div style={{ ...styles.awaitingBadge, background: "#FFF8E7", color: "#7c5000" }}>
                        🏦 Bank transfer started — reserved, but not paid yet
                      </div>
                      <div style={{ fontSize: 13, color: "#7c5000", marginTop: 6, lineHeight: 1.6, padding: "10px 12px", background: "#FFF8E7", borderLeft: "3px solid #FFB020", borderRadius: "0 6px 6px 0" }}>
                        <strong>Don't hand over the vehicle yet.</strong> Bank transfers take about 5 business days to clear. We'll email you the moment this one does, and your listing is reserved for this buyer until then.
                      </div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
                        If the transfer fails, this listing goes back on sale automatically and we'll let you know.
                      </div>
                    </>
                  )}
                  {l.status === "pending_confirmation" && (
                    <>
                      <div style={styles.awaitingBadge}>💳 Payment received for {fmt(l.sale_price)} — enter the buyer's handover code to get paid</div>
                      {/* Set only on bank-funded sales. Without this the seller
                          enters a correct code, gets "held", and has no idea why. */}
                      {l.release_not_before && new Date(l.release_not_before) > new Date() && (
                        <div style={{ fontSize: 13, color: "#7c5000", marginTop: 6, lineHeight: 1.6, padding: "10px 12px", background: "#FFF8E7", borderLeft: "3px solid #FFB020", borderRadius: "0 6px 6px 0" }}>
                          This buyer paid by bank transfer, which has cleared. Bank payments carry a short settlement hold, so funds are released from <strong>{new Date(l.release_not_before).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</strong>. You can hand over the vehicle before then — entering the code just won't pay out until that date.
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
                        The buyer's payment is held safely. Once they have the car and the signed title, ask them for their 6-digit handover code and enter it below — {fmt(l.seller_net)} is released to you immediately. They can also release it themselves from their purchases page. Bank arrival typically takes a few business days after that.
                      </div>
                      <HandoverCodeEntry listingId={l.id} onSubmit={onConfirmHandover} />
                    </>
                  )}
                  {l.status === "disputed" && <div style={{ ...styles.awaitingBadge, background: "#fee2e2", color: "#b91c1c" }}>⚠️ Buyer disputed this sale — our team is reviewing it</div>}
                  {listingOffers.length > 0 && <div style={styles.awaitingBadge}>💰 {listingOffers.length} offer{listingOffers.length === 1 ? "" : "s"} waiting on your response</div>}
                  {acceptedOffer && l.status === "active" && (() => {
                    const deadline = acceptedOffer.payment_deadline ? new Date(acceptedOffer.payment_deadline) : null;
                    const msLeft = deadline ? deadline.getTime() - Date.now() : null;
                    const expired = msLeft !== null && msLeft <= 0;
                    const hoursLeft = msLeft !== null ? Math.max(0, Math.ceil(msLeft / 3600000)) : null;
                    return (
                      <div style={{ ...styles.awaitingBadge, background: expired ? "#fef9c3" : "#dcfce7", color: expired ? "#854d0e" : "#15803d" }}>
                        <div>
                          {expired ? "⏰" : "✅"} Accepted {fmt(acceptedOffer.amount)} from {acceptedOfferBuyer?.name || "buyer"}
                          {expired
                            ? " — they never completed the purchase"
                            : hoursLeft !== null
                              ? ` — ${hoursLeft}h left for them to complete purchase`
                              : " — waiting for them to complete purchase"}
                        </div>
                        <button
                          style={{ ...styles.cancelBtn, marginTop: 8 }}
                          onClick={() => {
                            if (window.confirm(`Cancel your acceptance of ${fmt(acceptedOffer.amount)}? The buyer will be notified and your listing reopens to other offers.`)) {
                              onRescindOffer(acceptedOffer.id);
                            }
                          }}
                        >
                          Cancel acceptance
                        </button>
                      </div>
                    );
                  })()}
                  {promoter && <div style={styles.promoterTag}>Promoted by {promoter.name} {ref.status === "paid" ? `• Commission ${fmt(ref.commission_amount)} paid` : "• Pending"}</div>}
                  {l.status === "active" && l.last_active_at && (Date.now() - new Date(l.last_active_at).getTime()) > STALE_WARN_DAYS_MS && (
                    <div style={{ fontSize: 12, color: "#b45309", fontWeight: 600, marginTop: 4 }}>
                      ⏰ This listing looks inactive to buyers — edit and save it to refresh, or it'll auto-archive after 60 days.
                    </div>
                  )}
                </div>
                <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : l.status === "pending" ? "#fef9c3" : l.status === "awaiting_payment" ? "#FFF8E7" : l.status === "pending_confirmation" ? "#dbeafe" : l.status === "disputed" ? "#fee2e2" : "#fee2e2", color: l.status === "active" ? "#15803d" : l.status === "pending" ? "#854d0e" : l.status === "awaiting_payment" ? "#7c5000" : l.status === "pending_confirmation" ? "#1d4ed8" : l.status === "disputed" ? "#b91c1c" : "#b91c1c" }}>{l.status === "pending_confirmation" ? "awaiting confirmation" : l.status === "awaiting_payment" ? "payment clearing" : l.status}</span>
                {/* awaiting_payment excluded: the price and terms are what a buyer
                    has already committed money against, and guard_listings_settlement_columns
                    would reject the write anyway — better to not offer the button. */}
                {l.status !== "sold" && l.status !== "awaiting_payment" && l.status !== "pending_confirmation" && l.status !== "disputed" && (
                  <button style={styles.pendingBtn} onClick={() => setEditing(l)}>Edit</button>
                )}
                {l.status === "active" && (
                  <>
                    <button style={styles.pendingBtn} onClick={() => onSetStatus(l.id, "pending")}>Mark Pending</button>
                    <button style={styles.soldBtn} onClick={() => setMarkingSold(l)}>Mark Sold</button>
                  </>
                )}
                {l.status === "pending" && (
                  <>
                    <button style={styles.pendingBtn} onClick={() => onSetStatus(l.id, "active")}>Reactivate</button>
                    <button style={styles.soldBtn} onClick={() => setMarkingSold(l)}>Mark Sold</button>
                  </>
                )}
                {(l.status === "active" || l.status === "pending" || l.status === "archived") && (
                  <button
                    style={styles.removeBtn}
                    onClick={() => {
                      if (window.confirm(`Delete your ${l.year} ${l.make} ${l.model} listing?\n\nIt will be taken down and any open offers will be closed. You can restore it from the Deleted section.`)) {
                        onDelete(l.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {listingOffers.map(o => (
                <SellerOfferRow key={o.id} offer={o} buyer={users.find(u => u.id === o.buyer_id)} onRespond={onRespondToOffer} />
              ))}
            </div>
          );
        })}
      </div>

      {deletedListings.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <button
            style={{ ...styles.pendingBtn, marginBottom: 8 }}
            onClick={() => setShowDeleted(v => !v)}
          >
            {showDeleted ? "Hide" : "Show"} deleted ({deletedListings.length})
          </button>
          {showDeleted && (
            <div style={styles.tableWrap}>
              {deletedListings.map(l => (
                <div key={l.id} style={{ ...styles.listingRow, opacity: 0.65 }} className="app-listing-row">
                  <img src={(l.images && l.images[0]) || l.image} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
                  <div style={styles.rowInfo} className="app-row-info">
                    <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                    <div style={styles.rowMeta}>{fmt(l.price)} • deleted{l.removed_at ? ` ${new Date(l.removed_at).toLocaleDateString()}` : ""}</div>
                  </div>
                  <button style={styles.soldBtn} onClick={() => onRestore(l.id)}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {markingSold && (
        <MarkSoldModal
          listing={markingSold}
          onCancel={() => setMarkingSold(null)}
          onConfirm={(price, buyerEmail) => { onMarkSold(markingSold.id, price, buyerEmail); setMarkingSold(null); }}
        />
      )}
      {editing && (
        <EditListingModal
          listing={editing}
          onCancel={() => setEditing(null)}
          onSave={async (data) => { await onUpdate(editing.id, data); setEditing(null); }}
        />
      )}
    </div>
  );
}

function SellerOfferRow({ offer, buyer, onRespond }) {
  const [countering, setCountering] = useState(false);
  const [counterAmount, setCounterAmount] = useState(fromCents(offer.amount));
  const [counterMessage, setCounterMessage] = useState("");
  return (
    <div style={styles.offerRow}>
      <div style={styles.rowInfo} className="app-row-info">
        <div style={styles.rowTitle}>{buyer?.name || "Buyer"} offered {fmt(offer.amount)}</div>
        {offer.message && <div style={{ fontSize: 13, color: "#374151", marginTop: 2 }}>"{offer.message}"</div>}
        {offer.status === "countered" && <div style={{ fontSize: 13, color: "#1d4ed8", marginTop: 4 }}>You countered at {fmt(offer.counter_amount)} — waiting on buyer</div>}
      </div>
      {offer.status === "pending" && !countering && (
        <>
          <button style={styles.soldBtn} onClick={() => onRespond(offer.id, "accepted")}>Accept</button>
          <button style={styles.pendingBtn} onClick={() => setCountering(true)}>Counter</button>
          <button style={styles.removeBtn} onClick={() => onRespond(offer.id, "declined")}>Decline</button>
        </>
      )}
      {countering && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input style={{ ...styles.fieldInput, width: 110 }} type="number" value={counterAmount} onChange={e => setCounterAmount(e.target.value)} />
          <input style={{ ...styles.fieldInput, width: 160 }} placeholder="Message (optional)" value={counterMessage} onChange={e => setCounterMessage(e.target.value)} />
          <button style={styles.soldBtn} onClick={() => { onRespond(offer.id, "countered", toCents(counterAmount), counterMessage); setCountering(false); }}>Send Counter</button>
          <button style={styles.cancelBtn} onClick={() => setCountering(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function MyPurchasesView({ listings, users, reviews, currentUser, handoverCodes, onSubmitReview, onConfirmReceipt, onFileDispute, onBuy, onBrowse, onOpenSafety }) {
  const [reviewing, setReviewing] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const hasHandoffPending = listings.some(l => l.status === "pending_confirmation");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>My Purchases</h2>
      {hasHandoffPending && (
        <div style={styles.safetyBanner}>
          🛡️ Picking up a car soon? <button style={styles.safetyBannerLink} onClick={onOpenSafety}>Review our safety tips</button> before you meet the seller.
        </div>
      )}
      {listings.length === 0 && <p style={{ color: "#6b7280" }}>Nothing here yet. Cars you buy — or deals you start with a seller — will show up here.</p>}
      <div style={styles.tableWrap}>
        {listings.map(l => {
          const seller = users.find(u => u.id === l.seller_id);
          const myReview = reviews.find(r => r.listing_id === l.id && r.buyer_id === currentUser.id);
          const cover = (l.images && l.images[0]) || l.image;
          const awaitingConfirmation = l.status === "pending_confirmation";
          const disputed = l.status === "disputed";
          // A BYOD deal sits here as an active, unpaid listing from the moment
          // the seller joins until the buyer funds escrow. This view was built
          // for purchases already paid for, so that window had no action on it
          // at all — the buyer's only route to checkout was the listing modal,
          // which nothing links to from here.
          const awaitingPayment = l.status === "active" && !l.sold_at;
          // Distinct from awaitingPayment above, which is a BYOD deal the buyer
          // has not paid for yet. This one is money already committed by bank
          // transfer and still in flight — the buyer can do nothing but wait,
          // and must not go and collect the car.
          const settlingPayment = l.status === "awaiting_payment";
          return (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={cover} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>
                  {fmt(l.sale_price || l.price)} • {(awaitingPayment || settlingPayment) ? `Seller: ${seller?.name || "seller"}` : `Sold by ${seller?.name || "seller"} on ${l.sold_at}`}
                </div>
                {settlingPayment && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 13, color: "#7c5000", fontWeight: 600 }}>
                      🏦 Your bank transfer is on its way. Bank payments take about 5 business days to clear.
                    </div>
                    <div style={{ marginTop: 10, padding: 12, background: "#FFF8E7", border: "1px solid #FFB020", borderRadius: 8, fontSize: 13, color: "#7c5000", lineHeight: 1.6 }}>
                      <strong>You don't have a handover code yet.</strong> We'll email it the moment the payment clears — that code is what releases the money to the seller.
                      <br /><br />
                      Please don't arrange to collect the vehicle until then. Nothing has been paid to the seller.
                    </div>
                  </div>
                )}
                {awaitingConfirmation && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>
                      Your money is held safely by DriveLink until you have the car. Had a problem instead? Report it rather than confirming.
                    </div>
                    {handoverCodes?.[l.id]?.code && (
                      <div style={{ marginTop: 10, padding: 12, background: "#FFF8E7", border: "1px solid #FFB020", borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#7c5000", marginBottom: 6 }}>
                          YOUR HANDOVER CODE
                        </div>
                        <div style={{ fontSize: 30, fontFamily: "monospace", letterSpacing: 8, fontWeight: 700, color: "#111" }}>
                          {handoverCodes[l.id].code}
                        </div>
                        {/* This wording is a security control, not marketing copy. The
                            code is the only thing standing between the seller and the
                            money, and a seller can ask for it before handing over the
                            keys. Nothing server-side can prevent that — only this can. */}
                        <div style={{ fontSize: 13, color: "#7c5000", marginTop: 8, lineHeight: 1.6 }}>
                          Give this to the seller <strong>only after</strong> the car and the signed title are in your hands. The moment they enter it, the money is theirs.
                          <br />
                          <strong>Don't text or email it. Read it out in person.</strong>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {awaitingPayment && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>
                      The seller has joined and is ready. Your payment is held by DriveLink until you confirm you have the car and the signed title.
                    </div>
                    {l.handover_date && (
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                        Handover agreed for {new Date(`${l.handover_date}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}.
                      </div>
                    )}
                  </div>
                )}
                {disputed && (
                  <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, marginTop: 4 }}>
                    ⚠️ Dispute filed — our team is reviewing this sale. We'll follow up with you directly.
                  </div>
                )}
                {myReview && <div style={styles.promoterTag}>{"⭐".repeat(myReview.rating)} — you reviewed this purchase</div>}
              </div>
              {awaitingPayment && (
                <button style={styles.confirmBtn} onClick={() => onBuy(l)}>💳 Pay securely</button>
              )}
              {awaitingConfirmation && (
                <>
                  <button style={styles.soldBtn} onClick={() => onConfirmReceipt(l.id)}>✅ Confirm Receipt</button>
                  <button style={styles.reportBtn} onClick={() => setDisputing(l)}>⚠️ Report a Problem</button>
                </>
              )}
              {l.status === "sold" && !myReview && (
                <button style={styles.soldBtn} onClick={() => setReviewing(l)}>Leave a Review</button>
              )}
            </div>
          );
        })}
      </div>
      {disputing && (
  <DisputeModal
    listing={disputing}
    onCancel={() => setDisputing(null)}
    onSubmit={(reason, details, evidence) => { onFileDispute(disputing.id, reason, details, evidence); setDisputing(null); }}
  />
)}
      {reviewing && (
        <ReviewModal
          listing={reviewing}
          onCancel={() => setReviewing(null)}
          onSubmit={(rating, comment) => { onSubmitReview(reviewing.id, reviewing.seller_id, rating, comment); setReviewing(null); }}
        />
      )}
      <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
    </div>
  );
}

function MyOffersView({ offers, listings, onRespondToCounter, onBuy, onBrowse, onOpenListing }) {
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>💰 My Offers</h2>
      {offers.length === 0 && <p style={{ color: "#6b7280" }}>No offers made yet. Use "Make an Offer" on any listing to negotiate a price.</p>}
      <div style={styles.tableWrap}>
        {offers.map(o => {
          const listing = listings.find(l => l.id === o.listing_id);
          return (
            <div key={o.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{listing ? `${listing.year} ${listing.make} ${listing.model}` : "Listing"} — offered {fmt(o.amount)}</div>
                {o.status === "countered" && <div style={{ fontSize: 13, color: "#1d4ed8", marginTop: 2 }}>Seller countered at {fmt(o.counter_amount)} {o.counter_message ? `— "${o.counter_message}"` : ""}</div>}
                {o.status === "accepted" && listing?.status === "active" && <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>✅ Accepted — complete your purchase to lock it in</div>}
                {o.status === "accepted" && listing?.status === "pending_confirmation" && <div style={{ fontSize: 13, color: "#1d4ed8", marginTop: 2 }}>💳 Payment received — awaiting confirmation</div>}
                {o.status === "accepted" && listing?.status === "sold" && <div style={{ fontSize: 13, color: "#15803d", marginTop: 2 }}>✅ Sale complete</div>}
                {o.status === "declined" && <div style={{ fontSize: 13, color: "#b91c1c", marginTop: 2 }}>Declined by seller — you can offer again if the car's still listed</div>}
              </div>
              <span style={{ ...styles.statusPill, background: o.status === "accepted" ? "#dcfce7" : o.status === "countered" ? "#dbeafe" : o.status === "declined" || o.status === "withdrawn" ? "#f1f5f9" : "#fef9c3", color: o.status === "accepted" ? "#15803d" : o.status === "countered" ? "#1d4ed8" : o.status === "declined" || o.status === "withdrawn" ? "#6b7280" : "#854d0e" }}>{o.status}</span>
              {o.status === "countered" && (
                <>
                  <button style={styles.soldBtn} onClick={() => onRespondToCounter(o.id, true)}>Accept {fmt(o.counter_amount)}</button>
                  <button style={styles.removeBtn} onClick={() => onRespondToCounter(o.id, false)}>Decline</button>
                </>
              )}
              {o.status === "pending" && (
                <button style={styles.removeBtn} onClick={() => onRespondToCounter(o.id, false)}>Withdraw</button>
              )}
              {o.status === "accepted" && listing?.status === "active" && (
                <button style={styles.soldBtn} onClick={() => onBuy(listing)}>Complete Purchase</button>
              )}
              {/* A declined or withdrawn offer used to be a dead end: the row
                  said "Declined by seller" and offered nothing to click, even
                  though the listing itself would happily take a new offer.
                  Most private car deals close on the second or third number,
                  so this is the single most valuable button on the page. */}
              {(o.status === "declined" || o.status === "withdrawn") && listing?.status === "active" && onOpenListing && (
                <button style={styles.offerBtn} onClick={() => onOpenListing(listing)}>Make another offer</button>
              )}
              {(o.status === "declined" || o.status === "withdrawn") && listing && listing.status !== "active" && (
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  {listing.status === "sold" || listing.status === "pending_confirmation"
                    ? "This car has sold."
                    : "This car is no longer available."}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
    </div>
  );
}

function ReviewModal({ listing, onCancel, onSubmit }) {
  const { t } = useLang();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Review your {listing.year} {listing.make} {listing.model}</h3>
        <label style={styles.fieldLabel}>Rating</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" onClick={() => setRating(n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 26, padding: 0, opacity: n <= rating ? 1 : 0.3 }}>⭐</button>
          ))}
        </div>
        <label style={styles.fieldLabel}>Comment (optional)</label>
        <textarea style={styles.textarea} rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="How was your experience with this seller?" />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(rating, comment)}>Submit Review</button>
        </div>
      </div>
    </div>
  );
}

function DisputeModal({ listing, onCancel, onSubmit }) {
  const { t } = useLang();
  const [reason, setReason] = useState("Car not as described");
  const [details, setDetails] = useState("");
  const [evidence, setEvidence] = useState([]);
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={{ ...styles.modalBox, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Report a problem with this purchase</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>This puts the sale on hold and notifies our team — don't confirm receipt if something's wrong.</div>
        <label style={styles.fieldLabel}>What happened?</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option>Car not as described</option>
          <option>Seller never showed up / unreachable</option>
          <option>Car has undisclosed damage or issues</option>
          <option>Title or paperwork problem</option>
          <option value="Other">{t("common.other")}</option>
        </select>
        <label style={styles.fieldLabel}>Details</label>
        <textarea style={styles.textarea} rows={4} value={details} onChange={e => setDetails(e.target.value)} placeholder="Tell us what went wrong" />
        <div style={{ marginTop: 16 }}>
          <label style={styles.fieldLabel}>Photo evidence (optional but strongly recommended)</label>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Photos of the actual car's condition help our team resolve this fairly and faster.</div>
          <ImageUpload images={evidence} onChange={setEvidence} />
        </div>
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details, evidence)} disabled={!details.trim()}>File Dispute</button>
        </div>
      </div>
    </div>
  );
}
function OfferModal({ listing, onCancel, onSubmit }) {
  const { t } = useLang();
  const [amount, setAmount] = useState(Math.round(listing.price * 0.95));
  const [message, setMessage] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Make an offer on this {listing.year} {listing.make} {listing.model}</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>Asking price: {fmt(listing.price)}</div>
        <label style={styles.fieldLabel}>Your offer ($)</label>
        <input style={{ ...styles.fieldInput, marginBottom: 12 }} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
        <label style={styles.fieldLabel}>Message (optional)</label>
        <textarea style={styles.textarea} rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Anything you want the seller to know" />
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>If accepted, you and the seller coordinate the sale directly — checkout still runs at the listed price, so the seller records the agreed amount when they mark it sold.</div>
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(toCents(amount), message)} disabled={!amount || +amount <= 0}>Send Offer</button>
        </div>
      </div>
    </div>
  );
}

function MarkSoldModal({ listing, onCancel, onConfirm }) {
  const { t } = useLang();
  const [price, setPrice] = useState(fromCents(listing.price));
  const [buyerEmail, setBuyerEmail] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Mark as Sold</h3>
        <label style={styles.fieldLabel}>Final sale price ($)</label>
        <input style={{ ...styles.fieldInput, marginBottom: 12 }} type="number" value={price} onChange={e => setPrice(e.target.value)} />
        <label style={styles.fieldLabel}>Buyer's email (optional)</label>
        <input style={styles.fieldInput} type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="buyer@example.com" />
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>If the buyer has a DriveLink account, adding their email links the sale so they can leave a review.</div>
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={styles.confirmBtn} onClick={() => onConfirm(toCents(price), buyerEmail)}>Confirm Sale</button>
        </div>
      </div>
    </div>
  );
}

function PayoutModal({ user, onCancel, onConfirm, onPayViaStripe }) {
  const { t } = useLang();
  const [amount, setAmount] = useState(fromCents(user.balance || 0));
  const [method, setMethod] = useState("Bank transfer");
  const [note, setNote] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Pay Out {user.name}</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>Current tracked balance: {fmt(user.balance || 0)}</div>
        {user.stripe_payouts_enabled ? (
          <div style={{ fontSize: 13, color: "#16a34a", marginBottom: 12 }}>✅ This promoter has Stripe payouts set up — you can send this amount directly.</div>
        ) : (
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>This promoter hasn't set up Stripe payouts yet — record an external payout below instead.</div>
        )}
        <label style={styles.fieldLabel}>Amount ($)</label>
        <input style={{ ...styles.fieldInput, marginBottom: 12 }} type="number" value={amount} onChange={e => setAmount(e.target.value)} />
        <label style={styles.fieldLabel}>Note (optional)</label>
        <input style={{ ...styles.fieldInput, marginBottom: 12 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Reference number, etc." />
        {user.stripe_payouts_enabled && (
          <button style={{ ...styles.confirmBtn, width: "100%", marginBottom: 12 }} onClick={() => onPayViaStripe(toCents(amount), note)}>
            💳 Send {fmt(toCents(amount))} via Stripe
          </button>
        )}
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
          <label style={styles.fieldLabel}>Or record an external payout</label>
          <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={method} onChange={e => setMethod(e.target.value)}>
            <option>Bank transfer</option>
            <option>PayPal</option>
            <option>Venmo</option>
            <option>Zelle</option>
            <option>Check</option>
            <option value="Other">{t("common.other")}</option>
          </select>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>This records that you paid {user.name} outside of DriveLink and reduces their tracked balance to match — it doesn't move any real money.</div>
          <div style={styles.modalActions}>
            <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
            <button style={styles.confirmBtn} onClick={() => onConfirm(toCents(amount), method, note)}>Record Payout</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditListingModal({ listing, onCancel, onSave }) {
  const { t } = useLang();
  const [form, setForm] = useState({
    make: listing.make || "", model: listing.model || "", year: listing.year || new Date().getFullYear(),
    price: listing.price != null ? fromCents(listing.price) : "", mileage: listing.mileage || "", color: listing.color || "",
    description: listing.description || "", vin: listing.vin || "", location_text: listing.location_text || "",
    handover_date: listing.handover_date || "",
    vehicle_type: listing.vehicle_type || "car",
  });
  const [images, setImages] = useState(listing.images && listing.images.length ? listing.images : (listing.image ? [listing.image] : []));
  const [saving, setSaving] = useState(false);
  const [vinChecking, setVinChecking] = useState(false);
  const [vinResult, setVinResult] = useState(null);
  const [vinVerified, setVinVerified] = useState(listing.vin_verified || false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const checkVin = async () => {
    setVinChecking(true);
    setVinResult(null);
    setVinVerified(false);
    const result = await decodeVin(form.vin);
    setVinResult(result);
    setVinChecking(false);
    if (result.valid) setVinVerified(true);
  };

  const handleSave = async () => {
    if (!form.make || !form.model || !form.price || !form.year) return alert("Fill in at least make, model, year, and price.");
    setSaving(true);
    await onSave({
      ...form,
      price: toCents(form.price),
      mileage: +form.mileage,
      year: +form.year,
      // A date column rejects "". Empty means "no agreed handover date", which
      // is null, which is what the escrow clock treats as immediate.
      handover_date: form.handover_date || null,
      images,
      image: images[0] || listing.image,
      // vin_verified is deliberately NOT sent. It is a platform attestation
      // written only by the verify-vin Edge Function — a browser that can set
      // it can forge it.
    });
    setSaving(false);
  };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={{ ...styles.modalBox, maxWidth: 640, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Edit Listing</h3>
        <ImageUpload images={images} onChange={setImages} />
        <VehicleTypePicker
          value={form.vehicle_type}
          onChange={v => {
            // Make and model belong to the old type's list — a Ford model on a
            // motorcycle listing is worse than an empty field.
            setForm(f => ({ ...f, vehicle_type: v, make: "", model: "" }));
          }}
        />
        <div style={styles.formGrid} className="app-form-grid">
          <MakeModelFields
            make={form.make}
            model={form.model}
            year={form.year}
            vehicleType={form.vehicle_type}
            onChangeMake={v => set("make", v)}
            onChangeModel={v => set("model", v)}
            onChangeYear={v => set("year", v)}
          />
          <Field label="Price ($)" value={form.price} onChange={v => set("price", v)} type="number" />
          <Field label="Mileage" value={form.mileage} onChange={v => set("mileage", v)} type="number" />
          <Field label="Color" value={form.color} onChange={v => set("color", v)} />
          <Field label="Location (city or ZIP)" value={form.location_text} onChange={v => set("location_text", v)} />
        </div>
        <SellerNetPreview price={toCents(form.price)} />
        <HandoverDateField value={form.handover_date} onChange={v => set("handover_date", v)} />
        <div style={{ marginTop: 12 }}>
          <label style={styles.fieldLabel}>VIN (optional)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...styles.fieldInput, flex: 1 }} value={form.vin} onChange={e => { set("vin", e.target.value); setVinResult(null); setVinVerified(false); }} placeholder="17-character VIN" maxLength={17} />
            <button type="button" style={{ ...styles.pendingBtn, whiteSpace: "nowrap" }} onClick={checkVin} disabled={vinChecking || form.vin.trim().length !== 17}>
              {vinChecking ? "Checking…" : "Decode VIN"}
            </button>
          </div>
          {vinResult && !vinResult.valid && <div style={{ fontSize: 13, color: "#b91c1c", marginTop: 6 }}>⚠️ {vinResult.error}</div>}
          {vinResult?.valid && (
            <div style={{ fontSize: 13, color: "#15803d", marginTop: 6 }}>
              ✓ VIN verified — {vinResult.year} {vinResult.make} {vinResult.model}{vinResult.trim ? ` ${vinResult.trim}` : ""}
            </div>
          )}
          {!vinResult && vinVerified && <div style={{ fontSize: 13, color: "#15803d", marginTop: 6 }}>✓ Already verified</div>}
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={styles.fieldLabel}>Description</label>
          <textarea style={styles.textarea} value={form.description} onChange={e => set("description", e.target.value)} rows={4} />
        </div>
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>{t("common.cancel")}</button>
          <button style={{ ...styles.confirmBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

function PostListingView({ onPost }) {
  const { t } = useLang();
  const [form, setForm] = useState({ make: "", model: "", year: new Date().getFullYear(), price: "", mileage: "", color: "", description: "", vin: "", location_text: "", handover_date: "", vehicle_type: "car" });
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [vinChecking, setVinChecking] = useState(false);
  const [vinResult, setVinResult] = useState(null); // { valid, error?, make?, model?, year?, trim?, engine? }
  const [vinVerified, setVinVerified] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const checkVin = async () => {
    setVinChecking(true);
    setVinResult(null);
    setVinVerified(false);
    const result = await decodeVin(form.vin);
    setVinResult(result);
    setVinChecking(false);
    if (result.valid) {
      setVinVerified(true);
      // Auto-fill fields the seller left blank; flag (don't overwrite) if they typed something different.
      if (!form.make) set("make", result.make);
      if (!form.model) set("model", result.model);
      if (!form.year) set("year", result.year);
    }
  };
  const handleSubmit = async () => {
    if (!form.make || !form.model || !form.price || !form.year) return alert("Fill in at least make, model, year, and price.");
    setSubmitting(true);
    await onPost({
      ...form,
      price: toCents(form.price),
      mileage: +form.mileage,
      year: +form.year,
      // See EditListingModal — "" is not a valid date, null means immediate.
      handover_date: form.handover_date || null,
      images,
      image: images[0] || "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&q=80",
      // See note in EditListingModal — the platform sets vin_verified, not us.
    });
    setSubmitting(false);
  };
  const vinMismatch = vinResult?.valid && form.make && form.model && (
    vinResult.make.toLowerCase() !== form.make.toLowerCase() || vinResult.model.toLowerCase() !== form.model.toLowerCase()
  );
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>{t("sell.pageTitle")}</h2>
      <div style={styles.formCard}>
        <ImageUpload images={images} onChange={setImages} />
        <VehicleTypePicker
          value={form.vehicle_type}
          onChange={v => setForm(f => ({ ...f, vehicle_type: v, make: "", model: "" }))}
        />
        <div style={styles.formGrid} className="app-form-grid">
          <MakeModelFields
            make={form.make}
            model={form.model}
            year={form.year}
            vehicleType={form.vehicle_type}
            onChangeMake={v => set("make", v)}
            onChangeModel={v => set("model", v)}
            onChangeYear={v => set("year", v)}
          />
          <Field label={t("sell.price")} value={form.price} onChange={v => set("price", v)} type="number" placeholder="e.g. 25000" />
          <Field label={t("sell.mileage")} value={form.mileage} onChange={v => set("mileage", v)} type="number" placeholder="e.g. 35000" />
          <Field label={t("sell.color")} value={form.color} onChange={v => set("color", v)} placeholder="e.g. Pearl White" />
          <Field label={t("sell.location")} value={form.location_text} onChange={v => set("location_text", v)} placeholder="e.g. Austin, TX" />
        </div>
        <SellerNetPreview price={toCents(form.price)} />
        <HandoverDateField value={form.handover_date} onChange={v => set("handover_date", v)} />
        <div style={{ marginTop: 12 }}>
          <label style={styles.fieldLabel}>VIN (optional)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...styles.fieldInput, flex: 1 }} value={form.vin} onChange={e => { set("vin", e.target.value); setVinResult(null); setVinVerified(false); }} placeholder="17-character VIN" maxLength={17} />
            <button type="button" style={{ ...styles.pendingBtn, whiteSpace: "nowrap" }} onClick={checkVin} disabled={vinChecking || form.vin.trim().length !== 17}>
              {vinChecking ? "Checking…" : "Decode VIN"}
            </button>
          </div>
          {vinResult && !vinResult.valid && (
            <div style={{ fontSize: 13, color: "#b91c1c", marginTop: 6 }}>⚠️ {vinResult.error}</div>
          )}
          {vinResult?.valid && !vinMismatch && (
            <div style={{ fontSize: 13, color: "#15803d", marginTop: 6 }}>
              ✓ VIN verified — {vinResult.year} {vinResult.make} {vinResult.model}{vinResult.trim ? ` ${vinResult.trim}` : ""}
            </div>
          )}
          {vinMismatch && (
            <div style={{ fontSize: 13, color: "#b45309", marginTop: 6 }}>
              ⚠️ This VIN decodes to a {vinResult.year} {vinResult.make} {vinResult.model} — that doesn't match what you entered above. Double-check the VIN or your listing details.
            </div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={styles.fieldLabel}>Description</label>
          <textarea style={styles.textarea} value={form.description} onChange={e => set("description", e.target.value)} rows={4} placeholder="Describe the car's condition, features, history…" />
        </div>
        <button style={{ ...styles.confirmBtn, marginTop: 24, opacity: submitting ? 0.6 : 1 }} onClick={handleSubmit} disabled={submitting}>{submitting ? "Posting…" : "Post Listing"}</button>
      </div>
    </div>
  );
}

const AD_PLANS = [
  // Cents, to match fmt(). Display only — create-ad-checkout-session prices the
  // plan server-side from the plan id, so these are never sent anywhere.
  { id: "3mo", label: "3 Months", monthly: 15000, total: 45000, blurb: "" },
  { id: "6mo", label: "6 Months", monthly: 12500, total: 75000, blurb: "Save ~17%" },
  { id: "12mo", label: "12 Months", monthly: 10000, total: 120000, blurb: "Save ~33%" },
];

function AdvertiseView({ currentUser, onSubmit, onSignIn }) {
  const [selectedPlan, setSelectedPlan] = useState("6mo");
  const [businessName, setBusinessName] = useState("");
  const [contactEmail, setContactEmail] = useState(currentUser?.email || "");
  const [linkUrl, setLinkUrl] = useState("");
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!businessName.trim() || !linkUrl.trim()) return;
    setSubmitting(true);
    await onSubmit({
      plan: selectedPlan,
      business_name: businessName,
      contact_email: contactEmail,
      image_url: images[0] || null,
      link_url: linkUrl,
    });
    setSubmitting(false);
  };

  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>📢 Advertise on DriveLink</h2>
      <p style={{ color: "#6b7280", marginBottom: 24 }}>Put your business in front of car buyers and sellers with a sidebar ad on drivelink.deals.</p>

      <h3 style={styles.sectionTitle}>Choose a plan</h3>
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
        {AD_PLANS.map(p => (
          <div
            key={p.id}
            onClick={() => setSelectedPlan(p.id)}
            style={{
              flex: "1 1 160px",
              border: selectedPlan === p.id ? "2px solid #FFB020" : "1px solid #e5e7eb",
              background: selectedPlan === p.id ? "#fffbeb" : "#fff",
              borderRadius: 12,
              padding: 16,
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15 }}>{p.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 2px" }}>{fmt(p.monthly)}<span style={{ fontSize: 13, fontWeight: 500, color: "#6b7280" }}>/mo</span></div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{fmt(p.total)} total</div>
            {p.blurb && <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600, marginTop: 4 }}>{p.blurb}</div>}
          </div>
        ))}
      </div>

      {!currentUser ? (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: "#6b7280", marginBottom: 16 }}>Sign in or create an account to set up your ad and continue to payment.</p>
          <button style={styles.confirmBtn} onClick={onSignIn}>Sign In / Create Account</button>
        </div>
      ) : (
        <>
          <h3 style={styles.sectionTitle}>Your ad details</h3>
          <Field label="Business name" value={businessName} onChange={setBusinessName} placeholder="Your business name" />
          <Field label="Contact email" value={contactEmail} onChange={setContactEmail} placeholder="you@business.com" type="email" />
          <Field label="Link URL (where the ad sends people)" value={linkUrl} onChange={setLinkUrl} placeholder="https://yourbusiness.com" />
          <div style={{ marginBottom: 16 }}>
            <label style={styles.fieldLabel}>Ad image (optional — you can add this later)</label>
            <ImageUpload images={images} onChange={setImages} />
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
            You'll be taken to secure Stripe checkout to complete payment. Your ad goes live once payment is confirmed.
          </div>

          <button
            style={styles.confirmBtn}
            onClick={handleSubmit}
            disabled={submitting || !businessName.trim() || !linkUrl.trim()}
          >
            {submitting ? "Redirecting…" : `Continue to Payment — ${fmt(AD_PLANS.find(p => p.id === selectedPlan).total)}`}
          </button>
        </>
      )}
    </div>
  );
}

function ProfileView({ dbUser, authEmail, onUpdateProfile, onChangeEmail, onChangePassword, onSetupPayouts, onStartIdentityVerification }) {
  const [name, setName] = useState(dbUser?.name || "");
  const [phone, setPhone] = useState(dbUser?.phone || "");
  const [notifyOffers, setNotifyOffers] = useState(dbUser?.notify_offers ?? true);
  const [notifyMessages, setNotifyMessages] = useState(dbUser?.notify_messages ?? true);
  const [notifySales, setNotifySales] = useState(dbUser?.notify_sales ?? true);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (!dbUser) return <div style={styles.pageWrap}><p style={{ color: "#6b7280" }}>Loading your profile…</p></div>;

  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>⚙️ Profile</h2>

      <h3 style={styles.sectionTitle}>Your Details</h3>
      <Field label="Name" value={name} onChange={setName} placeholder="Your name" />
      <Field label="Phone (optional)" value={phone} onChange={setPhone} placeholder="e.g. (555) 123-4567" type="tel" />
      <button
        style={styles.confirmBtn}
        onClick={() => onUpdateProfile({ name, phone })}
        disabled={!name.trim()}
      >
        Save Details
      </button>

      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Payouts</h3>
      {dbUser.stripe_payouts_enabled ? (
        <div style={{ fontSize: 13, color: "#16a34a" }}>✅ Stripe payouts are set up.</div>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Set up payouts to get paid automatically for sales and commissions.</p>
          <button style={styles.confirmBtn} onClick={onSetupPayouts}>Set up payouts</button>
        </div>
      )}

      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Identity Verification</h3>
      {dbUser.identity_verification_status === "verified" ? (
        <div style={{ fontSize: 13, color: "#16a34a" }}>✅ Your identity is verified — buyers see a Verified badge on your listings.</div>
      ) : dbUser.identity_verification_status === "pending" ? (
        <div>
          <p style={{ fontSize: 13, color: "#854d0e", marginBottom: 8 }}>⏳ Verification submitted — this usually finishes in a few minutes.</p>
          <button style={styles.confirmBtn} onClick={onStartIdentityVerification}>Check status / resume</button>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Verify your identity to earn a Verified badge on your listings — buyers trust verified sellers more, which means faster sales.</p>
          <button style={styles.confirmBtn} onClick={onStartIdentityVerification}>Verify Your Identity</button>
        </div>
      )}

      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Notifications</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={notifyOffers} onChange={e => setNotifyOffers(e.target.checked)} />
          Offers on my listings
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={notifyMessages} onChange={e => setNotifyMessages(e.target.checked)} />
          New messages
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={notifySales} onChange={e => setNotifySales(e.target.checked)} />
          Sales &amp; payout updates
        </label>
      </div>
      <button
        style={styles.confirmBtn}
        onClick={() => onUpdateProfile({ notify_offers: notifyOffers, notify_messages: notifyMessages, notify_sales: notifySales })}
      >
        Save Notification Preferences
      </button>

      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Email Address</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Current: {authEmail}</p>
      <Field label="New email" value={newEmail} onChange={setNewEmail} placeholder="new@example.com" type="email" />
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>We'll send a confirmation link to the new address — the change only takes effect once you click it.</div>
      <button
        style={styles.confirmBtn}
        onClick={() => { onChangeEmail(newEmail); setNewEmail(""); }}
        disabled={!newEmail.trim() || newEmail === authEmail}
      >
        Update Email
      </button>

      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Password</h3>
      <Field label="New password" value={newPassword} onChange={setNewPassword} placeholder="At least 8 characters" type="password" />
      <Field label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter password" type="password" />
      {newPassword && confirmPassword && newPassword !== confirmPassword && (
        <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 12 }}>Passwords don't match.</div>
      )}
      <button
        style={styles.confirmBtn}
        onClick={() => { onChangePassword(newPassword); setNewPassword(""); setConfirmPassword(""); }}
        disabled={!newPassword || newPassword !== confirmPassword}
      >
        Update Password
      </button>
    </div>
  );
}

// ── Sidebar ad rail ───────────────────────────────────────────────────────────
// Renders whatever placements are currently paid for and running. With none, it
// falls back to the promo that used to be hardcoded here — which meant a
// business that had paid up to $1,200 saw an advert asking them to advertise.
//
// Ads are stacked as compact cards rather than one filling the column. A single
// full-height ad wastes the slot and looks broken; it also means a second
// advertiser has nowhere to go. Beyond PAGE_SIZE the rail pages through them on
// a slow timer, so every advertiser gets impressions instead of whoever sorted
// first taking the session.
const AD_PAGE_SIZE = 4;

// Own state rather than the app-level toast: showToast is defined inside App
// and is not in scope down here in AdminView.
// ── Install prompt ────────────────────────────────────────────────────────────
// Nudges phone visitors to add DriveLink to their home screen. Two paths,
// because the platforms differ:
//
//   Android/Chrome — fires beforeinstallprompt, which can be deferred and
//     replayed on a button click. One tap, real install.
//   iOS/Safari — no such event and never will be; Apple requires the user to
//     go through Share → Add to Home Screen manually. So iOS gets instructions
//     rather than a button that cannot work.
//
// Hidden entirely when already installed, and a dismissal is remembered for 30
// days — an install banner that reappears on every visit is an irritation, and
// someone who said no to it once has answered.
const INSTALL_DISMISS_KEY = "dl_install_dismissed_at";
const INSTALL_SNOOZE_DAYS = 30;

// ── About ─────────────────────────────────────────────────────────────────────
// Doubles as the trust page and the crawlable one. Someone deciding whether to
// hand a stranger $7,000 through a site they have never heard of is asking who
// runs it, where the money sits, and what happens when it goes wrong — so the
// page answers those plainly rather than selling.
function AboutView({ onBack, onBrowse, onSafety }) {
  return (
    <div style={styles.legalPage}>
      <style>{css}</style>
      <div style={styles.legalInner}>
        <button style={styles.legalBackBtn} onClick={onBack}>← Back to DriveLink</button>
        <h1 style={styles.legalTitle}>About DriveLink</h1>
        <p style={styles.legalUpdated}>A peer-to-peer car marketplace where the money is held safely until the car actually changes hands.</p>
        <div style={styles.legalBody} className="legalBody">
          <h2>Why DriveLink exists</h2>
          <p>Buying a used car privately usually means choosing between two bad options. Marketplaces like Facebook and Craigslist have the cars but no payment protection at all — you meet a stranger and hand over a cashier's check, hoping the title is clean. Escrow services offer protection but aren't built for cars, so you're bolting a generic process onto a transaction it wasn't designed for.</p>
          <p>DriveLink puts the two together. Every sale closes through escrow, and the buyer's money is held until the keys and the title have changed hands.</p>

          <h2>How a sale works</h2>
          <p>A seller lists their car. A buyer pays through the platform, and that payment is held — it does not reach the seller yet. The two arrange the handover themselves, in person, like any private sale.</p>
          <p>Nothing is released on a timer. When the buyer pays, they get a 6-digit handover code. At the handover — once the car and the signed title are in their hands — they give that code to the seller, who enters it, and the funds are released. The buyer can also confirm receipt in the app if they'd rather. If a sale goes quiet with no confirmation either way, we pause it and ask both people what happened, rather than paying anyone out and hoping. If something goes wrong, the buyer can open a dispute at any point.</p>

          <h2>What it costs</h2>
          <p>DriveLink charges sellers 1% of the sale price. Buyers pay nothing beyond the price of the car. The fee is shown upfront when a car is listed, alongside what the seller will actually receive after card processing costs — no discovering the real number at payout time.</p>

          <h2>Where the money sits</h2>
          <p>Payments are processed by Stripe, and funds are held on DriveLink's Stripe balance between payment and release. DriveLink never handles card details directly — those go straight to Stripe. Sellers connect their own account to receive payouts.</p>

          <h2>Who runs it</h2>
          <p>DriveLink LLC is a company registered in New Jersey, United States. It's a small operation, which is deliberate — you can reach a person who can actually fix your problem rather than a support queue.</p>
          <p>Questions, problems, or something that looks wrong on the platform: <a href="mailto:support@drivelink.deals">support@drivelink.deals</a>.</p>

          <h2>Before you meet anyone</h2>
          <p>Escrow protects the money. It doesn't replace the ordinary care any private sale needs — checking the VIN, meeting somewhere public, confirming the title. Our <button style={styles.legalInlineLink} onClick={onSafety}>meetup safety guide</button> covers what to check and where to meet.</p>

          <p style={{ marginTop: 28 }}>
            <button style={styles.legalBackBtn} onClick={onBrowse}>Browse cars →</button>
          </p>
        </div>
      </div>
    </div>
  );
}

function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState("generic"); // ios | android | generic
  const bannerRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already installed — the banner would be advertising something they have.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    let dismissedAt = 0;
    try { dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY)) || 0; } catch { /* private mode */ }
    if (dismissedAt && Date.now() - dismissedAt < INSTALL_SNOOZE_DAYS * 86400000) return;

    const ua = window.navigator.userAgent || "";
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    const isAndroid = /android/i.test(ua);
    if (window.innerWidth > 820) return;

    // Show unconditionally on phones. The earlier version waited for Chrome's
    // beforeinstallprompt event before showing anything, which meant the banner
    // was invisible whenever Chrome chose not to fire it — private windows,
    // low engagement scores, or no reason at all. Instructions always work;
    // the one-tap button is an upgrade when the event happens to arrive.
    setPlatform(isIOS ? "ios" : isAndroid ? "android" : "generic");
    setShow(true);

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setShow(false);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // The banner is position:fixed over the bottom of the viewport, which means
  // it sits ON TOP of whatever content is already there rather than pushing
  // it up — on a phone that's the last ~90px of every page: hero copy, stat
  // numbers, buy buttons, all partly hidden behind it. Reserving that much
  // space at the bottom of the page while the banner is showing keeps real
  // content clear of it without touching any of the pages that render
  // <InstallPrompt />.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (show && bannerRef.current) {
      const h = bannerRef.current.offsetHeight;
      document.body.style.paddingBottom = `calc(${h}px + 24px + env(safe-area-inset-bottom, 0px))`;
    } else {
      document.body.style.paddingBottom = "";
    }
    return () => { document.body.style.paddingBottom = ""; };
  }, [show]);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    setShow(false);
    if (outcome !== "accepted") dismiss();
  };

  if (!show) return null;

  // iOS never gets a button — Apple has no install API and never will, so the
  // only honest thing to show is where the control actually lives.
  const instructions =
    platform === "ios"
      ? <>Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>.</>
      : deferred
      ? <>Add it to your home screen — no app store needed.</>
      : <>Open your browser menu and tap <strong>Install app</strong>.</>;

  return (
    <div
      ref={bannerRef}
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        // Clears the iOS Safari toolbar and any Android gesture bar.
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
        zIndex: 9000,
        background: "#0f172a",
        color: "#fff",
        borderRadius: 14,
        padding: "14px 16px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
      role="dialog"
      aria-label="Install DriveLink"
    >
      <img
        src="/icons/icon-192.png"
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 9, background: "#fff", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Get DriveLink on your phone</div>
        <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2, lineHeight: 1.4 }}>
          {instructions}
        </div>
      </div>
      {deferred && (
        <button
          onClick={install}
          style={{
            background: "#FFB020",
            color: "#0f172a",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          fontSize: 22,
          lineHeight: 1,
          cursor: "pointer",
          padding: "0 2px",
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      style={{ background: "none", border: "none", color: copied ? "#16a34a" : "#1d4ed8", cursor: "pointer", padding: 0, fontSize: 13 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API needs a secure context and can be blocked outright.
          // Selecting the address by hand still works, so fail quietly.
        }
      }}
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

function AdRail({ ads, onPromoClick }) {
  const live = ads || [];
  const pages = Math.max(1, Math.ceil(live.length / AD_PAGE_SIZE));
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage(p => (p + 1) % pages), 20000);
    return () => clearInterval(id);
  }, [pages]);

  // Guards against a page index left over from a larger set.
  const start = (page % pages) * AD_PAGE_SIZE;
  const visible = live.slice(start, start + AD_PAGE_SIZE);

  if (live.length === 0) {
    return (
      <div style={styles.adRailInner} onClick={onPromoClick} role="button" tabIndex={0}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📢 Advertise Here</div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>Reach car buyers and sellers on DriveLink.</div>
        <div style={{ fontSize: 13, color: "#FFB020", fontWeight: 600, marginTop: 12 }}>Click to learn more →</div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.adRailInner, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: "#64748b", letterSpacing: 1, fontWeight: 700 }}>
        SPONSORED
        {pages > 1 && <span style={{ marginLeft: 6, fontWeight: 500 }}>{page + 1}/{pages}</span>}
      </div>

      {visible.map(ad => (
        <a
          key={ad.id}
          href={ad.link_url}
          target="_blank"
          // noopener: the advertiser's page must not get a handle on this window.
          // nofollow + sponsored: paid links, and telling Google otherwise is how
          // a site earns a manual action.
          rel="noopener noreferrer nofollow sponsored"
          onClick={(e) => e.stopPropagation()}
          style={{
            textDecoration: "none",
            color: "inherit",
            display: "block",
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {ad.image_url && (
            <img
              src={ad.image_url}
              alt={ad.business_name}
              loading="lazy"
              // Fixed height with object-fit: one advertiser uploading a tall
              // image must not push the others off the rail.
              style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 6, marginBottom: 8, display: "block" }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{ad.business_name}</div>
          <div style={{ fontSize: 12, color: "#FFB020", fontWeight: 600, marginTop: 4 }}>Visit site →</div>
        </a>
      ))}

      {/* Keeps the slot selling itself even when it's full. */}
      <div
        onClick={onPromoClick}
        role="button"
        tabIndex={0}
        style={{ fontSize: 12, color: "#94a3b8", cursor: "pointer", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        Advertise on DriveLink →
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.fieldLabel}>{label}</label>
      <input style={styles.fieldInput} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Handover date ────────────────────────────────────────────────────────────
// The day the seller physically hands the car to the buyer, when that isn't
// straight away. It is optional and empty on almost every listing — the common
// case is "we meet this week" and needs no date at all.
//
// It matters because it anchors the escrow clock. auto_release_at is the LATER
// of (payment + 7 days) and (handover + 7 days) — but as of 2026-08-06 that
// timestamp no longer releases money. Nothing does, automatically. It is now
// the point at which a sale nobody has confirmed gets escalated to manual
// review. Setting a handover date means that escalation fires at a sensible
// time rather than while the car is still legitimately undelivered.
//
// The 90-day ceiling matches the hard limit in create-checkout-session, which
// refuses to open a Checkout session beyond it. Enforcing it here too means the
// seller finds out while editing their listing rather than the buyer finding
// out at the payment screen.
const HANDOVER_MAX_DAYS = 90;

function HandoverDateField({ value, onChange }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const maxIso = new Date(Date.now() + HANDOVER_MAX_DAYS * 86400000).toISOString().slice(0, 10);

  return (
    <div style={{ marginTop: 16 }}>
      <label style={styles.fieldLabel}>Handover date (optional)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          style={{ ...styles.fieldInput, flex: 1 }}
          type="date"
          value={value || ""}
          min={todayIso}
          max={maxIso}
          onChange={e => onChange(e.target.value)}
        />
        {value && (
          <button type="button" style={{ ...styles.cancelBtn, whiteSpace: "nowrap" }} onClick={() => onChange("")}>
            Clear
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
        {value ? (
          <>
            Buyers will see this date before they pay. Their payment stays in escrow until the handover — you're paid when they give you their 6-digit code, or when they confirm receipt in the app.
          </>
        ) : (
          <>Leave blank if you can hand the car over as soon as it sells. Set a date only if the buyer would have to wait — it's what lets someone buy a car you can't deliver yet.</>
        )}
      </div>
    </div>
  );
}

// What the seller actually receives, shown while they type the price.
//
// The headline fee is 1%, but that is not what lands in their account: card
// processing is deducted too, and on a $50 sale the difference between "1%"
// and reality was $49.50 vs $47.00. Quoting a percentage and paying out a
// different number is the kind of surprise that costs trust on a platform
// whose whole proposition is escrow, so the real figure is shown up front.
//
// Mirrors the arithmetic in stripe-webhook, in CENTS. The webhook no longer
// rounds the processing fee up to whole dollars — it deducts Stripe's exact
// reported fee — so this estimate is now accurate to the cent rather than
// deliberately pessimistic. It is still an estimate: the real fee comes off
// the charge's balance_transaction at settlement time.
const STRIPE_PCT = 0.029;
const STRIPE_FIXED = 30; // cents

function sellerNetBreakdown(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return null;
  const platformFee = Math.round(p * PLATFORM_FEE);
  const processing = Math.ceil(p * STRIPE_PCT + STRIPE_FIXED);
  const promoter = Math.round(p * PROMOTER_FEE);
  const net = Math.max(0, p - platformFee - processing);
  const netWithPromoter = Math.max(0, net - promoter);
  return { price: p, platformFee, processing, promoter, net, netWithPromoter };
}

function SellerNetPreview({ price }) {
  const { t } = useLang();
  const b = sellerNetBreakdown(price);
  if (!b) return null;
  return (
    <div style={{ ...styles.infoBox, marginTop: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("fee.youReceive", { amount: fmt(b.net) })}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        {t("fee.breakdown", { price: fmt(b.price), platform: fmt(b.platformFee), processing: fmt(b.processing) })}
      </div>
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
        {t("fee.promoterNote", { promoter: fmt(b.promoter), netWithPromoter: fmt(b.netWithPromoter) })}
      </div>
    </div>
  );
}

// ── Make / model, driven by NHTSA vPIC ──────────────────────────────────────
//
// Free-text make and model is where the listings table got " Honda" with a
// leading space and "avlon" as a model. A seller typing under a car in a
// driveway will typo, and every typo is a listing that never matches a search.
//
// Source is the same keyless vPIC API the VIN decoder already uses, so there
// is no bundled list to go stale. Three vehicle types are merged — passenger
// cars, trucks, and MPVs — because vPIC files SUVs under MPV and a Highlander
// would otherwise be unlistable.
//
// ESCAPE HATCH, and it matters: vPIC's model lists are imperfect and a seller
// who cannot find their actual car will abandon the form rather than pick
// something close. Both fields offer "Other" and fall back to a text input.
// The API being unreachable does the same thing automatically — a network
// blip must never make listing impossible.
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const OTHER = "__other__";

// vPIC's GetMakesForVehicleType returns every registered manufacturer — over a
// thousand entries including trailer builders, upfitters, and one-off kit car
// shops ("Badger Equipment", "Brain Unlimited", "Blackwater"). A seller had to
// scroll past hundreds of them to reach Honda, which is worse than the free
// text field it replaced.
//
// So makes are a curated list of marques actually sold to US consumers, and
// the API is kept only for models, where it earns its place: nobody wants to
// maintain every Toyota trim by hand, and vPIC is authoritative there.
//
// Discontinued marques are included on purpose — a 2004 Pontiac GTO is a
// perfectly normal used listing, and leaving them out would force those
// sellers into the "Other" path for no reason.
// ── Vehicle types ───────────────────────────────────────────────────────────
// Everything here carries a 17-character NHTSA VIN, which is what lets the
// existing VIN decoder and vin_verified badge work unchanged. Boats (HINs) and
// towable RVs (frequently no VIN) are deliberately absent — they need a
// separate identity path, not a new entry in this list.
const VEHICLE_TYPES = [
  { value: "car",        label: "Car / Truck / SUV", emoji: "🚗", vpic: null },
  { value: "motorcycle", label: "Motorcycle",        emoji: "🏍️", vpic: "motorcycle" },
  { value: "scooter",    label: "Scooter / Moped",   emoji: "🛵", vpic: "motorcycle" },
  { value: "atv",        label: "ATV / Quad",        emoji: "🏞️", vpic: "motorcycle" },
  { value: "utv",        label: "UTV / Side-by-side", emoji: "🚙", vpic: "motorcycle" },
  { value: "snowmobile", label: "Snowmobile",        emoji: "🛷", vpic: "motorcycle" },
];

const vehicleTypeLabel = (v) =>
  VEHICLE_TYPES.find(t => t.value === v)?.label || "Car / Truck / SUV";
const vehicleTypeEmoji = (v) =>
  VEHICLE_TYPES.find(t => t.value === v)?.emoji || "🚗";

// Powersports marques actually sold to US consumers. Same reasoning as the car
// list: vPIC's own make list runs to thousands of entries including one-off
// trailer builders, and a seller should not scroll past 400 of them to reach
// Harley-Davidson.
//
// The ATV/UTV/snowmobile brands are folded in together because the
// manufacturers overlap almost entirely — Polaris makes sleds and side-by-sides,
// Yamaha makes all four — and splitting them would mean a seller hunting for a
// brand that is right there under a different heading.
const POWERSPORTS_MAKES = [
  "Aprilia", "Arctic Cat", "Bennche", "Beta", "BMW", "Bombardier", "BRP",
  "Can-Am", "CFMOTO", "Ducati", "Gas Gas", "Harley-Davidson", "Honda", "Husqvarna",
  "Indian", "Kawasaki", "KTM", "Kymco", "Lance", "Moto Guzzi", "MV Agusta",
  "Piaggio", "Polaris", "Royal Enfield", "Ski-Doo", "Suzuki", "SYM", "Triumph",
  "Vespa", "Victory", "Yamaha", "Zero",
];

const makesForType = (vehicleType) =>
  vehicleType && vehicleType !== "car" ? POWERSPORTS_MAKES : MAKES;

const MAKES = [
  "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Buick",
  "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ferrari", "Fiat", "Ford",
  "Genesis", "GMC", "Honda", "Hummer", "Hyundai", "Infiniti", "Isuzu",
  "Jaguar", "Jeep", "Kia", "Lamborghini", "Land Rover", "Lexus", "Lincoln",
  "Lotus", "Lucid", "Maserati", "Mazda", "McLaren", "Mercedes-Benz", "Mercury",
  "MINI", "Mitsubishi", "Nissan", "Oldsmobile", "Plymouth", "Polestar",
  "Pontiac", "Porsche", "RAM", "Rivian", "Rolls-Royce", "Saab", "Saturn",
  "Scion", "Smart", "Subaru", "Suzuki", "Tesla", "Toyota", "Volkswagen",
  "Volvo",
];

// Year-scoped on purpose. GetModelsForMake returns everything a manufacturer
// has ever registered with NHTSA — for Ford that is ~900 entries including
// trailer part numbers ("A8513"), commercial chassis ("B-750"), and upfitter
// SKUs ("Affordable Trailers"). Adding the model year cuts it to the ~30
// vehicles actually sold that year, which is a list a person can read.
//
// This is why the fields cascade Make -> Year -> Model rather than the more
// obvious Make -> Model -> Year.
async function fetchModels(make, year, vehicleType) {
  if (!make || !year) return [];

  // vPIC can scope results by vehicle type. Without it, "Honda 2020" returns
  // Accords and CB500s in one list, and a seller listing a bike has to pick
  // their model out of a hundred cars. With it, a motorcycle seller sees
  // motorcycles.
  const vpicType = VEHICLE_TYPES.find(t => t.value === vehicleType)?.vpic;
  const url = vpicType
    ? `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelYear/${encodeURIComponent(year)}/vehicleType/${encodeURIComponent(vpicType)}?format=json`
    : `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`;

  const res = await fetch(url);
  const json = await res.json();
  const seen = new Set();
  const out = [];
  for (const row of json?.Results || []) {
    const name = String(row.Model_Name || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) { seen.add(key); out.push(name); }
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return out;
}

// Sits above make/model because it changes what those fields offer. Chips
// rather than a dropdown: six options is few enough to show at once, and a
// seller listing a motorcycle should see immediately that this is a place that
// takes motorcycles rather than having to open a menu to find out.
function VehicleTypePicker({ value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.fieldLabel}>What are you selling?</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {VEHICLE_TYPES.map(vt => {
          const active = (value || "car") === vt.value;
          return (
            <button
              key={vt.value}
              type="button"
              onClick={() => onChange(vt.value)}
              style={{
                padding: "9px 14px",
                borderRadius: 10,
                border: active ? "2px solid #1d4ed8" : "1px solid #e5e7eb",
                background: active ? "#eff6ff" : "#fff",
                color: active ? "#1d4ed8" : "#374151",
                fontWeight: active ? 700 : 500,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {vt.emoji} {vt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VehicleTypeBadge({ vehicleType }) {
  if (!vehicleType || vehicleType === "car") return null;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 999, marginLeft: 8 }}>
      {vehicleTypeEmoji(vehicleType)} {vehicleTypeLabel(vehicleType)}
    </span>
  );
}

function MakeModelFields({ make, model, year, vehicleType, onChangeMake, onChangeModel, onChangeYear }) {
  const { t } = useLang();
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsFailed, setModelsFailed] = useState(false);

  const makeList = makesForType(vehicleType);

  // An existing listing may hold a make or model the lists don't contain, and
  // a dropdown that silently dropped it would blank the field on save.
  const [customMake, setCustomMake] = useState(
    () => !!make && !makeList.some(m => m.toLowerCase() === make.toLowerCase())
  );
  const [customModel, setCustomModel] = useState(false);

  useEffect(() => {
    if (!make || !year || customMake) { setModels([]); return; }
    let alive = true;
    setLoadingModels(true);
    setModelsFailed(false);
    fetchModels(make, year, vehicleType)
      .then(list => {
        if (!alive) return;
        setModels(list);
        if (!list.length) setModelsFailed(true);
        if (model && list.length && !list.some(m => m.toLowerCase() === model.toLowerCase())) {
          setCustomModel(true);
        }
      })
      .catch(() => alive && setModelsFailed(true))
      .finally(() => alive && setLoadingModels(false));
    return () => { alive = false; };
  }, [make, year, customMake, vehicleType]);

  const selectStyle = { ...styles.fieldInput, appearance: "none", WebkitAppearance: "none", background: "#fff" };
  const freeModel = customModel || modelsFailed || customMake;

  const modelPlaceholder = !make
    ? t("sell.pickMakeFirst")
    : !year
    ? t("sell.pickYearFirst")
    : loadingModels
    ? t("sell.loading")
    : t("sell.modelSelect");

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <label style={styles.fieldLabel}>{t("sell.make")}</label>
        {customMake ? (
          <input
            style={styles.fieldInput}
            value={make}
            placeholder="e.g. Toyota"
            onChange={e => onChangeMake(e.target.value)}
          />
        ) : (
          <select
            style={selectStyle}
            value={make || ""}
            onChange={e => {
              const v = e.target.value;
              if (v === OTHER) { setCustomMake(true); onChangeMake(""); onChangeModel(""); return; }
              onChangeMake(v);
              onChangeModel("");
              setCustomModel(false);
            }}
          >
            <option value="">{t("sell.makeSelect")}</option>
            {makeList.map(m => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>{t("sell.other")}</option>
          </select>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={styles.fieldLabel}>{t("sell.year")}</label>
        <select
          style={selectStyle}
          value={year ?? ""}
          onChange={e => { onChangeYear(e.target.value); onChangeModel(""); setCustomModel(false); }}
        >
          <option value="">{t("sell.yearSelect")}</option>
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={styles.fieldLabel}>{t("sell.model")}</label>
        {freeModel ? (
          <input
            style={styles.fieldInput}
            value={model}
            placeholder="e.g. Camry"
            onChange={e => onChangeModel(e.target.value)}
          />
        ) : (
          <select
            style={selectStyle}
            value={model || ""}
            disabled={!make || !year || loadingModels}
            onChange={e => {
              const v = e.target.value;
              if (v === OTHER) { setCustomModel(true); onChangeModel(""); return; }
              onChangeModel(v);
            }}
          >
            <option value="">{modelPlaceholder}</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
            <option value={OTHER}>{t("sell.other")}</option>
          </select>
        )}
      </div>
    </>
  );
}

// Year is a fixed range rather than a free-text number input. Typing produced
// real bad data — a listing stored as year 201, another as 20200000 — and the
// listings.listings_year_valid check constraint now rejects those outright, so
// an unconstrained input just turns a typo into a failed save. Range runs from
// next year back to 1900 and rolls forward on its own.
const YEAR_OPTIONS = (() => {
  const max = new Date().getFullYear() + 1;
  const out = [];
  for (let y = max; y >= 1900; y--) out.push(y);
  return out;
})();

function YearField({ value, onChange }) {
  const { t } = useLang();
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.fieldLabel}>{t("sell.year")}</label>
      <select
        style={{ ...styles.fieldInput, appearance: "none", WebkitAppearance: "none", background: "#fff" }}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{t("sell.yearSelect")}</option>
        {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

function PromoterDashboard({ currentUser, referrals, listings, payouts, standingCode, onSetupPayouts, onRetract, onGetCode }) {
  const pending = referrals.filter(r => r.status === "pending");
  const lifetimeEarned = referrals.filter(r => r.status === "paid").reduce((s, r) => s + (r.commission_amount || 0), 0);
  const myPayouts = (payouts || []).filter(p => p.user_id === currentUser?.id);
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Earnings Dashboard</h2>
      {currentUser && !currentUser.stripe_payouts_enabled && (
        <div style={styles.safetyBanner}>
          💳 Set up Stripe payouts to get your commission sent directly instead of waiting on a manual payout.{" "}
          <button style={styles.safetyBannerLink} onClick={onSetupPayouts}>Set up payouts</button>
        </div>
      )}
      {currentUser && currentUser.stripe_payouts_enabled && (
        <div style={{ fontSize: 13, color: "#16a34a", marginBottom: 12 }}>✅ Stripe payouts are set up — commissions can be sent to you directly.</div>
      )}
      <div style={styles.statsRow}>
        <StatBox label="Available Balance" value={fmt(currentUser?.balance || 0)} color="#16a34a" />
        <StatBox label="Lifetime Earned" value={fmt(lifetimeEarned)} color="#1d4ed8" />
        <StatBox label="Shares Active" value={pending.length} color="#1d4ed8" />
        <StatBox label="Sales Converted" value={referrals.filter(r => r.status === "paid").length} color="#7c3aed" />
      </div>
      {!standingCode && (
        <div style={styles.safetyBanner}>
          🎫 You don't have a Promoter code yet — that's the link you share to earn on deals you bring in.{" "}
          <button style={styles.safetyBannerLink} onClick={onGetCode}>Get your code</button>
        </div>
      )}
      <h3 style={styles.sectionTitle}>Your Referrals</h3>
      {referrals.length === 0 && <p style={{ color: "#6b7280" }}>No referrals yet. Browse listings and share to earn 1% commission on sales.</p>}
      <div style={styles.tableWrap}>
        {referrals.map(r => (
          <ReferralRow
            key={r.id}
            referral={r}
            listing={listings.find(l => l.id === r.listing_id)}
            standingCode={standingCode}
            onRetract={onRetract}
          />
        ))}
      </div>
      <div style={styles.infoBox}><b>How commissions work:</b> Share a listing, or send your Promoter link to someone doing a deal they found elsewhere. Either way, 1% of the sale price is credited to you once the sale completes.</div>
      <h3 style={{ ...styles.sectionTitle, marginTop: 32 }}>Payout History</h3>
      {myPayouts.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No payouts yet — your available balance above is what's owed to you.</p>
      ) : (
        <div style={styles.tableWrap}>
          {myPayouts.map(p => (
            <div key={p.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{fmt(p.amount)} via {p.method}</div>
                <div style={styles.rowMeta}>{new Date(p.paid_at).toLocaleDateString()} {p.note ? `• "${p.note}"` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shows the actual shareable URL with working Copy / Share buttons. The raw code
// is kept visible but secondary — it's a reference, not the thing you send.
function PromoterLinkRow({ code, listing, standing = false }) {
  const [state, setState] = useState(null); // "copied" | "shared"
  const url = standing ? standingUrl(code) : promoterUrl(code);
  const title = listing ? `${listing.year} ${listing.make} ${listing.model} on DriveLink` : "Buy or sell safely on DriveLink";

  const doShare = async () => {
    const result = await shareOrCopy(url, title);
    if (result === "cancelled" || result === "failed") return;
    setState(result);
    setTimeout(() => setState(null), 2500);
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{
        fontSize: 13, color: "#1d4ed8", wordBreak: "break-all",
        background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "8px 10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>{url}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          onClick={doShare}
          style={{
            background: state ? "#16a34a" : "#1d4ed8", color: "#fff", border: "none",
            borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {state === "copied" ? "✓ Link copied!" : state === "shared" ? "✓ Shared!" : "🔗 Copy / Share link"}
        </button>
      </div>
    </div>
  );
}

// ── Promoter code page ───────────────────────────────────────────────────────
// The self-serve mint. This exists so a broker can go from "sure, send it over"
// to a working link without anyone at DriveLink touching a console. Everything
// on this page is one screen and one button on purpose — it gets opened on a
// phone, between calls, by someone who has not read anything about us.
// What a signed-out visitor sees at /promoter. This page is not linked from the
// nav — people reach it from an outreach email or a direct link — so it has to
// carry the whole pitch itself rather than assuming any context.
function PromoterSignedOut({ onSignUp, onBack }) {
  return (
    <div style={{ ...styles.pageWrap, maxWidth: 720 }}>
      {/* This view renders outside the app shell, so there is no nav to fall
          back on. Without this, someone who is not ready to sign up has no way
          off the page. */}
      <button
        onClick={onBack}
        style={{ background: "none", border: "none", padding: 0, color: "#6b7280", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 20 }}
      >
        ← Back to DriveLink
      </button>
      <h2 style={styles.pageTitle}>Earn 1% on cars you already move</h2>

      <p style={{ color: "#334155", fontSize: 16, lineHeight: 1.7 }}>
        If you arrange vehicle sales or transport, your customers are already
        wiring money to people they have never met. DriveLink holds that money
        in escrow until the keys and title change hands — and pays you{" "}
        <b>1% of every sale</b> that goes through your link.
      </p>

      <div style={{ ...styles.infoBox, marginTop: 24 }}>
        <b>The 1% is added to the deal, not taken out of it.</b> It does not come
        out of your customer's pocket at your expense, and it does not reduce
        what the seller receives beyond the fee they already agreed to. Our own
        1% stays the same either way.
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", letterSpacing: ".06em", marginBottom: 14 }}>
          HOW IT WORKS
        </div>
        {[
          ["1", "Create an account", "Takes a minute. No fee, no contract, nothing to install."],
          ["2", "Get your link", "One standing link. It is not tied to any particular car, and it does not expire."],
          ["3", "Send it to anyone doing a deal", "A customer buying out of state, a seller nervous about a cashier's check \u2014 anyone moving a car privately."],
          ["4", "Get paid when the sale completes", "1% lands in your balance once the buyer confirms the handover. Paid out to your bank."],
        ].map(([n, title, desc]) => (
          <div key={n} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
            <div style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 14, background: "#1d4ed8",
              color: "#fff", fontSize: 14, fontWeight: 700, display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>{n}</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{title}</div>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6, marginTop: 2 }}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onSignUp}
        style={{
          marginTop: 8, background: "#1d4ed8", color: "#fff", border: "none",
          borderRadius: 10, padding: "15px 26px", fontSize: 16, fontWeight: 700, cursor: "pointer",
        }}
      >
        Create an account and get my link
      </button>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 10 }}>
        Free. You are only paid — never charged.
      </div>
    </div>
  );
}

function PromoterCodeView({ currentUser, promoterCode, onMint, onSetupPayouts, onViewEarnings }) {
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(null); // "copied" | "shared"

  const code = promoterCode?.code || null;
  const url = code ? standingUrl(code) : null;

  const doMint = async () => {
    setWorking(true);
    await onMint();
    setWorking(false);
  };

  const doShare = async () => {
    const result = await shareOrCopy(url, "Buy or sell safely on DriveLink");
    if (result === "cancelled" || result === "failed") return;
    setCopied(result);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Your Promoter Code</h2>

      {!code && (
        <>
          <p style={{ color: "#475569", fontSize: 15, lineHeight: 1.6, maxWidth: 640 }}>
            Send your link to anyone buying or selling a car privately. When they
            complete a deal through DriveLink, you earn <b>1% of the sale price</b>.
            That 1% is added to the deal — it doesn't come out of the buyer's or
            seller's pocket at your expense, and it doesn't reduce what the seller
            receives beyond the fee they already agreed to.
          </p>
          <button
            onClick={doMint}
            disabled={working}
            style={{
              marginTop: 20, background: working ? "#93c5fd" : "#1d4ed8", color: "#fff",
              border: "none", borderRadius: 10, padding: "14px 22px", fontSize: 15,
              fontWeight: 700, cursor: working ? "default" : "pointer",
            }}
          >
            {working ? "Creating\u2026" : "Create my Promoter code"}
          </button>
        </>
      )}

      {code && (
        <>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>Your code</div>
          <div style={{
            fontSize: 24, fontWeight: 800, letterSpacing: "0.04em", color: "#0f172a",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom: 18,
          }}>{code}</div>

          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>Your link</div>
          <div style={{
            fontSize: 14, color: "#1d4ed8", wordBreak: "break-all",
            background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
            padding: "10px 12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>{url}</div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              onClick={doShare}
              style={{
                background: copied ? "#16a34a" : "#1d4ed8", color: "#fff", border: "none",
                borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              {copied === "copied" ? "\u2713 Link copied!" : copied === "shared" ? "\u2713 Shared!" : "\ud83d\udd17 Copy / Share link"}
            </button>
            <button
              onClick={onViewEarnings}
              style={{
                background: "#fff", color: "#1d4ed8", border: "1px solid #bfdbfe",
                borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}
            >
              View earnings
            </button>
          </div>

          {currentUser && !currentUser.stripe_payouts_enabled && (
            <div style={{ ...styles.safetyBanner, marginTop: 20 }}>
              💳 Set up payouts so your commission can be sent to you directly.{" "}
              <button style={styles.safetyBannerLink} onClick={onSetupPayouts}>Set up payouts</button>
            </div>
          )}
        </>
      )}

      <div style={styles.infoBox}>
        <b>How it works:</b> Anyone who opens your link and starts a deal is
        credited to you for 3 days. The commission is confirmed once the sale
        completes and the buyer confirms the handover, then it lands in your
        balance. You can share the same link as many times as you like — it
        doesn't expire and it isn't tied to any one car.
      </div>
    </div>
  );
}

// One row in the Promoter's referral list. Pending referrals show the shareable
// link and can be retracted; settled ones are read-only history.
function ReferralRow({ referral: r, listing, standingCode, onRetract }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  // listing_id is the discriminator, not share_code. A standing-code referral
  // has no listing at all: it was created by /p/:code before any car existed.
  // Some of these carry the standing code in share_code and some carry null,
  // so keying off share_code misclassifies them — and rendering either shape
  // through the per-listing path produced a dead /s/ link.
  const isStanding = !r.listing_id;

  // A referral can only be pulled back while it's still pending AND the car
  // hasn't entered a sale. Once a buyer is in checkout the attribution is
  // already recorded and money is moving — retracting then would quietly
  // forfeit a commission that's arguably already earned. A standing referral
  // isn't retractable at all: there is no listing to withdraw it from, and the
  // code keeps working regardless.
  const saleInFlight = listing && listing.status !== "active";
  const canRetract = r.status === "pending" && !saleInFlight && !isStanding;

  const doRetract = async () => {
    setWorking(true);
    await onRetract(r.id);
    setWorking(false);
    setConfirming(false);
  };

  return (
    <div style={styles.listingRow} className="app-listing-row">
      <div style={styles.rowInfo} className="app-row-info">
        <div style={styles.rowTitle}>
          {isStanding
            ? "Direct deal \u2014 your Promoter code"
            : listing ? `${listing.year} ${listing.make} ${listing.model}` : "Listing no longer available"}
        </div>

        {/* Standing referrals get the /p/ link, which is the one that actually
            works: /s/ resolves a code to a listing and there is none here. */}
        {r.status === "pending" && isStanding && (r.share_code || standingCode) && (
          <PromoterLinkRow code={r.share_code || standingCode} listing={null} standing />
        )}
        {r.status === "pending" && isStanding && !r.share_code && !standingCode && (
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
            Attributed to your Promoter code.
          </div>
        )}
        {r.status === "pending" && !isStanding && r.share_code && (
          <PromoterLinkRow code={r.share_code} listing={listing} />
        )}

        {r.status === "paid" && <div style={styles.soldBadge}>✅ Commission: {fmt(r.commission_amount)} on {r.paid_at}</div>}
        {r.status === "pending" && (
          <div style={styles.promoterTag}>
            ⏳ Pending — you'll earn {listing ? fmt(Math.round(listing.price * 0.01)) : "1%"} when {isStanding ? "a deal completes" : "it sells"}
          </div>
        )}
        {r.status === "flagged" && (
          <div style={{ fontSize: 13, color: "#b45309", marginTop: 6 }}>
            🔍 Under review — we'll confirm this commission before it's paid.
          </div>
        )}
        {r.status === "denied" && (
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
            This referral wasn't eligible for a commission.
          </div>
        )}

        {saleInFlight && r.status === "pending" && (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
            This car has a sale in progress — the link is locked until it settles.
          </div>
        )}

        {canRetract && (
          confirming ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#b91c1c" }}>Retract this referral? Your link will stop working.</span>
              <button
                disabled={working}
                onClick={doRetract}
                style={{ background: "#b91c1c", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: working ? "default" : "pointer", opacity: working ? 0.6 : 1 }}
              >
                {working ? "Retracting…" : "Yes, retract"}
              </button>
              <button
                disabled={working}
                onClick={() => setConfirming(false)}
                style={{ background: "transparent", color: "#475569", border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              style={{ background: "transparent", color: "#b91c1c", border: "none", padding: 0, marginTop: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
            >
              Retract this referral
            </button>
          )
        )}
      </div>
      <span style={{
        ...styles.statusPill,
        background: r.status === "paid" ? "#dcfce7" : r.status === "flagged" ? "#ffedd5" : r.status === "denied" ? "#f1f5f9" : "#fef9c3",
        color: r.status === "paid" ? "#15803d" : r.status === "flagged" ? "#9a3412" : r.status === "denied" ? "#64748b" : "#854d0e",
      }}>{r.status}</span>
    </div>
  );
}

function StatBox({ label, value, color }) {
  return <div style={styles.statBox}><div style={{ ...styles.statValue, color }}>{value}</div><div style={styles.statLabel}>{label}</div></div>;
}

function AdminView({ listings, users, referrals, reports, feedback, userReports, reviews, payouts, disputes, adPlacements, riskFlags, onResolveRiskFlag, onDeleteAd, onCompAd, onRefreshAds, onArchive, onMarkSold, onConfirmReceipt, onResolveReport, onResolveUserReport, onToggleVerified, onResetData, onRecordPayout, onPayoutViaStripe, onResolveDispute, onDeleteUser, onApproveFlaggedReferral, onDenyFlaggedReferral }) {
  const [tab, setTab] = useState("listings");
  const [showDeletedUsers, setShowDeletedUsers] = useState(false);
  const deletedUserCount = (users || []).filter(u => u.deleted_at).length;
  const visibleUsers = showDeletedUsers ? users : (users || []).filter(u => !u.deleted_at);
  const [markingSold, setMarkingSold] = useState(null);
  const [payingOut, setPayingOut] = useState(null);
  // ── Test data toggle ──────────────────────────────────────────────────────
  // Every listing created before real inventory arrived is flagged is_test.
  // Left in, they put $15 of $5 test sales into GMV and made the dashboard
  // useless as a read on the actual business. Off by default: the numbers
  // should mean something at a glance. One click to see everything, because
  // reconciling against Stripe needs the unfiltered set.
  const [showTestData, setShowTestData] = useState(false);
  const testCount = (listings || []).filter(l => l.is_test).length;
  const scopedListings = showTestData ? listings : (listings || []).filter(l => !l.is_test);
  const activeAndSold = scopedListings.filter(l => l.status !== "archived" && l.status !== "removed");
  const totalRevenue = activeAndSold.filter(l => l.status === "sold" || l.status === "pending_confirmation").reduce((s, l) => s + (l.sale_price || 0), 0);
  const platformEarnings = activeAndSold.filter(l => l.status === "sold").reduce((s, l) => s + (l.platform_fee || Math.round((l.sale_price || 0) * 0.01)), 0);
  const totalCommissions = referrals.filter(r => r.status === "paid").reduce((s, r) => s + (r.commission_amount || 0), 0);
  const openReports = reports.filter(r => r.status === "open");

  // ── Ads ──────────────────────────────────────────────────────────────────
  // Bucketed by what you'd actually do about each: running ones are fine,
  // expiring ones are a renewal conversation, and pending_payment is someone
  // who opened Stripe Checkout and never finished — a real lead, not noise.
  const todayStr = new Date().toISOString().slice(0, 10);
  const ads = adPlacements || [];
  const adState = (a) => {
    if (a.status === "pending_payment") return "awaiting payment";
    if (a.status !== "active") return a.status;
    if (a.end_date && a.end_date < todayStr) return "expired";
    if (a.start_date && a.start_date > todayStr) return "scheduled";
    return "running";
  };
  const runningAds = ads.filter(a => adState(a) === "running");
  const pendingAds = ads.filter(a => adState(a) === "awaiting payment");
  // Comped rows are excluded by their explicit flag, not by their zero amount.
  // Same result today, but it survives the day a genuinely free promotional
  // plan exists.
  const adRevenue = ads
    .filter(a => a.status === "active" && !a.comped)
    .reduce((s, a) => s + (a.amount_cents || 0), 0);
  const compedAds = ads.filter(a => a.comped && adState(a) === "running");
  // Within 30 days of expiry and still running — worth an email before it lapses.
  const expiringSoon = runningAds.filter(a => {
    if (!a.end_date) return false;
    const days = (new Date(`${a.end_date}T12:00:00Z`) - Date.now()) / 86400000;
    return days <= 30;
  });
  const openUserReports = (userReports || []).filter(r => r.status === "open");
  const awaitingConfirmation = activeAndSold.filter(l => l.status === "pending_confirmation");
  const openDisputes = (disputes || []).filter(d => d.status === "open");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Admin Panel</h2>
      {testCount > 0 && (
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            style={{ ...styles.pendingBtn, ...(showTestData ? { background: "#dbeafe", color: "#1d4ed8" } : {}) }}
            onClick={() => setShowTestData(v => !v)}
          >
            {showTestData ? "Hide test data" : `Include test data (${testCount})`}
          </button>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {showTestData
              ? "Showing everything, including internal test listings."
              : "Stats and listings below exclude internal test listings."}
          </span>
        </div>
      )}
      <div style={styles.statsRow}>
        <StatBox label="Listings" value={activeAndSold.length} color="#1d4ed8" />
        <StatBox label="Active" value={activeAndSold.filter(l => l.status === "active").length} color="#16a34a" />
        <StatBox label="Sold" value={activeAndSold.filter(l => l.status === "sold").length} color="#7c3aed" />
        <StatBox label="Awaiting Confirmation" value={awaitingConfirmation.length} color="#1d4ed8" />
        <StatBox label="Open Disputes" value={openDisputes.length} color="#dc2626" />
        <StatBox label="GMV" value={fmt(totalRevenue)} color="#b45309" />
        <StatBox label="Your Earnings (1%)" value={fmt(platformEarnings)} color="#16a34a" />
        <StatBox label="Promoter Commissions" value={fmt(totalCommissions)} color="#dc2626" />
        <StatBox label="Open Reports" value={openReports.length} color="#dc2626" />
        <StatBox label="Open User Reports" value={openUserReports.length} color="#dc2626" />
      </div>
      <div style={styles.tabRow}>
        {["listings", "archived", "users", "referrals", "payouts", "ads", "disputes", "reports", "userReports", "feedback", "analytics", "danger"].map(t => <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}), ...(t === "danger" ? { color: tab === "danger" ? "#dc2626" : "#dc2626" } : {}) }} onClick={() => setTab(t)}>{t === "danger" ? "⚠️ Danger Zone" : t === "userReports" ? "User Reports" : t === "analytics" ? "📊 Analytics" : t === "ads" ? "📢 Ads" : t.charAt(0).toUpperCase() + t.slice(1)}{t === "reports" && openReports.length > 0 ? ` (${openReports.length})` : ""}{t === "userReports" && openUserReports.length > 0 ? ` (${openUserReports.length})` : ""}{t === "disputes" && openDisputes.length > 0 ? ` (${openDisputes.length})` : ""}{t === "feedback" && feedback.length > 0 ? ` (${feedback.length})` : ""}{t === "ads" && runningAds.length > 0 ? ` (${runningAds.length})` : ""}</button>)}
      </div>
      {tab === "listings" && (
        <div style={styles.tableWrap}>
          {activeAndSold.filter(l => l.status !== "archived").length === 0 && <p style={{ color: "#6b7280" }}>No listings yet.</p>}
          {activeAndSold.filter(l => l.status !== "archived").map(l => (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={l.image} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>{fmt(l.price)}</div>
                {l.status === "awaiting_payment" && <div style={{ fontSize: 12, color: "#7c5000", marginTop: 2 }}>🏦 Bank transfer in flight — no money settled, no handover code issued</div>}
                {l.status === "pending_confirmation" && <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 2 }}>Sold {fmt(l.sale_price)} on {l.sold_at} • waiting on buyer to confirm receipt{l.release_not_before && new Date(l.release_not_before) > new Date() ? ` • funds held until ${String(l.release_not_before).slice(0, 10)} (bank settlement)` : ""}</div>}
                {l.status === "disputed" && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>⚠️ Disputed — see Disputes tab</div>}
                <RiskFlagPanel flags={(riskFlags || {})[l.id]} onResolve={onResolveRiskFlag} />
              </div>
              <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : l.status === "awaiting_payment" ? "#FFF8E7" : l.status === "pending_confirmation" ? "#dbeafe" : l.status === "disputed" ? "#fee2e2" : "#fee2e2", color: l.status === "active" ? "#15803d" : l.status === "awaiting_payment" ? "#7c5000" : l.status === "pending_confirmation" ? "#1d4ed8" : "#b91c1c" }}>{l.status === "pending_confirmation" ? "awaiting confirmation" : l.status === "awaiting_payment" ? "payment clearing" : l.status}</span>
              {l.status === "active" && <button style={styles.soldBtn} onClick={() => setMarkingSold(l)}>Mark Sold</button>}
              {l.status === "pending_confirmation" && <button style={styles.soldBtn} onClick={() => onConfirmReceipt(l.id)} title="Use only if the buyer isn't responding — normally they confirm themselves">Force Confirm</button>}
              <button style={styles.removeBtn} onClick={() => onArchive(l.id)}>Archive</button>
            </div>
          ))}
          {markingSold && (
            <MarkSoldModal
              listing={markingSold}
              onCancel={() => setMarkingSold(null)}
              onConfirm={(price, buyerEmail) => { onMarkSold(markingSold.id, price, buyerEmail); setMarkingSold(null); }}
            />
          )}
        </div>
      )}
      {tab === "archived" && (
        <div style={styles.tableWrap}>
          <div style={styles.infoBox} >📦 Archived and deleted listings are stored here for audit purposes and cannot be seen by users.</div>
          {scopedListings.filter(l => l.status === "archived" || l.status === "removed").length === 0 && <p style={{ color: "#6b7280", marginTop: 16 }}>No archived listings yet.</p>}
          {scopedListings.filter(l => l.status === "archived" || l.status === "removed").map(l => (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={l.image} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>{fmt(l.price)} • Archived {l.archived_at ? new Date(l.archived_at).toLocaleDateString() : ""}</div>
                {l.sale_price && <div style={styles.soldBadge}>Sold for {fmt(l.sale_price)} on {l.sold_at}</div>}
              </div>
              <span style={{ ...styles.statusPill, background: "#f1f5f9", color: "#6b7280" }}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
      {tab === "users" && (
        <div style={styles.tableWrap}>
          {/* Deleted accounts are anonymized tombstones kept so past
              transactions still resolve to a name. They are real rows, but
              they are not people you can act on — and they accumulate
              forever. Hidden by default so the list stays usable, with a
              toggle for when you actually need to purge them. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
              {visibleUsers.length} user{visibleUsers.length === 1 ? "" : "s"}
              {deletedUserCount > 0 && !showDeletedUsers ? ` · ${deletedUserCount} deleted hidden` : ""}
            </div>
            {deletedUserCount > 0 && (
              <button
                style={{ ...styles.pendingBtn, fontSize: 12 }}
                onClick={() => setShowDeletedUsers(v => !v)}
              >
                {showDeletedUsers ? "Hide deleted" : `Show deleted (${deletedUserCount})`}
              </button>
            )}
          </div>
          {visibleUsers.map((u, i) => {
            const uReviews = (reviews || []).filter(r => r.seller_id === u.id);
            const uRating = uReviews.length ? uReviews.reduce((s, r) => s + r.rating, 0) / uReviews.length : null;
            return (
            <div key={u.id} style={styles.listingRow} className="app-listing-row">
              <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700, minWidth: 28, textAlign: "right" }}>{i + 1}</div>
              <div style={styles.avatar}>{u.name[0]}</div>
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{u.name} {u.verified && <span style={styles.verifiedBadge}>✓ Verified</span>} {uRating != null && <span style={styles.ratingBadge}>⭐ {uRating.toFixed(1)} ({uReviews.length})</span>}</div>
                <div style={styles.rowMeta}>{u.email} • Balance: {fmt(u.balance || 0)}</div>
              </div>
              <span style={{ ...styles.statusPill, background: "#e0e7ff", color: "#3730a3" }}>{u.role}</span>
              {(u.balance || 0) > 0 && <button style={styles.soldBtn} onClick={() => setPayingOut(u)}>Pay Out</button>}
              <button style={u.verified ? styles.removeBtn : styles.pendingBtn} onClick={() => onToggleVerified(u.id, !u.verified)}>
                {u.verified ? "Unverify" : "Verify Seller"}
              </button>
              <button style={styles.removeBtn} onClick={() => onDeleteUser(u.id, u.name, "anonymize")}>Delete Account</button>
              <button
                style={{ ...styles.removeBtn, background: "#7f1d1d", color: "#fff" }}
                title="Permanently remove the account row and all their data. Test/junk accounts only."
                onClick={() => onDeleteUser(u.id, u.name, "purge")}
              >
                Purge
              </button>
            </div>
            );
          })}
          {payingOut && (
            <PayoutModal
              user={payingOut}
              onCancel={() => setPayingOut(null)}
              onConfirm={(amount, method, note) => { onRecordPayout(payingOut.id, amount, method, note); setPayingOut(null); }}
              onPayViaStripe={(amount, note) => { onPayoutViaStripe(payingOut.id, amount, note); setPayingOut(null); }}
            />
          )}
        </div>
      )}
     {tab === "referrals" && (
  <div style={styles.tableWrap}>
    {referrals.length === 0 && <p style={{ color: "#6b7280" }}>No referrals yet.</p>}
    {referrals.map(r => {
      const promoter = users.find(u => u.id === r.promoter_id);
      const listing = listings.find(l => l.id === r.listing_id);
      const badgeStyle = r.status === "paid" ? { background: "#dcfce7", color: "#15803d" }
        : r.status === "flagged" ? { background: "#fee2e2", color: "#b91c1c" }
        : r.status === "denied" ? { background: "#f1f5f9", color: "#6b7280" }
        : { background: "#fef9c3", color: "#854d0e" };
      return (
        <div key={r.id} style={styles.listingRow} className="app-listing-row">
          <div style={styles.rowInfo} className="app-row-info">
            <div style={styles.rowTitle}>{promoter?.name} → {listing ? `${listing.make} ${listing.model}` : r.listing_id}</div>
            <div style={styles.rowMeta}>Code: {r.share_code} • Commission: {fmt(r.commission_amount || 0)}</div>
            {r.status === "flagged" && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>⚠️ Promoter and buyer appear to be the same account — likely self-referral</div>}
          </div>
          <span style={{ ...styles.statusPill, ...badgeStyle }}>{r.status}</span>
          {r.status === "flagged" && (
            <>
              <button style={styles.soldBtn} onClick={() => onApproveFlaggedReferral(r.id)}>Approve & Pay</button>
              <button style={styles.removeBtn} onClick={() => onDenyFlaggedReferral(r.id)}>Deny</button>
            </>
          )}
        </div>
      );
    })}
  </div>
)}
      {tab === "payouts" && (
        <div style={styles.tableWrap}>
          {(payouts || []).length === 0 && <p style={{ color: "#6b7280" }}>No payouts recorded yet.</p>}
          {(payouts || []).map(p => {
            const u = users.find(x => x.id === p.user_id);
            return (
              <div key={p.id} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{u?.name || p.user_id} — {fmt(p.amount)}</div>
                  <div style={styles.rowMeta}>via {p.method} {p.note ? `• "${p.note}"` : ""} • {new Date(p.paid_at).toLocaleDateString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === "ads" && (
        <div style={styles.tableWrap}>
          <CompAdForm onComp={onCompAd} onDone={onRefreshAds} />
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16, fontSize: 14 }}>
            <div><strong>{runningAds.length}</strong> running</div>
            <div><strong>{fmt(adRevenue)}</strong> collected</div>
            {compedAds.length > 0 && (
              <div style={{ color: "#92400e" }}>
                <strong>{compedAds.length}</strong> comped
              </div>
            )}
            {expiringSoon.length > 0 && (
              <div style={{ color: "#b45309" }}>
                <strong>{expiringSoon.length}</strong> expiring within 30 days
              </div>
            )}
            {pendingAds.length > 0 && (
              <div style={{ color: "#6b7280" }}>
                <strong>{pendingAds.length}</strong> abandoned at checkout
              </div>
            )}
          </div>

          {ads.length === 0 && <p style={{ color: "#6b7280" }}>No ad placements yet.</p>}

          {ads.map(a => {
            const state = adState(a);
            const owner = users.find(u => u.id === a.user_id);
            const color =
              state === "running"          ? "#16a34a"
              : state === "expired"        ? "#6b7280"
              : state === "awaiting payment" ? "#b45309"
              : "#1d4ed8";

            // An abandoned checkout is the warmest lead this platform produces:
            // they chose a plan, filled in their business details, and reached
            // the payment page. Everything needed to follow up is already on
            // the row — it was just never surfaced.
            const email = a.contact_email || owner?.email || null;
            const daysAgo = a.created_at
              ? Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000)
              : null;
            const planLabel = a.plan === "12mo" ? "12-month" : a.plan === "6mo" ? "6-month" : "3-month";
            const mailto = email
              ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
                  `Your DriveLink ad placement for ${a.business_name}`,
                )}&body=${encodeURIComponent(
                  `Hi,\n\n` +
                  `We noticed you started setting up a ${planLabel} sidebar ad for ${a.business_name} on DriveLink but didn't finish checking out.\n\n` +
                  `If something went wrong with the payment, or you have questions about placement or reach, just reply here and we'll sort it out.\n\n` +
                  `We can send you a fresh checkout link whenever you're ready.\n\n` +
                  `— DriveLink\ndrivelink.deals`,
                )}`
              : null;

            return (
              <div key={a.id} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>
                    {a.business_name} — {a.comped ? "Comped" : fmt(a.amount_cents)}
                    <span style={{ color, fontWeight: 600, fontSize: 13, marginLeft: 8 }}>· {state}</span>
                  </div>
                  <div style={styles.rowMeta}>
                    {a.plan} • {a.start_date ? `${a.start_date} → ${a.end_date}` : "not yet activated"}
                    {owner?.name ? ` • ${owner.name}` : ""}
                    {daysAgo !== null && ` • started ${daysAgo === 0 ? "today" : `${daysAgo}d ago`}`}
                    {a.comped && a.comped_reason ? ` • ${a.comped_reason}` : ""}
                  </div>
                  <div style={styles.rowMeta}>
                    <a href={a.link_url} target="_blank" rel="noopener noreferrer nofollow">{a.link_url}</a>
                  </div>
                  {email && (
                    <div style={{ ...styles.rowMeta, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                      <a href={`mailto:${email}`}>{email}</a>
                      <CopyButton value={email} />
                      {state === "awaiting payment" && mailto && (
                        <a href={mailto} style={{ color: "#b45309", fontWeight: 600 }}>
                          Email them about it →
                        </a>
                      )}
                    </div>
                  )}
                </div>
                {/* Running placements have no delete control — the row is the
                    advertiser's receipt. The RLS policy refuses them too. */}
                {state !== "running" && state !== "scheduled" && (
                  <button
                    style={{ ...styles.dangerBtn, width: "auto", padding: "8px 14px", fontSize: 13, whiteSpace: "nowrap", alignSelf: "center" }}
                    onClick={() => {
                      if (window.confirm(`Delete the "${a.business_name}" placement? This cannot be undone.`)) {
                        onDeleteAd(a.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {tab === "disputes" && (
        <div style={styles.tableWrap}>
          {(disputes || []).length === 0 && <p style={{ color: "#6b7280" }}>No disputes filed.</p>}
          {(disputes || []).map(d => {
            const listing = listings.find(l => l.id === d.listing_id);
            const buyer = users.find(u => u.id === d.buyer_id);
            const seller = users.find(u => u.id === d.seller_id);
            return (
              <DisputeRow key={d.id} dispute={d} listing={listing} buyer={buyer} seller={seller} onResolve={onResolveDispute} />
            );
          })}
        </div>
      )}
      {tab === "reports" && (
        <div style={styles.tableWrap}>
          {reports.length === 0 && <p style={{ color: "#6b7280" }}>No reports filed.</p>}
          {reports.map(r => {
            const listing = listings.find(l => l.id === r.listing_id);
            const reporter = users.find(u => u.id === r.reporter_id);
            return (
              <div key={r.id} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{r.reason} — {listing ? `${listing.year} ${listing.make} ${listing.model}` : r.listing_id}</div>
                  <div style={styles.rowMeta}>Reported by {reporter?.name || "user"} {r.details ? `• "${r.details}"` : ""}</div>
                </div>
                <span style={{ ...styles.statusPill, background: r.status === "open" ? "#fef9c3" : r.status === "actioned" ? "#fee2e2" : "#f1f5f9", color: r.status === "open" ? "#854d0e" : r.status === "actioned" ? "#b91c1c" : "#6b7280" }}>{r.status}</span>
                {r.status === "open" && (
                  <>
                    <button style={styles.removeBtn} onClick={() => { if (listing) onArchive(listing.id); onResolveReport(r.id, "actioned"); }}>Remove Listing</button>
                    <button style={styles.pendingBtn} onClick={() => onResolveReport(r.id, "dismissed")}>Dismiss</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {tab === "userReports" && (
        <div style={styles.tableWrap}>
          {(userReports || []).length === 0 && <p style={{ color: "#6b7280" }}>No user reports filed.</p>}
          {(userReports || []).map(r => {
            const reportedUser = users.find(u => u.id === r.reported_user_id);
            const reporter = users.find(u => u.id === r.reporter_id);
            return (
              <div key={r.id} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{r.reason} — {reportedUser?.name || r.reported_user_id}</div>
                  <div style={styles.rowMeta}>Reported by {reporter?.name || "user"} {r.details ? `• "${r.details}"` : ""}</div>
                </div>
                <span style={{ ...styles.statusPill, background: r.status === "open" ? "#fef9c3" : r.status === "actioned" ? "#fee2e2" : "#f1f5f9", color: r.status === "open" ? "#854d0e" : r.status === "actioned" ? "#b91c1c" : "#6b7280" }}>{r.status}</span>
                {r.status === "open" && (
                  <>
                    <button style={styles.removeBtn} onClick={() => onResolveUserReport(r.id, "actioned")}>Mark Actioned</button>
                    <button style={styles.pendingBtn} onClick={() => onResolveUserReport(r.id, "dismissed")}>Dismiss</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {tab === "feedback" && (
        <div style={styles.tableWrap}>
          {feedback.length === 0 && <p style={{ color: "#6b7280" }}>No feedback submitted yet.</p>}
          {feedback.map(f => (
            <div key={f.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{f.message}</div>
                <div style={styles.rowMeta}>{f.email ? f.email : "Anonymous"} • {new Date(f.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "analytics" && <AnalyticsView listings={scopedListings} referrals={referrals} users={users} />}
      {tab === "danger" && <DangerZone onResetData={onResetData} />}
    </div>
  );
}

// ── Analytics tab (Admin). Starts with make/model demand — which cars get
// listed most, sell most, and how fast they move — since this is computable
// entirely from data we already have (no new tracking needed). Promoter
// leaderboard and time-series trend sections get added here next.
function AnalyticsView({ listings, referrals, users }) {
  const nonArchived = listings.filter(l => l.status !== "archived");

  // Group by make+model: total listed, sold count, avg price, avg days-to-sell
  // (only computed across listings that actually have both created_at and
  // sold_at — active/unsold listings don't have a days-to-sell yet).
  const byModel = {};
  for (const l of nonArchived) {
    const key = `${l.make} ${l.model}`;
    if (!byModel[key]) byModel[key] = { make: l.make, model: l.model, count: 0, soldCount: 0, totalPrice: 0, totalDaysToSell: 0, soldWithDates: 0 };
    const row = byModel[key];
    row.count++;
    row.totalPrice += l.price || 0;
    if (l.status === "sold") {
      row.soldCount++;
      if (l.created_at && l.sold_at) {
        const days = Math.round((new Date(l.sold_at) - new Date(l.created_at)) / (1000 * 60 * 60 * 24));
        if (days >= 0) { row.totalDaysToSell += days; row.soldWithDates++; }
      }
    }
  }

  const modelRows = Object.values(byModel)
    .map(r => ({
      ...r,
      avgPrice: Math.round(r.totalPrice / r.count),
      avgDaysToSell: r.soldWithDates > 0 ? Math.round(r.totalDaysToSell / r.soldWithDates) : null,
    }))
    .sort((a, b) => b.count - a.count);

  const chartData = modelRows.slice(0, 10).map(r => ({ name: `${r.make} ${r.model}`, listings: r.count, sold: r.soldCount }));

  // Promoter leaderboard: group referrals by promoter, rank by commission earned
  // (the number that actually reflects revenue-driving impact, not just
  // activity). Conversion rate = paid ÷ total shares generated.
  const byPromoter = {};
  for (const r of referrals) {
    if (!byPromoter[r.promoter_id]) byPromoter[r.promoter_id] = { promoter_id: r.promoter_id, totalShares: 0, paidCount: 0, flaggedCount: 0, totalCommission: 0 };
    const row = byPromoter[r.promoter_id];
    row.totalShares++;
    if (r.status === "paid") { row.paidCount++; row.totalCommission += r.commission_amount || 0; }
    if (r.status === "flagged") row.flaggedCount++;
  }
  const promoterRows = Object.values(byPromoter)
    .map(r => ({
      ...r,
      name: users.find(u => u.id === r.promoter_id)?.name || "Unknown",
      conversionRate: r.totalShares > 0 ? Math.round((r.paidCount / r.totalShares) * 100) : 0,
    }))
    .sort((a, b) => b.totalCommission - a.totalCommission)
    .slice(0, 10);

  const totalShares = referrals.length;
  const totalPaid = referrals.filter(r => r.status === "paid").length;
  const overallConversion = totalShares > 0 ? Math.round((totalPaid / totalShares) * 100) : 0;

  // Time-series trends: last 12 weeks, bucketed Sunday-to-Saturday. Weekly
  // rather than daily to smooth out noise at current volume; still recent
  // enough to show real momentum (vs. monthly, which would hide it).
  const WEEKS = 12;
  const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
  const thisWeekStart = startOfWeek(new Date());
  const weekBuckets = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const weekStart = new Date(thisWeekStart);
    weekStart.setDate(weekStart.getDate() - i * 7);
    weekBuckets.push({ weekStart, label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }), newListings: 0, sold: 0, gmv: 0 });
  }
  const bucketFor = (dateStr) => {
    if (!dateStr) return null;
    const ws = startOfWeek(new Date(dateStr)).getTime();
    return weekBuckets.find(b => b.weekStart.getTime() === ws) || null;
  };
  for (const l of listings) {
    const createdBucket = bucketFor(l.created_at);
    if (createdBucket) createdBucket.newListings++;
    if (l.status === "sold" || l.status === "pending_confirmation") {
      const soldBucket = bucketFor(l.sold_at);
      if (soldBucket) { soldBucket.sold++; soldBucket.gmv += l.sale_price || 0; }
    }
  }
  const trendData = weekBuckets.map(b => ({ label: b.label, newListings: b.newListings, sold: b.sold, gmv: b.gmv }));

  return (
    <div>
      <h3 style={styles.sectionTitle}>Demand by Make &amp; Model</h3>
      {modelRows.length === 0 ? (
        <p style={{ color: "#6b7280" }}>Not enough listing data yet.</p>
      ) : (
        <>
          <div style={{ background: "#fff", borderRadius: 14, padding: "20px 20px 8px", marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11 }} height={70} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="listings" fill="#93c5fd" name="Total listed" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sold" fill="#1d4ed8" name="Sold" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={styles.tableWrap}>
            {modelRows.map(r => (
              <div key={`${r.make}-${r.model}`} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{r.make} {r.model}</div>
                  <div style={styles.rowMeta}>
                    {r.count} listed • {r.soldCount} sold • avg {fmt(r.avgPrice)}
                    {r.avgDaysToSell != null && ` • avg ${r.avgDaysToSell} day${r.avgDaysToSell === 1 ? "" : "s"} to sell`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ ...styles.sectionTitle, marginTop: 40 }}>Promoter Leaderboard</h3>
      {referrals.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No referral activity yet.</p>
      ) : (
        <>
          <div style={styles.infoBox}>
            <b>{totalShares}</b> total shares generated → <b>{totalPaid}</b> resulted in a paid sale ({overallConversion}% overall conversion rate)
          </div>
          <div style={{ ...styles.tableWrap, marginTop: 16 }}>
            {promoterRows.map((s, i) => (
              <div key={s.promoter_id} style={styles.listingRow} className="app-listing-row">
                <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700, minWidth: 24, textAlign: "right" }}>{i + 1}</div>
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{s.name}</div>
                  <div style={styles.rowMeta}>
                    {s.totalShares} share{s.totalShares === 1 ? "" : "s"} • {s.paidCount} converted ({s.conversionRate}%) • {fmt(s.totalCommission)} earned
                    {s.flaggedCount > 0 && ` • ⚠️ ${s.flaggedCount} flagged`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ ...styles.sectionTitle, marginTop: 40 }}>Trends (Last 12 Weeks)</h3>
      <div style={{ background: "#fff", borderRadius: 14, padding: "20px 20px 8px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={trendData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 12 }} />
            <YAxis yAxisId="gmv" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Math.round(v / 100000)}k`} />
            <Tooltip formatter={(value, name) => name === "GMV" ? fmt(value) : value} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="count" type="monotone" dataKey="newListings" name="New listings" stroke="#93c5fd" strokeWidth={2} dot={false} />
            <Line yAxisId="count" type="monotone" dataKey="sold" name="Sold" stroke="#1d4ed8" strokeWidth={2} dot={false} />
            <Line yAxisId="gmv" type="monotone" dataKey="gmv" name="GMV" stroke="#16a34a" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DisputeRow({ dispute, listing, buyer, seller, onResolve }) {
  const [note, setNote] = useState("");
  return (
    <div style={styles.listingRow} className="app-listing-row">
      <div style={styles.rowInfo} className="app-row-info">
        <div style={styles.rowTitle}>{dispute.reason} — {listing ? `${listing.year} ${listing.make} ${listing.model}` : dispute.listing_id}</div>
        <div style={styles.rowMeta}>Buyer: {buyer?.name || dispute.buyer_id} • Seller: {seller?.name || dispute.seller_id}</div>
        {dispute.details && <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>"{dispute.details}"</div>}
        {dispute.evidence_urls?.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {dispute.evidence_urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`Evidence ${i + 1}`} style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #e5e7eb" }} />
              </a>
            ))}
          </div>
        )}
        {dispute.status === "open" && (
          <input style={{ ...styles.fieldInput, marginTop: 8, maxWidth: 320 }} placeholder="Resolution note (optional)" value={note} onChange={e => setNote(e.target.value)} />
        )}
        {dispute.status !== "open" && dispute.resolution_note && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Note: "{dispute.resolution_note}"</div>}
      </div>
      <span style={{ ...styles.statusPill, background: dispute.status === "open" ? "#fef9c3" : dispute.status === "refunded" ? "#fee2e2" : "#f1f5f9", color: dispute.status === "open" ? "#854d0e" : dispute.status === "refunded" ? "#b91c1c" : "#6b7280" }}>{dispute.status}</span>
      {dispute.status === "open" && (
        <>
          <button style={styles.removeBtn} onClick={() => onResolve(dispute.id, "refunded", note)} title="Only marks it here — you still issue the actual refund in Stripe">Mark Refunded</button>
          <button style={styles.pendingBtn} onClick={() => onResolve(dispute.id, "dismissed", note)}>Dismiss</button>
        </>
      )}
    </div>
  );
}

// Open risk flags for one listing, rendered inline on the row they belong to
// rather than in a tab of their own. A twelfth tab would have to be remembered
// and visited; a flag is only ever interesting next to the sale it is holding
// up, and the Force Confirm button that finishes the job is already on this row.
// (The tab bar is also the known clipped-at-both-edges mobile bug — see the CSS
// note further down — and widening it would make that worse.)
//
// Renders nothing when there are no open flags, which is the normal case.
function RiskFlagPanel({ flags, onResolve }) {
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState("");

  if (!flags || flags.length === 0) return null;

  const total = flags.reduce((sum, f) => sum + (f.score || 0), 0);
  const severityColor = {
    critical: "#b91c1c", high: "#c2410c", medium: "#a16207",
    low: "#4b5563", info: "#6b7280",
  };

  const choose = (flagId, resolution) => {
    onResolve(flagId, resolution, note);
    setOpenId(null);
    setNote("");
  };

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#854d0e", marginBottom: 6 }}>
        ⚠️ {flags.length} open risk {flags.length === 1 ? "flag" : "flags"} · score {total}
      </div>

      {flags.map(f => (
        <div key={f.id} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: severityColor[f.severity] || "#4b5563" }}>
              {f.flag_code}
            </span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {f.severity} · {f.score} pts
            </span>
            <button
              style={{ ...styles.pendingBtn, padding: "2px 8px", fontSize: 11 }}
              onClick={() => { setOpenId(openId === f.id ? null : f.id); setNote(""); }}
            >
              {openId === f.id ? "Cancel" : "Resolve"}
            </button>
          </div>

          {/* The evaluator writes the numbers it actually compared into details.
              Showing them raw beats paraphrasing: PRICE_OVER_MARKET means
              nothing without the ratio it tripped on. */}
          {f.details && Object.keys(f.details).length > 0 && (
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
              {Object.entries(f.details).map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </div>
          )}

          {openId === f.id && (
            <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid #fcd34d" }}>
              <input
                style={{ ...styles.fieldInput, maxWidth: 320, fontSize: 12, padding: "4px 8px" }}
                placeholder="Why? (optional, but future-you will want it)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <button style={{ ...styles.soldBtn, padding: "3px 10px", fontSize: 11 }}
                  onClick={() => choose(f.id, "false_positive")}
                  title="The rule misfired — this transaction is fine">
                  False positive
                </button>
                <button style={{ ...styles.soldBtn, padding: "3px 10px", fontSize: 11 }}
                  onClick={() => choose(f.id, "released")}
                  title="The flag was fair, but you reviewed it and it's OK to pay">
                  Reviewed — OK to pay
                </button>
                <button style={{ ...styles.pendingBtn, padding: "3px 10px", fontSize: 11 }}
                  onClick={() => choose(f.id, "held")}
                  title="Deliberately not paying yet. Recorded, funds stay held.">
                  Keep held
                </button>
                <button style={{ ...styles.removeBtn, padding: "3px 10px", fontSize: 11 }}
                  onClick={() => choose(f.id, "refunded")}
                  title="You refunded in Stripe — this records why">
                  Refunded
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 11, color: "#854d0e", marginTop: 6 }}>
        Clearing every blocking flag doesn't pay anyone by itself — press Force Confirm afterwards.
      </div>
    </div>
  );
}

function DangerZone({ onResetData }) {
  const [selected, setSelected] = useState({
    activeListings: false, soldListings: false, archivedListings: false,
    referrals: true, messages: true, reports: true,
    savedSearchesFlag: true, feedbackFlag: false, resetBalances: true,
  });
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const toggle = (k) => setSelected(s => ({ ...s, [k]: !s[k] }));
  const anySelected = Object.values(selected).some(Boolean);
  const canRun = confirmText.trim().toUpperCase() === "DELETE" && anySelected;

  const run = async () => {
    setRunning(true);
    await onResetData(selected);
    setRunning(false);
    setDone(true);
    setConfirmText("");
    setTimeout(() => setDone(false), 4000);
  };

  return (
    <div style={styles.dangerBox}>
      <h3 style={styles.dangerTitle}>⚠️ Reset Test Data</h3>
      <p style={styles.dangerSub}>
        This permanently deletes data from your live database. Use this to clear out testing
        entries before real users show up — it does <b>not</b> delete user accounts, so nobody loses their login.
      </p>
      <div style={styles.dangerChecks}>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.activeListings} onChange={() => toggle("activeListings")} /> Active listings</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.soldListings} onChange={() => toggle("soldListings")} /> Sold listings</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.archivedListings} onChange={() => toggle("archivedListings")} /> Archived listings</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.referrals} onChange={() => toggle("referrals")} /> Referrals & share links</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.messages} onChange={() => toggle("messages")} /> Messages</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.reports} onChange={() => toggle("reports")} /> Reports</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.savedSearchesFlag} onChange={() => toggle("savedSearchesFlag")} /> Saved searches</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.feedbackFlag} onChange={() => toggle("feedbackFlag")} /> Feedback submissions</label>
        <label style={styles.dangerCheckRow}><input type="checkbox" checked={selected.resetBalances} onChange={() => toggle("resetBalances")} /> Reset all user balances to $0 (keeps accounts)</label>
      </div>
      <div style={styles.dangerConfirmRow}>
        <label style={styles.fieldLabel}>Type DELETE to confirm</label>
        <input style={styles.fieldInput} value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="DELETE" />
      </div>
      <button
        style={{ ...styles.dangerBtn, opacity: canRun && !running ? 1 : 0.5, cursor: canRun && !running ? "pointer" : "not-allowed" }}
        onClick={run}
        disabled={!canRun || running}
      >
        {running ? "Clearing…" : "Permanently Clear Selected Data"}
      </button>
      {done && <div style={styles.dangerDone}>✅ Selected data cleared.</div>}
    </div>
  );
}

const styles = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#111827" },
  legalPage: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  legalInner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  legalInlineLink: { background: "none", border: "none", padding: 0, color: "#1d4ed8", cursor: "pointer", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" },
  legalBackBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 32 },
  legalTitle: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 8 },
  legalUpdated: { fontSize: 13, color: "#9ca3af", marginBottom: 24 },
  legalDisclaimer: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", fontSize: 14, color: "#92400e", lineHeight: 1.6, marginBottom: 32 },
  legalBody: { fontSize: 15, color: "#374151", lineHeight: 1.7 },
  appFooter: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px 40px", paddingBottom: "calc(40px + env(safe-area-inset-bottom, 0px))", display: "flex", gap: 10, rowGap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center", fontSize: 13, boxSizing: "border-box" },
  appFooterLink: { background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 0, whiteSpace: "nowrap" },
  // paddingTop reserves the iOS status-bar strip when the PWA runs standalone
  // with viewport-fit=cover. Resolves to 0px everywhere else.
  nav: { background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 100, paddingTop: "env(safe-area-inset-top, 0px)" },
  navInner: { maxWidth: 1200, margin: "0 auto", padding: "0 16px", height: 64, display: "flex", alignItems: "center", gap: 16, boxSizing: "border-box" },
  logo: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 },
  logoImg: { height: 30, width: "auto", display: "block" },
  logoIcon: { fontSize: 22 },
  logoText: { fontWeight: 800, fontSize: 20, color: "#0f172a", letterSpacing: "-0.03em" },
  // Five items fit at 360px, so this no longer needs to scroll or be dragged.
  // Centred rather than flex-start: left-aligned links left a dead gap between
  // the last item and the account controls on wide screens.
  navLinks: { display: "flex", gap: 2, flex: 1, minWidth: 0, justifyContent: "center", overflowX: "auto", flexWrap: "nowrap", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" },
  avatarBtn: { display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "3px 6px 3px 3px", borderRadius: 999 },
  caret: { fontSize: 11, color: "#6b7280", lineHeight: 1 },
  navUnread: { background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 999, minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px", lineHeight: 1 },
  menu: { position: "absolute", right: 0, top: "calc(100% + 10px)", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,.14)", minWidth: 220, padding: 6, zIndex: 200 },
  menuHeader: { padding: "8px 12px 10px", borderBottom: "1px solid #f1f5f9", marginBottom: 4 },
  menuItem: { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "9px 12px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#374151", cursor: "pointer" },
  menuItemActive: { background: "#f1f5f9", color: "#0f172a", fontWeight: 700 },
  menuDivider: { height: 1, background: "#f1f5f9", margin: "6px 0" },
  menuRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 12px" },
  menuRowLabel: { fontSize: 13, color: "#6b7280", fontWeight: 600 },
  adRailInner: { background: "linear-gradient(160deg, #1a1a2e, #16213e)", border: "1px dashed #FFB020", borderRadius: 12, padding: "22px 16px", color: "#fff", textAlign: "center", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", boxSizing: "border-box" },
  navBtn: { background: "none", border: "none", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#4b5563", flexShrink: 0, whiteSpace: "nowrap" },
  navBtnActive: { background: "#f1f5f9", color: "#0f172a" },
  navRight: { marginLeft: "auto" },
  userChip: { display: "flex", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  userName: { fontSize: 13, fontWeight: 600, color: "#0f172a" },
  userRole: { fontSize: 11, color: "#6b7280", textTransform: "capitalize" },
  balanceBadge: { background: "#dcfce7", color: "#15803d", fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 20 },
  logoutBtn: { background: "none", border: "1px solid #e5e7eb", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#4b5563" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "0 24px 64px" },
  hero: { background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)", margin: "0 -24px", padding: "72px 24px" },
  heroInner: { maxWidth: 680, margin: "0 auto", textAlign: "center" },
  heroBadge: { display: "inline-block", background: "rgba(255,255,255,.12)", color: "#94a3b8", fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, marginBottom: 20 },
  heroTitle: { fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 16 },
  heroAccent: { color: "#60a5fa" },
  heroSub: { fontSize: 18, color: "#94a3b8", lineHeight: 1.6, marginBottom: 36, maxWidth: 520, marginLeft: "auto", marginRight: "auto" },
  heroStats: { display: "flex", gap: 32, alignItems: "center", justifyContent: "center" },
  heroStat: { display: "flex", flexDirection: "column", gap: 2, alignItems: "center", textAlign: "center" },
  heroStatNum: { fontSize: 28, fontWeight: 800, color: "#fff" },
  heroStatLabel: { fontSize: 13, color: "#64748b" },
  heroStatDiv: { width: 1, height: 40, background: "#334155" },
  filterBar: { display: "flex", gap: 16, alignItems: "center", padding: "24px 0 16px", flexWrap: "wrap" },
  searchInput: { flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", background: "#fff" },
  filterGroup: { display: "flex", flexDirection: "column", gap: 4, minWidth: 200 },
  filterLabel: { fontSize: 12, color: "#6b7280", fontWeight: 500 },
  rangeInput: { width: "100%", accentColor: "#3b82f6" },
  selectInput: { padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, background: "#fff", cursor: "pointer" },
  viewToggle: { display: "flex", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" },
  viewToggleBtn: { padding: "9px 14px", background: "#fff", border: "none", fontSize: 13, fontWeight: 600, color: "#4b5563", cursor: "pointer" },
  viewToggleBtnActive: { background: "#0f172a", color: "#fff" },
  saveSearchBtn: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 24, paddingTop: 8 },
  card: { background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.08)", transition: "transform .2s,box-shadow .2s" },
  cardImgWrap: { position: "relative", height: 200, overflow: "hidden" },
  cardImg: { width: "100%", height: "100%", objectFit: "cover" },
  cardPrice: { position: "absolute", bottom: 12, right: 12, background: "#0f172a", color: "#fff", fontWeight: 800, fontSize: 16, padding: "6px 14px", borderRadius: 10 },
  favoriteBtn: { position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,.9)", border: "none", width: 34, height: 34, borderRadius: "50%", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.15)" },
  pendingRibbon: { position: "absolute", top: 12, left: 12, background: "#f59e0b", color: "#fff", fontWeight: 700, fontSize: 11, padding: "4px 10px", borderRadius: 8, textTransform: "uppercase", letterSpacing: ".03em" },
  cardBody: { padding: "18px 20px 20px" },
  cardTitleRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a" },
  verifiedBadge: { fontSize: 11, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 20 },
  unverifiedBadge: { fontSize: 11, fontWeight: 700, color: "#b45309", background: "#fffbeb", padding: "2px 8px", borderRadius: 20 },
  ratingBadge: { fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 20 },
  cardMeta: { display: "flex", gap: 16, fontSize: 13, color: "#6b7280", marginBottom: 10, flexWrap: "wrap" },
  priceCompare: { fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, display: "inline-block", marginBottom: 10 },
  similarLink: { display: "block", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#1d4ed8", fontWeight: 600, padding: 0, marginBottom: 10, textAlign: "left" },
  compareToggleBtn: { display: "inline-block", background: "#fff", border: "1px solid #e5e7eb", color: "#374151", fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 10 },
  compareToggleBtnActive: { background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" },
  compareBar: { position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #e5e7eb", boxShadow: "0 -4px 16px rgba(0,0,0,.08)", zIndex: 200, padding: "12px 24px" },
  compareBarInner: { maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 },
  compareBarRemove: { background: "#f1f5f9", border: "none", borderRadius: 6, width: 20, height: 20, fontSize: 11, color: "#6b7280", cursor: "pointer", flexShrink: 0 },
  compareBarClear: { background: "none", border: "none", fontSize: 12, color: "#9ca3af", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
  compareCloseBtn: { background: "#f1f5f9", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 14, color: "#374151" },
  compareTable: { width: "100%", borderCollapse: "collapse", minWidth: 560 },
  compareTableHeaderCell: { padding: "8px 16px", textAlign: "center", verticalAlign: "top", borderBottom: "2px solid #e5e7eb", minWidth: 180 },
  compareTableLabelCell: { padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" },
  compareTableCell: { padding: "10px 16px", fontSize: 14, color: "#374151", textAlign: "center", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" },
  compareTableCellBest: { background: "#f0fdf4", color: "#15803d", fontWeight: 700, borderRadius: 6 },
  cardDesc: { fontSize: 13, color: "#374151", lineHeight: 1.5, marginBottom: 10 },
  vinRow: { fontSize: 12, color: "#6b7280", marginBottom: 12 },
  translateLink: { background: "none", border: "none", padding: 0, marginTop: 6, color: "#1d4ed8", fontWeight: 600, fontSize: 13, cursor: "pointer", textDecoration: "underline" },
  vinLink: { color: "#1d4ed8", fontWeight: 600, textDecoration: "none" },
  refTag: { background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 8, marginBottom: 12 },
  escrowBox: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", marginBottom: 14 },
  escrowBoxPending: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginBottom: 14 },
  escrowBoxTitle: { fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 4 },
  escrowBoxText: { fontSize: 12.5, color: "#4b5563", lineHeight: 1.55 },
  cardActions: { display: "flex", gap: 10 },
  cardSecondaryActions: { display: "flex", gap: 16, marginTop: 12, justifyContent: "center" },
  messageLink: { background: "none", border: "none", color: "#4b5563", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  reportLink: { background: "none", border: "none", color: "#9ca3af", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  buyBtn: { flex: 1, background: "#0f172a", color: "#fff", border: "none", padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  shareBtn: { flex: 1, color: "#fff", border: "none", padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "background .3s" },
  offerBtn: { width: "100%", background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb", padding: "9px 0", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8 },
  offerStatusRow: { fontSize: 13, color: "#1d4ed8", fontWeight: 600, background: "#eff6ff", padding: "8px 12px", borderRadius: 8, marginTop: 8 },
  dealCheckBtn: { width: "100%", background: "#fff", color: "#1d4ed8", border: "1px solid #bfdbfe", padding: "9px 0", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8 },
  dealCheckPanel: { borderRadius: 10, padding: "12px 14px", marginTop: 8 },
  dealCheckRefresh: { background: "none", border: "none", color: "#6b7280", fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: 6 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" },
  modalBox: { background: "#fff", borderRadius: 20, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)", boxSizing: "border-box" },
  detailBox: { background: "#fff", borderRadius: 20, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.25)", boxSizing: "border-box", position: "relative" },
  detailCloseBtn: { position: "absolute", top: 14, right: 14, zIndex: 2, background: "rgba(15,23,42,.7)", color: "#fff", border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 14 },
  detailGalleryWrap: { position: "relative", width: "100%", height: 380, background: "#0f172a" },
  detailMainImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  detailGalleryNav: { position: "absolute", top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,.5)", color: "#fff", border: "none", width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 20 },
  detailGalleryCount: { position: "absolute", bottom: 12, right: 12, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 20 },
  detailThumbRow: { display: "flex", gap: 8, padding: "12px 20px 0", overflowX: "auto" },
  detailThumb: { width: 64, height: 48, objectFit: "cover", borderRadius: 8, cursor: "pointer", flexShrink: 0 },
  detailBody: { padding: 24 },
  modalTitle: { fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 12 },
  modalText: { fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 10 },
  modalActions: { display: "flex", gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, background: "#f1f5f9", border: "none", padding: "12px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  confirmBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "12px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  pageWrap: { width: "100%", maxWidth: 1200, margin: "0 auto", minWidth: 0, paddingTop: 36, boxSizing: "border-box" },
  pageTitle: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 24, letterSpacing: "-0.02em" },
  tableWrap: { display: "flex", flexDirection: "column", gap: 12 },
  // Image + info + status pill + up to three buttons cannot fit on a 360px
  // phone in one line. Without wrap the row sets the document's min-width and
  // the whole page scrolls sideways.
  listingRow: { background: "#fff", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, rowGap: 10, flexWrap: "wrap", boxShadow: "0 1px 4px rgba(0,0,0,.06)", boxSizing: "border-box", maxWidth: "100%" },
  offerRow: { background: "#f8fafc", borderRadius: 12, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, rowGap: 8, flexWrap: "wrap", marginTop: 6, marginLeft: 16, border: "1px dashed #e5e7eb", boxSizing: "border-box", maxWidth: "100%" },
  rowImg: { width: 80, height: 60, borderRadius: 8, objectFit: "cover", flexShrink: 0 },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  rowMeta: { fontSize: 13, color: "#6b7280", marginTop: 3 },
  soldBadge: { display: "inline-block", background: "#dcfce7", color: "#15803d", fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, marginTop: 6 },
  awaitingBadge: { display: "inline-block", background: "#dbeafe", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, marginTop: 6 },
  promoterTag: { display: "inline-block", background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, marginTop: 6 },
  statusPill: { flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: ".04em" },
  soldBtn: { background: "#dcfce7", color: "#15803d", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  pendingBtn: { background: "#fef9c3", color: "#854d0e", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  removeBtn: { background: "#fee2e2", color: "#dc2626", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  reportBtn: { background: "#fff", color: "#b91c1c", border: "1px solid #fecaca", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  formCard: { background: "#fff", borderRadius: 16, padding: 32, maxWidth: 640, boxShadow: "0 1px 4px rgba(0,0,0,.07)" },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  fieldLabel: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" },
  fieldInput: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box" },
  textarea: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" },
  statsRow: { display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  statBox: { background: "#fff", borderRadius: 14, padding: "16px 18px", minWidth: 130, flex: "1 1 130px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", boxSizing: "border-box" },
  statValue: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" },
  statLabel: { fontSize: 12, color: "#6b7280", fontWeight: 500, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 16 },
  infoBox: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "16px 20px", fontSize: 13, color: "#1e40af", lineHeight: 1.6, marginTop: 24 },
  safetyBanner: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 20px", fontSize: 14, color: "#92400e", marginBottom: 20 },
  safetyBannerLink: { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#92400e", fontWeight: 700, textDecoration: "underline", padding: 0 },
  // 11 tabs will never wrap cleanly, so this scrolls sideways on its own rather
  // than forcing the whole document wider than the viewport — which is what was
  // clipping the footer and the stat cards at both edges on a phone.
  tabRow: { display: "flex", gap: 4, marginBottom: 20, flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "thin", paddingBottom: 6, maxWidth: "100%" },
  tab: { padding: "8px 18px", borderRadius: 8, border: "none", background: "none", fontSize: 14, fontWeight: 500, color: "#6b7280", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" },
  tabActive: { background: "#f1f5f9", color: "#0f172a", fontWeight: 700 },
  toast: { position: "fixed", bottom: 24, right: 24, zIndex: 9999, color: "#fff", fontWeight: 600, fontSize: 14, padding: "14px 20px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.2)", maxWidth: 360 },
  dangerBox: { background: "#fef2f2", border: "2px solid #fecaca", borderRadius: 16, padding: 28, maxWidth: 560 },
  dangerTitle: { fontSize: 18, fontWeight: 800, color: "#b91c1c", marginBottom: 10 },
  dangerSub: { fontSize: 13, color: "#7f1d1d", lineHeight: 1.6, marginBottom: 20 },
  dangerChecks: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 20, background: "#fff", padding: 16, borderRadius: 10, border: "1px solid #fecaca" },
  dangerCheckRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", cursor: "pointer" },
  dangerConfirmRow: { marginBottom: 16 },
  dangerBtn: { width: "100%", background: "#dc2626", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, fontSize: 14, fontWeight: 700 },
  dangerDone: { marginTop: 14, fontSize: 13, color: "#15803d", fontWeight: 600 },
};

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f8fafc; overflow-x: hidden; }
  img { max-width: 100%; }
  .car-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,.12) !important; }
  input:focus, select:focus, textarea:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
  button:active { opacity: .85; }

  .legalBody h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 8px; }
  .legalBody h2:first-child { margin-top: 0; }
  .legalBody p { margin-bottom: 4px; }

  /* Nav: let the middle links scroll horizontally instead of squeezing everything */
  .app-nav-inner { gap: 12px; }
  .app-nav-links { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .app-nav-links::-webkit-scrollbar { display: none; }
  .app-nav-links button { white-space: nowrap; flex-shrink: 0; }

  /* Sidebar ad: a real layout column beside main content (not floating on
     top of it), filling the full empty space to each side and running the
     full height of the page. Only shown on wide desktop viewports where
     there's actual spare space — hidden entirely below 1300px. */
  .app-content-row {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: 20px;
  }
  /* A flex child defaults to min-width:auto, which refuses to shrink below its
     own content. One wide row — the 11-tab admin bar — therefore pushed this
     whole column wider than the screen, and justify-content:center spilled the
     excess out BOTH sides while body{overflow-x:hidden} removed any way to
     scroll to it. That is the "clipped at both edges" admin bug. */
  .app-content-row > * { min-width: 0; }
  .app-main { min-width: 0; max-width: 100%; }
  .app-ad-rail {
    display: none;
    flex: 1 1 0;
    min-width: 160px;
    max-width: 340px;
    position: sticky;
    top: 90px;
    align-self: flex-start;
    height: calc(100vh - 110px);
    cursor: pointer;
    transition: transform 0.15s ease;
  }
  .app-ad-rail:hover { transform: translateY(-2px); }
  @media (min-width: 1300px) {
    .app-ad-rail { display: block; }
  }

  @media (max-width: 860px) {
    .app-nav-inner { padding: 0 16px !important; height: auto !important; flex-wrap: wrap; padding-top: 10px !important; padding-bottom: 10px !important; }
    .app-logo { order: 1; }
    .app-nav-right { order: 2; margin-left: auto !important; }
    /* This row centers its items on wide screens (styles.navLinks has
       justify-content: "center"), but center + overflow-x: auto on a flex
       row that doesn't fit is a classic trap: the browser centers the
       overflow, so the row loads scrolled to the middle with BOTH the first
       and last items clipped and no visible hint that it scrolls at all.
       flex-start here keeps it centered on the screens it fits on above,
       while narrow screens load scrolled to the true start instead. */
    .app-nav-links { order: 3; width: 100%; flex: none !important; justify-content: flex-start !important; }
    .app-user-text { display: none; }
  }

  @media (max-width: 700px) {
    .app-main { padding: 0 16px 48px !important; }
    .app-hero { margin: 0 -16px !important; padding: 40px 16px !important; }
    .app-hero-title { font-size: 32px !important; }
    .app-hero-stats { gap: 20px !important; flex-wrap: wrap; }
    .app-grid { grid-template-columns: 1fr !important; }
    .app-form-grid { grid-template-columns: 1fr !important; }
    /* The inline style on rowInfo is "flex: 1", and the shorthand expands to
       flex-basis: 0%. An inline declaration outranks a stylesheet one, so the
       old "flex-basis: 100%" here silently never applied — the info block kept
       sharing one line with the image, the status pill and every button, and
       got crushed into a column a few words wide. "order: 1" was NOT
       overridden (different property), so the text also rendered AFTER the
       buttons. Hence: image left, buttons stranded mid-row, title and price
       squeezed down the right-hand edge.

       Fix is the "flex" shorthand with !important so it beats the inline
       rule, and dropping "order" so the DOM sequence (image, info, pill, buttons)
       holds. The basis is calc(100% - 96px) = the row minus the 80px thumbnail
       and the 16px gap: image and text share line one, everything after wraps
       to line two. */
    .app-listing-row { flex-wrap: wrap; }
    .app-row-info { flex: 1 1 calc(100% - 96px) !important; }
  }

  @media (max-width: 480px) {
    .app-toast { left: 16px !important; right: 16px !important; bottom: 16px !important; max-width: none !important; }
    .app-user-chip button { padding: 5px 8px !important; font-size: 12px !important; }
  }
`;
