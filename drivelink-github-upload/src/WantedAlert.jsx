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
    sub: "Pick what you want, add your email, and we'll write when a match is listed. No account, no mailing list, stop anytime.",
    make: "Any make",
    price: "Any price",
    priceUpTo: "Up to",
    email: "Your email",
    send: "Email me matches",
    sending: "Saving...",
    doneTitle: "You're on the list",
    doneBody: "We sent a confirmation. You'll get one email for each matching car, for the next 60 days.",
    another: "Add another",
    errEmail: "That email address doesn't look right.",
    errNeed: "Pick a make or a price so we know what to watch for.",
    errPrice: "Enter a top price between $500 and $500,000.",
    errRate: "You already have a few alerts set. Please try again later.",
    errGeneric: "Something went wrong. Please try again.",
    note: "We only use your email for these alerts.",
  },
  es: {
    title: "¿No ves tu auto? Estaremos atentos.",
    sub: "Dinos qué buscas y te escribiremos cuando se publique una coincidencia. Sin cuenta, sin lista de correo, y puedes parar cuando quieras.",
    make: "Cualquier marca",
    price: "Cualquier precio",
    priceUpTo: "Hasta",
    email: "Tu correo",
    send: "Enviarme coincidencias",
    sending: "Guardando...",
    doneTitle: "Listo, quedaste en la lista",
    doneBody: "Enviamos una confirmación. Recibirás un correo por cada auto que coincida, durante los próximos 60 días.",
    another: "Agregar otra",
    errEmail: "Ese correo no parece válido.",
    errNeed: "Elige una marca o un precio para saber qué buscar.",
    errPrice: "Ingresa un precio máximo entre $500 y $500,000.",
    errRate: "Ya tienes varias alertas activas. Inténtalo más tarde.",
    errGeneric: "Algo salió mal. Inténtalo de nuevo.",
    note: "Solo usamos tu correo para estas alertas.",
  },
};

const MAKES = ["Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Jeep", "Kia", "Lexus", "Mazda", "Mercedes-Benz", "Nissan", "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo"];
const PRICES = [5000, 10000, 15000, 25000, 40000];

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

export default function WantedAlert({ defaultEmail = "", defaultMake = "", defaultMaxPrice = "" }) {
  const { lang } = useLang();
  const c = COPY[lang === "es" ? "es" : "en"];
  const [email, setEmail] = useState(defaultEmail);
  const [make, setMake] = useState(defaultMake);
  const [price, setPrice] = useState(defaultMaxPrice ? String(defaultMaxPrice) : "");
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
        body: { email: email.trim(), make: make.trim(), model: "", max_price: String(price).trim() === "" ? null : Number(price), lang, hp },
      });
      let code = data?.error;
      if (fnErr && !code) {
        try { code = (await fnErr.context?.json?.())?.error; } catch { /* ignore */ }
      }
      if (fnErr || code) { setError(c[ERRORS[code]] || c.errGeneric); return; }
      trackEvent("wanted_alert_created", { has_price: !!String(price).trim() });
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
        <button type="button" style={S.link} onClick={() => { setDone(false); setMake(""); setPrice(""); }}>{c.another}</button>
      </div>
    );
  }

  return (
    <form style={S.card} onSubmit={submit}>
      <h3 style={S.h}>{c.title}</h3>
      <p style={S.sub}>{c.sub}</p>
      <div style={S.grid}>
        <select style={S.input} value={make} onChange={(e) => setMake(e.target.value)} aria-label={c.make}>
          <option value="">{c.make}</option>
          {[...new Set([...(make && !MAKES.includes(make) ? [make] : []), ...MAKES])].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select style={S.input} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={c.price}>
          <option value="">{c.price}</option>
          {[...new Set([...(price && !PRICES.includes(Number(price)) ? [Number(price)] : []), ...PRICES])].sort((a, b) => a - b).map((p) => <option key={p} value={String(p)}>{c.priceUpTo} ${Number(p).toLocaleString("en-US")}</option>)}
        </select>
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
