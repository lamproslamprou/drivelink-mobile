import { useState, useEffect } from "react";
import { useLang, LangToggle } from "./i18n.jsx";
import { platformFeeLabel, promoActive } from "./fee.js";
import { faqItemsEn } from "./faqData.js";

// Fee copy is built from fee.js so it flips back to "1%" by itself on Nov 1 ET.
const FEE = platformFeeLabel();
const PROMO_ES = promoActive() ? " (la mitad de nuestro 1% habitual, hasta el 31 de octubre)" : "";

/*
  FAQView — standalone FAQ page at /faq.

  Palette and type deliberately mirror styles.legalPage / legalTitle / legalBody
  in App.jsx (white background, #0f172a headings, #374151 body, Inter). This page
  should read as the same document family as Terms, Privacy and Safety Tips.

  Copy lives here rather than in i18n.jsx because these are prose paragraphs, not
  UI strings — keeping EN and ES adjacent makes drift obvious. The language comes
  from useLang() so the toggle in the corner works without App.jsx passing it.

  Every claim here is currently true. Do NOT add anything promising that funds
  settle if DriveLink goes offline — auto-release runs on our own pg_cron, not on
  Stripe, so that would not hold.
*/

const COPY = {
  en: {
    back: "← Back to DriveLink",
    title: "How your money is protected",
    lede: "Buying a car from a stranger means one of you has to go first. These are the questions people ask us before they do.",
    contactLead: "Still unsure about something?",
    contactBody: "Email us and a person will answer.",
    transferTitle: "Paid by wire transfer and don't have a handover code yet?",
    transferBody: "That's expected. Wire transfers can take 1–2 business days to arrive, and we only issue your code once the money has actually cleared. We'll email it the moment it does. Until then, please don't arrange to collect the car. If it's been more than 5 business days, email us and we'll check your payment.",
    transferLink: "Check my purchases →",
    safetyLink: "Read the meetup safety tips →",
    compareLabel: "Compare:",
    items: faqItemsEn(),
  },

  es: {
    back: "← Volver a DriveLink",
    title: "Cómo se protege tu dinero",
    lede: "Comprarle un auto a un desconocido significa que alguien tiene que dar el primer paso. Estas son las preguntas que nos hacen antes de darlo.",
    contactLead: "¿Te quedó alguna duda?",
    contactBody: "Escríbenos y te responderá una persona.",
    transferTitle: "¿Pagaste por transferencia wire y todavía no tienes código de entrega?",
    transferBody: "Es lo esperado. Las transferencias wire pueden tardar 1–2 días hábiles en llegar, y solo emitimos tu código cuando el dinero se ha acreditado de verdad. Te lo enviaremos por correo apenas ocurra. Hasta entonces, no coordines retirar el auto. Si pasaron más de 5 días hábiles, escríbenos y revisamos tu pago.",
    transferLink: "Ver mis compras →",
    safetyLink: "Lee los consejos de seguridad para el encuentro →",
    compareLabel: "Comparar:",
    items: [
      {
        q: "¿Quién retiene mi dinero?",
        a: "El dinero lo tiene Stripe. El comprador paga a la cuenta de Stripe del propio vendedor, no a la de DriveLink, y DriveLink nunca recibe ni retiene el dinero. DriveLink controla cuándo esa cuenta puede pagar al banco del vendedor, y no lo hace hasta que se ingresa el código de entrega del comprador, el comprador confirma, o un administrador lo libera. Al vendedor no se le paga antes, y el dinero puede devolverse al comprador si la venta sale mal.",
      },
      {
        q: "¿Qué impide que DriveLink se quede con mi pago?",
        a: `El precio de venta nunca llega a nosotros: el comprador paga a la cuenta de Stripe del propio vendedor, y el vendedor no puede retirarlo hasta que se ingresa el código de entrega del comprador o el comprador confirma la recepción. Nuestro único ingreso es la comisión del ${FEE}, que se cobra cuando se cierra la transacción.`,
      },
      {
        q: "¿Cuándo recibe el pago el vendedor?",
        a: "Cuando el comprador libera los fondos. El comprador recibe un código de entrega de 6 dígitos una vez que su pago se ha acreditado. Una vez que ha inspeccionado el auto y tiene las llaves y el título en mano — y solo entonces — le da el código al vendedor, lo que activa el pago.",
      },
      {
        q: "¿Puedo pagar por transferencia bancaria en vez de tarjeta?",
        a: "En compras de $15,000 o más puedes elegir una transferencia wire nacional: recibes los datos bancarios y una referencia y envías la transferencia desde tu banco. La tarjeta siempre está disponible y se acredita en segundos; te mostramos el costo de procesamiento de cada una antes de elegir. Las transferencias wire suelen llegar en 1–2 días hábiles y cuestan menos que una tarjeta.",
      },
      {
        q: "Pagué por transferencia wire. ¿Por qué no tengo código de entrega?",
        a: "Porque el dinero todavía no llegó. Emitimos el código solo cuando el pago se ha acreditado de verdad — de lo contrario podrías retirar un auto con una transferencia que después falla, y el vendedor se quedaría sin auto y sin dinero. Te enviaremos el código por correo apenas se acredite. Hasta entonces, no coordines retirar el vehículo.",
        flag: true,
      },
      {
        q: "¿Y si la transferencia wire no llega?",
        a: "No se pierde nada. No se te cobra, no se retiene dinero, y la publicación vuelve a estar a la venta automáticamente — les avisamos por correo a ti y al vendedor. Los bancos rechazan transferencias por motivos comunes como el saldo disponible o restricciones de la cuenta; tu banco puede decirte cuál fue. Puedes intentar de nuevo por transferencia o con tarjeta.",
      },
      {
        q: "¿Debo dar mi código de entrega antes de tiempo?",
        a: "No. El código es lo único que libera tu dinero, así que trátalo como si fuera efectivo. Dáselo al vendedor solo después de tener las llaves y el título firmado en mano — nunca antes de ver el auto, nunca para apartar una venta, nunca por teléfono o mensaje antes del encuentro. Quien te lo pida antes de tiempo está pidiendo que le paguen por un auto que aún no tienes. DriveLink nunca te pedirá tu código.",
        flag: true,
      },
      {
        q: "¿Y si pago y el auto no es como lo describieron?",
        a: "No des el código. Sin él no se libera nada, y el pago se reembolsa a la tarjeta del comprador.",
      },
      {
        q: "¿Y si el comprador se lleva el auto y se niega a liberar el pago?",
        a: "Avísanos. Si una transacción queda sin confirmar, contactamos automáticamente a ambas partes y les preguntamos directamente si el auto ya cambió de manos. Al vendedor no se le paga hasta resolverlo — nada se paga ni se reembolsa por un temporizador, y nadie queda esperando indefinidamente sin que una persona revise el caso.",
      },
      {
        q: "¿Por qué confiar en una empresa de la que nunca he oído hablar?",
        a: "No tienes que creernos bajo palabra. DriveLink LLC está registrada en Nueva Jersey con un EIN federal, y nuestra identidad está verificada con Stripe. La protección viene de dónde está el dinero y quién puede liberarlo, no de nuestra reputación.",
      },
      {
        q: "¿Cuánto cuesta?",
        a: `${FEE} del precio de venta${PROMO_ES}, cobrado una sola vez al cerrar la transacción. Sin cuotas por publicar, sin suscripción, y nada si la venta no se concreta.`,
      },
      {
        q: "¿Tengo que publicar mi auto en DriveLink?",
        a: "No. Si ya encontraste comprador o vendedor por otro lado, puedes iniciar una transacción directamente y usar DriveLink solo para el pago.",
      },
      {
        q: "¿Está segura mi información personal?",
        a: "Los datos de tu tarjeta van directamente a Stripe y nunca pasan por nuestros servidores. Solo recopilamos lo necesario para gestionar la transacción y verificar identidad.",
      },
    ],
  },
};

