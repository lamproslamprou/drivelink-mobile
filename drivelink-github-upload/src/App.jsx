import { useState, useEffect } from "react";
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

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [dbUser, setDbUser] = useState(null);
  const [listings, setListings] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [openThread, setOpenThread] = useState(null);
  const [view, setView] = useState("landing");
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null); // { status: 'success' | 'error', message? }

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    const { data: listingsData } = await supabase.from("listings").select("*").order("created_at", { ascending: false });
    const { data: referralsData } = await supabase.from("referrals").select("*");
    const { data: usersData } = await supabase.from("users").select("*");
    const { data: reportsData } = await supabase.from("reports").select("*").order("created_at", { ascending: false });
    if (listingsData) setListings(listingsData);
    if (referralsData) setReferrals(referralsData);
    if (usersData) setUsers(usersData);
    if (reportsData) setReports(reportsData);
    setLoading(false);
  };

  const loadSavedSearches = async (userId) => {
    const { data } = await supabase.from("saved_searches").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (data) setSavedSearches(data);
  };

  const loadDbUser = async (authUser) => {
    if (!authUser) { setDbUser(null); setSavedSearches([]); return; }
    const { data } = await supabase.from("users").select("*").eq("id", authUser.id).single();
    setDbUser(data);
    loadSavedSearches(authUser.id);
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

  // ── Buy Now — redirect to Stripe
  const handleBuyNow = (listing) => {
    const ref = referrals.find(r => r.listing_id === listing.id && r.status === "pending");
    const params = new URLSearchParams({ client_reference_id: listing.id });
    if (ref) params.append("prefilled_promo_code", ref.share_code);
    window.open(`${STRIPE_LINK}?${params.toString()}`, "_blank");
    showToast("Redirecting to secure checkout…", "info");
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
    };
    const { error } = await supabase.from("listings").insert(newListing);
    if (error) { showToast("Error posting listing", "error"); return; }
    await loadData();
    showToast("Listing posted successfully!");
    setView("myListings");
  };

  // ── Mark sold (admin manual override)
  const markSold = async (listingId, salePrice) => {
    const platformFee = Math.round(salePrice * PLATFORM_FEE);
    const promoterCommission = Math.round(salePrice * PROMOTER_FEE);
    const sellerNet = salePrice - platformFee - promoterCommission;
    await supabase.from("listings").update({ 
      status: "sold", 
      sale_price: salePrice, 
      sold_at: new Date().toISOString().slice(0, 10),
      platform_fee: platformFee,
      seller_net: sellerNet
    }).eq("id", listingId);
    const ref = referrals.find(r => r.listing_id === listingId && r.status === "pending");
    if (ref) {
      await supabase.from("referrals").update({ status: "paid", commission_amount: promoterCommission, paid_at: new Date().toISOString().slice(0, 10) }).eq("id", ref.id);
      const promoter = users.find(u => u.id === ref.promoter_id);
      await supabase.from("users").update({ balance: (promoter?.balance || 0) + promoterCommission }).eq("id", ref.promoter_id);
      showToast(`Sale recorded! Platform fee: ${fmt(platformFee)} • Promoter: ${fmt(promoterCommission)} • Seller nets: ${fmt(sellerNet)}`);
    } else {
      showToast(`Sale recorded! Platform fee: ${fmt(platformFee)} • Seller nets: ${fmt(sellerNet)}`);
    }
    await loadData();
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

  // ── Remove listing (admin)
  const archiveListing = async (listingId) => {
    await supabase.from("listings").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", listingId);
    await loadData();
    showToast("Listing archived.");
  };

  // ── Seller toggles their own listing between active/pending (e.g. "sale in progress")
  const setListingStatus = async (listingId, status) => {
    await supabase.from("listings").update({ status }).eq("id", listingId);
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

  // ── Jump into (or start) a message thread with a listing's seller
  const messageSeller = (listing) => {
    if (listing.seller_id === currentUser.id) return;
    setOpenThread({ listingId: listing.id, otherId: listing.seller_id });
    setView("messages");
  };

  const activeListings = listings.filter(l => l.status === "active");
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

  if (!currentUser && view === "landing") return (
    <Landing
      onSignIn={() => setView("auth")}
      onBrowse={() => setView("home")}
    />
  );

  if (!currentUser && view === "auth") return (
    <Auth onAuth={(user) => { setCurrentUser(user); loadDbUser(user); loadData(); setView("home"); }} />
  );

  if (!currentUser && view !== "home") return (
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
          <div style={styles.logo} className="app-logo" onClick={() => setView("home")}>
            <img src={logoIcon} alt="DriveLink" style={styles.logoImg} />
            <span style={styles.logoText}>DriveLink</span>
          </div>
          <div style={styles.navLinks} className="app-nav-links">
            <NavBtn active={view === "home"} onClick={() => setView("home")}>Browse</NavBtn>
            {currentUser && <NavBtn active={view === "myListings"} onClick={() => setView("myListings")}>My Listings</NavBtn>}
            {currentUser && <NavBtn active={view === "postListing"} onClick={() => setView("postListing")}>+ Post Car</NavBtn>}
            {currentUser && <NavBtn active={view === "messages"} onClick={() => setView("messages")}>Messages</NavBtn>}
            {currentUser && <NavBtn active={view === "savedSearches"} onClick={() => setView("savedSearches")}>Saved Searches</NavBtn>}
            {currentUser && <NavBtn active={view === "dashboard"} onClick={() => setView("dashboard")}>Earnings</NavBtn>}
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

      <main style={styles.main} className="app-main">
        {view === "home" && <HomeView listings={activeListings} allListings={listings} currentUser={dbUser} users={users} onShare={generateShare} onBuy={handleBuyNow} referrals={referrals} onSignIn={() => setView("auth")} onMessageSeller={messageSeller} onReport={fileReport} onSaveSearch={saveSearch} />}
        {view === "myListings" && <MyListingsView listings={listings.filter(l => l.seller_id === currentUser?.id)} referrals={referrals} users={users} onMarkSold={markSold} onSetStatus={setListingStatus} />}
        {view === "postListing" && <PostListingView onPost={postListing} />}
        {view === "messages" && currentUser && <Messages currentUser={{ ...dbUser, id: currentUser.id }} listings={listings} users={users} openThread={openThread} onOpened={() => setOpenThread(null)} />}
        {view === "savedSearches" && <SavedSearchesView savedSearches={savedSearches} onDelete={deleteSavedSearch} onBrowse={() => setView("home")} />}
        {view === "dashboard" && <PromoterDashboard currentUser={dbUser} referrals={referrals.filter(r => r.promoter_id === currentUser?.id)} listings={listings} />}
        {view === "admin" && <AdminView listings={listings} users={users} referrals={referrals} reports={reports} onArchive={archiveListing} onMarkSold={markSold} onResolveReport={resolveReport} onToggleVerified={toggleVerified} />}
        {view === "success" && <SuccessView onHome={() => setView("home")} />}
      </main>
    </div>
  );
}

function NavBtn({ children, active, onClick }) {
  return <button style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }} onClick={onClick}>{children}</button>;
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

