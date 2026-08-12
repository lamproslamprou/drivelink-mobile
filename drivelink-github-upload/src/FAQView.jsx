import { useState, useEffect } from "react";
import { useLang, LangToggle } from "./i18n.jsx";

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
    safetyLink: "Read the meetup safety tips →",
    items: [
      {
        q: "Who actually holds my money?",
        a: "Stripe does. Payments go into a Stripe-held balance tied to the deal, not into a DriveLink bank account. We're the layer that tells Stripe when the conditions are met.",
      },
      {
        q: "What stops DriveLink from just taking my payment?",
        a: "We can't move the funds to ourselves. The payout goes to the seller's own Stripe-connected account. Our only revenue is the 1% fee, taken when the deal closes.",
      },
      {
        q: "When does the seller get paid?",
        a: "When the buyer releases the funds. At payment, the buyer gets a 6-digit handover code. Once they've inspected the car and have the keys and title in hand — and only then — they give the code to the seller, which triggers the payout.",
      },
      {
        q: "Should I ever give out my handover code early?",
        a: "No. The code is the only thing that releases your money, so treat it like cash. Give it to the seller only after you have the keys and the signed title in hand — never before you've seen the car, never to hold a deal, never over the phone or by text ahead of the meeting. Anyone asking for it early is asking to be paid for a car you don't have yet. DriveLink will never ask you for your code.",
        flag: true,
      },
      {
        q: "What if I pay and then the car isn't as described?",
        a: "Don't give the code. Nothing releases without it, and the payment is refunded to the buyer's card.",
      },
      {
        q: "What if the buyer just refuses to release after taking the car?",
        a: "Every deal has an automatic release 7 days after the agreed handover date, so a seller who's done their part isn't left waiting indefinitely. If something's gone wrong before then, contact us and we'll look at the deal.",
      },
      {
        q: "Why should I trust a company I've never heard of?",
        a: "You don't have to take our word for much. DriveLink LLC is registered in New Jersey with a federal EIN, and our identity is verified with Stripe. The protection comes from where the money sits and who can release it, not from our reputation.",
      },
      {
        q: "What does it cost?",
        a: "1% of the sale price, charged once when the deal closes. No listing fees, no subscription, and nothing if the deal falls through.",
      },
      {
        q: "Do I have to list my car on DriveLink?",
        a: "No. If you've already found a buyer or seller somewhere else, you can start a deal directly and use DriveLink just for the payment.",
      },
      {
        q: "Is my personal information safe?",
        a: "Card details go straight to Stripe and never hit our servers. We collect what's needed to run the deal and verify identity, nothing more.",
      },
    ],
  },

  es: {
    back: "← Volver a DriveLink",
    title: "Cómo se protege tu dinero",
    lede: "Comprarle un auto a un desconocido significa que alguien tiene que dar el primer paso. Estas son las preguntas que nos hacen antes de darlo.",
    contactLead: "¿Te quedó alguna duda?",
    contactBody: "Escríbenos y te responderá una persona.",
    safetyLink: "Lee los consejos de seguridad para el encuentro →",
    items: [
      {
        q: "¿Quién retiene mi dinero?",
        a: "Stripe. El pago se mantiene en un saldo de Stripe vinculado a la transacción, no en una cuenta bancaria de DriveLink. Nosotros solo le indicamos a Stripe cuándo se cumplen las condiciones.",
      },
      {
        q: "¿Qué impide que DriveLink se quede con mi pago?",
        a: "No podemos transferir los fondos a nosotros mismos. El pago va a la cuenta de Stripe del propio vendedor. Nuestro único ingreso es la comisión del 1%, que se cobra cuando se cierra la transacción.",
      },
      {
        q: "¿Cuándo recibe el pago el vendedor?",
        a: "Cuando el comprador libera los fondos. Al pagar, el comprador recibe un código de entrega de 6 dígitos. Una vez que ha inspeccionado el auto y tiene las llaves y el título en mano — y solo entonces — le da el código al vendedor, lo que activa el pago.",
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
        a: "Cada transacción tiene una liberación automática 7 días después de la fecha de entrega acordada, para que un vendedor que cumplió su parte no quede esperando indefinidamente. Si algo salió mal antes de ese plazo, contáctanos y revisaremos el caso.",
      },
      {
        q: "¿Por qué confiar en una empresa de la que nunca he oído hablar?",
        a: "No tienes que creernos bajo palabra. DriveLink LLC está registrada en Nueva Jersey con un EIN federal, y nuestra identidad está verificada con Stripe. La protección viene de dónde está el dinero y quién puede liberarlo, no de nuestra reputación.",
      },
      {
        q: "¿Cuánto cuesta?",
        a: "1% del precio de venta, cobrado una sola vez al cerrar la transacción. Sin cuotas por publicar, sin suscripción, y nada si la venta no se concreta.",
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

export default function FAQView({ onBack, onSafety }) {
  const { lang } = useLang();
  const t = COPY[lang] || COPY.en;
  const [open, setOpen] = useState(0);

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

        <div style={S.list}>
          {t.items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={S.item}>
                <h2 style={{ margin: 0 }}>
                  <button
                    className="dlFaqQ"
                    aria-expanded={isOpen}
                    aria-controls={`dl-faq-a-${i}`}
                    onClick={() => setOpen(isOpen ? -1 : i)}
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
        </div>
      </div>
    </div>
  );
}

/* Mirrors styles.legalPage & friends in App.jsx — same document family as
   Terms, Privacy and Safety Tips. */
const S = {
  page: { fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: "#111827" },
  inner: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 96px" },
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 32, flexWrap: "wrap" },
  backBtn: { background: "none", border: "1px solid #e5e7eb", padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "#374151" },
  title: { fontSize: 36, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 10 },
  lede: { fontSize: 15, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, maxWidth: "56ch" },
  list: { marginTop: 36, borderTop: "1px solid #e5e7eb" },
  item: { borderBottom: "1px solid #e5e7eb" },
  answer: { margin: 0, padding: "0 44px 22px 0", fontSize: 15, color: "#374151", lineHeight: 1.7 },
  answerFlag: { borderLeft: "3px solid #FFB020", paddingLeft: 16, background: "#fffbf2", paddingTop: 14, paddingBottom: 14, marginBottom: 22, borderRadius: "0 8px 8px 0", color: "#1f2937" },
  contact: { marginTop: 44, padding: 22, border: "1px solid #e5e7eb", borderRadius: 12, background: "#f9fafb" },
  contactLead: { display: "block", fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 },
  contactBody: { margin: 0, fontSize: 14, color: "#6b7280", lineHeight: 1.6 },
  link: { color: "#2563eb", textDecoration: "none", fontWeight: 600 },
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
