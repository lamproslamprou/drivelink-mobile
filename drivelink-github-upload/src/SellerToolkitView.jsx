import { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { useLang, LangToggle } from "./i18n.jsx";
import { analytics } from "@heycatch/sdk";
import qrcode from "qrcode-generator";
import { PAYMENTS_OPEN } from "./flags.js";

/*
  SellerToolkitView — free tool at /seller-toolkit.

  VIN in, and out come: a ready-to-post ad (templated, not AI), a short
  checklist, and a protected-payment link to paste into the ad. Anyone can build
  the kit without an account; creating the payment link needs a signed-in seller
  because it calls create-deal, exactly like /start-deal does. Nothing here
  touches the backend beyond that existing function, and no third-party market
  data is used (the price-check box in the design is deliberately absent).

  The buyer side is the existing /d/:token page (JoinDealView). The invite is
  first-buyer-wins and expires, which is the behaviour a link in a public ad
  needs.
*/

const DRAFT_KEY = "dl_toolkit_draft";
const thisYear = new Date().getFullYear();

const COPY = {
  en: {
    back: "← Back to DriveLink",
    eyebrow: "FREE FOR PRIVATE SELLERS",
    title: "Sell your car privately, without the guesswork.",
    lede: "Enter your VIN. We write the ad and give you a link that lets buyers pay safely. Post it anywhere you already list.",
    ledePaused: "Enter your VIN. We look up your car, write a ready-to-post ad and give you a checklist for a smooth private sale. Free.",
    vinLabel: "Vehicle Identification Number (VIN)",
    vinHelp: "It's on the driver-side dashboard, the door jamb sticker, and your registration. We only use it to look up your car's specs.",
    build: "Build my kit",
    building: "Looking up…",
    vinBad: "A VIN is 17 characters.",
    vinFail: "We couldn't read that VIN. Check it, or type the details yourself.",
    vinNet: "Couldn't reach the VIN lookup. Type the details instead.",
    manual: "Type the details instead",
    specs: "Your car",
    year: "Year", make: "Make", model: "Model", trim: "Trim",
    details: "Add your details",
    mileage: "Mileage", price: "Asking price", town: "Town / area (e.g. Newark, NJ)",
    condition: "Condition and history, in your words",
    conditionPh: "One owner, garage kept, new tires in 2025, no accidents…",
    adTitle: "Your ad",
    adHelp: "Copy it into Facebook Marketplace, Craigslist or anywhere else.",
    copyTitle: "Copy title", copyBody: "Copy ad", copied: "Copied",
    needDetails: "Add mileage and price to finish the ad.",
    checklist: "Before you post",
    checks: [
      "Take 10 to 15 photos in daylight: all sides, interior, odometer, engine bay.",
      "Find your title. If a lender holds it, you'll need a payoff first.",
      "Gather service records and a spare key.",
      "Decide the lowest price you'll take, and stick to it.",
      "Meet in a public place, and never hand over the car or title before payment is secured.",
    ],
    lienLink: "NJ lien payoff guide →",
    linkTitle: "Your protected-payment link",
    linkBody: "Paste it into your ad. A buyer who opens it can pay through DriveLink, and you're paid when the car and title change hands. The first buyer to join takes the deal.",
    makeLink: "Create my link",
    making: "Creating…",
    signIn: "Sign in to create your link",
    signInNote: "Free to set up. You're only charged when a deal goes through.",
    linkErr: "Could not create the link. Try again.",
    payouts: "Set up payouts first so the money can reach you, then come back here.",
    payoutsBtn: "Set up payouts",
    copyLink: "Copy link",
    qr: "QR code for a printed sign or flyer",
    needPrice: "Add your price and mileage above first.",
    fee: "Fee: charged to the seller when a deal closes. See pricing.",
    escrowInfo: "How protected payment works →",
    gateTitle: "Your ad is one step away",
    gateBody: "Create a free account to get your ready-to-post ad. Your details are saved, so you'll come straight back to this page.",
    gateBtn: "Create a free account",
    gateSignIn: "Already have an account? Sign in",
    soonTitle: "Protected-payment links are paused for now",
    soonBody: "We're rebuilding how payments work, so buyers can't pay through DriveLink yet. Your ad above is ready to post without a payment link, and we'll tell you the moment links are back.",
    ad: {
      sale: "for sale", miles: "miles", asking: "Asking", located: "Located in",
      escrow: "Pay safely through DriveLink: the seller isn't paid until you have the car and the signed title.", pay: "Pay here:",
      contact: "Message me with questions or to set up a viewing.",
      vin: "VIN",
    },
  },
  es: {
    back: "← Volver a DriveLink",
    eyebrow: "GRATIS PARA VENDEDORES PARTICULARES",
    title: "Vende tu auto por tu cuenta, sin adivinar.",
    lede: "Ingresa tu VIN. Escribimos el anuncio y te damos un enlace para que los compradores paguen con seguridad. Publícalo donde ya vendes.",
    ledePaused: "Ingresa tu VIN. Buscamos tu auto, escribimos un anuncio listo para publicar y te damos una lista para una venta tranquila. Gratis.",
    vinLabel: "Número de identificación del vehículo (VIN)",
    vinHelp: "Está en el tablero del lado del conductor, en la etiqueta de la puerta y en tu registro. Solo lo usamos para buscar las especificaciones.",
    build: "Crear mi kit",
    building: "Buscando…",
    vinBad: "El VIN tiene 17 caracteres.",
    vinFail: "No pudimos leer ese VIN. Revísalo o escribe los datos tú mismo.",
    vinNet: "No pudimos conectar con la búsqueda de VIN. Escribe los datos.",
    manual: "Escribir los datos manualmente",
    specs: "Tu auto",
    year: "Año", make: "Marca", model: "Modelo", trim: "Versión",
    details: "Agrega tus datos",
    mileage: "Millas", price: "Precio", town: "Ciudad o zona (ej. Newark, NJ)",
    condition: "Estado e historial, con tus palabras",
    conditionPh: "Un solo dueño, guardado en garaje, llantas nuevas en 2025, sin accidentes…",
    adTitle: "Tu anuncio",
    adHelp: "Cópialo en Facebook Marketplace, Craigslist o donde quieras.",
    copyTitle: "Copiar título", copyBody: "Copiar anuncio", copied: "Copiado",
    needDetails: "Agrega millas y precio para terminar el anuncio.",
    checklist: "Antes de publicar",
    checks: [
      "Toma de 10 a 15 fotos con luz de día: todos los lados, interior, odómetro y motor.",
      "Ubica tu título. Si un banco lo tiene, primero necesitas el finiquito.",
      "Reúne los recibos de servicio y una llave de repuesto.",
      "Decide el precio mínimo que aceptarás y no cambies.",
      "Reúnete en un lugar público y nunca entregues el auto ni el título antes de que el pago esté asegurado.",
    ],
    lienLink: "Guía de finiquito de prenda en NJ →",
    linkTitle: "Tu enlace de pago protegido",
    linkBody: "Pégalo en tu anuncio. El comprador que lo abra puede pagar con DriveLink y a ti te pagan cuando el auto y el título cambian de manos. El primer comprador que se una se queda con el trato.",
    makeLink: "Crear mi enlace",
    making: "Creando…",
    signIn: "Inicia sesión para crear tu enlace",
    signInNote: "Es gratis configurarlo. Solo pagas cuando se cierra un trato.",
    linkErr: "No se pudo crear el enlace. Intenta de nuevo.",
    payouts: "Configura primero los pagos para que el dinero te llegue, y luego regresa aquí.",
    payoutsBtn: "Configurar pagos",
    copyLink: "Copiar enlace",
    qr: "Código QR para un letrero o volante",
    needPrice: "Primero agrega tu precio y millas arriba.",
    fee: "Tarifa: se cobra al vendedor cuando se cierra el trato. Ver precios.",
    escrowInfo: "Cómo funciona el pago protegido →",
    gateTitle: "Tu anuncio está a un paso",
    gateBody: "Crea una cuenta gratis para obtener tu anuncio listo para publicar. Guardamos tus datos, así que volverás directo a esta página.",
    gateBtn: "Crear una cuenta gratis",
    gateSignIn: "¿Ya tienes cuenta? Inicia sesión",
    soonTitle: "Los enlaces de pago protegido están en pausa",
    soonBody: "Estamos rehaciendo cómo funcionan los pagos, así que por ahora los compradores no pueden pagar con DriveLink. Tu anuncio de arriba está listo para publicar sin enlace de pago, y te avisaremos en cuanto regresen los enlaces.",
    ad: {
      sale: "en venta", miles: "millas", asking: "Precio", located: "Ubicado en",
      escrow: "Paga seguro con DriveLink: al vendedor no se le paga hasta que tengas el auto y el título firmado.", pay: "Paga aquí:",
      contact: "Escríbeme si tienes preguntas o para ver el auto.",
      vin: "VIN",
    },
  },
};

const titleCase = (s) => (s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const fmtNum = (n) => Number(n).toLocaleString("en-US");

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}
function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
}