function HomeView({ listings, allListings, currentUser, users, onShare, onBuy, referrals, onSignIn, onMessageSeller, onReport, onSaveSearch }) {
  const [search, setSearch] = useState("");
  const [make, setMake] = useState("all");
  const [maxPrice, setMaxPrice] = useState(200000);
  const [maxMileage, setMaxMileage] = useState(300000);
  const [location, setLocation] = useState("");
  const [sort, setSort] = useState("newest");
  const [mode, setMode] = useState("grid"); // grid | map

  const makes = [...new Set(listings.map(l => l.make).filter(Boolean))].sort();

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
            return (
              <CarCard
                key={l.id}
                listing={l}
                seller={seller}
                avgPrice={avgPrice}
                currentUser={currentUser}
                onShare={onShare}
                onBuy={onBuy}
                myRef={myRef}
                onSignIn={onSignIn}
                onMessageSeller={onMessageSeller}
                onReport={onReport}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CarCard({ listing, seller, avgPrice, currentUser, onShare, onBuy, myRef, onSignIn, onMessageSeller, onReport }) {
  const [copied, setCopied] = useState(false);
  const [reporting, setReporting] = useState(false);
  const handleShare = () => { onShare(listing.id); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const cover = (listing.images && listing.images[0]) || listing.image;
  const isOwnListing = currentUser && listing.seller_id === currentUser.id;

  let priceCompare = null;
  if (avgPrice) {
    const diffPct = Math.round(((listing.price - avgPrice) / avgPrice) * 100);
    if (Math.abs(diffPct) >= 3) {
      priceCompare = diffPct < 0
        ? { text: `${Math.abs(diffPct)}% below similar listings`, good: true }
        : { text: `${diffPct}% above similar listings`, good: false };
    }
  }

  return (
    <div style={styles.card} className="car-card">
      <div style={styles.cardImgWrap}>
        <img src={cover} alt={`${listing.make} ${listing.model}`} style={styles.cardImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=600&q=80"; }} />
        <div style={styles.cardPrice}>{fmt(listing.price)}</div>
        {listing.status === "pending" && <div style={styles.pendingRibbon}>Sale Pending</div>}
      </div>
      <div style={styles.cardBody}>
        <div style={styles.cardTitleRow}>
          <div style={styles.cardTitle}>{listing.year} {listing.make} {listing.model}</div>
          {seller?.verified && <span style={styles.verifiedBadge} title="Verified seller">✓ Verified</span>}
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
        <p style={styles.cardDesc}>{listing.description}</p>
        {listing.vin && (
          <div style={styles.vinRow}>
            VIN: {listing.vin} · <a href={`https://www.carfax.com/vehicle/${listing.vin}`} target="_blank" rel="noreferrer" style={styles.vinLink}>Check Carfax history →</a>
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
        {currentUser && !isOwnListing && (
          <div style={styles.cardSecondaryActions}>
            <button style={styles.messageLink} onClick={() => onMessageSeller(listing)}>💬 Message seller</button>
            <button style={styles.reportLink} onClick={() => setReporting(true)}>🚩 Report</button>
          </div>
        )}
      </div>
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

function MyListingsView({ listings, referrals, users, onMarkSold, onSetStatus }) {
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>My Listings</h2>
      {listings.length === 0 && <p style={{ color: "#6b7280" }}>You haven't posted any listings yet.</p>}
      <div style={styles.tableWrap}>
        {listings.map(l => {
          const ref = referrals.find(r => r.listing_id === l.id);
          const promoter = ref ? users.find(u => u.id === ref.promoter_id) : null;
          const cover = (l.images && l.images[0]) || l.image;
          return (
            <div key={l.id} style={styles.listingRow} className="app-listing-row">
              <img src={cover} alt="" style={styles.rowImg} onError={e => { e.target.src = "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=300&q=60"; }} />
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{l.year} {l.make} {l.model}</div>
                <div style={styles.rowMeta}>{fmt(l.price)} • {l.mileage?.toLocaleString()} mi</div>
                {l.status === "sold" && <div style={styles.soldBadge}>SOLD for {fmt(l.sale_price)} on {l.sold_at}</div>}
                {promoter && <div style={styles.promoterTag}>Promoted by {promoter.name} {ref.status === "paid" ? `• Commission ${fmt(ref.commission_amount)} paid` : "• Pending"}</div>}
              </div>
              <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : l.status === "pending" ? "#fef9c3" : "#fee2e2", color: l.status === "active" ? "#15803d" : l.status === "pending" ? "#854d0e" : "#b91c1c" }}>{l.status}</span>
              {l.status === "active" && (
                <>
                  <button style={styles.pendingBtn} onClick={() => onSetStatus(l.id, "pending")}>Mark Pending</button>
                  <button style={styles.soldBtn} onClick={() => onMarkSold(l.id, l.price)}>Mark Sold</button>
                </>
              )}
              {l.status === "pending" && (
                <>
                  <button style={styles.pendingBtn} onClick={() => onSetStatus(l.id, "active")}>Reactivate</button>
                  <button style={styles.soldBtn} onClick={() => onMarkSold(l.id, l.price)}>Mark Sold</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PostListingView({ onPost }) {
  const [form, setForm] = useState({ make: "", model: "", year: new Date().getFullYear(), price: "", mileage: "", color: "", description: "", vin: "", location_text: "" });
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
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
    });
    setSubmitting(false);
  };
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
          <Field label="VIN (optional)" value={form.vin} onChange={v => set("vin", v)} placeholder="17-character VIN" />
          <Field label="Location (city or ZIP)" value={form.location_text} onChange={v => set("location_text", v)} placeholder="e.g. Austin, TX" />
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

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={styles.fieldLabel}>{label}</label>
      <input style={styles.fieldInput} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PromoterDashboard({ currentUser, referrals, listings }) {
  const pending = referrals.filter(r => r.status === "pending");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Earnings Dashboard</h2>
      <div style={styles.statsRow}>
        <StatBox label="Total Earned" value={fmt(currentUser?.balance || 0)} color="#16a34a" />
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
    </div>
  );
}

function StatBox({ label, value, color }) {
  return <div style={styles.statBox}><div style={{ ...styles.statValue, color }}>{value}</div><div style={styles.statLabel}>{label}</div></div>;
}

function AdminView({ listings, users, referrals, reports, onArchive, onMarkSold, onResolveReport, onToggleVerified }) {
  const [tab, setTab] = useState("listings");
  const activeAndSold = listings.filter(l => l.status !== "archived");
  const totalRevenue = activeAndSold.filter(l => l.status === "sold").reduce((s, l) => s + (l.sale_price || 0), 0);
  const platformEarnings = activeAndSold.filter(l => l.status === "sold").reduce((s, l) => s + (l.platform_fee || Math.round((l.sale_price || 0) * 0.01)), 0);
  const totalCommissions = referrals.filter(r => r.status === "paid").reduce((s, r) => s + (r.commission_amount || 0), 0);
  const openReports = reports.filter(r => r.status === "open");
  return (
    <div style={styles.pageWrap}>
      <h2 style={styles.pageTitle}>Admin Panel</h2>
      <div style={styles.statsRow}>
        <StatBox label="Listings" value={activeAndSold.length} color="#1d4ed8" />
        <StatBox label="Active" value={activeAndSold.filter(l => l.status === "active").length} color="#16a34a" />
        <StatBox label="Sold" value={activeAndSold.filter(l => l.status === "sold").length} color="#7c3aed" />
        <StatBox label="GMV" value={fmt(totalRevenue)} color="#b45309" />
        <StatBox label="Your Earnings (1%)" value={fmt(platformEarnings)} color="#16a34a" />
        <StatBox label="Promoter Commissions" value={fmt(totalCommissions)} color="#dc2626" />
        <StatBox label="Open Reports" value={openReports.length} color="#dc2626" />
      </div>
      <div style={styles.tabRow}>
        {["listings", "archived", "users", "referrals", "reports"].map(t => <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}{t === "reports" && openReports.length > 0 ? ` (${openReports.length})` : ""}</button>)}
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
              </div>
              <span style={{ ...styles.statusPill, background: l.status === "active" ? "#dcfce7" : "#fee2e2", color: l.status === "active" ? "#15803d" : "#b91c1c" }}>{l.status}</span>
              {l.status === "active" && <button style={styles.soldBtn} onClick={() => onMarkSold(l.id, l.price)}>Mark Sold</button>}
              <button style={styles.removeBtn} onClick={() => onArchive(l.id)}>Archive</button>
            </div>
          ))}
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
          {users.map(u => (
            <div key={u.id} style={styles.listingRow} className="app-listing-row">
              <div style={styles.avatar}>{u.name[0]}</div>
              <div style={styles.rowInfo} className="app-row-info">
                <div style={styles.rowTitle}>{u.name} {u.verified && <span style={styles.verifiedBadge}>✓ Verified</span>}</div>
                <div style={styles.rowMeta}>{u.email} • Balance: {fmt(u.balance || 0)}</div>
              </div>
              <span style={{ ...styles.statusPill, background: "#e0e7ff", color: "#3730a3" }}>{u.role}</span>
              <button style={u.verified ? styles.removeBtn : styles.pendingBtn} onClick={() => onToggleVerified(u.id, !u.verified)}>
                {u.verified ? "Unverify" : "Verify Seller"}
              </button>
            </div>
          ))}
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
    </div>
  );
}

const styles = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#f8fafc", minHeight: "100vh", color: "#111827" },
  nav: { background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 100 },
  navInner: { maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", gap: 24 },
  logo: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 },
  logoImg: { height: 30, width: "auto", display: "block" },
  logoIcon: { fontSize: 22 },
  logoText: { fontWeight: 800, fontSize: 20, color: "#0f172a", letterSpacing: "-0.03em" },
  navLinks: { display: "flex", gap: 4, flex: 1 },
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
  pendingRibbon: { position: "absolute", top: 12, left: 12, background: "#f59e0b", color: "#fff", fontWeight: 700, fontSize: 11, padding: "4px 10px", borderRadius: 8, textTransform: "uppercase", letterSpacing: ".03em" },
  cardBody: { padding: "18px 20px 20px" },
  cardTitleRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: 700, color: "#0f172a" },
  verifiedBadge: { fontSize: 11, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 20 },
  cardMeta: { display: "flex", gap: 16, fontSize: 13, color: "#6b7280", marginBottom: 10, flexWrap: "wrap" },
  priceCompare: { fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, display: "inline-block", marginBottom: 10 },
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
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" },
  modalBox: { background: "#fff", borderRadius: 20, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)", boxSizing: "border-box" },
  modalTitle: { fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 12 },
  modalText: { fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 10 },
  modalActions: { display: "flex", gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, background: "#f1f5f9", border: "none", padding: "12px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  confirmBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "12px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  pageWrap: { paddingTop: 36 },
  pageTitle: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 24, letterSpacing: "-0.02em" },
  tableWrap: { display: "flex", flexDirection: "column", gap: 12 },
  listingRow: { background: "#fff", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  rowImg: { width: 80, height: 60, borderRadius: 8, objectFit: "cover", flexShrink: 0 },
  rowInfo: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  rowMeta: { fontSize: 13, color: "#6b7280", marginTop: 3 },
  soldBadge: { display: "inline-block", background: "#dcfce7", color: "#15803d", fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, marginTop: 6 },
  promoterTag: { display: "inline-block", background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "3px 8px", borderRadius: 6, marginTop: 6 },
  statusPill: { flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: ".04em" },
  soldBtn: { background: "#dcfce7", color: "#15803d", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  pendingBtn: { background: "#fef9c3", color: "#854d0e", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  removeBtn: { background: "#fee2e2", color: "#dc2626", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
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
  tabRow: { display: "flex", gap: 4, marginBottom: 20 },
  tab: { padding: "8px 18px", borderRadius: 8, border: "none", background: "none", fontSize: 14, fontWeight: 500, color: "#6b7280", cursor: "pointer" },
  tabActive: { background: "#f1f5f9", color: "#0f172a", fontWeight: 700 },
  toast: { position: "fixed", bottom: 24, right: 24, zIndex: 9999, color: "#fff", fontWeight: 600, fontSize: 14, padding: "14px 20px", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.2)", maxWidth: 360 },
};

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f8fafc; overflow-x: hidden; }
  img { max-width: 100%; }
  .car-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,.12) !important; }
  input:focus, select:focus, textarea:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
  button:active { opacity: .85; }

  /* Nav: let the middle links scroll horizontally instead of squeezing everything */
  .app-nav-inner { gap: 12px; }
  .app-nav-links { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .app-nav-links::-webkit-scrollbar { display: none; }
  .app-nav-links button { white-space: nowrap; flex-shrink: 0; }

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
