import { useState, useEffect } from "react";

/*
  FAQView — standalone FAQ page.

  WIRING (3 edits outside this file):
    1. import FAQView from "./FAQView";
    2. VIEW_PATHS: add  faq: "/faq"
    3. render <FAQView lang={lang} /> when view === "faq"

  `lang` is "en" or "es". Pass whatever your language toggle already holds.
  FAQ copy lives here rather than in i18n.jsx on purpose: these are long prose
  blocks, not UI strings, and keeping the two languages side by side makes it
  obvious when one drifts out of sync with the other.

  Every claim here is one that is currently true. Do NOT add anything about
  funds settling if DriveLink goes offline — auto-release runs on our own cron,
  not on Stripe, so that promise would not hold.
*/

const COPY = {
  en: {
    eyebrow: "Common questions",
    title: "How your money is protected",
    lede: "Buying a car from a stranger means one of you has to go first. These are the questions people ask us before they do.",
    contactLead: "Still unsure about something?",
    contactBody: "Email us and a person will answer.",
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
    eyebrow: "Preguntas frecuentes",
    title: "Cómo se protege tu dinero",
    lede: "Comprarle un auto a un desconocido significa que alguien tiene que dar el primer paso. Estas son las preguntas que nos hacen antes de darlo.",
    contactLead: "¿Te quedó alguna duda?",
    contactBody: "Escríbenos y te responderá una persona.",
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

export default function FAQView({ lang = "en" }) {
  const t = COPY[lang] || COPY.en;
  const [open, setOpen] = useState(0);

  // FAQPage structured data — lets Google show these as expandable results,
  // which is worth a lot on escrow-intent search queries.
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
    return () => document.head.removeChild(el);
  }, [lang]);

  return (
    <div className="dl-faq">
      <style>{`
        .dl-faq{max-width:820px;margin:0 auto;padding:64px 20px 96px;color:#F2F4F7}
        .dl-faq__eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;
          color:#8A939F;display:flex;align-items:center;gap:10px;margin-bottom:18px}
        .dl-faq__dot{width:6px;height:6px;border-radius:50%;background:#FFB020;
          box-shadow:0 0 0 4px rgba(255,176,32,.15)}
        .dl-faq__title{font-size:clamp(30px,5vw,44px);font-weight:600;letter-spacing:-.03em;
          line-height:1.1;margin:0}
        .dl-faq__lede{margin-top:16px;color:#8A939F;font-size:16px;line-height:1.6;max-width:56ch}
        .dl-faq__list{margin-top:44px;border-top:1px solid #242A32}
        .dl-faq__item{border-bottom:1px solid #242A32}
        .dl-faq__q{width:100%;background:none;border:0;color:inherit;font:inherit;
          font-size:16.5px;font-weight:500;text-align:left;padding:22px 44px 22px 0;
          cursor:pointer;position:relative;line-height:1.45}
        .dl-faq__q:hover{color:#FFB020}
        .dl-faq__q:focus-visible{outline:2px solid #FFB020;outline-offset:3px;border-radius:4px}
        .dl-faq__sign{position:absolute;right:8px;top:50%;transform:translateY(-50%);
          color:#8A939F;font-size:20px;line-height:1;transition:transform .2s ease}
        .dl-faq__item[data-open="true"] .dl-faq__sign{transform:translateY(-50%) rotate(45deg);color:#FFB020}
        .dl-faq__a{padding:0 44px 26px 0;color:#8A939F;font-size:15.5px;line-height:1.7;margin:0}
        .dl-faq__a--flag{border-left:2px solid #FFB020;padding-left:18px;color:#C9D1DB}
        .dl-faq__contact{margin-top:48px;padding:24px;border:1px solid #242A32;border-radius:12px}
        .dl-faq__contact strong{display:block;margin-bottom:6px;font-weight:600}
        .dl-faq__contact p{margin:0;color:#8A939F;font-size:14.5px}
        .dl-faq__contact a{color:#FFB020;text-decoration:none}
        .dl-faq__contact a:hover{text-decoration:underline}
        @media(prefers-reduced-motion:reduce){.dl-faq__sign{transition:none}}
      `}</style>

      <div className="dl-faq__eyebrow">
        <span className="dl-faq__dot" />
        {t.eyebrow}
      </div>
      <h1 className="dl-faq__title">{t.title}</h1>
      <p className="dl-faq__lede">{t.lede}</p>

      <div className="dl-faq__list">
        {t.items.map((it, i) => {
          const isOpen = open === i;
          return (
            <div className="dl-faq__item" key={i} data-open={isOpen}>
              <h2 style={{ margin: 0 }}>
                <button
                  className="dl-faq__q"
                  aria-expanded={isOpen}
                  aria-controls={`dl-faq-a-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  {it.q}
                  <span className="dl-faq__sign" aria-hidden="true">+</span>
                </button>
              </h2>
              {isOpen && (
                <p
                  id={`dl-faq-a-${i}`}
                  className={"dl-faq__a" + (it.flag ? " dl-faq__a--flag" : "")}
                >
                  {it.a}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="dl-faq__contact">
        <strong>{t.contactLead}</strong>
        <p>
          {t.contactBody}{" "}
          <a href="mailto:hello@drivelink.deals">hello@drivelink.deals</a>
        </p>
      </div>
    </div>
  );
}
