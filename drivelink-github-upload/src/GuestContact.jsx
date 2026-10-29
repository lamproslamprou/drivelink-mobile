import { useState } from "react";
import { supabase } from "./supabase.js";
import { useLang } from "./i18n.jsx";
import { trackEvent } from "./track.js";

// Signed-out visitors can email the seller, or email themselves the car, with
// nothing but an email address. Sign-in used to gate every action on a listing,
// and the visitors with real intent were the ones bouncing off it. Everything
// here goes through the guest-inquiry edge function; the seller's address never
// reaches the browser.

const COPY = {
  en: {
    askTitle: "Ask the seller",
    askSub: "No account needed. Your message goes to the seller by email and they reply to you directly.",
    saveTitle: "Email me this car",
    saveSub: "We'll send the link to your inbox so you can come back to it. No account, no mailing list.",
    name: "Your name (optional)",
    email: "Your email",
    message: "Your message",
    messagePh: "Is it still available? When could I see it?",
    sendAsk: "Send message",
    sendSave: "Email me the link",
    sending: "Sending...",
    cancel: "Close",
    doneAskTitle: "Message sent",
    doneAskBody: "The seller will reply to your email. We also sent you a copy of the link.",
    doneSaveTitle: "Check your inbox",
    doneSaveBody: "We sent you the link to this car.",
    create: "Create a free account",
    createNote: "Optional. An account lets you make offers and pay with protection.",
    errInvalidEmail: "That email address doesn't look right.",
    errShort: "Please write a little more (at least 10 characters).",
    errLinks: "Please leave links out of your message.",
    errRate: "You've sent a few of these already. Please try again later.",
    errGone: "This car is no longer available.",
    errGeneric: "Something went wrong. Please try again.",
    privacy: "We only use your email to deliver this. We won't add you to a mailing list.",
  },
  es: {
    askTitle: "Pregunta al vendedor",
    askSub: "Sin cuenta. Tu mensaje llega al vendedor por correo y te responde directamente.",
    saveTitle: "Envíame este auto",
    saveSub: "Te enviamos el enlace a tu correo para que puedas volver. Sin cuenta, sin lista de correo.",
    name: "Tu nombre (opcional)",
    email: "Tu correo",
    message: "Tu mensaje",
    messagePh: "¿Sigue disponible? ¿Cuándo podría verlo?",
    sendAsk: "Enviar mensaje",
    sendSave: "Enviarme el enlace",
    sending: "Enviando...",
    cancel: "Cerrar",
    doneAskTitle: "Mensaje enviado",
    doneAskBody: "El vendedor te responderá por correo. También te enviamos una copia del enlace.",
    doneSaveTitle: "Revisa tu correo",
    doneSaveBody: "Te enviamos el enlace a este auto.",
    create: "Crear una cuenta gratis",
    createNote: "Opcional. Con una cuenta puedes hacer ofertas y pagar con protección.",
    errInvalidEmail: "Ese correo no parece válido.",
    errShort: "Escribe un poco más (mínimo 10 caracteres).",
    errLinks: "Por favor no incluyas enlaces en tu mensaje.",
    errRate: "Ya enviaste varios. Inténtalo más tarde.",
    errGone: "Este auto ya no está disponible.",
    errGeneric: "Algo salió mal. Inténtalo de nuevo.",
    privacy: "Solo usamos tu correo para entregar esto. No te agregaremos a ninguna lista de correo.",
  },
};

const ERRORS = {
  invalid_email: "errInvalidEmail",
  message_short: "errShort",
  no_links: "errLinks",
  rate_limited: "errRate",
  listing_unavailable: "errGone",
};

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000, padding: 0 },
  sheet: { background: "#fff", width: "100%", maxWidth: 460, borderRadius: "16px 16px 0 0", padding: 20, maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" },
  h: { fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "0 0 6px" },
  sub: { fontSize: 14, color: "#475569", lineHeight: 1.5, margin: "0 0 14px" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#334155", margin: "10px 0 4px" },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 16, outline: "none", background: "#fff" },
  err: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12 },
  row: { display: "flex", gap: 10, marginTop: 16 },
  primary: { flex: 1, minHeight: 48, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: "pointer" },
  secondary: { minHeight: 48, padding: "0 16px", background: "#f1f5f9", color: "#334155", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  note: { fontSize: 12, color: "#64748b", marginTop: 12, lineHeight: 1.5 },
};

// kind: "message" | "save". listing: the row being asked about.
export default function GuestContact({ listing, kind: initialKind = "message", onClose, onCreateAccount }) {
  const { lang } = useLang();
  const c = COPY[lang === "es" ? "es" : "en"];
  const [kind] = useState(initialKind);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState(""); // honeypot, hidden from people
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError(c.errInvalidEmail); return; }
    if (kind === "message" && message.trim().length < 10) { setError(c.errShort); return; }
    setBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("guest-inquiry", {
        body: { listing_id: listing.id, kind, email: email.trim(), name: name.trim(), message: message.trim(), lang, hp },
      });
      // functions.invoke puts non-2xx bodies on error.context; read the code out of it.
      let code = data?.error;
      if (fnErr && !code) {
        try { code = (await fnErr.context?.json?.())?.error; } catch { /* ignore */ }
      }
      if (fnErr || code) { setError(c[ERRORS[code]] || c.errGeneric); setBusy(false); return; }
      if (kind === "message") trackEvent("inquiry_sent", { kind: "message", signed_in: false });
      else trackEvent("listing_emailed", { signed_in: false });
      setDone(true);
    } catch {
      setError(c.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const car = [listing.year, listing.make, listing.model].filter(Boolean).join(" ");

  return (
    <div style={S.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h2 style={S.h}>{kind === "message" ? c.doneAskTitle : c.doneSaveTitle}</h2>
            <p style={S.sub}>{kind === "message" ? c.doneAskBody : c.doneSaveBody}</p>
            {onCreateAccount && (
              <>
                <button style={{ ...S.primary, width: "100%" }} onClick={onCreateAccount}>{c.create}</button>
                <div style={S.note}>{c.createNote}</div>
              </>
            )}
            <div style={S.row}><button style={{ ...S.secondary, flex: 1 }} onClick={onClose}>{c.cancel}</button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={S.h}>{kind === "message" ? c.askTitle : c.saveTitle}</h2>
            <p style={S.sub}>{car}. {kind === "message" ? c.askSub : c.saveSub}</p>
            {kind === "message" && (
              <>
                <label style={S.label} htmlFor="gc-name">{c.name}</label>
                <input id="gc-name" style={S.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
              </>
            )}
            <label style={S.label} htmlFor="gc-email">{c.email}</label>
            <input id="gc-email" style={S.input} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            {kind === "message" && (
              <>
                <label style={S.label} htmlFor="gc-msg">{c.message}</label>
                <textarea id="gc-msg" style={{ ...S.input, minHeight: 96, resize: "vertical" }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={c.messagePh} maxLength={1000} />
              </>
            )}
            {/* Honeypot: off-screen, not focusable, ignored by people. */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} name="website" />
            {error && <div style={S.err}>{error}</div>}
            <div style={S.row}>
              <button type="button" style={S.secondary} onClick={onClose}>{c.cancel}</button>
              <button type="submit" style={{ ...S.primary, opacity: busy ? 0.7 : 1 }} disabled={busy}>
                {busy ? c.sending : kind === "message" ? c.sendAsk : c.sendSave}
              </button>
            </div>
            <div style={S.note}>{c.privacy}</div>
          </form>
        )}
      </div>
    </div>
  );
}