export default function FAQView({ onBack, onSafety, onNavigate }) {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;
  // The three highest-stakes answers start expanded (who holds the money, what
  // stops us taking it, why trust a company nobody has heard of) plus the bank-transfer
  // handover-code answer (index 4), which paying visitors were clicking and collapsing so a skimmer
  // reads answers, not just the fears. Indexes match the item order in both
  // languages. Any item can still be collapsed or opened.
  const [open, setOpen] = useState(() => new Set([0, 1, 4, 9]));
  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  // FAQPage structured data. Google can render these as expandable results,
  // which is worth real estate on escrow-intent searches for free.
  useEffect(() => {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: t.items.map((it) => ({
        "@type": "Question",
        name: it.q,
        acceptedAnswer: { "@type": "Answer", text: it.a },
      })),
    });
    document.head.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [lang]);

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <div style={S.inner}>
        <div style={S.topRow}>
          {onBack ? (
            <button style={S.backBtn} onClick={onBack}>{t.back}</button>
          ) : <span />}
          <LangToggle />
        </div>

        <h1 style={S.title}>{t.title}</h1>
        <p style={S.lede}>{t.lede}</p>

        <div style={S.transferBox} role="note">
          <strong style={S.transferTitle}>{t.transferTitle}</strong>
          <p style={S.transferBody}>
            {t.transferBody}{" "}
            <a href="mailto:support@drivelink.deals" style={S.link}>support@drivelink.deals</a>
          </p>
          {onNavigate && (
            <button style={{ ...S.link, ...S.linkBtn, marginTop: 8 }} onClick={() => onNavigate("myPurchases")}>
              {t.transferLink}
            </button>
          )}
        </div>

        <div style={S.list}>
          {t.items.map((it, i) => {
            const isOpen = open.has(i);
            return (
              <div key={i} style={S.item}>
                <h2 style={{ margin: 0 }}>
                  <button
                    className="dlFaqQ"
                    aria-expanded={isOpen}
                    aria-controls={`dl-faq-a-${i}`}
                    onClick={() => toggle(i)}
                  >
                    <span>{it.q}</span>
                    <span className={"dlFaqSign" + (isOpen ? " isOpen" : "")} aria-hidden="true">+</span>
                  </button>
                </h2>
                {isOpen && (
                  <p
                    id={`dl-faq-a-${i}`}
                    style={{ ...S.answer, ...(it.flag ? S.answerFlag : null) }}
                  >
                    {it.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div style={S.contact}>
          <strong style={S.contactLead}>{t.contactLead}</strong>
          <p style={S.contactBody}>
            {t.contactBody}{" "}
            <a href="mailto:support@drivelink.deals" style={S.link}>support@drivelink.deals</a>
          </p>
          {onSafety && (
            <button style={{ ...S.link, ...S.linkBtn }} onClick={onSafety}>
              {t.safetyLink}
            </button>
          )}
          <nav aria-label={t.compareLabel} style={S.compareRow}>
            <span style={S.compareLabel}>{t.compareLabel}</span>
            {COMPARE_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                style={S.link}
                onClick={(e) => {
                  if (!onNavigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onNavigate(l.view);
                }}
              >
                {l.label[lang] || l.label.en}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

const COMPARE_LINKS = [
  { href: "/vs/drivelink-vs-privateauto", view: "vsPrivateAuto", label: { en: "DriveLink vs PrivateAuto", es: "DriveLink vs PrivateAuto" } },
  { href: "/vs/drivelink-vs-keysavvy", view: "vsKeySavvy", label: { en: "DriveLink vs KeySavvy", es: "DriveLink vs KeySavvy" } },
  { href: "/vs/drivelink-vs-escrow-com", view: "vsEscrowCom", label: { en: "DriveLink vs Escrow.com", es: "DriveLink vs Escrow.com" } },
];

/* Mirrors styles.legalPage & friends in App.jsx — same document family as
   Terms, Privacy and Safety Tips. */
const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  title: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10 },
  lede: { fontSize: 15, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, maxWidth: "56ch" },
  transferBox: { marginTop: 28, padding: "16px 20px", borderLeft: "3px solid #FFB020", background: "#fffbf2", borderRadius: "0 8px 8px 0" },
  transferTitle: { display: "block", fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 },
  transferBody: { margin: 0, fontSize: 15, color: "#1f2937", lineHeight: 1.65 },
  list: { marginTop: 28, borderTop: "1px solid #e5e7eb" },
  item: { borderBottom: "1px solid #e5e7eb" },
  answer: { margin: 0, padding: "0 44px 22px 0", fontSize: 15, color: "#374151", lineHeight: 1.7 },
  answerFlag: { borderLeft: "3px solid #FFB020", paddingLeft: 16, background: "#fffbf2", paddingTop: 14, paddingBottom: 14, marginBottom: 22, borderRadius: "0 8px 8px 0", color: "#1f2937" },
  contact: { marginTop: 44, padding: 22, border: "1px solid #e5e7eb", borderRadius: 12, background: "#f9fafb" },
  contactLead: { display: "block", fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 },
  contactBody: { margin: 0, fontSize: 14, color: "#6b7280", lineHeight: 1.6 },
  link: { color: "#2563eb", textDecoration: "none", fontWeight: 600 },
  compareRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px", marginTop: 16, fontSize: 14 },
  compareLabel: { color: "#6b7280", fontWeight: 600 },
  linkBtn: { display: "inline-block", background: "none", border: "none", padding: 0, marginTop: 14, cursor: "pointer", fontSize: 14 },
};

const CSS = `
.dlFaqQ{
  width:100%;background:none;border:0;color:#0f172a;font-family:inherit;
  font-size:16px;font-weight:600;text-align:left;padding:20px 0;cursor:pointer;
  display:flex;align-items:flex-start;justify-content:space-between;gap:16px;line-height:1.45;
}
.dlFaqQ:hover{color:#2563eb}
.dlFaqQ:focus-visible{outline:2px solid #FFB020;outline-offset:3px;border-radius:4px}
.dlFaqSign{color:#9ca3af;font-size:22px;line-height:1.2;flex:0 0 auto;transition:transform .18s ease}
.dlFaqSign.isOpen{transform:rotate(45deg);color:#FFB020}
@media(prefers-reduced-motion:reduce){.dlFaqSign{transition:none}}
`;
