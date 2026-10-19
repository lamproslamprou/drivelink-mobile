import { useLang } from "./i18n.jsx";
import { HERO_SCREENSHOT } from "./siteProof.js";

// Homepage hero visual (site audit D1.5). The whole product — money held, a
// code released, keys handed over — used to be shown only as words next to a
// stock photo of a car. This draws the moment itself: the buyer's payment held
// in escrow, the 6-digit handover code, and the funds-released state.
//
// It is a built illustration, not a screenshot, and says so on its face
// ("Example deal") so it can't be mistaken for a real customer's deal. The car,
// price and code below are made up. If you later drop a real screenshot into
// /public and set HERO_SCREENSHOT.src in siteProof.js, Landing.jsx shows that
// instead and this component is no longer rendered.

const COPY = {
  en: {
    example: "Example deal",
    car: "2019 Honda CR-V",
    price: "$18,400",
    held: "Payment protected until handover",
    heldSub: "Held on DriveLink's Stripe account. Not paid out yet.",
    codeLabel: "Buyer's handover code",
    codeHelp: "Give this to the seller only once you have the keys and the signed title.",
    released: "Funds released to seller",
    releasedSub: "Happens when the seller enters the code at the handover.",
  },
  es: {
    example: "Trato de ejemplo",
    car: "Honda CR-V 2019",
    price: "$18,400",
    held: "Pago retenido en depósito",
    heldSub: "Retenido en la cuenta de Stripe de DriveLink. Todavía no se paga al vendedor.",
    codeLabel: "Código de entrega del comprador",
    codeHelp: "Dáselo al vendedor solo cuando tengas las llaves y el título firmado.",
    released: "Fondos liberados al vendedor",
    releasedSub: "Ocurre cuando el vendedor ingresa el código en la entrega.",
  },
};

const EXAMPLE_CODE = "482917";

export default function HeroDealMock() {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;
  const alt = HERO_SCREENSHOT.alt[lang] || HERO_SCREENSHOT.alt.en;
  return (
    // role="img" + aria-label is the alt text; the drawn contents are decoration
    // for screen readers so the label isn't read twice.
    <div role="img" aria-label={alt} style={S.stage} className="dl-deal-mock">
      <div aria-hidden="true" style={S.card}>
        <div style={S.head}>
          <div>
            <div style={S.car}>{t.car}</div>
            <div style={S.price}>{t.price}</div>
          </div>
          <span style={S.tag}>{t.example}</span>
        </div>

        <div style={S.row}>
          <span style={{ ...S.dot, background: "#16a34a" }}>✓</span>
          <div>
            <div style={S.rowTitle}>{t.held}</div>
            <div style={S.rowSub}>{t.heldSub}</div>
          </div>
        </div>

        <div style={S.codeBox}>
          <div style={S.codeLabel}>{t.codeLabel}</div>
          <div style={S.digits}>
            {EXAMPLE_CODE.split("").map((d, i) => (
              <span key={i} style={S.digit}>{d}</span>
            ))}
          </div>
          <div style={S.codeHelp}>{t.codeHelp}</div>
        </div>

        <div style={{ ...S.row, opacity: 0.62, marginBottom: 0 }}>
          <span style={{ ...S.dot, background: "#fff", color: "#94a3b8", border: "2px dashed #cbd5e1" }}>→</span>
          <div>
            <div style={S.rowTitle}>{t.released}</div>
            <div style={S.rowSub}>{t.releasedSub}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const S = {
  stage: { display: "flex", alignItems: "center", justifyContent: "center", padding: 28, minHeight: 400 },
  card: { width: "100%", maxWidth: 400, background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 10px 30px rgba(0,0,0,.25)", textAlign: "left" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid #e5e7eb" },
  car: { fontSize: 15, fontWeight: 700, color: "#0f172a" },
  price: { fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" },
  tag: { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#475569", background: "#f1f5f9", borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" },
  row: { display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14 },
  dot: { flex: "0 0 auto", width: 28, height: 28, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 800 },
  rowTitle: { fontSize: 14, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 },
  rowSub: { fontSize: 12.5, color: "#6b7280", lineHeight: 1.5, marginTop: 2 },
  codeBox: { background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "14px 14px 12px", marginBottom: 14 },
  codeLabel: { fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#1d4ed8", marginBottom: 8 },
  digits: { display: "flex", gap: 6, marginBottom: 8 },
  digit: { flex: 1, maxWidth: 44, textAlign: "center", fontSize: 22, fontWeight: 800, color: "#0f172a", background: "#fff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 0", fontVariantNumeric: "tabular-nums" },
  codeHelp: { fontSize: 12.5, color: "#374151", lineHeight: 1.5 },
};
