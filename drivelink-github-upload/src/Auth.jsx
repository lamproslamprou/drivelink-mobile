import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { useLang, Rich, LangToggle } from "./i18n.jsx";
import logoFull from "./assets/logo-full.png";
import { analytics } from "@heycatch/sdk";

const styles = {
  googleBtn: { width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "12px 16px", background: "#fff", color: "#1f2937", border: "1.5px solid #d1d5db", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", minHeight: 44, marginBottom: 14 },
  orRow: { display: "flex", alignItems: "center", gap: 10, margin: "2px 0 16px" },
  orLine: { flex: 1, height: 1, background: "#e5e7eb" },
  orText: { fontSize: 12, color: "#6b7280", fontWeight: 600 },
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

// GA4 events. Guarded because gtag is loaded from an external script that ad
// blockers routinely strip — a missing analytics tag must never break signup.
function track(event, params) {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", event, params);
    }
  } catch {
    // Analytics is never worth throwing over.
  }
}

// Remembers that this browser has signed in or signed up before. First-time
// visitors land on "Create account" — the sign-in screen is also where every
// gated link sends strangers (/sell, /my-listings, Message seller), and opening
// on a Sign In form they have no account for reads as a dead end.
const SEEN_KEY = "dl_seen_account";
const hasSeenAccount = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
const markSeenAccount = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ } };

// Google sign-in is turned on in the Supabase dashboard, not in code. Ask the
// project which providers are enabled and show the button only if Google is
// one of them, so the button can ship before the dashboard is configured and
// never leads anyone to a "provider is not enabled" error.
function useGoogleEnabled() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${supabase.supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabase.supabaseKey } })
      .then((r) => r.json())
      .then((j) => { if (alive) setOn(!!j?.external?.google); })
      .catch(() => { /* leave the button hidden */ });
    return () => { alive = false; };
  }, []);
  return on;
}

// Where to send the visitor once they are signed in, when the trip leaves the
// page (Google, or the confirmation email opened in a new tab). App.jsx reads
// and clears it.
export const RETURN_VIEW_KEY = "dl_post_auth_view";
const rememberReturnView = (v) => { try { if (v && v !== "auth") localStorage.setItem(RETURN_VIEW_KEY, v); } catch { /* private mode */ } };

