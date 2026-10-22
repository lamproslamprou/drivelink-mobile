import { useLang, LangToggle } from "./i18n.jsx";
import { platformFeeLabel, platformFeeRate, maxFeeLabel, promoActive } from "./fee.js";

// /pricing — the whole fee schedule on one page, with a worked dollar example.
// Every figure is derived from fee.js, so the page flips from the October 0.5%
// promo back to 1% on Nov 1 ET by itself, same as the rest of the site.
//
// Processing is shown explicitly: the seller's payout is the sale price minus
// DriveLink's fee MINUS Stripe's processing cost (see sellerNetBreakdown in
// App.jsx). Leaving it off would repeat exactly the "quoted 1%, paid out
// something else" surprise that code comment warns about.

const EXAMPLE_PRICE = 30000;
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

function figures() {
  const rate = platformFeeRate();
  const fee = EXAMPLE_PRICE * rate;
  const withPromoter = EXAMPLE_PRICE * (rate + 0.01);
  const cardProcessing = Math.ceil(EXAMPLE_PRICE * 0.029 + 0.3);
  return { fee, withPromoter, cardProcessing };
}

function buildCopy() {
  const FEE = platformFeeLabel();
  const MAX = maxFeeLabel();
  const promo = promoActive();
  const f = figures();
  return {
    en: {
      back: "← Back to DriveLink",
      title: "What DriveLink costs",
      lede: `Sellers pay ${FEE} of the sale price, once, when the deal closes${promo ? " (half our usual 1%, through October 31)" : ""}. Buyers pay nothing beyond the price of the car. If the deal falls through, nobody pays us anything. Card processing is a separate charge from Stripe (about 2.9% + $0.30), taken from the seller's proceeds: roughly ${usd(f.cardProcessing)} on a ${usd(EXAMPLE_PRICE)} card sale. Bank transfer costs much less.`,
      tableTitle: "The full fee schedule",
      rows: [
        ["Listing a car", "$0"],
        ["Buyers", "$0 beyond the price of the car"],
        [`DriveLink fee (seller)${promo ? " — October offer" : ""}`, `${FEE} of the sale price, charged when the deal closes${promo ? ". Normally 1%." : "."}`],
        ["If the deal falls through", "$0. The buyer's money goes back and nobody is charged"],
        ["Card or bank processing", "Charged by Stripe, not by DriveLink. About 2.9% + $0.30 on cards. Wire transfer, available from $15,000, costs far less"],
        ["Deal size", "Up to $250,000. Above that, the deal is arranged manually"],
        ["If something goes wrong", "The buyer can open a dispute. The seller isn't paid until our team resolves it"],
      ],
      exTitle: "A worked example",
      exBody: [
        `A car sells for ${usd(EXAMPLE_PRICE)}.`,
        `DriveLink's fee is ${usd(f.fee)} (${FEE}).`,
        `If the deal falls through, you pay ${"$0"}.`,
        `Card processing is separate, paid to Stripe, and comes out of the seller's proceeds: about ${usd(f.cardProcessing)} on a card payment of ${usd(EXAMPLE_PRICE)}. Wire transfer, available from $15,000, costs much less.`,
      ],
      exNote: "When you list a car, the form shows exactly what you would receive after both the DriveLink fee and processing, before you publish.",
      ctaStart: "Start a deal on a car you already found",
      ctaBrowse: "Browse cars",
      faqLink: "How your money is protected →",
    },
    es: {
      back: "← Volver a DriveLink",
      title: "Cuánto cuesta DriveLink",
      lede: `Los vendedores pagan ${FEE} del precio de venta, una sola vez, cuando se cierra el trato${promo ? " (la mitad de nuestro 1% habitual, hasta el 31 de octubre)" : ""}. Los compradores no pagan nada aparte del precio del auto. Si el trato no se concreta, nadie nos paga nada. El procesamiento con tarjeta es un cargo aparte de Stripe (alrededor de 2.9% + $0.30), que sale de lo que recibe el vendedor: unos ${usd(f.cardProcessing)} en una venta de ${usd(EXAMPLE_PRICE)} con tarjeta. La transferencia bancaria cuesta mucho menos.`,
      tableTitle: "Todas las tarifas",
      rows: [
        ["Publicar un auto", "$0"],
        ["Compradores", "$0 aparte del precio del auto"],
        [`Comisión de DriveLink (vendedor)${promo ? " — oferta de octubre" : ""}`, `${FEE} del precio de venta, cobrada cuando se cierra el trato${promo ? ". Normalmente 1%." : "."}`],
        ["Si el trato no se concreta", "$0. El dinero del comprador se devuelve y no se cobra nada"],
        ["Procesamiento de tarjeta o banco", "Lo cobra Stripe, no DriveLink. Alrededor de 2.9% + $0.30 con tarjeta. La transferencia wire, disponible desde $15,000, cuesta mucho menos"],
        ["Tamaño del trato", "Hasta $250,000. Por encima de eso, el trato se arregla manualmente"],
        ["Si algo sale mal", "El comprador puede abrir una disputa. El dinero queda retenido hasta que nuestro equipo la resuelva"],
      ],
      exTitle: "Un ejemplo con números",
      exBody: [
        `Un auto se vende por ${usd(EXAMPLE_PRICE)}.`,
        `La comisión de DriveLink es ${usd(f.fee)} (${FEE}).`,
        "Si el trato no se concreta, pagas $0.",
        `El procesamiento es aparte, se paga a Stripe y sale de lo que recibe el vendedor: alrededor de ${usd(f.cardProcessing)} con un pago de ${usd(EXAMPLE_PRICE)} por tarjeta. La transferencia wire, disponible desde $15,000, cuesta mucho menos.`,
      ],
      exNote: "Al publicar un auto, el formulario muestra exactamente lo que recibirías después de la comisión de DriveLink y del procesamiento, antes de publicar.",
      ctaStart: "Abrir un trato por un auto que ya encontraste",
      ctaBrowse: "Ver autos",
      faqLink: "Cómo se protege tu dinero →",
    },
  };
}

