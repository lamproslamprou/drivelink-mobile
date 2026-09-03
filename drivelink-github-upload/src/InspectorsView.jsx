import { useState, useEffect } from "react";
import { useLang, LangToggle } from "./i18n.jsx";

/*
  InspectorsView — standalone directory page at /inspectors.

  Palette and type mirror FAQView.jsx (white background, #0f172a headings,
  #374151 body, Inter) so this reads as the same document family as FAQ,
  Terms, Privacy and Safety Tips.

  Two jobs in one page, same as the brief: (1) buyers browse approved
  pre-purchase-inspection businesses, (2) an inspection business can list
  itself via a self-serve form with no account. Submissions land as
  status='pending' and only appear in `inspectors` (passed in already
  filtered to approved) once an admin approves them from the Admin Panel.

  DriveLink does not vet, inspect, or guarantee any listed business — same
  stance as the VIN/Carfax disclaimer on a listing page. Keep that disclaimer
  visible; it is the whole reason this can stay a free directory instead of
  something that needs the brokering question resolved first.
*/

const COPY = {
  en: {
    back: "← Back to DriveLink",
    title: "Find a pre-purchase inspector",
    lede: "Independent inspection businesses buyers can contact before completing a purchase. DriveLink doesn't perform, vet, or guarantee these inspections — confirm price and availability directly with the business.",
    empty: "No inspectors listed yet in your area. Check back soon, or list your own business below.",
    areaLabel: "Serves",
    priceLabel: "Typical price",
    contactBtn: "Contact",
    listTitle: "Run an inspection business?",
    listBody: "List your business for free. Submissions are reviewed before they go live.",
    listToggleOpen: "List your business →",
    listToggleClose: "Hide form",
    form: {
      businessName: "Business name",
      contactEmail: "Contact email",
      contactPhone: "Phone (optional)",
      serviceArea: "Service area (e.g. NY/NJ/CT tri-state)",
      priceRange: "Typical price range (optional)",
      bookingLink: "Booking or contact link (optional)",
      notes: "Short description (optional)",
      submit: "Submit for review",
      submitting: "Submitting…",
    },
    successTitle: "Thanks — submitted for review",
    successBody: "We'll email you once your listing is approved and live.",
    errorGeneric: "Couldn't submit — please try again.",
  },
  es: {
    back: "← Volver a DriveLink",
    title: "Encuentra un inspector pre-compra",
    lede: "Negocios de inspección independientes que los compradores pueden contactar antes de completar una compra. DriveLink no realiza, verifica ni garantiza estas inspecciones — confirma precio y disponibilidad directamente con el negocio.",
    empty: "Todavía no hay inspectores en tu área. Vuelve pronto, o publica tu propio negocio abajo.",
    areaLabel: "Atiende",
    priceLabel: "Precio típico",
    contactBtn: "Contactar",
    listTitle: "¿Tienes un negocio de inspecciones?",
    listBody: "Publica tu negocio gratis. Las publicaciones se revisan antes de salir en línea.",
    listToggleOpen: "Publica tu negocio →",
    listToggleClose: "Ocultar formulario",
    form: {
      businessName: "Nombre del negocio",
      contactEmail: "Correo de contacto",
      contactPhone: "Teléfono (opcional)",
      serviceArea: "Área de servicio (ej. NY/NJ/CT)",
      priceRange: "Rango de precio típico (opcional)",
      bookingLink: "Enlace de reserva o contacto (opcional)",
      notes: "Descripción breve (opcional)",
      submit: "Enviar para revisión",
      submitting: "Enviando…",
    },
    successTitle: "Gracias — enviado para revisión",
    successBody: "Te enviaremos un correo cuando tu publicación esté aprobada y en línea.",
    errorGeneric: "No se pudo enviar — intenta de nuevo.",
  },
};

const EMPTY_FORM = { businessName: "", contactEmail: "", contactPhone: "", serviceArea: "", priceRange: "", bookingLink: "", notes: "" };

