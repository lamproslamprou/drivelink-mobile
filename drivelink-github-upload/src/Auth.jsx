import { useState } from "react";
import { supabase } from "./supabase.js";
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

export default function Auth({ onAuth }) {
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
    if (!name) { setError("Please enter your name."); setLoading(false); return; }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, role: "member" }, emailRedirectTo: window.location.origin }
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
          <div style={styles.checkEmailTitle}>Check your email</div>
          <p style={styles.checkEmailText}>We sent a confirmation link to</p>
          <p style={{ ...styles.checkEmailText, marginBottom: 16 }}><span style={styles.checkEmailAddr}>{email}</span></p>
          <p style={styles.checkEmailText}>Click the link in that email to confirm your account, then come back and sign in.</p>

          {resendStatus === "sent" && <div style={{ ...styles.success, marginTop: 16 }}>Confirmation email resent!</div>}
          {resendStatus === "error" && <div style={{ ...styles.error, marginTop: 16 }}>Couldn't resend — try again in a moment.</div>}

          <button style={{ ...styles.resendBtn, opacity: resendStatus === "sending" ? 0.6 : 1 }} onClick={handleResend} disabled={resendStatus === "sending"}>
            {resendStatus === "sending" ? "Sending…" : "Resend confirmation email"}
          </button>
          <button style={styles.backLink} onClick={() => { setAwaitingConfirmation(false); setTab("signin"); setError(""); setResendStatus(""); }}>
            ← Back to sign in
          </button>

          <p style={styles.checkEmailHint}>Don't see it? Check your spam folder — it can take a minute or two to arrive.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <img src={logoFull} alt="DriveLink — Buy, Sell & Earn" style={styles.logoImg} />
        </div>

        <div style={styles.tabs}>
          <button style={{ ...styles.tab, ...(tab === "signin" ? styles.tabActive : {}) }} onClick={() => { setTab("signin"); setError(""); setSuccess(""); }}>Sign In</button>
          <button style={{ ...styles.tab, ...(tab === "signup" ? styles.tabActive : {}) }} onClick={() => { setTab("signup"); setError(""); setSuccess(""); }}>Create Account</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        {tab === "signup" && (
          <>
            <label style={styles.label}>Your Name</label>
            <input style={styles.input} placeholder="e.g. John Smith" value={name} onChange={e => setName(e.target.value)} />
            <div style={styles.perks}>
              <div style={styles.perk}>🚗 <span><b>Sell</b> your car — list for free</span></div>
              <div style={styles.perk}>🛒 <span><b>Buy</b> directly from owners</span></div>
              <div style={styles.perk}>💰 <span><b>Earn 1%</b> sharing any listing</span></div>
            </div>
          </>
        )}

        <label style={styles.label}>Email</label>
        <input style={styles.input} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />

        <label style={styles.label}>Password</label>
        <input style={styles.input} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (tab === "signin" ? handleSignIn() : handleSignUp())} />

        <button style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }} onClick={tab === "signin" ? handleSignIn : handleSignUp} disabled={loading}>
          {loading ? "Please wait…" : tab === "signin" ? "Sign In" : "Create Account — It's Free"}
        </button>
      </div>
    </div>
  );
}