export default function SellerToolkitView({ currentUser, onBack, onSignIn, onNavigate, showToast }) {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;

  const draft = useMemo(loadDraft, []);
  const [vin, setVin] = useState(draft?.vin || "");
  const [car, setCar] = useState(draft?.car || null); // {year, make, model, trim}
  const [info, setInfo] = useState(draft?.info || { mileage: "", price: "", town: "", condition: "" });
  const [looking, setLooking] = useState(false);
  const [vinError, setVinError] = useState(null);
  const [copied, setCopied] = useState("");
  const [making, setMaking] = useState(false);
  const [linkErr, setLinkErr] = useState(null);
  const [needsPayouts, setNeedsPayouts] = useState(false);
  const [dealUrl, setDealUrl] = useState(null);

  useEffect(() => { saveDraft({ vin, car, info }); }, [vin, car, info]);

  // Page title and description (this view isn't in pageMeta.js's table because
  // the copy is bilingual; same approach as InspectorsView).
  useEffect(() => {
    const prev = document.title;
    document.title = lang === "es"
      ? "Kit gratis para vender tu auto | DriveLink"
      : "Free Toolkit to Sell Your Car Privately | DriveLink";
    const desc = lang === "es"
      ? (PAYMENTS_OPEN ? "Ingresa tu VIN y obtén un anuncio listo para publicar y un enlace de pago protegido para el comprador." : "Ingresa tu VIN y obtén un anuncio listo para publicar y una lista para vender tu auto por tu cuenta. Gratis.")
      : (PAYMENTS_OPEN ? "Enter your VIN and get a ready-to-post ad and a protected-payment link for your private car sale. Free for sellers." : "Enter your VIN and get a ready-to-post ad and a checklist for your private car sale. Free for sellers.");
    let meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content") ?? null;
    const created = !meta;
    if (!meta) { meta = document.createElement("meta"); meta.setAttribute("name", "description"); document.head.appendChild(meta); }
    meta.setAttribute("content", desc);
    return () => {
      document.title = prev;
      if (created) meta.remove(); else if (prevDesc != null) meta.setAttribute("content", prevDesc);
    };
  }, [lang]);

  const setInfoField = (k) => (e) => { setInfo((i) => ({ ...i, [k]: e.target.value })); setDealUrl(null); };
  const setCarField = (k) => (e) => { setCar((c) => ({ ...(c || {}), [k]: e.target.value })); setDealUrl(null); };

  async function lookup(e) {
    e?.preventDefault();
    const clean = vin.trim().toUpperCase();
    if (clean.length !== 17) { setVinError(t.vinBad); return; }
    setLooking(true); setVinError(null);
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(clean)}?format=json`);
      const data = await res.json();
      const r = data?.Results?.[0];
      if (!r?.Make || !r?.Model || !r?.ModelYear) {
        setVinError(t.vinFail);
        setCar((c) => c || { year: "", make: "", model: "", trim: "" });
        return;
      }
      setVin(clean);
      setCar({ year: r.ModelYear, make: titleCase(r.Make), model: r.Model, trim: r.Trim || "" });
      setDealUrl(null);
      try { analytics.trackEvent("toolkit_kit_built"); } catch { /* ignore */ }
    } catch {
      setVinError(t.vinNet);
      setCar((c) => c || { year: "", make: "", model: "", trim: "" });
    } finally {
      setLooking(false);
    }
  }

  const ready = car && car.year && car.make && car.model;
  const detailsDone = ready && Number(info.price) > 0 && info.mileage !== "" && Number(info.mileage) >= 0;

  const adTitle = ready
    ? `${car.year} ${car.make} ${car.model}${car.trim ? " " + car.trim : ""}${detailsDone ? ` - ${fmtNum(info.mileage)} ${t.ad.miles}` : ""}`
    : "";

  const adBody = useMemo(() => {
    if (!detailsDone) return "";
    const lines = [];
    lines.push(`${car.year} ${car.make} ${car.model}${car.trim ? " " + car.trim : ""} ${t.ad.sale}.`);
    lines.push(`${t.ad.asking}: $${fmtNum(info.price)}`);
    lines.push(`${fmtNum(info.mileage)} ${t.ad.miles}${info.town ? ` | ${t.ad.located} ${info.town}` : ""}`);
    if (info.condition.trim()) lines.push("", info.condition.trim());
    if (vin.trim().length === 17) lines.push("", `${t.ad.vin}: ${vin.trim().toUpperCase()}`);
    if (PAYMENTS_OPEN) lines.push("", dealUrl ? `${t.ad.escrow} ${t.ad.pay} ${dealUrl}` : t.ad.escrow);
    lines.push("", t.ad.contact);
    return lines.join("\n");
  }, [car, info, vin, dealUrl, detailsDone, lang, PAYMENTS_OPEN]);

  async function copy(which, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      showToast?.("Copy failed. Select the text and copy it manually.", "error");
    }
  }

  async function makeLink() {
    setMaking(true); setLinkErr(null); setNeedsPayouts(false);
    try {
      const { data, error } = await supabase.functions.invoke("create-deal", {
        body: {
          role: "seller",
          vin: vin.trim().length === 17 ? vin.trim().toUpperCase() : null,
          year: car.year, make: car.make, model: car.model,
          mileage: info.mileage || 0,
          price: info.price,
          note: [car.trim, info.condition.trim()].filter(Boolean).join(". ").slice(0, 500) || null,
          handover_date: null,
        },
      });
      if (error) { setLinkErr(t.linkErr); return; }
      if (data?.error) { setLinkErr(data.error); return; }
      if (data?.needs_onboarding) { setNeedsPayouts(true); return; }
      setDealUrl(data.url);
      try { analytics.trackEvent("toolkit_link_created"); } catch { /* ignore */ }
    } catch {
      setLinkErr(t.linkErr);
    } finally {
      setMaking(false);
    }
  }

  const qrSvg = useMemo(() => {
    if (!dealUrl) return null;
    try {
      const q = qrcode(0, "M");
      q.addData(dealUrl);
      q.make();
      return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch { return null; }
  }, [dealUrl]);

  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topRow}>
          {onBack ? <button style={S.backBtn} onClick={onBack}>{t.back}</button> : <span />}
          <LangToggle />
        </div>

        <div style={S.pill}>{t.eyebrow}</div>
        <h1 style={S.title}>{t.title}</h1>
        <p style={S.lede}>{PAYMENTS_OPEN ? t.lede : t.ledePaused}</p>

        <form style={S.card} onSubmit={lookup}>
          <label htmlFor="tk-vin" style={S.label}>{t.vinLabel}</label>
          <div style={S.row}>
            <input
              id="tk-vin" style={{ ...S.input, flex: "1 1 240px", letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }}
              value={vin} maxLength={17} placeholder="1HGCV1F3XJA000000"
              onChange={(e) => setVin(e.target.value)} autoComplete="off"
            />
            <button type="submit" style={S.primary} disabled={looking}>{looking ? t.building : t.build}</button>
          </div>
          <div style={S.help}>{t.vinHelp}</div>
          {vinError && <div style={S.err}>{vinError}</div>}
          {!car && (
            <button type="button" style={S.linkBtn} onClick={() => setCar({ year: "", make: "", model: "", trim: "" })}>{t.manual}</button>
          )}
        </form>

        {car && (
          <>
            <div style={S.card}>
              <div style={S.h2}>{t.specs}</div>
              <div style={S.grid2}>
                <Field label={t.year} value={car.year} onChange={setCarField("year")} inputMode="numeric" />
                <Field label={t.make} value={car.make} onChange={setCarField("make")} />
                <Field label={t.model} value={car.model} onChange={setCarField("model")} />
                <Field label={t.trim} value={car.trim} onChange={setCarField("trim")} />
              </div>
            </div>

            <div style={S.card}>
              <div style={S.h2}>{t.details}</div>
              <div style={S.grid2}>
                <Field label={t.mileage} value={info.mileage} onChange={setInfoField("mileage")} inputMode="numeric" />
                <Field label={t.price} value={info.price} onChange={setInfoField("price")} inputMode="numeric" prefix="$" />
              </div>
              <Field label={t.town} value={info.town} onChange={setInfoField("town")} />
              <label style={S.label}>{t.condition}</label>
              <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={info.condition} onChange={setInfoField("condition")} placeholder={t.conditionPh} />
            </div>

            {!currentUser ? (
              <div style={{ ...S.card, background: "#eff6ff", borderColor: "#bfdbfe" }}>
                <div style={S.h2}>{t.gateTitle}</div>
                <p style={S.p}>{t.gateBody}</p>
                <button style={S.primary} onClick={onSignIn}>{t.gateBtn}</button>
                <div style={S.help}><button style={S.linkBtn} onClick={onSignIn}>{t.gateSignIn}</button></div>
              </div>
            ) : (
            <div style={S.card}>
              <div style={S.h2}>{t.adTitle}</div>
              <div style={S.help}>{t.adHelp}</div>
              {detailsDone ? (
                <>
                  <div style={S.adTitle}>{adTitle}</div>
                  <pre style={S.adBody}>{adBody}</pre>
                  <div style={S.row}>
                    <button style={S.secondary} onClick={() => copy("title", adTitle)}>{copied === "title" ? t.copied : t.copyTitle}</button>
                    <button style={S.primary} onClick={() => copy("body", adBody)}>{copied === "body" ? t.copied : t.copyBody}</button>
                  </div>
                </>
              ) : (
                <div style={S.muted}>{t.needDetails}</div>
              )}
            </div>

            )}

            <div style={S.card}>
              <div style={S.h2}>{t.checklist}</div>
              <ul style={S.ul}>{t.checks.map((c) => <li key={c} style={S.li}>{c}</li>)}</ul>
              <button style={S.linkBtn} onClick={() => onNavigate?.("lienPayoffNJ")}>{t.lienLink}</button>
            </div>

            {currentUser && !PAYMENTS_OPEN && (
              <div style={{ ...S.card, background: "#fffbeb", borderColor: "#fde68a" }}>
                <div style={S.h2}>{t.soonTitle}</div>
                <p style={S.p}>{t.soonBody}</p>
              </div>
            )}

            {currentUser && PAYMENTS_OPEN && (
            <div style={{ ...S.card, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
              <div style={S.h2}>{t.linkTitle}</div>
              <p style={S.p}>{t.linkBody}</p>
              {!detailsDone && <div style={S.muted}>{t.needPrice}</div>}
              {detailsDone && !dealUrl && (
                currentUser ? (
                  <button style={S.primary} onClick={makeLink} disabled={making}>{making ? t.making : t.makeLink}</button>
                ) : (
                  <>
                    <button style={S.primary} onClick={onSignIn}>{t.signIn}</button>
                    <div style={S.help}>{t.signInNote}</div>
                  </>
                )
              )}
              {linkErr && <div style={S.err}>{linkErr}</div>}
              {needsPayouts && (
                <div style={S.warn}>
                  <div style={{ marginBottom: 10 }}>{t.payouts}</div>
                  <button style={S.secondary} onClick={() => onNavigate?.("startDeal")}>{t.payoutsBtn}</button>
                </div>
              )}
              {dealUrl && (
                <>
                  <div style={S.linkBox}>{dealUrl}</div>
                  <div style={S.row}>
                    <button style={S.primary} onClick={() => copy("link", dealUrl)}>{copied === "link" ? t.copied : t.copyLink}</button>
                  </div>
                  {qrSvg && (
                    <div style={{ marginTop: 16 }}>
                      <div style={S.help}>{t.qr}</div>
                      <div style={{ width: 168, marginTop: 8, background: "#fff", padding: 6, borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: qrSvg }} />
                    </div>
                  )}
                </>
              )}
              <div style={{ ...S.help, marginTop: 14 }}>
                <button style={S.linkBtn} onClick={() => onNavigate?.("escrow")}>{t.escrowInfo}</button>
                {" "}<button style={S.linkBtn} onClick={() => onNavigate?.("pricing")}>{t.fee}</button>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, prefix, inputMode }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 0, marginBottom: 10 }}>
      <label style={S.label}>{label}</label>
      <div style={{ position: "relative" }}>
        {prefix && <span style={{ position: "absolute", left: 12, top: 11, color: "#6b7280" }}>{prefix}</span>}
        <input style={{ ...S.input, paddingLeft: prefix ? 26 : 12 }} value={value ?? ""} onChange={onChange} inputMode={inputMode} />
      </div>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 28, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  pill: { display: "inline-block", background: "#dcfce7", color: "#14532d", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 999, letterSpacing: "0.03em", marginBottom: 14 },
  title: { fontSize: 38, lineHeight: 1.1, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.025em", margin: "0 0 12px" },
  lede: { fontSize: 16, color: "#4b5563", lineHeight: 1.6, maxWidth: "58ch", margin: "0 0 24px" },
  card: { border: "1px solid #e5e7eb", borderRadius: 16, padding: 20, marginBottom: 16, background: "#fff" },
  h2: { fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 10 },
  label: { display: "block", fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 6 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 15, border: "1.5px solid #d1d5db", borderRadius: 10, fontFamily: "inherit", color: "#111827", background: "#fff" },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  grid2: { display: "flex", gap: 12, flexWrap: "wrap" },
  primary: { background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  secondary: { background: "#fff", color: "#111827", border: "1.5px solid #d1d5db", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  linkBtn: { background: "none", border: "none", padding: 0, color: "#1d4ed8", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "underline", marginTop: 6 },
  help: { fontSize: 13, color: "#6b7280", lineHeight: 1.5, marginTop: 8 },
  muted: { fontSize: 14, color: "#6b7280" },
  p: { fontSize: 14, color: "#374151", lineHeight: 1.6, margin: "0 0 14px" },
  err: { marginTop: 10, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", fontSize: 14 },
  warn: { marginTop: 10, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", borderRadius: 10, padding: "12px", fontSize: 14 },
  adTitle: { fontWeight: 700, fontSize: 15, margin: "10px 0 8px" },
  adBody: { whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 14, lineHeight: 1.6, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, margin: "0 0 12px" },
  ul: { margin: "0 0 8px", paddingLeft: 20 },
  li: { fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 6 },
  linkBox: { fontFamily: "ui-monospace, monospace", fontSize: 13, background: "#fff", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px", margin: "10px 0 12px", wordBreak: "break-all" },
};
