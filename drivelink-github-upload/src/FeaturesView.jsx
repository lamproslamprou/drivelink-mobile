import { useLang, LangToggle } from "./i18n.jsx";

/*
  FeaturesView — /features (site audit D5.1). One section per feature, each with
  its own heading so each can be searched for and linked to. Plain statements
  only; every claim here matches what the product and backend do today:
    - payment processed by Stripe straight to the seller's own Stripe account, with payouts to the seller's bank held until the 6-digit code
    - deals up to $250,000 (create-deal MAX_PRICE), arranged manually above
    - wire transfer for purchases of $15,000 or more
    - disputes are opened by the buyer and the money stays held
  Same visual family as FAQView / Terms / Privacy.
*/

const COPY = {
  en: {
    back: "← Back to DriveLink",
    title: "What DriveLink does",
    lede: "DriveLink protects the buyer's payment while you hand over a privately sold car. These are the parts, in the order a deal uses them.",
    sections: [
      {
        id: "escrow",
        h: "Protected payment",
        p: [
          "The buyer pays through DriveLink. Stripe processes the payment into the seller's own Stripe account, not DriveLink's. The seller can't withdraw it until the handover is confirmed, so they are not paid yet.",
          "Deals can be up to $250,000. Above that, the deal is arranged manually.",
        ],
      },
      {
        id: "bring-your-own-deal",
        h: "Use it on a car you already found",
        p: [
          "You do not have to list the car on DriveLink. If you found the buyer or seller on Facebook Marketplace, Craigslist or through a friend, you can start a deal on that car and use DriveLink only for the payment.",
        ],
        link: { href: "/start-deal", label: "Start a deal", view: "startDeal" },
      },
      {
        id: "id-verification",
        h: "ID verification",
        p: [
          "Every seller is identity-checked by Stripe before they can be paid: they connect their own Stripe account to receive payouts, and Stripe verifies who they are. Buyers can verify their ID too.",
        ],
      },
      {
        id: "handover-code",
        h: "The 6-digit handover code",
        p: [
          "Once the buyer's payment has cleared, the buyer gets a 6-digit code. At the handover, when the buyer has the keys and the signed title, they give the code to the seller. The seller enters it and the money is released.",
          "Nothing is released on a timer. DriveLink never asks for your code.",
        ],
      },
      {
        id: "disputes",
        h: "Disputes",
        p: [
          "If the car is not as described, the buyer does not give the code. If something goes wrong, the buyer can open a dispute and the seller isn't paid until our team resolves it.",
        ],
        link: { href: "/faq", label: "How your money is protected", view: "faq" },
      },
    ],
    compareLabel: "Compare:",
    priceLink: { href: "/pricing", label: "What it costs", view: "pricing" },
  },
  es: {
    back: "← Volver a DriveLink",
    title: "Qué hace DriveLink",
    lede: "DriveLink protege el pago del comprador mientras ustedes hacen la entrega de un auto vendido entre particulares. Estas son las piezas, en el orden en que las usa un trato.",
    sections: [
      {
        id: "escrow",
        h: "Pago protegido",
        p: [
          "El comprador paga a través de DriveLink. Stripe procesa el pago directamente a la cuenta de Stripe del vendedor, no a la de DriveLink, y el vendedor no puede retirarlo hasta que se confirma la entrega. Al vendedor todavía no se le paga.",
          "Los tratos pueden ser de hasta $250,000. Por encima de eso, el trato se arregla manualmente.",
        ],
      },
      {
        id: "bring-your-own-deal",
        h: "Úsalo con un auto que ya encontraste",
        p: [
          "No tienes que publicar el auto en DriveLink. Si encontraste al comprador o al vendedor en Facebook Marketplace, Craigslist o por un conocido, puedes abrir un trato por ese auto y usar DriveLink solo para el pago.",
        ],
        link: { href: "/start-deal", label: "Abrir un trato", view: "startDeal" },
      },
      {
        id: "id-verification",
        h: "Verificación de identidad",
        p: [
          "Stripe verifica la identidad de cada vendedor antes de pagarle: conectan su propia cuenta de Stripe para recibir el pago, y Stripe verifica quiénes son. Los compradores también pueden verificar su identidad.",
        ],
      },
      {
        id: "handover-code",
        h: "El código de entrega de 6 dígitos",
        p: [
          "Cuando el pago del comprador se ha acreditado, el comprador recibe un código de 6 dígitos. En la entrega, cuando tiene las llaves y el título firmado, le da el código al vendedor. El vendedor lo ingresa y el dinero se libera.",
          "Nada se libera por un temporizador. DriveLink nunca te pide tu código.",
        ],
      },
      {
        id: "disputes",
        h: "Disputas",
        p: [
          "Si el auto no es como lo describieron, el comprador no da el código. Si algo sale mal, el comprador puede abrir una disputa y al vendedor no se le paga hasta que nuestro equipo la resuelva.",
        ],
        link: { href: "/faq", label: "Cómo se protege tu dinero", view: "faq" },
      },
    ],
    compareLabel: "Comparar:",
    priceLink: { href: "/pricing", label: "Cuánto cuesta", view: "pricing" },
  },
};

const COMPARE_LINKS = [
  { href: "/vs/drivelink-vs-privateauto", view: "vsPrivateAuto", label: "PrivateAuto" },
  { href: "/vs/drivelink-vs-keysavvy", view: "vsKeySavvy", label: "KeySavvy" },
  { href: "/vs/drivelink-vs-escrow-com", view: "vsEscrowCom", label: "Escrow.com" },
];

export default function FeaturesView({ onBack, onNavigate }) {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;

  // Real anchors (crawlable); plain left-click navigates inside the SPA.
  const A = ({ href, view, children }) => (
    <a
      href={href}
      style={S.link}
      onClick={(e) => {
        if (!onNavigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate(view);
      }}
    >
      {children}
    </a>
  );

  return (
    <div style={S.page}>
      <div style={S.inner}>
        <div style={S.topRow}>
          {onBack ? <button style={S.backBtn} onClick={onBack}>{t.back}</button> : <span />}
          <LangToggle />
        </div>

        <h1 style={S.title}>{t.title}</h1>
        <p style={S.lede}>{t.lede}</p>

        {t.sections.map((s) => (
          <section key={s.id} id={s.id} style={S.section}>
            <h2 style={S.h2}>{s.h}</h2>
            {s.p.map((para, i) => <p key={i} style={S.p}>{para}</p>)}
            {s.link && <p style={S.p}><A href={s.link.href} view={s.link.view}>{s.link.label} →</A></p>}
          </section>
        ))}

        <nav aria-label={t.compareLabel} style={S.footerRow}>
          <A href={t.priceLink.href} view={t.priceLink.view}>{t.priceLink.label}</A>
          <span style={S.muted}>{t.compareLabel}</span>
          {COMPARE_LINKS.map((l) => (
            <A key={l.href} href={l.href} view={l.view}>DriveLink vs {l.label}</A>
          ))}
        </nav>
      </div>
    </div>
  );
}

const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  title: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10 },
  lede: { fontSize: 15, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, maxWidth: "56ch" },
  section: { borderTop: "1px solid #e5e7eb", marginTop: 32, paddingTop: 24 },
  h2: { fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" },
  p: { fontSize: 15, color: "#374151", lineHeight: 1.7, margin: "0 0 10px" },
  link: { color: "#2563eb", textDecoration: "none", fontWeight: 600 },
  footerRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 44, paddingTop: 20, borderTop: "1px solid #e5e7eb", fontSize: 14 },
  muted: { color: "#6b7280", fontWeight: 600 },
};
