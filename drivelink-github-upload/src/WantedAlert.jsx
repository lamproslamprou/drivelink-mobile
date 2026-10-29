import { useState } from "react";
import { supabase } from "./supabase.js";
import { useLang } from "./i18n.jsx";
import { trackEvent } from "./track.js";

// "Tell us what you want": a no-account email alert for visitors who land on a
// browse page with little or nothing that fits. Backed by the wanted-alert edge
// function (stores the request, sends a confirmation) and the hourly
// notify-wanted job (emails matches). Every email carries an unsubscribe link.

const COPY = {
  en: {
    title: "Don't see your car? We'll watch for it.",
    sub: "Tell us what you're looking for and we'll email you when a match is listed. No account, no mailing list, and you can stop anytime.",
    make: "Make (e.g. Toyota)",
    model: "Model (optional)",
    price: "Max price, $",
    email: "Your email",
    send: "Email me matches",
    sending: "Saving...",
    doneTitle: "You're on the list",
    doneBody: "We sent a confirmation. You'll get one email for each matching car, for the next 60 days.",
    another: "Add another",
    errEmail: "That email address doesn't look right.",
    errNeed: "Add a make or a top price so we know what to watch for.",
    errPrice: "Enter a top price between $500 and $500,000.",
    errRate: "You already have a few alerts set. Please try again later.",
    errGeneric: "Something went wrong. Please try again.",
    note: "We only use your email for these alerts.",
  },
  es: {
    title: "¿No ves tu auto? Estaremos atentos.",
    sub: "Dinos qué buscas y te escribiremos cuando se publique una coincidencia. Sin cuenta, sin lista de correo, y puedes parar cuando quieras.",
    make: "Marca (p. ej. Toyota)",
    model: "Modelo (opcional)",
    price: "Precio máx., $",
    email: "Tu correo",
    send: "Enviarme coincidencias",
    sending: "Guardando...",
    doneTitle: "Listo, quedaste en la lista",
    doneBody: "Enviamos una confirmación. Recibirás un correo por cada auto que coincida, durante los próximos 60 días.",
    another: "Agregar otra",
    errEmail: "Ese correo no parece válido.",
    errNeed: "Agrega una marca o un precio máximo para saber qué buscar.",
    errPrice: "Ingresa un precio máximo entre $500 y $500,000.",
    errRate: "Ya tienes varias alertas activas. Inténtalo más tarde.",
    errGeneric: "Algo salió mal. Inténtalo de nuevo.",
    note: "Solo usamos tu correo para estas alertas.",
  },
};

const ERRORS = { invalid_email: "errEmail", need_criteria: "errNeed", invalid_price: "errPrice", rate_limited: "errRate" };

const S = {
  card: { fontFamily: "inherit", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: 20, margin: "24px 0", color: "#0f172a" },
  h: { fontSize: 18, fontWeight: 800, margin: "0 0 6px" },
  sub: { fontSize: 14, color: "#475569", lineHeight: 1.5, margin: "0 0 14px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 },
  input: { width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontFamily: "inherit", fontSize: 16, outline: "none", background: "#fff" },
  err: { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 10 },
  btn: { marginTop: 12, minHeight: 48, padding: "0 20px", background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" },
  link: { background: "none", border: "none", padding: 0, color: "#1d4ed8", fontWeight: 600, fontSize: 14, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" },
  note: { fontSize: 12, color: "#64748b", marginTop: 10 },
};

export default function WantedAlert({ defaultEmail = "", defaultMake = "" }) {
  const { lang } = useLang();
  const c = COPY[lang === "es" ? "es" : "en"];
  const [email, setEmail] = useState(defaultEmail);
  const [make, setMake] = useState(defaultMake);
  const [model, setModel] = useState("");
  const [price, setPrice] = useState("");
  const [hp, setHp] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError(c.errEmail); return; }
    if (!make.trim() && !String(price).trim()) { setError(c.errNeed); return; }
    setBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("wanted-alert", {
        body: { email: email.trim(), make: make.trim(), model: model.trim(), max_price: String(price).trim() === "" ? null : Number(price), lang, hp },
      });
      let code = data?.error;
      if (fnErr && !code) {
        try { code = (await fnErr.context?.json?.())?.error; } catch { /* ignore */ }
      }
      if (fnErr || code) { setError(c[ERRORS[code]] || c.errGeneric); return; }
      trackEvent("wanted_alert_created", { has_model: !!model.trim(), has_price: !!String(price).trim() });
      setDone(true);
    } catch {
      setError(c.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div style={S.card}>
        <h3 style={S.h}>{c.doneTitle}</h3>
        <p style={{ ...S.sub, marginBottom: 10 }}>{c.doneBody}</p>
        <button type="button" style={S.link} onClick={() => { setDone(false); setMake(""); setModel(""); setPrice(""); }}>{c.another}</button>
      </div>
    );
  }

  return (
    <form style={S.card} onSubmit={submit}>
      <h3 style={S.h}>{c.title}</h3>
      <p style={S.sub}>{c.sub}</p>
      <div style={S.grid}>
        <input style={S.input} value={make} onChange={(e) => setMake(e.target.value)} placeholder={c.make} maxLength={40} aria-label={c.make} />
        <input style={S.input} value={model} onChange={(e) => setModel(e.target.value)} placeholder={c.model} maxLength={40} aria-label={c.model} />
        <input style={S.input} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder={c.price} inputMode="numeric" aria-label={c.price} />
        <input style={S.input} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={c.email} aria-label={c.email} required />
      </div>
      {/* Honeypot: off-screen, not focusable, ignored by people. */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} name="website" />
      {error && <div style={S.err}>{error}</div>}
      <button type="submit" style={{ ...S.btn, opacity: busy ? 0.7 : 1 }} disabled={busy}>{busy ? c.sending : c.send}</button>
      <div style={S.note}>{c.note}</div>
    </form>
  );
}
