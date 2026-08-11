import { useState } from "react";
import { supabase } from "./supabase.js";
import { useLang, Rich, LangToggle } from "./i18n.jsx";
import logoIcon from "./assets/logo-icon.png";

export default function Landing({ onSignIn, onBrowse, onNavigate, signedIn }) {
  const { t } = useLang();
  const handleCta = signedIn ? onBrowse : onSignIn;
  // Signed-out visitors go to auth first — StartDealView needs an account to
  // attach the deal to. This is the one CTA that works with zero inventory.
  const handleStartDeal = signedIn ? () => onNavigate?.("startDeal") : onSignIn;

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {/* NAV */}
      <nav style={styles.nav}>
        <div style={styles.navInner} className="dl-nav-inner">
          <div style={styles.logo} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <img src={logoIcon} alt="DriveLink" style={styles.logoImg} />
            <span style={styles.logoText}>DriveLink</span>
          </div>
          <div style={styles.navRight} className="dl-nav-right">
            {/* Without this, a Spanish speaker landing on "/" has no way to
                switch — the toggle only existed once they were inside the app. */}
            <LangToggle />
            <button style={styles.byodNavBtn} onClick={handleStartDeal} className="dl-byod-nav">{t("lp.nav.secure")}</button>
            <button style={styles.browseBtn} onClick={onBrowse}>{t("lp.nav.browse")}</button>
            <button style={styles.signInBtn} onClick={signedIn ? onBrowse : onSignIn}>{signedIn ? t("lp.nav.app") : t("lp.nav.signin")}</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={styles.hero} className="dl-hero">
        <div style={styles.heroBannerWrap} className="dl-hero-banner-wrap">
          <div style={styles.heroBanner} className="dl-hero-banner">
            <span style={styles.heroBannerDot} />
            {t("lp.badge")}
          </div>
        </div>
        <div style={styles.heroInner}>
          <h1 style={styles.heroTitle} className="dl-hero-title">
            {t("lp.title")}<br />
            <span style={styles.heroAccent}>{t("lp.titleAccent")}</span>
          </h1>
          <p style={styles.heroSub} className="dl-hero-sub">
            <Rich text={t("lp.sub")} />
          </p>
          <div style={styles.heroActions} className="dl-hero-actions">
            <button style={styles.ctaByodDark} onClick={handleStartDeal}>{t("lp.ctaByod")}</button>
            <button style={styles.ctaPrimary} onClick={onBrowse}>{t("lp.ctaBrowse")}</button>
            <button style={styles.ctaSecondary} onClick={handleCta}>{t("lp.ctaList")}</button>
          </div>

          <div style={styles.trustStrip} className="dl-trust-strip">
            <span style={styles.trustItem}>{t("lp.trustStripe")}</span>
            <span style={styles.trustItem}>{t("lp.trustId")}</span>
            <span style={styles.trustItem}>{t("lp.trustNoFee")}</span>
          </div>

          <div style={styles.heroStats} className="dl-hero-stats">
            <div style={styles.heroStat}>
              <span style={styles.heroStatNum}>1%</span>
              <span style={styles.heroStatLabel}>{t("lp.statFee")}</span>
            </div>
            <div style={styles.heroStatDiv} />
            <div style={styles.heroStat}>
              <span style={styles.heroStatNum}>$0</span>
              <span style={styles.heroStatLabel}>{t("lp.statList")}</span>
            </div>
            <div style={styles.heroStatDiv} />
            <div style={styles.heroStat}>
              <span style={styles.heroStatNum}>2% max</span>
              <span style={styles.heroStatLabel}>{t("lp.statPromoter")}</span>
            </div>
          </div>
        </div>
        <div style={styles.heroImageWrap} className="dl-hero-image">
          <img src="https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800&q=80" alt="Cars" style={styles.heroImage} />
        </div>
      </section>

      {/* THE PROBLEM */}
      <section style={{ ...styles.section, background: "#f8fafc", paddingTop: 64, paddingBottom: 64 }} className="dl-section">
        <div style={styles.sectionInner}>
          <div style={styles.sectionBadge}>{t("lp.why.badge")}</div>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 32 }} className="dl-section-title">
            {t("lp.why.title")}
          </h2>
          <div style={styles.problemGrid} className="dl-problem-grid">
            <div style={styles.problemCard}>
              <div style={styles.problemLabel}>{t("lp.why.buyerLabel")}</div>
              <p style={styles.problemText}>
                {t("lp.why.buyerText")}
              </p>
            </div>
            <div style={styles.problemCard}>
              <div style={styles.problemLabel}>{t("lp.why.sellerLabel")}</div>
              <p style={styles.problemText}>
                {t("lp.why.sellerText")}
              </p>
            </div>
            <div style={styles.problemCard}>
              <div style={styles.problemLabel}>{t("lp.why.bothLabel")}</div>
              <p style={styles.problemText}>
                {t("lp.why.bothText")}
              </p>
            </div>
          </div>
          <p style={styles.problemClose}>{t("lp.why.close")}</p>
        </div>
      </section>

      {/* BRING YOUR OWN DEAL */}
      <section style={styles.byodBand} className="dl-section">
        <div style={styles.byodInner}>
          <div style={styles.byodBadge}>{t("lp.byod.badge")}</div>
          <h2 style={styles.byodTitle} className="dl-byod-title">
            {t("lp.byod.title")}
          </h2>
          <p style={styles.byodText}>
            {t("lp.byod.text")}
          </p>

          <div style={styles.byodSplit} className="dl-byod-split">
            <div style={styles.byodCol}>
              <div style={styles.byodColLabel}>{t("lp.byod.buyLabel")}</div>
              <p style={styles.byodColText}>
                {t("lp.byod.buyText")}
              </p>
            </div>
            <div style={styles.byodCol}>
              <div style={styles.byodColLabel}>{t("lp.byod.sellLabel")}</div>
              <p style={styles.byodColText}>
                {t("lp.byod.sellText")}
              </p>
            </div>
          </div>

          <button style={styles.byodBtn} onClick={handleStartDeal}>{t("lp.byod.btn")}</button>
          <p style={styles.byodFine}>
            {t("lp.byod.fine")}
          </p>
        </div>
      </section>

      {/* HOW ESCROW WORKS */}
      <section style={styles.section} className="dl-section">
        <div style={styles.sectionInner}>
          <div style={styles.sectionBadge}>{t("lp.esc.badge")}</div>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 32 }} className="dl-section-title">
            {t("lp.esc.title")}
          </h2>
          <div style={styles.escrowSteps} className="dl-escrow-steps">
            <div style={styles.escrowStep}>
              <div style={styles.escrowNum}>01</div>
              <h4 style={styles.escrowTitle}>{t("lp.esc.t1")}</h4>
              <p style={styles.escrowDesc}>
                {t("lp.esc.d1")}
              </p>
            </div>
            <div style={styles.escrowStep}>
              <div style={styles.escrowNum}>02</div>
              <h4 style={styles.escrowTitle}>{t("lp.esc.t2")}</h4>
              <p style={styles.escrowDesc}>
                {t("lp.esc.d2")}
              </p>
            </div>
            <div style={styles.escrowStep}>
              <div style={styles.escrowNum}>03</div>
              <h4 style={styles.escrowTitle}>{t("lp.esc.t3")}</h4>
              <p style={styles.escrowDesc}>
                {t("lp.esc.d3")}
              </p>
            </div>
            <div style={styles.escrowStep}>
              <div style={styles.escrowNum}>04</div>
              <h4 style={styles.escrowTitle}>{t("lp.esc.t4")}</h4>
              <p style={styles.escrowDesc}>
                {t("lp.esc.d4")}
              </p>
            </div>
          </div>
          <div style={styles.feeNote}>
            <Rich text={t("lp.esc.fee")} />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — ROLES */}
      <section style={{ ...styles.section, background: "#f8fafc" }} className="dl-section">
        <div style={styles.sectionInner}>
          <div style={styles.sectionBadge}>How it works</div>
          <h2 style={styles.sectionTitle} className="dl-section-title">Three ways to use DriveLink</h2>
          <div style={styles.cards} className="dl-cards">

            <div style={{ ...styles.roleCard, background: "#fff" }}>
              <div style={styles.roleEmoji}>🚗</div>
              <h3 style={styles.roleTitle}>Sellers</h3>
              <p style={styles.roleDesc}>List your car for free in minutes. Upload photos, set your price, and let our network of promoters share it for you. The buyer's money sits in escrow before you hand over anything — so you're never deciding whether to trust a piece of paper in a parking lot.</p>
              <ul style={styles.roleList}>
                <li>✅ Free to list</li>
                <li>✅ Buyer's funds verified before handover</li>
                <li>✅ 1% fee, 2% max if referred</li>
              </ul>
              <button style={styles.roleBtn} onClick={handleCta}>List My Car →</button>
            </div>

            <div style={{ ...styles.roleCard, ...styles.roleCardFeatured }}>
              <div style={styles.featuredBadge}>Most Popular</div>
              <div style={styles.roleEmoji}>💰</div>
              <h3 style={{ ...styles.roleTitle, color: "#fff" }}>Promoters</h3>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#60a5fa", marginBottom: 10 }}>The link that drives you to cash. 💸</p>
              <p style={{ ...styles.roleDesc, color: "#94a3b8" }}>Share car listings with your friends, family, or followers. Every time someone buys a car through your link, you earn 1% of the sale price — automatically.</p>
              <ul style={{ ...styles.roleList, color: "#94a3b8" }}>
                <li>✅ Earn 1% per sale</li>
                <li>✅ No experience needed</li>
                <li>✅ Paid automatically</li>
              </ul>
              <button style={{ ...styles.roleBtn, background: "#3b82f6" }} onClick={handleCta}>Start Earning →</button>
            </div>

            <div style={{ ...styles.roleCard, background: "#fff" }}>
              <div style={styles.roleEmoji}>🛒</div>
              <h3 style={styles.roleTitle}>Buyers</h3>
              <p style={styles.roleDesc}>Browse cars listed directly by their owners. No dealer markups, no pressure. Your payment is held in escrow until you confirm you have the car and the title in your hands.</p>
              <ul style={styles.roleList}>
                <li>✅ Direct from owners</li>
                <li>✅ Money held until you have the keys</li>
                <li>✅ Seller ID verification available</li>
              </ul>
              <button style={styles.roleBtn} onClick={onBrowse}>Browse Cars →</button>
            </div>

          </div>
        </div>
      </section>

      {/* HOW REFERRALS WORK */}
      <section style={{ ...styles.section, background: "#f1f5f9" }} className="dl-section">
        <div style={styles.sectionInner}>
          <div style={styles.sectionBadge}>Referral system</div>
          <h2 style={styles.sectionTitle} className="dl-section-title">Earn money sharing cars you don't own</h2>
          <div style={styles.steps} className="dl-steps">
            <div style={styles.step}>
              <div style={styles.stepNum}>1</div>
              <h4 style={styles.stepTitle}>Browse listings</h4>
              <p style={styles.stepDesc}>Find any car listing on DriveLink that you think your network would love.</p>
            </div>
            <div style={styles.stepArrow} className="dl-step-arrow">→</div>
            <div style={styles.step}>
              <div style={styles.stepNum}>2</div>
              <h4 style={styles.stepTitle}>Share your link</h4>
              <p style={styles.stepDesc}>Click "Share &amp; Earn 1%" to get your unique referral code. Share it anywhere.</p>
            </div>
            <div style={styles.stepArrow} className="dl-step-arrow">→</div>
            <div style={styles.step}>
              <div style={styles.stepNum}>3</div>
              <h4 style={styles.stepTitle}>Get paid</h4>
              <p style={styles.stepDesc}>When someone buys through your link, 1% of the sale is credited to your account instantly.</p>
            </div>
          </div>
          {/* The one route in from the landing page for someone who moves cars
              for a living. Deliberately a single line rather than a card: a
              consumer skims past it, and a broker stops. /promoter is not in
              the nav or footer — this and the outreach email are the ways in. */}
          <p style={{ textAlign: "center", fontSize: 15, color: "#475569", marginTop: 4, marginBottom: 28 }}>
            Move cars for a living? Transport brokers, mechanics, and dealers earn the same 1%.{" "}
            <button
              onClick={() => onNavigate?.("promoter")}
              style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", fontWeight: 700, fontSize: 15, cursor: "pointer", textDecoration: "underline" }}
            >
              See how it works →
            </button>
          </p>

          <div style={styles.exampleBox}>
            <b>Example:</b> A $30,000 Honda CR-V sells through your referral → You earn <span style={{ color: "#16a34a", fontWeight: 800 }}>$300</span> automatically.
          </div>
        </div>
      </section>

      {/* EVERY LISTING */}
      <section style={styles.assureBand} className="dl-section">
        <div style={styles.assureInner}>
          <div style={styles.assureBadge}>{t("lp.assure.badge")}</div>
          <h2 style={styles.assureTitle} className="dl-assure-title">{t("lp.assure.title")}</h2>
          <p style={styles.assureText}>
            {t("lp.assure.text")}
          </p>
          <button style={styles.assureBtn} onClick={onBrowse}>{t("lp.assure.btn")}</button>
        </div>
      </section>

      {/* CTA */}
      <section style={styles.ctaSection} className="dl-section">
        <div style={styles.sectionInner}>
          <h2 style={styles.ctaTitle} className="dl-cta-title">{t("lp.cta.title")}</h2>
          <p style={styles.ctaSub}>{t("lp.cta.sub")}</p>
          <div style={{ ...styles.heroActions, justifyContent: "center" }} className="dl-hero-actions">
            <button style={styles.ctaPrimary} onClick={onBrowse}>{t("lp.cta.browse")}</button>
            <button style={{ ...styles.ctaSecondary, borderColor: "rgba(255,255,255,.3)", color: "#fff" }} onClick={handleCta}>{t("lp.cta.create")}</button>
            <button style={styles.ctaByodDark} onClick={handleStartDeal}>{t("lp.cta.byod")}</button>
          </div>
        </div>
      </section>

      {/* FEEDBACK */}
      <FeedbackSection />

      {/* FOOTER */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={{ ...styles.footerLogo, cursor: "pointer" }} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <img src={logoIcon} alt="DriveLink" style={{ height: 26, width: "auto" }} />
            <span style={{ fontWeight: 800, color: "#0f172a" }}>DriveLink</span>
          </div>
          <p style={styles.footerText}>{t("lp.foot.tagline")}</p>
          <p style={styles.footerText}>{t("lp.foot.rights")}</p>
          <div style={styles.footerLinks}>
            <button style={styles.footerLinkBtn} onClick={() => onNavigate?.("safety")}>{t("lp.foot.safety")}</button>
            <span style={{ color: "#d1d5db" }}>·</span>
            <button style={styles.footerLinkBtn} onClick={() => onNavigate?.("terms")}>{t("lp.foot.terms")}</button>
            <span style={{ color: "#d1d5db" }}>·</span>
            <button style={styles.footerLinkBtn} onClick={() => onNavigate?.("privacy")}>{t("lp.foot.privacy")}</button>
            <span style={{ color: "#d1d5db" }}>·</span>
            <a href="mailto:support@drivelink.deals" style={styles.footerLinkBtn}>support@drivelink.deals</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeedbackSection() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  const submit = async () => {
    if (!message.trim()) return;
    setStatus("sending");
    const { error } = await supabase.from("feedback").insert({
      id: "fb" + Date.now(),
      email: email.trim() || null,
      message: message.trim(),
    });
    if (error) { setStatus("error"); return; }
    setStatus("sent");
    setMessage("");
    setEmail("");
  };

  return (
    <section style={styles.feedbackSection}>
      <div style={styles.sectionInner}>
        <div style={styles.feedbackBox}>
          <h3 style={styles.feedbackTitle}>This is your marketplace.</h3>
          <p style={styles.feedbackSub}>Noticed a feature you'd like to see? Let us know — it helps us build what actually matters to you.</p>
          {status === "sent" ? (
            <div style={styles.feedbackThanks}>✅ Thanks — we've got your note and will take a look.</div>
          ) : (
            <div style={styles.feedbackForm}>
              <textarea
                style={styles.feedbackTextarea}
                placeholder="What would make DriveLink better for you?"
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
              />
              <div style={styles.feedbackRow}>
                <input
                  style={styles.feedbackEmail}
                  placeholder="Your email (optional, if you'd like a reply)"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <button style={styles.feedbackBtn} onClick={submit} disabled={status === "sending" || !message.trim()}>
                  {status === "sending" ? "Sending…" : "Send Feedback"}
                </button>
              </div>
              {status === "error" && <div style={styles.feedbackError}>Something went wrong — please try again.</div>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const styles = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  nav: { background: "#fff", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 100 },
  navInner: { maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" },
  logo: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  logoImg: { height: 34, width: "auto", display: "block" },
  logoIcon: { fontSize: 22 },
  logoText: { fontWeight: 800, fontSize: 20, color: "#0f172a", letterSpacing: "-0.03em" },
  navRight: { display: "flex", gap: 12, alignItems: "center" },
  browseBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 18px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  signInBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  hero: { maxWidth: 1200, margin: "0 auto", padding: "80px 24px 60px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" },
  heroInner: {},
  heroBannerWrap: { gridColumn: "1 / -1", display: "flex", justifyContent: "center", marginBottom: 12 },
  heroBanner: { position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", gap: 10, background: "linear-gradient(90deg,#1d4ed8,#3b82f6,#1d4ed8)", backgroundSize: "200% 100%", color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: ".04em", padding: "10px 22px", borderRadius: 999, boxShadow: "0 8px 24px rgba(29,78,216,.35)" },
  heroBannerDot: { width: 8, height: 8, borderRadius: "50%", background: "#4ade80", flexShrink: 0 },
  heroTagline: { fontSize: 15, fontWeight: 700, color: "#3b82f6", marginBottom: 14, letterSpacing: "-0.01em" },
  heroTitle: { fontSize: 52, fontWeight: 800, color: "#0f172a", lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 20 },
  heroAccent: { color: "#3b82f6" },
  heroSub: { fontSize: 18, color: "#4b5563", lineHeight: 1.7, marginBottom: 28 },
  heroActions: { display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" },
  ctaPrimary: { background: "#0f172a", color: "#fff", border: "none", padding: "14px 28px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 700 },
  ctaSecondary: { background: "none", border: "2px solid #e5e7eb", padding: "14px 28px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#374151" },
  trustStrip: { display: "flex", flexWrap: "wrap", gap: "8px 18px", marginBottom: 32, paddingTop: 20, borderTop: "1px solid #e5e7eb" },
  trustItem: { fontSize: 12.5, color: "#6b7280", fontWeight: 500, whiteSpace: "nowrap" },
  heroStats: { display: "flex", gap: 32, alignItems: "center" },
  heroStat: { display: "flex", flexDirection: "column", gap: 2 },
  heroStatNum: { fontSize: 28, fontWeight: 800, color: "#0f172a" },
  heroStatLabel: { fontSize: 12, color: "#6b7280" },
  heroStatDiv: { width: 1, height: 40, background: "#e5e7eb" },
  heroImageWrap: { borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.15)" },
  heroImage: { width: "100%", height: 400, objectFit: "cover", display: "block" },
  section: { padding: "80px 24px" },
  sectionInner: { maxWidth: 1200, margin: "0 auto" },
  sectionBadge: { display: "inline-block", background: "#eff6ff", color: "#1d4ed8", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 36, fontWeight: 800, color: "#0f172a", marginBottom: 48, letterSpacing: "-0.02em" },

  problemGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 },
  problemCard: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 28 },
  problemLabel: { fontSize: 13, fontWeight: 800, color: "#1d4ed8", marginBottom: 10, letterSpacing: "-0.01em" },
  problemText: { fontSize: 14.5, color: "#4b5563", lineHeight: 1.7, margin: 0 },
  problemClose: { textAlign: "center", fontSize: 19, fontWeight: 700, color: "#0f172a", marginTop: 36, marginBottom: 0, letterSpacing: "-0.02em" },

  escrowSteps: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 },
  escrowStep: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24 },
  escrowNum: { fontSize: 13, fontWeight: 800, color: "#3b82f6", letterSpacing: ".08em", marginBottom: 10 },
  escrowTitle: { fontSize: 16, fontWeight: 800, color: "#0f172a", marginBottom: 8, marginTop: 0, lineHeight: 1.3 },
  escrowDesc: { fontSize: 14, color: "#4b5563", lineHeight: 1.65, margin: 0 },
  feeNote: { marginTop: 28, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "16px 24px", fontSize: 14.5, color: "#374151", lineHeight: 1.65 },

  cards: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 },
  roleCard: { background: "#f8fafc", borderRadius: 20, padding: 32, border: "1px solid #e5e7eb", position: "relative" },
  roleCardFeatured: { background: "#0f172a", border: "none" },
  featuredBadge: { position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#3b82f6", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 20, whiteSpace: "nowrap" },
  roleEmoji: { fontSize: 36, marginBottom: 16 },
  roleTitle: { fontSize: 22, fontWeight: 800, color: "#0f172a", marginBottom: 12 },
  roleDesc: { fontSize: 14, color: "#4b5563", lineHeight: 1.7, marginBottom: 20 },
  roleList: { listStyle: "none", padding: 0, margin: "0 0 24px", display: "flex", flexDirection: "column", gap: 8, fontSize: 14, color: "#374151" },
  roleBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "11px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, width: "100%" },
  steps: { display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 16, alignItems: "center", marginBottom: 32 },
  step: { background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  stepNum: { width: 36, height: 36, borderRadius: "50%", background: "#0f172a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, marginBottom: 12 },
  stepTitle: { fontSize: 16, fontWeight: 700, color: "#0f172a", marginBottom: 8 },
  stepDesc: { fontSize: 14, color: "#4b5563", lineHeight: 1.6 },
  stepArrow: { fontSize: 24, color: "#9ca3af", textAlign: "center" },
  exampleBox: { background: "#fff", border: "2px solid #bbf7d0", borderRadius: 12, padding: "16px 24px", fontSize: 15, color: "#374151", textAlign: "center" },

  byodNavBtn: { background: "#fffbeb", border: "1px solid #fde68a", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#92400e" },
  ctaByod: { background: "none", border: "2px dashed #FFB020", padding: "14px 24px", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#92400e" },
  ctaByodDark: { background: "#FFB020", border: "none", padding: "14px 28px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#0f172a" },
  byodBand: { background: "#0f172a", padding: "76px 24px", borderTop: "1px dashed rgba(255,176,32,.4)", borderBottom: "1px dashed rgba(255,176,32,.4)" },
  byodInner: { maxWidth: 820, margin: "0 auto", textAlign: "center" },
  byodBadge: { display: "inline-block", background: "rgba(255,176,32,.15)", color: "#FFB020", fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, marginBottom: 18 },
  byodTitle: { fontSize: 36, fontWeight: 800, color: "#fff", marginBottom: 18, letterSpacing: "-0.02em", lineHeight: 1.2 },
  byodText: { fontSize: 16.5, color: "#94a3b8", lineHeight: 1.7, marginBottom: 36, maxWidth: 660, marginLeft: "auto", marginRight: "auto" },
  byodSplit: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 36, textAlign: "left" },
  byodCol: { background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: "22px 24px" },
  byodColLabel: { fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#FFB020", marginBottom: 10 },
  byodColText: { fontSize: 15, color: "#cbd5e1", lineHeight: 1.65, margin: 0 },
  byodBtn: { background: "#FFB020", color: "#0f172a", border: "none", padding: "15px 32px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 800 },
  byodFine: { fontSize: 13, color: "#64748b", marginTop: 16, marginBottom: 0 },
  assureBand: { background: "#0f172a", padding: "72px 24px" },
  assureInner: { maxWidth: 760, margin: "0 auto", textAlign: "center" },
  assureBadge: { display: "inline-block", background: "rgba(59,130,246,.15)", color: "#60a5fa", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, marginBottom: 16 },
  assureTitle: { fontSize: 34, fontWeight: 800, color: "#fff", marginBottom: 16, letterSpacing: "-0.02em", lineHeight: 1.2 },
  assureText: { fontSize: 16.5, color: "#94a3b8", lineHeight: 1.7, marginBottom: 28 },
  assureBtn: { background: "#3b82f6", color: "#fff", border: "none", padding: "14px 30px", borderRadius: 12, cursor: "pointer", fontSize: 16, fontWeight: 700 },

  ctaSection: { background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)", padding: "80px 24px", textAlign: "center" },
  ctaTitle: { fontSize: 40, fontWeight: 800, color: "#fff", marginBottom: 12, letterSpacing: "-0.02em" },
  ctaSub: { fontSize: 18, color: "#94a3b8", marginBottom: 32 },
  footer: { background: "#f8fafc", borderTop: "1px solid #e5e7eb", padding: "40px 24px" },
  footerInner: { maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  footerLogo: { display: "flex", alignItems: "center", gap: 8, fontSize: 18, marginBottom: 4 },
  footerText: { fontSize: 13, color: "#6b7280" },
  footerLinks: { display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap", justifyContent: "center" },
  footerLinkBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6b7280", padding: 0 },
  feedbackSection: { padding: "56px 24px", background: "#fff" },
  feedbackBox: { maxWidth: 640, margin: "0 auto", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "36px 40px", textAlign: "center" },
  feedbackTitle: { fontSize: 24, fontWeight: 800, color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em" },
  feedbackSub: { fontSize: 15, color: "#4b5563", lineHeight: 1.6, marginBottom: 24 },
  feedbackForm: { display: "flex", flexDirection: "column", gap: 12 },
  feedbackTextarea: { width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #bfdbfe", fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", background: "#fff" },
  feedbackRow: { display: "flex", gap: 10, flexWrap: "wrap" },
  feedbackEmail: { flex: 1, minWidth: 200, padding: "11px 16px", borderRadius: 10, border: "1px solid #bfdbfe", fontSize: 14, outline: "none", boxSizing: "border-box", background: "#fff" },
  feedbackBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "11px 24px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap" },
  feedbackThanks: { fontSize: 15, color: "#15803d", fontWeight: 600, padding: "12px 0" },
  feedbackError: { fontSize: 13, color: "#dc2626" },
};

const css = `
  @media (max-width: 720px) {
    .dl-byod-split { grid-template-columns: 1fr !important; }
    .dl-byod-title { font-size: 27px !important; }
  }
  @media (max-width: 560px) {
    .dl-byod-nav { display: none !important; }
  }
  * { box-sizing: border-box; }
  img { max-width: 100%; }
  button:active { opacity: .85; }

  @keyframes dl-banner-shine { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }
  @keyframes dl-banner-pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74,222,128,.6); } 50% { opacity: .6; box-shadow: 0 0 0 4px rgba(74,222,128,0); } }

  .dl-hero-banner { animation: dl-banner-shine 6s linear infinite; }
  .dl-hero-banner span { animation: dl-banner-pulse 2s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .dl-hero-banner, .dl-hero-banner span { animation: none; }
  }

  @media (max-width: 1100px) {
    .dl-escrow-steps { grid-template-columns: repeat(2, 1fr) !important; }
  }

  @media (max-width: 900px) {
    .dl-hero { grid-template-columns: 1fr !important; padding: 40px 20px 32px !important; gap: 28px !important; text-align: center; }
    .dl-hero-image { order: -1; }
    .dl-hero-image img { height: 220px !important; }
    .dl-cards { grid-template-columns: 1fr !important; }
    .dl-problem-grid { grid-template-columns: 1fr !important; }
    .dl-steps { grid-template-columns: 1fr !important; gap: 12px !important; }
    .dl-step-arrow { transform: rotate(90deg); padding: 4px 0; }
    .dl-section { padding: 48px 20px !important; }
    .dl-section-title { font-size: 26px !important; margin-bottom: 28px !important; }
    .dl-hero-title { font-size: 38px !important; }
    .dl-hero-actions { justify-content: center !important; }
    .dl-trust-strip { justify-content: center !important; }
    .dl-assure-title { font-size: 26px !important; }
  }

  @media (max-width: 900px) and (min-width: 481px) {
    .dl-hero-stats { justify-content: center !important; }
  }

  @media (max-width: 480px) {
    .dl-nav-inner { padding: 0 16px !important; }
    .dl-nav-right { gap: 8px !important; }
    .dl-nav-right button { padding: 8px 12px !important; font-size: 13px !important; }
    .dl-hero-banner { font-size: 11px !important; padding: 8px 14px !important; text-align: center; white-space: normal !important; }
    .dl-hero-title { font-size: 30px !important; }
    .dl-hero-sub { font-size: 15px !important; }
    .dl-hero-actions { flex-direction: column !important; }
    .dl-hero-actions button { width: 100% !important; }
    .dl-hero-stats { gap: 16px !important; flex-wrap: wrap !important; justify-content: center !important; }
    .dl-escrow-steps { grid-template-columns: 1fr !important; }
    .dl-trust-strip { flex-direction: column !important; align-items: center !important; gap: 6px !important; }
    .dl-cta-title { font-size: 28px !important; }
  }
`;