export default function InspectorsView({ inspectors, onBack, onSubmit }) {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // "success" | "error" | null

  // ── SEO: this is the one SPA view in the app that's meant to be found by
  // search rather than just clicked into — an inspection business googling
  // "list my inspection business" needs a real title/description in the
  // rendered DOM, not the generic index.html ones every other view leaves in
  // place. Restored on unmount so navigating elsewhere doesn't leave this
  // page's title/description stuck on, say, the browse grid.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = lang === "es"
      ? "Encuentra un inspector pre-compra | DriveLink"
      : "Find a Pre-Purchase Inspector | DriveLink";
    const description = lang === "es"
      ? "Negocios de inspección pre-compra independientes para compradores de autos en DriveLink. ¿Tienes un negocio de inspecciones? Publícalo gratis."
      : "Independent pre-purchase inspection businesses for DriveLink car buyers to find and contact. Run an inspection business? List it for free.";
    let meta = document.querySelector('meta[name="description"]');
    const prevDescription = meta?.getAttribute("content") ?? null;
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);
    return () => {
      document.title = prevTitle;
      if (createdMeta) meta.remove();
      else if (prevDescription != null) meta.setAttribute("content", prevDescription);
    };
  }, [lang]);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setResult(null);
    const ok = await onSubmit(form);
    setSubmitting(false);
    if (ok) {
      setResult("success");
      setForm(EMPTY_FORM);
    } else {
      setResult("error");
    }
  };

  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topRow}>
          {onBack ? (
            <button style={S.backBtn} onClick={onBack}>{t.back}</button>
          ) : <span />}
          <LangToggle />
        </div>

        <h1 style={S.title}>{t.title}</h1>
        <p style={S.lede}>{t.lede}</p>

        {inspectors.length === 0 ? (
          <p style={S.empty}>{t.empty}</p>
        ) : (
          <div style={S.grid}>
            {inspectors.map((i) => (
              <div key={i.id} style={S.card}>
                <div style={S.cardName}>{i.business_name}</div>
                {i.service_area && <div style={S.cardMeta}>{t.areaLabel}: {i.service_area}</div>}
                {i.price_range && <div style={S.cardMeta}>{t.priceLabel}: {i.price_range}</div>}
                {i.notes && <p style={S.cardNotes}>{i.notes}</p>}
                <a
                  href={i.booking_link || `mailto:${i.contact_email}`}
                  target={i.booking_link ? "_blank" : undefined}
                  rel={i.booking_link ? "noreferrer noopener" : undefined}
                  style={S.cardBtn}
                >
                  {t.contactBtn} →
                </a>
              </div>
            ))}
          </div>
        )}

        <div style={S.listSection}>
          <strong style={S.listTitle}>{t.listTitle}</strong>
          <p style={S.listBody}>{t.listBody}</p>

          {!showForm && (
            <button style={S.listToggleBtn} onClick={() => { setShowForm(true); setResult(null); }}>
              {t.listToggleOpen}
            </button>
          )}

          {showForm && (
            <>
              <button style={S.listToggleBtn} onClick={() => setShowForm(false)}>{t.listToggleClose}</button>

              {result === "success" ? (
                <div style={S.successBox}>
                  <strong style={{ display: "block", marginBottom: 4 }}>{t.successTitle}</strong>
                  <span style={{ color: "#6b7280", fontSize: 14 }}>{t.successBody}</span>
                </div>
              ) : (
                <form style={S.form} onSubmit={handleSubmit}>
                  {result === "error" && <div style={S.errorBox}>{t.errorGeneric}</div>}
                  <input style={S.input} required placeholder={t.form.businessName} value={form.businessName} onChange={set("businessName")} />
                  <input style={S.input} required type="email" placeholder={t.form.contactEmail} value={form.contactEmail} onChange={set("contactEmail")} />
                  <input style={S.input} placeholder={t.form.contactPhone} value={form.contactPhone} onChange={set("contactPhone")} />
                  <input style={S.input} required placeholder={t.form.serviceArea} value={form.serviceArea} onChange={set("serviceArea")} />
                  <input style={S.input} placeholder={t.form.priceRange} value={form.priceRange} onChange={set("priceRange")} />
                  <input style={S.input} placeholder={t.form.bookingLink} value={form.bookingLink} onChange={set("bookingLink")} />
                  <textarea style={{ ...S.input, minHeight: 70, resize: "vertical" }} placeholder={t.form.notes} value={form.notes} onChange={set("notes")} />
                  <button style={S.submitBtn} type="submit" disabled={submitting}>
                    {submitting ? t.form.submitting : t.form.submit}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* Mirrors FAQView.jsx's S — same document family as FAQ/Terms/Privacy/Safety. */
const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  title: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10 },
  lede: { fontSize: 15, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, maxWidth: "60ch" },
  empty: { fontSize: 14, color: "#6b7280", marginTop: 28 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16, marginTop: 32 },
  card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 4 },
  cardName: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
  cardMeta: { fontSize: 13, color: "#6b7280" },
  cardNotes: { fontSize: 13.5, color: "#374151", lineHeight: 1.5, margin: "6px 0 4px" },
  cardBtn: { marginTop: 10, alignSelf: "flex-start", background: "#0f172a", color: "#fff", textDecoration: "none", fontSize: 13.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8 },
  listSection: { marginTop: 48, padding: 22, border: "1px solid #e5e7eb", borderRadius: 12, background: "#f9fafb" },
  listTitle: { display: "block", fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 },
  listBody: { margin: "0 0 14px", fontSize: 14, color: "#6b7280", lineHeight: 1.6 },
  listToggleBtn: { background: "none", border: "1px solid #d1d5db", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "#0f172a", marginBottom: 14 },
  form: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 },
  input: { fontFamily: "inherit", fontSize: 14, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, color: "#111827" },
  submitBtn: { fontFamily: "inherit", fontSize: 14, fontWeight: 700, color: "#fff", background: "#FFB020", border: "none", padding: "11px 16px", borderRadius: 8, cursor: "pointer", marginTop: 4 },
  successBox: { border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16 },
  errorBox: { border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 13.5 },
};
