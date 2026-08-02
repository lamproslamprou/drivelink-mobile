import { useState } from "react";
import { supabase } from "./supabase.js";
import { useLang, Rich, LangToggle } from "./i18n.jsx";
import logoFull from "./assets/logo-full.png";

const styles = {
  overlay: { minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20, boxSizing: "border-box" },
  card: { background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,.1)", boxSizing: "border-box" },
  logo: { textAlign: "center", marginBottom: 28 },
  logoIcon: { fontSize: 44 },
  logoImg: { width: "100%", maxWidth: 220, height: "auto", display: "block", margin: "0 auto" },
  logoText: { fontSize: 26, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.03em", display: "block", marginTop: 8 },
  logoSub: { fontSize: 14, color: "#6b7280", marginTop: 4, display: "block" },
  tabs: { display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 4, marginBottom: 24 },
  tab: { flex: 1, padding: "8px 0", border: "none", background: "none", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#6b7280" },
  tabActive: { background: "#fff", color: "#0f172a", boxShadow: "0 1px 4px rgba(0,0,0,.08)" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" },
  input: { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16 },
  btn: { width: "100%", background: "#0f172a", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700, marginTop: 4 },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 16 },
  success: { background: "#dcfce7", color: "#15803d", fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 16 },
  fieldHint: { fontSize: 12, color: "#6b7280", margin: "-10px 0 16px", lineHeight: 1.5 },
  perks: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 20, background: "#f8fafc", borderRadius: 12, padding: 16 },
  perk: { fontSize: 13, color: "#374151", display: "flex", alignItems: "center", gap: 8 },
  checkEmailIcon: { fontSize: 48, textAlign: "center", marginBottom: 16 },
  checkEmailTitle: { fontSize: 22, fontWeight: 800, color: "#0f172a", textAlign: "center", marginBottom: 10 },
  checkEmailText: { fontSize: 14, color: "#4b5563", textAlign: "center", lineHeight: 1.6, marginBottom: 4 },
  checkEmailAddr: { fontWeight: 700, color: "#0f172a" },
  checkEmailHint: { fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 16, lineHeight: 1.6 },
  resendBtn: { width: "100%", background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb", padding: "12px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700, marginTop: 20 },
  backLink: { width: "100%", background: "none", border: "none", color: "#6b7280", padding: "12px 0", cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8, textAlign: "center" },
};

// Display names are the trust signal on a marketplace where strangers hand
// over five figures — "Sold by Member" tells a buyer nothing. A bare !name
// check let placeholders through, and one live account was literally named
// "Member". This rejects the obvious non-answers and anything too short or
// structureless to be a name, without trying to be clever about what real
// names look like — they vary enormously and false rejections are worse than
// the occasional weak pass.
const RESERVED_NAMES = new Set([
  "member", "members", "user", "users", "seller", "sellers", "buyer", "buyers",
  "admin", "administrator", "moderator", "support", "test", "testing", "tester",
  "name", "yourname", "your name", "anonymous", "anon", "guest", "none", "n/a",
  "na", "null", "undefined", "asdf", "qwerty", "abc", "xxx", "unknown",
  "drivelink", "owner", "dealer", "car", "cars",
]);

// Returns a translation KEY for the failure, or null if the name is
// acceptable. Returning a key rather than English text keeps the rule and its
// wording apart — the caller decides what language to render it in.
export function validateDisplayName(raw) {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "auth.err.nameRequired";
  if (name.length < 2) return "auth.err.nameFull";
  if (name.length > 60) return "auth.err.nameLong";
  if (!/\p{L}/u.test(name)) return "auth.err.nameLetters";
  if (RESERVED_NAMES.has(name.toLowerCase())) return "auth.err.nameReal";
  // "aaaa", "!!!!", and similar: a single repeated character is not a name.
  if (new Set(name.replace(/\s/g, "")).size < 2) return "auth.err.nameReal";
  // Mostly digits or punctuation with a letter dropped in to pass the check above.
  const letters = (name.match(/\p{L}/gu) || []).length;
  if (letters < 2) return "auth.err.nameLetters";
  return null;
}

export default function Auth({ onAuth }) {
  const { t } = useLang();
  const [tab, setTab] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resendStatus, setResendStatus] = useState("");

  const handleSignIn = async () => {
    setError(""); setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase returns this specific error when the account exists but hasn't confirmed its email yet
      if (error.message.toLowerCase().includes("email not confirmed")) {
        setAwaitingConfirmation(true);
        setLoading(false);
        return;
      }
      setError(error.message); setLoading(false); return;
    }
    onAuth(data.user);
  };

  const handleSignUp = async () => {
    setError(""); setLoading(true);
    const nameErrorKey = validateDisplayName(name);
    if (nameErrorKey) { setError(t(nameErrorKey)); setLoading(false); return; }
    // Store the normalized form, not the raw input — collapses double spaces
    // and strips the leading/trailing whitespace that was showing up on
    // listings as " Honda" and " accord Sport Sedan 4D".
    const cleanName = name.trim().replace(/\s+/g, " ");
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name: cleanName, role: "member" }, emailRedirectTo: window.location.origin }
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setLoading(false);
    if (data.session) {
      // Email confirmations are turned off in this Supabase project — the user is already signed in.
      onAuth(data.user);
      return;
    }
    // Confirmation email required before they can sign in.
    setAwaitingConfirmation(true);
  };

  const handleResend = async () => {
    setResendStatus("sending");
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } });
    setResendStatus(error ? "error" : "sent");
    setTimeout(() => setResendStatus(""), 4000);
  };

  if (awaitingConfirmation) {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <div style={styles.checkEmailIcon}>📬</div>
          <div style={styles.checkEmailTitle}>{t("auth.confirm.title")}</div>
          <p style={styles.checkEmailText}>{t("auth.confirm.sentTo")}</p>
          <p style={{ ...styles.checkEmailText, marginBottom: 16 }}><span style={styles.checkEmailAddr}>{email}</span></p>
          <p style={styles.checkEmailText}>{t("auth.confirm.instruction")}</p>

          {resendStatus === "sent" && <div style={{ ...styles.success, marginTop: 16 }}>{t("auth.confirm.resent")}</div>}
          {resendStatus === "error" && <div style={{ ...styles.error, marginTop: 16 }}>{t("auth.confirm.resendError")}</div>}

          <button style={{ ...styles.resendBtn, opacity: resendStatus === "sending" ? 0.6 : 1 }} onClick={handleResend} disabled={resendStatus === "sending"}>
            {resendStatus === "sending" ? t("auth.confirm.sending") : t("auth.confirm.resend")}
          </button>
          <button style={styles.backLink} onClick={() => { setAwaitingConfirmation(false); setTab("signin"); setError(""); setResendStatus(""); }}>
            {t("auth.confirm.back")}
          </button>

          <p style={styles.checkEmailHint}>{t("auth.confirm.spam")}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <LangToggle />
        </div>

        <div style={styles.logo}>
          <img src={logoFull} alt="DriveLink — Buy, Sell & Earn" style={styles.logoImg} />
        </div>

        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(tab === "signin" ? styles.tabActive : {}) }} onClick={() => { setTab("signin"); setError(""); setSuccess(""); }}>{t("auth.signin")}</button>
          <button style={{ ...styles.tab, ...(tab === "signup" ? styles.tabActive : {}) }} onClick={() => { setTab("signup"); setError(""); setSuccess(""); }}>{t("auth.createAccount")}</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        {tab === "signup" && (
          <>
            <label style={styles.label}>{t("auth.yourName")}</label>
            <input style={styles.input} placeholder={t("auth.namePlaceholder")} value={name} onChange={e => setName(e.target.value)} />
            <p style={styles.fieldHint}>{t("auth.nameHint")}</p>
            <div style={styles.perks}>
              <div style={styles.perk}>🚗 <span><Rich text={t("auth.perkSell")} /></span></div>
              <div style={styles.perk}>🛒 <span><Rich text={t("auth.perkBuy")} /></span></div>
              <div style={styles.perk}>💰 <span><Rich text={t("auth.perkEarn")} /></span></div>
            </div>
          </>
        )}

        <label style={styles.label}>{t("auth.email")}</label>
        <input style={styles.input} type="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={e => setEmail(e.target.value)} />

        <label style={styles.label}>{t("auth.password")}</label>
        <input style={styles.input} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (tab === "signin" ? handleSignIn() : handleSignUp())} />

        <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} onClick={tab === "signin" ? handleSignIn : handleSignUp} disabled={loading}>
          {loading ? t("auth.pleaseWait") : tab === "signin" ? t("auth.signin") : t("auth.createAccountCta")}
        </button>
      </div>
    </div>
  );
}
