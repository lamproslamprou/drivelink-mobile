import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";
import Auth from "./Auth.jsx";
import Landing from "./Landing.jsx";
import ImageUpload from "./ImageUpload.jsx";
import Messages from "./Messages.jsx";
import ListingsMap, { geocode } from "./ListingsMap.jsx";
import logoIcon from "./assets/logo-icon.png";

const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const STRIPE_LINK = "https://buy.stripe.com/4gM4gz0z05sNaa9afu4Vy00";
const PLATFORM_FEE = 0.01; // 1% platform fee
const PROMOTER_FEE = 0.01; // 1% promoter commission
const STALE_WARN_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // show "seller inactive" badge after 30 days
const STALE_ARCHIVE_DAYS_MS = 60 * 24 * 60 * 60 * 1000; // auto-archive after 60 days

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

export default function App() {
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
  const [disputes, setDisputes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [openThread, setOpenThread] = useState(null);
  const [view, setView] = useState("landing");
  const [homeResetKey, setHomeResetKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null); // { status: 'success' | 'error', message? }
  const [returnToAdvertise, setReturnToAdvertise] = useState(false);
  const [viewingListing, setViewingListing] = useState(null); // { listing, seller, myRef, sellerRating, sellerReviewCount, myOffer }

  // ── Nav bar horizontal scrolling. It has overflow-x:auto for touch/trackpad,
  // but a plain vertical mouse wheel and click-drag don't scroll horizontal
  // content by default in most browsers — only arrow keys and a visible
  // scrollbar (which we hide) worked before. These two handlers add both.
  const navRef = useRef(null);
  const navDrag = useRef({ active: false, startX: 0, startScrollLeft: 0 });

  const handleNavWheel = (e) => {
    const el = navRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // nothing to scroll
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };

  const handleNavMouseDown = (e) => {
    const el = navRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    navDrag.current = { active: true, startX: e.pageX, startScrollLeft: el.scrollLeft };
    el.style.cursor = "grabbing";
  };
  const handleNavMouseMove = (e) => {
    if (!navDrag.current.active || !navRef.current) return;
    e.preventDefault();
    navRef.current.scrollLeft = navDrag.current.startScrollLeft - (e.pageX - navDrag.current.startX);
  };
  const endNavDrag = () => {
    navDrag.current.active = false;
    if (navRef.current) navRef.current.style.cursor = "";
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    const { data: listingsData } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
    const { data: referralsData } = await supabase.from("referrals").select("*");
    const { data: usersData } = await supabase.from("users").select("*");
    const { data: reportsData } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
    const { data: feedbackData } = await supabase.from("feedback").select("*").order("created_at", { ascending: false });
    const { data: userReportsData } = await supabase.from("user_reports").select("*").order("created_at", { ascending: false });
    const { data: reviewsData } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
    const { data: payoutsData } = await supabase.from("payouts").select("*").order("paid_at", { ascending: false });
    const { data: disputesData } = await supabase.from("disputes").select("*").order("created_at", { ascending: false });
    const { data: offersData } = await supabase.from("offers").select("*").order("created_at", { ascending: false });
    let finalListings = listingsData || [];
    // ── Auto-archive listings whose seller has gone quiet for 60+ days (best-effort,
    // runs opportunistically whenever anyone loads the app — there's no cron here).
    if (listingsData) {
      const now = Date.now();
      const staleIds = listingsData
        .filter(l => l.status === "active" && l.last_active_at && (now - new Date(l.last_active_at).getTime()) > STALE_ARCHIVE_DAYS_MS)
        .map(l => l.id);
      if (staleIds.length) {
        const archivedAt = new Date().toISOString();
        await supabase.from("listings").update({ status: "archived", archived_at: archivedAt }).in("id", staleIds);
        finalListings = finalListings.map(l => staleIds.includes(l.id) ? { ...l, status: "archived", archived_at: archivedAt } : l);
      }
    }
    if (finalListings) setListings(finalListings);
    if (referralsData) setReferrals(referralsData);
    if (usersData) setUsers(usersData);
    if (reportsData) setReports(reportsData);
    if (feedbackData) setFeedback(feedbackData);
    if (userReportsData) setUserReports(userReportsData);
    if (reviewsData) setReviews(reviewsData);
    if (payoutsData) setPayouts(payoutsData);
    if (disputesData) setDisputes(disputesData);
    if (offersData) setOffers(offersData);
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
        showToast("Payouts are set up — you're all set to get paid automatically.");
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUser(session?.user ?? null);
      loadDbUser(session?.user ?? null);
      setAuthChecked(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      loadDbUser(session?.user ?? null);
    });
    loadData();
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (currentUser) loadDbUser(currentUser);
  }, [users]);

  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setDbUser(null);
    setView("home");
  };

  // ── Buy Now — creates a real Stripe Checkout session at the listing's price
  // via the create-checkout-session Edge Function, instead of the old static
  // payment link. Funds land on the platform's Stripe balance and are held
  // until the buyer confirms receipt (or 7 days pass with no dispute).
  const handleBuyNow = async (listing) => {
    showToast("Redirecting to secure checkout…", "info");
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { listing_id: listing.id },
    });
    if (error || !data?.url) {
      showToast(data?.error || error?.message || "Couldn't start checkout — try again.", "error");
      return;
    }
    window.location.href = data.url;
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
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("listings").insert(newListing);
    if (error) { showToast("Error posting listing", "error"); return; }
    await loadData();
    showToast("Listing posted successfully!");
    setView("myListings");
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
      sold_at: new Date().toISOString().slice(0, 10),
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
    // Sales that went through real Stripe Checkout (have a payment_intent)
    // route through release-funds so the seller actually gets paid via
    // Stripe transfer. Sales entered manually via markSold (off-platform/cash,
    // no stripe_payment_intent_id) keep the old direct-update behavior since
    // there's no real Stripe charge behind them to release.
    if (listing.stripe_payment_intent_id) {
      const { data, error } = await supabase.functions.invoke("release-funds", { body: { listing_id: listingId } });
      if (error || data?.error) {
        showToast(data?.error || error?.message || "Couldn't release funds — try again.", "error");
        return;
      }
      await loadData();
      showToast("Receipt confirmed — seller paid out and commission released.");
      return;
    }
    const promoterCommission = Math.round((listing.sale_price || 0) * PROMOTER_FEE);
    await supabase.from("listings").update({ status: "sold", confirmed_at: new Date().toISOString() }).eq("id", listingId);
    const ref = referrals.find(r => r.listing_id === listingId && r.status === "pending");
    if (ref) {
      await supabase.from("referrals").update({ status: "paid", commission_amount: promoterCommission, paid_at: new Date().toISOString().slice(0, 10) }).eq("id", ref.id);
      const promoter = users.find(u => u.id === ref.promoter_id);
      await supabase.from("users").update({ balance: (promoter?.balance || 0) + promoterCommission }).eq("id", ref.promoter_id);
    }
    await loadData();
    showToast("Receipt confirmed — sale finalized and commission released.");
  };

  // ── Buyer disputes a pending sale instead of confirming receipt (car not as
  // described, seller no-show, etc). Flips the listing to "disputed" so it's out
  // of the normal flow until an admin reviews it.
  const fileDispute = async (listingId, reason, details) => {
    const listing = listings.find(l => l.id === listingId);
    if (!listing) return;
    const row = { id: "disp" + Date.now(), listing_id: listingId, buyer_id: currentUser.id, seller_id: listing.seller_id, reason, details, status: "open" };
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
    const patch = { status: action, responded_at: new Date().toISOString() };
    if (action === "countered") { patch.counter_amount = counterAmount; patch.counter_message = counterMessage; }
    await supabase.from("offers").update(patch).eq("id", offerId);
    await loadData();
    showToast(
      action === "accepted" ? "Offer accepted — coordinate with the buyer and mark the listing sold at this price when the deal closes."
      : action === "declined" ? "Offer declined."
      : "Counter-offer sent."
    );
  };

  // ── Buyer accepts a seller's counter-offer, or withdraws their offer entirely.
  const respondToCounter = async (offerId, accept) => {
    await supabase.from("offers").update({ status: accept ? "accepted" : "withdrawn", responded_at: new Date().toISOString() }).eq("id", offerId);
    await loadData();
    showToast(accept ? "Counter-offer accepted — the seller will follow up to close the sale." : "Offer withdrawn.");
  };

  // ── Generate share link
  const generateShare = async (listingId) => {
    const existing = referrals.find(r => r.listing_id === listingId && r.promoter_id === currentUser.id);
    if (existing) { showToast("Share code: " + existing.share_code, "info"); return existing.share_code; }
    const code = (dbUser?.name || "USER").split(" ")[0].toUpperCase() + "-" + listingId.toUpperCase();
    const newRef = { id: "r" + Date.now(), promoter_id: currentUser.id, listing_id: listingId, share_code: code, status: "pending", commission_amount: 0 };
    await supabase.from("referrals").insert(newRef);
    await loadData();
    showToast("Share link created! Code: " + code, "info");
    return code;
  };

  // ── Seller edits their own listing's details
  const updateListing = async (listingId, data) => {
    const coords = data.location_text ? await geocode(data.location_text) : null;
    const patch = { ...data, last_active_at: new Date().toISOString() };
    if (coords) { patch.lat = coords.lat; patch.lng = coords.lng; }
    const { error } = await supabase.from("listings").update(patch).eq("id", listingId);
    if (error) { showToast("Error updating listing", "error"); return; }
    await loadData();
    showToast("Listing updated.");
  };

  // ── Remove listing (admin)
  const archiveListing = async (listingId) => {
    await supabase.from("listings").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", listingId);
    await loadData();
    showToast("Listing archived.");
  };

  // ── Seller toggles their own listing between active/pending (e.g. "sale in progress")
  const setListingStatus = async (listingId, status) => {
    await supabase.from("listings").update({ status, last_active_at: new Date().toISOString() }).eq("id", listingId);
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

  // ── Profile page handlers.
  // Simple fields live on the users table row.
  const updateProfile = async (patch) => {
    const { error } = await supabase.from("users").update(patch).eq("id", currentUser.id);
    if (error) { showToast("Couldn't save changes.", "error"); return; }
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
    if (wipeActive) await supabase.from("listings").delete().eq("status", "active");
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

  const activeListings = listings.filter(l => l.status === "active" && !blocks.some(b => b.blocked_id === l.seller_id));
  const archivedListings = listings.filter(l => l.status === "archived");

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

  if (view === "safety") return (
    <SafetyTipsView onBack={() => setView(currentUser ? "home" : "landing")} />
  );

  if (view === "landing") return (
    <Landing
      onSignIn={() => setView("auth")}
      onBrowse={() => setView("home")}
      onNavigate={setView}
      signedIn={!!currentUser}
    />
  );

  if (!currentUser && view === "auth") return (
    <Auth onAuth={(user) => { setCurrentUser(user); loadDbUser(user); loadData(); setView(returnToAdvertise ? "advertise" : "home"); setReturnToAdvertise(false); }} />
  );

  if (!currentUser && view !== "home" && view !== "advertise") return (
    <Landing
      onSignIn={() => setView("auth")}
      onBrowse={() => setView("home")}
    />
  );

  return (
    <div style={styles.app}>
      <style>{css}</style>
      <nav style={styles.nav}>
        <div style={styles.navInner} className="app-nav-inner">
          <div style={styles.logo} className="app-logo" onClick={() => { setView("home"); setHomeResetKey(k => k + 1); }}>
            <img src={logoIcon} alt="DriveLink" style={styles.logoImg} />
            <span style={styles.logoText}>DriveLink</span>
          </div>
          <div
            style={styles.navLinks}
            className="app-nav-links"
            ref={navRef}
            onWheel={handleNavWheel}
            onMouseDown={handleNavMouseDown}
            onMouseMove={handleNavMouseMove}
            onMouseUp={endNavDrag}
            onMouseLeave={endNavDrag}
          >
            <NavBtn active={view === "home"} onClick={() => { setView("home"); setHomeResetKey(k => k + 1); }}>Browse</NavBtn>
            <NavBtn active={view === "advertise"} onClick={() => setView("advertise")}>📢 Advertise</NavBtn>
            {currentUser && <NavBtn active={view === "myListings"} onClick={() => setView("myListings")}>My Listings</NavBtn>}
            {currentUser && <NavBtn active={view === "myPurchases"} onClick={() => setView("myPurchases")}>My Purchases</NavBtn>}
            {currentUser && <NavBtn active={view === "myOffers"} onClick={() => setView("myOffers")}>💰 My Offers</NavBtn>}
            {currentUser && <NavBtn active={view === "postListing"} onClick={() => setView("postListing")}>+ Post Car</NavBtn>}
            {currentUser && <NavBtn active={view === "messages"} onClick={() => setView("messages")}>Messages</NavBtn>}
            {currentUser && <NavBtn active={view === "savedSearches"} onClick={() => setView("savedSearches")}>Saved Searches</NavBtn>}
            {currentUser && <NavBtn active={view === "favorites"} onClick={() => setView("favorites")}>❤️ Saved Cars</NavBtn>}
            {currentUser && <NavBtn active={view === "blocked"} onClick={() => setView("blocked")}>🚫 Blocked</NavBtn>}
            {currentUser && <NavBtn active={view === "dashboard"} onClick={() => setView("dashboard")}>Earnings</NavBtn>}
            {currentUser && <NavBtn active={view === "profile"} onClick={() => setView("profile")}>⚙️ Profile</NavBtn>}
            {dbUser?.role === "admin" && <NavBtn active={view === "admin"} onClick={() => setView("admin")}>Admin</NavBtn>}
          </div>
          <div style={styles.navRight} className="app-nav-right">
            {currentUser ? (
              <div style={styles.userChip} className="app-user-chip">
                <div style={styles.avatar}>{(dbUser?.name || currentUser.email)[0].toUpperCase()}</div>
                <div className="app-user-text">
                  <div style={styles.userName}>{dbUser?.name || currentUser.email}</div>
                  <div style={styles.userRole}>{dbUser?.role === "admin" ? "admin" : "member"}</div>
                </div>
                {dbUser?.balance > 0 && <span style={styles.balanceBadge}>{fmt(dbUser.balance)}</span>}
                <button style={styles.logoutBtn} onClick={logout}>Sign out</button>
              </div>
            ) : (
              <button style={styles.signInBtn} onClick={() => setView("auth")}>Sign In</button>
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
        <div className="app-ad-rail" onClick={(e) => { e.stopPropagation(); setView("advertise"); }}>
          <div style={styles.adRailInner}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📢 Advertise Here</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Reach car buyers and sellers on DriveLink.</div>
            <div style={{ fontSize: 13, color: "#FFB020", fontWeight: 600, marginTop: 12 }}>Click to learn more →</div>
          </div>
        </div>

      <main style={styles.main} className="app-main">
        {view === "advertise" && <AdvertiseView currentUser={dbUser} onSubmit={createAdCheckout} onSignIn={() => { setReturnToAdvertise(true); setView("auth"); }} />}
        {view === "home" && <HomeView key={homeResetKey} listings={activeListings} allListings={listings} currentUser={dbUser} users={users} onShare={generateShare} onBuy={handleBuyNow} referrals={referrals} onSignIn={() => setView("auth")} onMessageSeller={messageSeller} onReport={fileReport} onSaveSearch={saveSearch} favorites={favorites} onToggleFavorite={toggleFavorite} onToggleBlock={toggleBlock} onReportUser={reportUserAction} blocks={blocks} reviews={reviews} offers={offers} onMakeOffer={makeOffer} onOpenListing={setViewingListing} />}
        {view === "myListings" && <MyListingsView listings={listings.filter(l => l.seller_id === currentUser?.id)} referrals={referrals} users={users} offers={offers} onMarkSold={markSold} onSetStatus={setListingStatus} onUpdate={updateListing} onRespondToOffer={respondToOffer} onOpenSafety={() => setView("safety")} currentUser={dbUser} onSetupPayouts={setupPayouts} />}
        {view === "myPurchases" && <MyPurchasesView listings={listings.filter(l => l.buyer_id === currentUser?.id)} users={users} reviews={reviews} currentUser={currentUser} onSubmitReview={submitReview} onConfirmReceipt={confirmReceipt} onFileDispute={fileDispute} onBrowse={() => setView("home")} onOpenSafety={() => setView("safety")} />}
        {view === "myOffers" && <MyOffersView offers={offers.filter(o => o.buyer_id === currentUser?.id)} listings={listings} onRespondToCounter={respondToCounter} onBuy={handleBuyNow} onBrowse={() => setView("home")} />}
        {view === "postListing" && <PostListingView onPost={postListing} />}
        {view === "messages" && currentUser && <Messages currentUser={{ ...dbUser, id: currentUser.id }} listings={listings} users={users} openThread={openThread} onOpened={() => setOpenThread(null)} />}
        {view === "savedSearches" && <SavedSearchesView savedSearches={savedSearches} onDelete={deleteSavedSearch} onBrowse={() => setView("home")} />}
        {view === "favorites" && <FavoritesView favorites={favorites} listings={listings} users={users} referrals={referrals} currentUser={dbUser} onShare={generateShare} onBuy={handleBuyNow} onMessageSeller={messageSeller} onReport={fileReport} onToggleFavorite={toggleFavorite} onBrowse={() => setView("home")} onOpenListing={setViewingListing} />}
        {view === "blocked" && <BlockedUsersView blocks={blocks} users={users} onToggleBlock={toggleBlock} onBrowse={() => setView("home")} />}
        {view === "dashboard" && <PromoterDashboard currentUser={dbUser} referrals={referrals.filter(r => r.promoter_id === currentUser?.id)} listings={listings} payouts={payouts} onSetupPayouts={setupPayouts} />}
        {view === "profile" && <ProfileView dbUser={dbUser} authEmail={currentUser?.email} onUpdateProfile={updateProfile} onChangeEmail={changeEmail} onChangePassword={changePassword} onSetupPayouts={setupPayouts} />}
        {view === "admin" && <AdminView listings={listings} users={users} referrals={referrals} reports={reports} feedback={feedback} userReports={userReports} reviews={reviews} payouts={payouts} disputes={disputes} onArchive={archiveListing} onMarkSold={markSold} onConfirmReceipt={confirmReceipt} onResolveReport={resolveReport} onResolveUserReport={resolveUserReport} onToggleVerified={toggleVerified} onResetData={resetTestData} onRecordPayout={recordPayout} onPayoutViaStripe={payoutPromoterViaStripe} onResolveDispute={resolveDispute} />}
        {view === "success" && <SuccessView onHome={() => setView("home")} />}
      </main>

      <div className="app-ad-rail" onClick={(e) => { e.stopPropagation(); setView("advertise"); }}>
        <div style={styles.adRailInner}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📢 Advertise Here</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Reach car buyers and sellers on DriveLink.</div>
          <div style={{ fontSize: 13, color: "#FFB020", fontWeight: 600, marginTop: 12 }}>Click to learn more →</div>
        </div>
      </div>
      </div>
      <footer style={styles.appFooter}>
        <button style={styles.appFooterLink} onClick={() => setView("landing")}>About DriveLink</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("safety")}>🛡️ Safety Tips</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("terms")}>Terms of Service</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <button style={styles.appFooterLink} onClick={() => setView("privacy")}>Privacy Policy</button>
        <span style={{ color: "#d1d5db" }}>·</span>
        <a href="mailto:support@drivelink.deals" style={styles.appFooterLink}>support@drivelink.deals</a>
      </footer>
      {viewingListing && (
        <ListingDetailModal
          data={viewingListing}
          currentUser={dbUser}
          isFavorited={favorites?.some(f => f.listing_id === viewingListing.listing.id)}
          isBlocked={blocks?.some(b => b.blocked_id === viewingListing.listing.seller_id)}
          onClose={() => setViewingListing(null)}
          onBuy={handleBuyNow}
          onShare={generateShare}
          onMessageSeller={messageSeller}
          onReport={fileReport}
          onReportUser={reportUserAction}
          onToggleFavorite={toggleFavorite}
          onToggleBlock={toggleBlock}
          onMakeOffer={makeOffer}
          onSignIn={() => setView("auth")}
        />
      )}
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
            <p>Listing a car is free. When a listing sells, DriveLink charges a 1% platform fee on the final sale price. If a buyer arrived through a promoter's shared link, an additional 1% commission is paid to that promoter. Both fees are deducted from the seller's proceeds.</p>

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
          <p>Buyers: verify the VIN on the dashboard or door frame matches the listing, and confirm the seller's ID matches the name on the title. Sellers: confirm payment has actually cleared before handing over keys — don't rely on a screenshot of a payment as proof.</p>
          <p>Only confirm receipt in DriveLink (which finalizes the sale and releases the promoter's commission) after you've actually inspected the car in person and are satisfied.</p>

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
      <p style={{ fontSize: 16, color: "#6b7280", marginBottom: 8 }}>Your purchase is confirmed. The seller will be in touch shortly.</p>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 32 }}>Referral commissions will be processed within 24 hours.</p>
      <button style={styles.confirmBtn} onClick={onHome}>Back to Browse</button>
    </div>
  );
}