export default function PricingView({ onBack, onStart, onBrowse, onFaq }) {
  const { lang } = useLang();
  const t = (buildCopy()[lang]) || buildCopy().en;
  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topRow}>
          {onBack ? <button style={S.backBtn} onClick={onBack}>{t.back}</button> : <span />}
          <LangToggle />
        </div>

        <h1 style={S.title}>{t.title}</h1>
        <p style={S.lede}>{t.lede}</p>

        <h2 style={S.h2}>{t.tableTitle}</h2>
        <dl style={S.table}>
          {t.rows.map(([k, v], i) => (
            <div key={i} style={S.row}>
              <dt style={S.k}>{k}</dt>
              <dd style={S.v}>{v}</dd>
            </div>
          ))}
        </dl>

        <h2 style={S.h2}>{t.exTitle}</h2>
        <div style={S.example}>
          {t.exBody.map((line, i) => <p key={i} style={S.exLine}>{line}</p>)}
          <p style={S.exNote}>{t.exNote}</p>
        </div>

        <div style={S.actions}>
          <button style={S.primary} onClick={onStart}>{t.ctaStart}</button>
          <button style={S.secondary} onClick={onBrowse}>{t.ctaBrowse}</button>
        </div>
        {onFaq && <button style={S.link} onClick={onFaq}>{t.faqLink}</button>}
      </div>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151", minHeight: 44 },
  title: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10 },
  lede: { fontSize: 16, color: "#374151", lineHeight: 1.7, marginBottom: 28, maxWidth: "60ch" },
  h2: { fontSize: 20, fontWeight: 800, color: "#0f172a", margin: "32px 0 12px" },
  table: { margin: 0, borderTop: "1px solid #e5e7eb" },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, padding: "14px 0", borderBottom: "1px solid #e5e7eb" },
  k: { fontWeight: 600, color: "#0f172a", fontSize: 15 },
  v: { margin: 0, color: "#374151", fontSize: 15, lineHeight: 1.6 },
  example: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "18px 20px" },
  exLine: { margin: "0 0 10px", fontSize: 15, lineHeight: 1.65, color: "#1f2937" },
  exNote: { margin: "6px 0 0", fontSize: 13, lineHeight: 1.6, color: "#6b7280" },
  actions: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 32 },
  primary: { background: "#0f172a", color: "#fff", border: "none", padding: "13px 22px", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", minHeight: 44 },
  secondary: { background: "#fff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "13px 22px", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: "pointer", minHeight: 44 },
  link: { display: "inline-block", marginTop: 20, background: "none", border: "none", padding: 0, color: "#2563eb", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
};