export default function Auth({ onAuth, returnView, carLabel, initialTab, onBack }) {
  const googleOn = useGoogleEnabled();
  const { t } = useLang();
  // initialTab lets a caller that already knows which one the visitor wants
  // (the invite page has separate "create account" and "sign in" buttons) open
  // the right tab; otherwise returning browsers get sign-in, new ones sign-up.
  const [tab, setTab] = useState(() => initialTab || (hasSeenAccount() ? "signin" : "signup"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [resendStatus, setResendStatus] = useState("");
  // "form" | "sent". Kept separate from `tab` so backing out of the reset flow
  // returns to sign-in with the typed email still in place.
  const [forgotStage, setForgotStage] = useState(null);

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
    markSeenAccount();
    // HeyCatch had no sign-in event at all (only signup_completed and
    // identity), so a "Signed in" funnel step could never be reached.
    try { analytics.trackEvent("signed_in"); } catch { /* ignore */ }
    onAuth(data.user);
  };

  const handleGoogle = async () => {
    setError(""); setLoading(true);
    rememberReturnView(returnView);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError(error.message); setLoading(false); }
    // On success the browser is already leaving for Google.
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
    // Fired before the session branch so both outcomes count as one signup:
    // an immediate session, and the confirm-your-email path. The account row
    // exists either way, which is what the conversion is measuring.
    rememberReturnView(returnView);
    track("sign_up", { method: "email" });
    // HeyCatch: the account exists either way (session now, or after email
    // confirmation), which is the outcome being counted.
    try { analytics.trackEvent("signup_completed"); } catch { /* ignore */ }
    setLoading(false);
    markSeenAccount();
    if (data.session) {
      // Email confirmations are turned off in this Supabase project — the user is already signed in.
      onAuth(data.user);
      return;
    }
    // Confirmation email required before they can sign in.
    setAwaitingConfirmation(true);
  };

  // Supabase mails the link; we never learn whether the address exists, and we
  // deliberately do not tell the visitor either. Confirming which emails have
  // accounts is an enumeration gift on a marketplace where the account holder's
  // name is public.
  const handleForgot = async () => {
    setError("");
    if (!email.trim()) { setError(t("auth.forgot.needEmail")); return; }
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setForgotStage("sent");
  };

  const handleResend = async () => {
    setResendStatus("sending");
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } });
    setResendStatus(error ? "error" : "sent");
    setTimeout(() => setResendStatus(""), 4000);
  };

  if (forgotStage === "sent") {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <div style={styles.checkEmailIcon}>\ud83d\udce8</div>
          <div style={styles.checkEmailTitle}>{t("auth.forgot.sentTitle")}</div>
          <p style={styles.checkEmailText}>{t("auth.forgot.sentTo")}</p>
          <p style={{ ...styles.checkEmailText, marginBottom: 16 }}><span style={styles.checkEmailAddr}>{email}</span></p>
          <p style={styles.checkEmailText}>{t("auth.forgot.sentRest")}</p>
          <button style={styles.backLink} onClick={() => { setForgotStage(null); setTab("signin"); setError(""); }}>
            {t("auth.forgot.back")}
          </button>
          <p style={styles.checkEmailHint}>{t("auth.confirm.spam")}</p>
        </div>
      </div>
    );
  }

  if (forgotStage === "form") {
    return (
      <div style={styles.overlay}>
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}><LangToggle /></div>
          <div style={styles.logo}>
            <img src={logoFull} alt="DriveLink" style={styles.logoImg} />
          </div>
          <div style={styles.checkEmailTitle}>{t("auth.forgot.title")}</div>
          <p style={{ ...styles.checkEmailText, marginBottom: 20 }}>{t("auth.forgot.intro")}</p>
          {error && <div style={styles.error}>{error}</div>}
          <label style={styles.label}>{t("auth.email")}</label>
          <input
            style={styles.input} type="email" autoFocus
            placeholder={t("auth.emailPlaceholder")}
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleForgot()}
          />
          <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} onClick={handleForgot} disabled={loading}>
            {loading ? t("auth.forgot.sending") : t("auth.forgot.send")}
          </button>
          <button style={styles.backLink} onClick={() => { setForgotStage(null); setError(""); }}>
            {t("auth.forgot.back")}
          </button>
        </div>
      </div>
    );
  }

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
        <div style={{ display: "flex", justifyContent: onBack ? "space-between" : "flex-end", alignItems: "center", marginBottom: 8 }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{ background: "none", border: "none", padding: "8px 4px", fontSize: 15, fontWeight: 600, color: "#475569", cursor: "pointer", minHeight: 44 }}
            >
              {t("auth.back")}
            </button>
          )}
          <LangToggle />
        </div>

        <div style={styles.logo}>
          <img src={logoFull} alt="DriveLink — Buy, Sell & Earn" style={styles.logoImg} />
        </div>

        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(tab === "signin" ? styles.tabActive : {}) }} onClick={() => { setTab("signin"); setError(""); setSuccess(""); }}>{t("auth.signin")}</button>
          <button style={{ ...styles.tab, ...(tab === "signup" ? styles.tabActive : {}) }} onClick={() => { setTab("signup"); setError(""); setSuccess(""); }}>{t("auth.createAccount")}</button>
        </div>

        {carLabel && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0c4a6e", borderRadius: 8, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, marginBottom: 12 }}>
            {t("auth.continueWithCar", { car: carLabel })}
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        {googleOn && (
          <>
            <button style={{ ...styles.googleBtn, opacity: loading ? 0.6 : 1 }} onClick={handleGoogle} disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
                <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/>
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
              </svg>
              {t("auth.google")}
            </button>
            <div style={styles.orRow}><span style={styles.orLine} /><span style={styles.orText}>{t("auth.or")}</span><span style={styles.orLine} /></div>
          </>
        )}

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

        {tab === "signin" && (
          <button style={styles.backLink} onClick={() => { setForgotStage("form"); setError(""); }}>
            {t("auth.forgot.link")}
          </button>
        )}
      </div>
    </div>
  );
}