function HomeView({ listings, allListings, currentUser, users, onShare, onBuy, referrals, onSignIn, onMessageSeller, onReport, onSaveSearch, favorites, onToggleFavorite, onToggleBlock, onReportUser, blocks, reviews, offers, onMakeOffer, onOpenListing }) {
  const [search, setSearch] = useState("");
  const [make, setMake] = useState("all");
  const [maxPrice, setMaxPrice] = useState(200000);
  const [maxMileage, setMaxMileage] = useState(300000);
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState("newest");
  const [mode, setMode] = useState("grid"); // grid | map

  const makes = [...new Set(listings.map(l => l.make).filter(Boolean))].sort();

  const seeSimilar = (l) => {
    setMake(l.make);
    setSearch(l.model);
    setMode("grid");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = listings
    .filter(l => `${l.year} ${l.make} ${l.model}`.toLowerCase().includes(search.toLowerCase()))
    .filter(l => make === "all" || l.make === make)
    .filter(l => l.price <= maxPrice)
    .filter(l => (l.mileage || 0) <= maxMileage)
    .filter(l => !location.trim() || (l.location_text || "").toLowerCase().includes(location.toLowerCase()))
    .sort((a, b) => sort === "newest" ? new Date(b.created_at) - new Date(a.created_at) : sort === "priceLow" ? a.price - b.price : b.price - a.price);

  // Average price per make+model, for the "priced below/above similar listings" comparison
  const avgByModel = {};
  for (const l of allListings) {
    const key = `${l.make}|${l.model}`;
    if (!avgByModel[key]) avgByModel[key] = [];
    avgByModel[key].push(l.price);
  }

  const soldCount = allListings.filter(l => l.status === "sold").length;

  return (
    <div>
      <div style={styles.hero} className="app-hero">
        <div style={styles.heroInner}>
          <div style={styles.heroBadge}>Peer-to-peer • Commission-backed</div>
          <h1 style={styles.heroTitle} className="app-hero-title">Find your next car.<br /><span style={styles.heroAccent}>Share and earn 1%.</span></h1>
          <p style={styles.heroSub}>Buy directly from owners. Promote listings to your network and earn 1% of every sale you unlock.</p>
          <div style={styles.heroStats} className="app-hero-stats">
            <div style={styles.heroStat}><span style={styles.heroStatNum}>{listings.length}</span><span style={styles.heroStatLabel}>Active listings</span></div>
            <div style={styles.heroStatDiv} />
            <div style={styles.heroStat}><span style={styles.heroStatNum}>{soldCount}</span><span style={styles.heroStatLabel}>Cars sold</span></div>
            <div style={styles.heroStatDiv} />
            <div style={styles.heroStat}><span style={styles.heroStatNum}>1%</span><span style={styles.heroStatLabel}>Promoter cut</span></div>
          </div>
        </div>
      </div>
      <div style={styles.filterBar}>
        <input style={styles.searchInput} placeholder="Search make, model, year…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={styles.selectInput} value={make} onChange={e => setMake(e.target.value)}>
          <option value="all">All makes</option>
          {makes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Max price: {fmt(maxPrice)}</label>
          <input type="range" min={5000} max={200000} step={1000} value={maxPrice} onChange={e => setMaxPrice(+e.target.value)} style={styles.rangeInput} />
        </div>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Max mileage: {maxMileage.toLocaleString()} mi</label>
          <input type="range" min={0} max={300000} step={5000} value={maxMileage} onChange={e => setMaxMileage(+e.target.value)} style={styles.rangeInput} />
        </div>
        <input style={{ ...styles.searchInput, minWidth: 140 }} placeholder="City or ZIP…" value={location} onChange={e => setLocation(e.target.value)} />
        <select style={styles.selectInput} value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="priceLow">Price: low to high</option>
          <option value="priceHigh">Price: high to low</option>
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
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No listings match your filters</div>
              <div style={{ fontSize: 14 }}>Try widening your search.</div>
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
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CarCard({ listing, seller, avgPrice, similarCount, onSeeSimilar, currentUser, onShare, onBuy, myRef, onSignIn, onMessageSeller, onReport, isFavorited, onToggleFavorite, isBlocked, onToggleBlock, onReportUser, sellerRating, sellerReviewCount, myOffer, onMakeOffer, onOpenListing }) {
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportingUser, setReportingUser] = useState(false);
  const [offering, setOffering] = useState(false);
  const handleShare = () => { onShare(listing.id); setCopied(true); setTimeout(() => setCopied(false), 2000); };
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
        {listing.status === "pending" && <div style={styles.pendingRibbon}>Sale Pending</div>}
        {isStale && <div style={{ ...styles.pendingRibbon, background: "#6b7280", top: listing.status === "pending" ? 40 : 12 }}>Seller Inactive</div>}
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
          {seller?.verified && <span style={styles.verifiedBadge} title="Verified seller">✓ Verified</span>}
          {sellerRating != null && <span style={styles.ratingBadge} title={`${sellerReviewCount} review${sellerReviewCount === 1 ? "" : "s"}`}>⭐ {sellerRating.toFixed(1)} ({sellerReviewCount})</span>}
        </div>
        <div style={styles.cardMeta}>
          <span>🛣 {listing.mileage?.toLocaleString()} mi</span>
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
        <p style={styles.cardDesc}>{listing.description}</p>
        {listing.vin && (
          <div style={styles.vinRow}>
            VIN: {listing.vin} {listing.vin_verified && <span style={styles.verifiedBadge} title="VIN was decoded and matches the make/model/year on this listing">✓ VIN Verified</span>} · <a href={`https://www.carfax.com/vehicle/${listing.vin}`} target="_blank" rel="noreferrer" style={styles.vinLink}>Check Carfax history →</a>
          </div>
        )}
        {myRef && <div style={styles.refTag}>{myRef.status === "paid" ? `✅ Commission paid: ${fmt(myRef.commission_amount)}` : `🔗 Tracking active • Code: ${myRef.share_code}`}</div>}
        <div style={styles.cardActions}>
          {currentUser && !isOwnListing && (
            <button style={styles.buyBtn} onClick={() => onBuy(listing)}>💳 Buy Now</button>
          )}
          {currentUser && !isOwnListing && (
            <button style={{ ...styles.shareBtn, background: copied ? "#16a34a" : "#1d4ed8" }} onClick={handleShare}>
              {copied ? "✓ Copied!" : myRef ? "Share Again" : "Share & Earn 1%"}
            </button>
          )}
          {!currentUser && (
            <button style={styles.buyBtn} onClick={onSignIn}>Sign in to buy or share →</button>
          )}
        </div>
        {currentUser && !isOwnListing && onMakeOffer && (
          myOffer ? (
            <div style={styles.offerStatusRow}>
              {myOffer.status === "pending" && <span>💰 Your offer of {fmt(myOffer.amount)} is pending</span>}
              {myOffer.status === "countered" && <span>💰 Seller countered at {fmt(myOffer.counter_amount)}</span>}
              {myOffer.status === "accepted" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span>✅ Offer of {fmt(myOffer.amount)} accepted!</span>
                  <button style={styles.buyBtn} onClick={() => onBuy(listing)}>Complete Purchase — {fmt(myOffer.amount)}</button>
                </div>
              )}
              {myOffer.status === "declined" && <span>Offer declined</span>}
              {myOffer.status === "withdrawn" && <span>Offer withdrawn</span>}
            </div>
          ) : (
            <button style={styles.offerBtn} onClick={() => setOffering(true)}>💰 Make an Offer</button>
          )
        )}
        {currentUser && !isOwnListing && (
          <div style={styles.cardSecondaryActions}>
            <button style={styles.messageLink} onClick={() => onMessageSeller(listing)}>💬 Message seller</button>
            <button style={styles.reportLink} onClick={() => setReporting(true)}>🚩 Report</button>
            {onToggleBlock && (
              <button style={styles.reportLink} onClick={() => onToggleBlock(listing.seller_id)}>
                {isBlocked ? "✅ Unblock seller" : "🚫 Block seller"}
              </button>
            )}
            {onReportUser && (
              <button style={styles.reportLink} onClick={() => setReportingUser(true)}>⚠️ Report seller</button>
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

function ListingDetailModal({ data, currentUser, isFavorited, isBlocked, onClose, onBuy, onShare, onMessageSeller, onReport, onReportUser, onToggleFavorite, onToggleBlock, onMakeOffer, onSignIn }) {
  const { listing, seller, myRef, sellerRating, sellerReviewCount, myOffer } = data;
  const [activeImg, setActiveImg] = useState(0);
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [offering, setOffering] = useState(false);

  const images = (listing.images && listing.images.length ? listing.images : [listing.image]).filter(Boolean);
  const isOwnListing = currentUser && listing.seller_id === currentUser.id;

  const handleShare = () => { onShare(listing.id); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.detailBox} onClick={e => e.stopPropagation()}>
        <button style={styles.detailCloseBtn} onClick={onClose} aria-label="Close">✕</button>

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
            {seller?.verified && <span style={styles.verifiedBadge} title="Verified seller">✓ Verified</span>}
            {sellerRating != null && <span style={styles.ratingBadge}>⭐ {sellerRating.toFixed(1)} ({sellerReviewCount})</span>}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", margin: "6px 0 14px" }}>{fmt(listing.price)}</div>

          <div style={styles.cardMeta}>
            <span>🛣 {listing.mileage?.toLocaleString()} mi</span>
            <span>🎨 {listing.color}</span>
            {listing.location_text && <span>📍 {listing.location_text}</span>}
            {seller?.name && <span>👤 Sold by {seller.name}</span>}
          </div>

          <p style={{ ...styles.cardDesc, marginTop: 12 }}>{listing.description}</p>

          {listing.vin && (
            <div style={styles.vinRow}>
              VIN: {listing.vin} {listing.vin_verified && <span style={styles.verifiedBadge}>✓ VIN Verified</span>} · <a href={`https://www.carfax.com/vehicle/${listing.vin}`} target="_blank" rel="noreferrer" style={styles.vinLink}>Check Carfax history →</a>
            </div>
          )}

          {myRef && <div style={styles.refTag}>{myRef.status === "paid" ? `✅ Commission paid: ${fmt(myRef.commission_amount)}` : `🔗 Tracking active • Code: ${myRef.share_code}`}</div>}

          <div style={styles.cardActions}>
            {currentUser && !isOwnListing && <button style={styles.buyBtn} onClick={() => onBuy(listing)}>💳 Buy Now</button>}
            {currentUser && !isOwnListing && (
              <button style={{ ...styles.shareBtn, background: copied ? "#16a34a" : "#1d4ed8" }} onClick={handleShare}>
                {copied ? "✓ Copied!" : myRef ? "Share Again" : "Share & Earn 1%"}
              </button>
            )}
            {!currentUser && <button style={styles.buyBtn} onClick={onSignIn}>Sign in to buy or share →</button>}
          </div>

          {currentUser && !isOwnListing && onMakeOffer && (
            myOffer ? (
              <div style={styles.offerStatusRow}>
                {myOffer.status === "pending" && <span>💰 Your offer of {fmt(myOffer.amount)} is pending</span>}
                {myOffer.status === "countered" && <span>💰 Seller countered at {fmt(myOffer.counter_amount)}</span>}
                {myOffer.status === "accepted" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span>✅ Offer accepted!</span>
                    <button style={styles.buyBtn} onClick={() => onBuy(listing)}>Complete Purchase — {fmt(myOffer.amount)}</button>
                  </div>
                )}
              </div>
            ) : (
              <button style={styles.offerBtn} onClick={() => setOffering(true)}>💰 Make an Offer</button>
            )
          )}

          {currentUser && !isOwnListing && (
            <div style={styles.cardSecondaryActions}>
              <button style={styles.messageLink} onClick={() => onMessageSeller(listing)}>💬 Message seller</button>
              <button style={styles.reportLink} onClick={() => setReporting(true)}>🚩 Report</button>
              {onToggleBlock && (
                <button style={styles.reportLink} onClick={() => onToggleBlock(listing.seller_id)}>
                  {isBlocked ? "✅ Unblock seller" : "🚫 Block seller"}
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

function ReportModal({ onCancel, onSubmit }) {
  const [reason, setReason] = useState("Misleading listing");
  const [details, setDetails] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Report this listing</h3>
        <label style={styles.fieldLabel}>Reason</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option>Misleading listing</option>
          <option>Suspected scam</option>
          <option>Wrong price / bait and switch</option>
          <option>Car already sold elsewhere</option>
          <option>Inappropriate content</option>
          <option>Other</option>
        </select>
        <label style={styles.fieldLabel}>Details (optional)</label>
        <textarea style={styles.textarea} rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder="Anything else we should know?" />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details)}>Submit Report</button>
        </div>
      </div>
    </div>
  );
}

function ReportUserModal({ onCancel, onSubmit }) {
  const [reason, setReason] = useState("Suspicious / scam behavior");
  const [details, setDetails] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Report this user</h3>
        <label style={styles.fieldLabel}>Reason</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option>Suspicious / scam behavior</option>
          <option>Harassment or abusive messages</option>
          <option>Never showed up / wasted my time</option>
          <option>Asked to pay outside the platform</option>
          <option>Other</option>
        </select>
        <label style={styles.fieldLabel}>Details (optional)</label>
        <textarea style={styles.textarea} rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder="Anything else we should know?" />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details)}>Submit Report</button>
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
  const favoritedListings = favorites
    .map(f => listings.find(l => l.id === f.listing_id))
    .filter(Boolean);

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
              />
            );
          })}
        </div>
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

function MyListingsView({ listings, referrals, users, offers, onMarkSold, onSetStatus, onUpdate, onRespondToOffer, onOpenSafety, currentUser, onSetupPayouts }) {
  const [editing, setEditing] = useState(null);
  const [markingSold, setMarkingSold] = useState(null);
  const hasHandoffPending = listings.some(l => l.status === "pending_confirmation");
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
        <div style={{ fontSize: 13, color: "#16a34a", marginBottom: 12 }}>✅ Payouts are set up — you'll be paid automatically when a sale is confirmed.</div>
      )}
      {hasHandoffPending && (
        <div style={styles.safetyBanner}>
          🛡️ Meeting a buyer to hand off a car? <button style={styles.safetyBannerLink} onClick={onOpenSafety}>Review our safety tips</button> before you meet.
        </div>
      )}
      {listings.length === 0 && <p style={{ color: "#6b7280" }}>You haven't posted any listings yet.</p>}
      <div style={styles.tableWrap}>
        {listings.map(l => {
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
                  <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                  <div style={styles.rowMeta}>{fmt(l.price)} • {l.mileage?.toLocaleString()} mi</div>
                  {l.status === "sold" && <div style={styles.soldBadge}>SOLD for {fmt(l.sale_price)} on {l.sold_at}</div>}
                  {l.status === "pending_confirmation" && <div style={styles.awaitingBadge}>💳 Payment received for {fmt(l.sale_price)} — awaiting buyer confirmation before payout</div>}
                  {l.status === "disputed" && <div style={{ ...styles.awaitingBadge, background: "#fee2e2", color: "#b91c1c" }}>⚠️ Buyer disputed this sale — our team is reviewing it</div>}
                  {listingOffers.length > 0 && <div style={styles.awaitingBadge}>💰 {listingOffers.length} offer{listingOffers.length === 1 ? "" : "s"} waiting on your response</div>}
                  {acceptedOffer && l.status === "active" && (
                    <div style={{ ...styles.awaitingBadge, background: "#dcfce7", color: "#15803d" }}>
                      ✅ Accepted {fmt(acceptedOffer.amount)} from {acceptedOfferBuyer?.name || "buyer"} — waiting for them to complete purchase
                    </div>
                  )}
                  {promoter && <div style={styles.promoterTag}>Promoted by {promoter.name} {ref.status === "paid" ? `• Commission ${fmt(ref.commission_amount)} paid` : "• Pending"}</div>}
                  {l.status === "active" && l.last_active_at && (Date.now() - new Date(l.last_active_at).getTime()) > STALE_WARN_DAYS_MS && (
                    <div style={{ fontSize: 12, color: "#b45309", fontWeight: 600, marginTop: 4 }}>
                      ⏰ This listing looks inactive to buyers — edit and save it to refresh, or it'll auto-archive after 60 days.
                    </div>
                  )}
                </div>
                <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : l.status === "pending" ? "#fef9c3" : l.status === "pending_confirmation" ? "#dbeafe" : l.status === "disputed" ? "#fee2e2" : "#fee2e2", color: l.status === "active" ? "#15803d" : l.status === "pending" ? "#854d0e" : l.status === "pending_confirmation" ? "#1d4ed8" : l.status === "disputed" ? "#b91c1c" : "#b91c1c" }}>{l.status === "pending_confirmation" ? "awaiting confirmation" : l.status}</span>
                {l.status !== "sold" && l.status !== "pending_confirmation" && l.status !== "disputed" && (
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
              </div>
              {listingOffers.map(o => (
                <SellerOfferRow key={o.id} offer={o} buyer={users.find(u => u.id === o.buyer_id)} onRespond={onRespondToOffer} />
              ))}
            </div>
          );
        })}
      </div>
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
  const [counterAmount, setCounterAmount] = useState(offer.amount);
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
          <button style={styles.soldBtn} onClick={() => { onRespond(offer.id, "countered", +counterAmount, counterMessage); setCountering(false); }}>Send Counter</button>
          <button style={styles.cancelBtn} onClick={() => setCountering(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function MyPurchasesView({ listings, users, reviews, currentUser, onSubmitReview, onConfirmReceipt, onFileDispute, onBrowse, onOpenSafety }) {
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
      {listings.length === 0 && <p style={{ color: "#6b7280" }}>No purchases linked to your account yet. When a seller marks a sale complete with your email, it'll show up here.</p>}
      <div style={styles.tableWrap}>
        {listings.map(l => {
          const seller = users.find(u => u.id === l.seller_id);
          const myReview = reviews.find(r => r.listing_id === l.id && r.buyer_id === currentUser.id);
          const cover = (l.images && l.images[0]) || l.image;
          const awaitingConfirmation = l.status === "pending_confirmation";
          const disputed = l.status === "disputed";
          return (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={cover} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>{fmt(l.sale_price || l.price)} • Sold by {seller?.name || "seller"} on {l.sold_at}</div>
                {awaitingConfirmation && (
                  <div style={{ fontSize: 13, color: "#1d4ed8", fontWeight: 600, marginTop: 4 }}>
                    Once you've received the car, confirm below — this finalizes the sale and releases the promoter's commission. Had a problem instead? Report it rather than confirming.
                  </div>
                )}
                {disputed && (
                  <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 600, marginTop: 4 }}>
                    ⚠️ Dispute filed — our team is reviewing this sale. We'll follow up with you directly.
                  </div>
                )}
                {myReview && <div style={styles.promoterTag}>{"⭐".repeat(myReview.rating)} — you reviewed this purchase</div>}
              </div>
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
          onSubmit={(reason, details) => { onFileDispute(disputing.id, reason, details); setDisputing(null); }}
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

function MyOffersView({ offers, listings, onRespondToCounter, onBuy, onBrowse }) {
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
                {o.status === "declined" && <div style={{ fontSize: 13, color: "#b91c1c", marginTop: 2 }}>Declined by seller</div>}
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
            </div>
          );
        })}
      </div>
      <button style={{ ...styles.confirmBtn, marginTop: 16 }} onClick={onBrowse}>Back to Browse</button>
    </div>
  );
}

function ReviewModal({ listing, onCancel, onSubmit }) {
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
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(rating, comment)}>Submit Review</button>
        </div>
      </div>
    </div>
  );
}

function DisputeModal({ listing, onCancel, onSubmit }) {
  const [reason, setReason] = useState("Car not as described");
  const [details, setDetails] = useState("");
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Report a problem with this purchase</h3>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>This puts the sale on hold and notifies our team — don't confirm receipt if something's wrong.</div>
        <label style={styles.fieldLabel}>What happened?</label>
        <select style={{ ...styles.selectInput, width: "100%", marginBottom: 12 }} value={reason} onChange={e => setReason(e.target.value)}>
          <option>Car not as described</option>
          <option>Seller never showed up / unreachable</option>
          <option>Car has undisclosed damage or issues</option>
          <option>Title or paperwork problem</option>
          <option>Other</option>
        </select>
        <label style={styles.fieldLabel}>Details</label>
        <textarea style={styles.textarea} rows={4} value={details} onChange={e => setDetails(e.target.value)} placeholder="Tell us what went wrong" />
        <div style={styles.modalActions}>
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(reason, details)} disabled={!details.trim()}>File Dispute</button>
        </div>
      </div>
    </div>
  );
}

