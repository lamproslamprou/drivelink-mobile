import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { useLang, LangToggle } from "./i18n.jsx";
import logoFull from "./assets/logo-full.png";

const styles = {
  overlay: { minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: 20, boxSizing: "border-box" },
  card: { background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 440, boxShadow: "0 8px 40px rgba(0,0,0,.1)", boxSizing: "border-box" },
  logo: { textAlign: "center", marginBottom: 28 },
  logoImg: { width: "100%", maxWidth: 220, height: "auto", display: "block", margin: "0 auto" },
  title: { fontSize: 22, fontWeight: 800, color: "#0f172a", textAlign: "center", marginBottom: 10 },
  text: { fontSize: 14, color: "#4b5563", textAlign: "center", lineHeight: 1.6, marginBottom: 20 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" },
  input: { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 16 },
  btn: { width: "100%", background: "#0f172a", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, cursor: "pointer", fontSize: 15, fontWeight: 700, marginTop: 4 },
  error: { background: "#fee2e2", color: "#dc2626", fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 16 },
  success: { background: "#dcfce7", color: "#15803d", fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 16 },
  backLink: { width: "100%", background: "none", border: "none", color: "#6b7280", padding: "12px 0", cursor: "pointer", fontSize: 13, fontWeight: 600, marginTop: 8, textAlign: "center" },
};

// Landed on from the emailed recovery link. The Supabase client parses the
// token out of the URL fragment on load and establishes a short-lived session
// by itself, so there is nothing to read out of the address bar here — the
// only question is whether that session actually materialised. It won't have
// if the link was already used, expired, or hand-typed, and showing a password
// form in that state would fail confusingly at submit instead of up front.
export default function ResetPassword({ onDone }) {
  const { t } = useLang();
  const [ready, setReady] = useState(null); // null = checking, true/false = resolved
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The recovery session may not exist on the first tick — detectSessionInUrl
    // resolves asynchronously. Listening for PASSWORD_RECOVERY catches the case
    // where getSession() runs a moment too early.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data?.session) setReady(true);
      else setTimeout(() => { if (!cancelled) setReady(prev => (prev === null ? false : prev)); }, 1500);
    })();
    return () => { cancelled = true; sub?.subscription?.unsubscribe(); };
  }, []);

  const save = async () => {
    setError("");
    if (password.length < 8) { setError(t("auth.reset.tooShort")); return; }
    if (password !== confirm) { setError(t("auth.reset.mismatch")); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    // The recovery session becomes a normal session once the password is set,
    // so there is no reason to make them sign in again with what they just typed.
    setTimeout(() => onDone?.(), 1200);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}><LangToggle /></div>
        <div style={styles.logo}>
          <img src={logoFull} alt="DriveLink" style={styles.logoImg} />
        </div>

        {ready === null && <p style={styles.text}>{t("auth.reset.checking")}</p>}

        {ready === false && (
          <>
            <div style={styles.title}>{t("auth.reset.title")}</div>
            <div style={styles.error}>{t("auth.reset.expired")}</div>
            <button style={styles.btn} onClick={() => onDone?.()}>{t("auth.signin")}</button>
          </>
        )}

        {ready === true && (
          <>
            <div style={styles.title}>{t("auth.reset.title")}</div>
            <p style={styles.text}>{t("auth.reset.intro")}</p>
            {error && <div style={styles.error}>{error}</div>}
            {done && <div style={styles.success}>{t("auth.reset.done")}</div>}

            {!done && (
              <>
                <label style={styles.label}>{t("auth.reset.newPassword")}</label>
                <input
                  style={styles.input} type="password" autoFocus placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                />
                <label style={styles.label}>{t("auth.reset.confirmPassword")}</label>
                <input
                  style={styles.input} type="password" placeholder="••••••••"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && save()}
                />
                <button style={{ ...styles.btn, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
                  {saving ? t("auth.reset.saving") : t("auth.reset.save")}
                </button>
                <button style={styles.backLink} onClick={() => onDone?.()}>{t("auth.forgot.back")}</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