function OfferModal({ listing, onCancel, onSubmit }) {
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
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onSubmit(+amount, message)} disabled={!amount || +amount <= 0}>Send Offer</button>
        </div>
      </div>
    </div>
  );
}

function MarkSoldModal({ listing, onCancel, onConfirm }) {
  const [price, setPrice] = useState(listing.price);
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
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.confirmBtn} onClick={() => onConfirm(+price, buyerEmail)}>Confirm Sale</button>
        </div>
      </div>
    </div>
  );
}

function PayoutModal({ user, onCancel, onConfirm, onPayViaStripe }) {
  const [amount, setAmount] = useState(user.balance || 0);
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
          <button style={{ ...styles.confirmBtn, width: "100%", marginBottom: 12 }} onClick={() => onPayViaStripe(+amount, note)}>
            💳 Send {fmt(+amount || 0)} via Stripe
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
            <option>Other</option>
          </select>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>This records that you paid {user.name} outside of DriveLink and reduces their tracked balance to match — it doesn't move any real money.</div>
          <div style={styles.modalActions}>
            <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
            <button style={styles.confirmBtn} onClick={() => onConfirm(+amount, method, note)}>Record Payout</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditListingModal({ listing, onCancel, onSave }) {
  const [form, setForm] = useState({
    make: listing.make || "", model: listing.model || "", year: listing.year || new Date().getFullYear(),
    price: listing.price || "", mileage: listing.mileage || "", color: listing.color || "",
    description: listing.description || "", vin: listing.vin || "", location_text: listing.location_text || "",
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
    if (!form.make || !form.model || !form.price) return alert("Fill in at least make, model, and price.");
    setSaving(true);
    await onSave({
      ...form,
      price: +form.price,
      mileage: +form.mileage,
      year: +form.year,
      images,
      image: images[0] || listing.image,
      vin_verified: vinVerified,
    });
    setSaving(false);
  };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={{ ...styles.modalBox, maxWidth: 640, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Edit Listing</h3>
        <ImageUpload images={images} onChange={setImages} />
        <div style={styles.formGrid} className="app-form-grid">
          <Field label="Make" value={form.make} onChange={v => set("make", v)} />
          <Field label="Model" value={form.model} onChange={v => set("model", v)} />
          <Field label="Year" value={form.year} onChange={v => set("year", v)} type="number" />
          <Field label="Price ($)" value={form.price} onChange={v => set("price", v)} type="number" />
          <Field label="Mileage" value={form.mileage} onChange={v => set("mileage", v)} type="number" />
          <Field label="Color" value={form.color} onChange={v => set("color", v)} />
          <Field label="Location (city or ZIP)" value={form.location_text} onChange={v => set("location_text", v)} />
        </div>
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
          <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
          <button style={{ ...styles.confirmBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

function PostListingView({ onPost }) {
  const [form, setForm] = useState({ make: "", model: "", year: new Date().getFullYear(), price: "", mileage: "", color: "", description: "", vin: "", location_text: "" });
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
    if (!form.make || !form.model || !form.price) return alert("Fill in at least make, model, and price.");
    setSubmitting(true);
    await onPost({
      ...form,
      price: +form.price,
      mileage: +form.mileage,
      year: +form.year,
      images,
      image: images[0] || "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&q=80",
      vin_verified: vinVerified,
    });
    setSubmitting(false);
  };
  const vinMismatch = vinResult?.valid && form.make && form.model && (
    vinResult.make.toLowerCase() !== form.make.toLowerCase() || vinResult.model.toLowerCase() !== form.model.toLowerCase()
  );
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Post a Car for Sale</h2>
      <div style={styles.formCard}>
        <ImageUpload images={images} onChange={setImages} />
        <div style={styles.formGrid} className="app-form-grid">
          <Field label="Make" value={form.make} onChange={v => set("make", v)} placeholder="e.g. Toyota" />
          <Field label="Model" value={form.model} onChange={v => set("model", v)} placeholder="e.g. Camry" />
          <Field label="Year" value={form.year} onChange={v => set("year", v)} type="number" />
          <Field label="Price ($)" value={form.price} onChange={v => set("price", v)} type="number" placeholder="e.g. 25000" />
          <Field label="Mileage" value={form.mileage} onChange={v => set("mileage", v)} type="number" placeholder="e.g. 35000" />
          <Field label="Color" value={form.color} onChange={v => set("color", v)} placeholder="e.g. Pearl White" />
          <Field label="Location (city or ZIP)" value={form.location_text} onChange={v => set("location_text", v)} placeholder="e.g. Austin, TX" />
        </div>
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
  { id: "3mo", label: "3 Months", monthly: 150, total: 450, blurb: "" },
  { id: "6mo", label: "6 Months", monthly: 125, total: 750, blurb: "Save ~17%" },
  { id: "12mo", label: "12 Months", monthly: 100, total: 1200, blurb: "Save ~33%" },
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

function ProfileView({ dbUser, authEmail, onUpdateProfile, onChangeEmail, onChangePassword, onSetupPayouts }) {
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

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.fieldLabel}>{label}</label>
      <input style={styles.fieldInput} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PromoterDashboard({ currentUser, referrals, listings, payouts, onSetupPayouts }) {
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
      <h3 style={styles.sectionTitle}>Your Referrals</h3>
      {referrals.length === 0 && <p style={{ color: "#6b7280" }}>No referrals yet. Browse listings and share to earn 1% commission on sales.</p>}
      <div style={styles.tableWrap}>
        {referrals.map(r => {
          const listing = listings.find(l => l.id === r.listing_id);
          return (
            <div key={r.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{listing ? `${listing.year} ${listing.make} ${listing.model}` : "Unknown listing"}</div>
                <div style={styles.rowMeta}>Share code: <b>{r.share_code}</b></div>
                {r.status === "paid" && <div style={styles.soldBadge}>✅ Commission: {fmt(r.commission_amount)} on {r.paid_at}</div>}
                {r.status === "pending" && <div style={styles.promoterTag}>⏳ Pending — you'll earn {listing ? fmt(Math.round(listing.price * 0.01)) : "1%"} when it sells</div>}
              </div>
              <span style={{ ...styles.statusPill, background: r.status === "paid" ? "#dcfce7" : "#fef9c3", color: r.status === "paid" ? "#15803d" : "#854d0e" }}>{r.status}</span>
            </div>
          );
        })}
      </div>
      <div style={styles.infoBox}><b>How commissions work:</b> When you share a listing and a buyer completes the purchase, 1% of the sale price is automatically credited to your account.</div>
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

function StatBox({ label, value, color }) {
  return <div style={styles.statBox}><div style={{ ...styles.statValue, color }}>{value}</div><div style={styles.statLabel}>{label}</div></div>;
}

function AdminView({ listings, users, referrals, reports, feedback, userReports, reviews, payouts, disputes, onArchive, onMarkSold, onConfirmReceipt, onResolveReport, onResolveUserReport, onToggleVerified, onResetData, onRecordPayout, onPayoutViaStripe, onResolveDispute }) {
  const [tab, setTab] = useState("listings");
  const [markingSold, setMarkingSold] = useState(null);
  const [payingOut, setPayingOut] = useState(null);
  const activeAndSold = listings.filter(l => l.status !== "archived");
  const totalRevenue = activeAndSold.filter(l => l.status === "sold" || l.status === "pending_confirmation").reduce((s, l) => s + (l.sale_price || 0), 0);
  const platformEarnings = activeAndSold.filter(l => l.status === "sold").reduce((s, l) => s + (l.platform_fee || Math.round((l.sale_price || 0) * 0.01)), 0);
  const totalCommissions = referrals.filter(r => r.status === "paid").reduce((s, r) => s + (r.commission_amount || 0), 0);
  const openReports = reports.filter(r => r.status === "open");
  const openUserReports = (userReports || []).filter(r => r.status === "open");
  const awaitingConfirmation = activeAndSold.filter(l => l.status === "pending_confirmation");
  const openDisputes = (disputes || []).filter(d => d.status === "open");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Admin Panel</h2>
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
        {["listings", "archived", "users", "referrals", "payouts", "disputes", "reports", "userReports", "feedback", "danger"].map(t => <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}), ...(t === "danger" ? { color: tab === "danger" ? "#dc2626" : "#dc2626" } : {}) }} onClick={() => setTab(t)}>{t === "danger" ? "⚠️ Danger Zone" : t === "userReports" ? "User Reports" : t.charAt(0).toUpperCase() + t.slice(1)}{t === "reports" && openReports.length > 0 ? ` (${openReports.length})` : ""}{t === "userReports" && openUserReports.length > 0 ? ` (${openUserReports.length})` : ""}{t === "disputes" && openDisputes.length > 0 ? ` (${openDisputes.length})` : ""}{t === "feedback" && feedback.length > 0 ? ` (${feedback.length})` : ""}</button>)}
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
                {l.status === "pending_confirmation" && <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 2 }}>Sold {fmt(l.sale_price)} on {l.sold_at} • waiting on buyer to confirm receipt</div>}
                {l.status === "disputed" && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 2 }}>⚠️ Disputed — see Disputes tab</div>}
              </div>
              <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : l.status === "pending_confirmation" ? "#dbeafe" : l.status === "disputed" ? "#fee2e2" : "#fee2e2", color: l.status === "active" ? "#15803d" : l.status === "pending_confirmation" ? "#1d4ed8" : "#b91c1c" }}>{l.status === "pending_confirmation" ? "awaiting confirmation" : l.status}</span>
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
          <div style={styles.infoBox} >📦 Archived listings are stored here for audit purposes and cannot be seen by users.</div>
          {listings.filter(l => l.status === "archived").length === 0 && <p style={{ color: "#6b7280", marginTop: 16 }}>No archived listings yet.</p>}
          {listings.filter(l => l.status === "archived").map(l => (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={l.image} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>{fmt(l.price)} • Archived {l.archived_at ? new Date(l.archived_at).toLocaleDateString() : ""}</div>
                {l.sale_price && <div style={styles.soldBadge}>Sold for {fmt(l.sale_price)} on {l.sold_at}</div>}
              </div>
              <span style={{ ...styles.statusPill, background: "#f1f5f9", color: "#6b7280" }}>archived</span>
            </div>
          ))}
        </div>
      )}
      {tab === "users" && (
        <div style={styles.tableWrap}>
          {users.map(u => {
            const uReviews = (reviews || []).filter(r => r.seller_id === u.id);
            const uRating = uReviews.length ? uReviews.reduce((s, r) => s + r.rating, 0) / uReviews.length : null;
            return (
            <div key={u.id} style={styles.listingRow} className="app-listing-row">
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
            return (
              <div key={r.id} style={styles.listingRow} className="app-listing-row">
                <div style={styles.rowInfo} className="app-row-info">
                  <div style={styles.rowTitle}>{promoter?.name} → {listing ? `${listing.make} ${listing.model}` : r.listing_id}</div>
                  <div style={styles.rowMeta}>Code: {r.share_code} • Commission: {fmt(r.commission_amount || 0)}</div>
                </div>
                <span style={{ ...styles.statusPill, background: r.status === "paid" ? "#dcfce7" : "#fef9c3", color: r.status === "paid" ? "#15803d" : "#854d0e" }}>{r.status}</span>
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
      {tab === "danger" && <DangerZone onResetData={onResetData} />}
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
  legalBackBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 32 },
  legalTitle: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 8 },
  legalUpdated: { fontSize: 13, color: "#9ca3af", marginBottom: 24 },
  legalDisclaimer: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", fontSize: 14, color: "#92400e", lineHeight: 1.6, marginBottom: 32 },
  legalBody: { fontSize: 15, color: "#374151", lineHeight: 1.7 },
  appFooter: { maxWidth: 1200, margin: "0 auto", padding: "24px 24px 40px", display: "flex", gap: 10, alignItems: "center", justifyContent: "center", fontSize: 13 },
  appFooterLink: { background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 0 },
  nav: { background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 100 },
  navInner: { maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", gap: 24 },
  logo: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 },
  logoImg: { height: 30, width: "auto", display: "block" },
  logoIcon: { fontSize: 22 },
  logoText: { fontWeight: 800, fontSize: 20, color: "#0f172a", letterSpacing: "-0.03em" },
  navLinks: { display: "flex", gap: 4, flex: 1, cursor: "grab", userSelect: "none" },
  adRailInner: { background: "linear-gradient(160deg, #1a1a2e, #16213e)", border: "1px dashed #FFB020", borderRadius: 12, padding: "22px 16px", color: "#fff", textAlign: "center", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", boxSizing: "border-box" },
  navBtn: { background: "none", border: "none", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 500, color: "#4b5563" },
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
  heroInner: { maxWidth: 680 },
  heroBadge: { display: "inline-block", background: "rgba(255,255,255,.12)", color: "#94a3b8", fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, marginBottom: 20 },
  heroTitle: { fontSize: 48, fontWeight: 800, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 16 },
  heroAccent: { color: "#60a5fa" },
  heroSub: { fontSize: 18, color: "#94a3b8", lineHeight: 1.6, marginBottom: 36, maxWidth: 520 },
  heroStats: { display: "flex", gap: 32, alignItems: "center" },
  heroStat: { display: "flex", flexDirection: "column", gap: 2 },
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
  ratingBadge: { fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 20 },
  cardMeta: { display: "flex", gap: 16, fontSize: 13, color: "#6b7280", marginBottom: 10, flexWrap: "wrap" },
  priceCompare: { fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, display: "inline-block", marginBottom: 10 },
  similarLink: { display: "block", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#1d4ed8", fontWeight: 600, padding: 0, marginBottom: 10, textAlign: "left" },
  cardDesc: { fontSize: 13, color: "#374151", lineHeight: 1.5, marginBottom: 10 },
  vinRow: { fontSize: 12, color: "#6b7280", marginBottom: 12 },
  vinLink: { color: "#1d4ed8", fontWeight: 600, textDecoration: "none" },
  refTag: { background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "6px 10px", borderRadius: 8, marginBottom: 12 },
  cardActions: { display: "flex", gap: 10 },
  cardSecondaryActions: { display: "flex", gap: 16, marginTop: 12, justifyContent: "center" },
  messageLink: { background: "none", border: "none", color: "#4b5563", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  reportLink: { background: "none", border: "none", color: "#9ca3af", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  buyBtn: { flex: 1, background: "#0f172a", color: "#fff", border: "none", padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  shareBtn: { flex: 1, color: "#fff", border: "none", padding: "10px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "background .3s" },
  offerBtn: { width: "100%", background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb", padding: "9px 0", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8 },
  offerStatusRow: { fontSize: 13, color: "#1d4ed8", fontWeight: 600, background: "#eff6ff", padding: "8px 12px", borderRadius: 8, marginTop: 8 },
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
  pageWrap: { paddingTop: 36 },
  pageTitle: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 24, letterSpacing: "-0.02em" },
  tableWrap: { display: "flex", flexDirection: "column", gap: 12 },
  listingRow: { background: "#fff", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  offerRow: { background: "#f8fafc", borderRadius: 12, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginLeft: 16, border: "1px dashed #e5e7eb" },
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
  statsRow: { display: "flex", gap: 16, marginBottom: 32, flexWrap: "wrap" },
  statBox: { background: "#fff", borderRadius: 14, padding: "20px 24px", minWidth: 120, flex: 1, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  statValue: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" },
  statLabel: { fontSize: 12, color: "#6b7280", fontWeight: 500, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 16 },
  infoBox: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "16px 20px", fontSize: 13, color: "#1e40af", lineHeight: 1.6, marginTop: 24 },
  safetyBanner: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 20px", fontSize: 14, color: "#92400e", marginBottom: 20 },
  safetyBannerLink: { background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#92400e", fontWeight: 700, textDecoration: "underline", padding: 0 },
  tabRow: { display: "flex", gap: 4, marginBottom: 20 },
  tab: { padding: "8px 18px", borderRadius: 8, border: "none", background: "none", fontSize: 14, fontWeight: 500, color: "#6b7280", cursor: "pointer" },
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
    .app-nav-links { order: 3; width: 100%; flex: none !important; }
    .app-user-text { display: none; }
  }

  @media (max-width: 700px) {
    .app-main { padding: 0 16px 48px !important; }
    .app-hero { margin: 0 -16px !important; padding: 40px 16px !important; }
    .app-hero-title { font-size: 32px !important; }
    .app-hero-stats { gap: 20px !important; flex-wrap: wrap; }
    .app-grid { grid-template-columns: 1fr !important; }
    .app-form-grid { grid-template-columns: 1fr !important; }
    .app-listing-row { flex-wrap: wrap; }
    .app-row-info { flex-basis: 100%; order: 1; }
  }

  @media (max-width: 480px) {
    .app-toast { left: 16px !important; right: 16px !important; bottom: 16px !important; max-width: none !important; }
    .app-user-chip button { padding: 5px 8px !important; font-size: 12px !important; }
  }
`;
