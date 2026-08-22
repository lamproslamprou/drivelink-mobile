import { useState } from "react";
import { useLang, LangToggle } from "./i18n.jsx";

// ── THE COUNTERPARTY PAGE ─────────────────────────────────────────────────────
// Not a marketing page. This is what one party sends the other when they say
// "let's use escrow" and get back "what's DriveLink, never heard of it".
//
// The reader is a stranger, on a phone, mid-negotiation, deciding whether to
// hand over a car or ten thousand dollars to a company they just learned exists.
// Every line answers a question they are already asking. There is deliberately
// no nav, no feature list and no pitch — a text message is the only way anyone
// arrives here, so the page opens by acknowledging that.
//
// Language comes from the app-wide context, same as every other view.

const COPY = {
  en: {
    eyebrow: "Someone sent you this link",
    h1: "Your money doesn't move until the car does.",
    lede:
      "Somebody you're doing a deal with wants to use DriveLink. Here's exactly what that means for you, in plain terms.",
    back: "← Back",
    trackTitle: "Where the money sits",
    steps: [
      {
        label: "Buyer pays into DriveLink",
        detail: "The money leaves the buyer's account and lands with us.",
        who: "Held by DriveLink",
      },
      {
        label: "We hold it",
        detail:
          "Neither of you can touch it. The seller can see it arrived. The buyer can't pull it back.",
        who: "Held by DriveLink",
      },
      {
        label: "You meet and hand over the car",
        detail: "Keys, signed title, plates. Same as any private sale.",
        who: "Held by DriveLink",
      },
      {
        label: "Buyer gives the seller a 6-digit code",
        detail:
          "The buyer received it when they paid. Handing it over is how they confirm they got the car.",
        who: "Held by DriveLink",
      },
      {
        label: "Seller enters the code, funds release",
        detail: "The money transfers to the seller's bank account.",
        who: "Paid to the seller",
      },
    ],
    qTitle: "The questions people actually ask",
    faqs: [
      {
        q: "Who has my money right now?",
        a: "DriveLink does, in an account separate from our operating funds. Payments are processed by Stripe, the same company that handles checkout for Amazon, Shopify and Instacart. We can't spend it, and neither party can withdraw it while the deal is open.",
      },
      {
        q: "When do I actually get paid?",
        a: "The moment you enter the buyer's 6-digit code. That's the release trigger. If the buyer disappears without giving you the code, funds release automatically 7 days after the handover date, so a buyer can't strand your money by ghosting you.",
      },
      {
        q: "What if the buyer pays and then wants their money back?",
        a: "Once you've entered the code and funds have released, the deal is closed on our side. Before that point, a buyer can only cancel if the car hasn't changed hands. Card and bank payments carry their own dispute rules, which is why we hold funds for a minimum period before release rather than paying out instantly.",
      },
      {
        q: "What if the car isn't what was described?",
        a: "The buyer inspects before handing over the code. That's the whole reason the code sits with the buyer. If something's wrong, they don't hand it over, and the deal doesn't complete.",
      },
      {
        q: "What does it cost?",
        a: "1% of the sale price, paid by whoever starts the deal. On a $10,000 car that's $100. There's no listing fee, no subscription, and no charge if the deal falls through.",
      },
      {
        q: "Do I have to sign up?",
        a: "You'll create an account so we can pay you and so there's a record of the deal. It takes about two minutes. Larger transactions require ID verification through Stripe, which protects both sides.",
      },
      {
        q: "Who are you?",
        a: "DriveLink LLC, a New Jersey company. We're an escrow layer for private car sales — not a dealer, not a broker. We don't own cars, don't take possession of them, and don't set prices. Our only job is holding the money until the handover is confirmed.",
      },
    ],
    ctaTitle: "Ready to continue the deal?",
    ctaBody:
      "Set it up here, or go back to the person who sent you this and tell them you're good to proceed.",
    ctaButton: "Start the deal",
    ctaNote: "Free to set up. The 1% is only charged when the deal goes through.",
  },
  es: {
    eyebrow: "Alguien te envió este enlace",
    h1: "Tu dinero no se mueve hasta que el auto se mueve.",
    lede:
      "Alguien con quien estás haciendo un trato quiere usar DriveLink. Esto es exactamente lo que significa para ti, en términos claros.",
    back: "← Volver",
    trackTitle: "Dónde está el dinero",
    steps: [
      {
        label: "El comprador paga a DriveLink",
        detail: "El dinero sale de la cuenta del comprador y llega a nosotros.",
        who: "En manos de DriveLink",
      },
      {
        label: "Nosotros lo retenemos",
        detail:
          "Ninguno de los dos puede tocarlo. El vendedor ve que llegó. El comprador no puede retirarlo.",
        who: "En manos de DriveLink",
      },
      {
        label: "Se reúnen y entregan el auto",
        detail: "Llaves, título firmado, placas. Igual que cualquier venta privada.",
        who: "En manos de DriveLink",
      },
      {
        label: "El comprador da al vendedor un código de 6 dígitos",
        detail:
          "El comprador lo recibió al pagar. Entregarlo es como confirma que recibió el auto.",
        who: "En manos de DriveLink",
      },
      {
        label: "El vendedor ingresa el código y se liberan los fondos",
        detail: "El dinero se transfiere a la cuenta bancaria del vendedor.",
        who: "Pagado al vendedor",
      },
    ],
    qTitle: "Las preguntas que la gente realmente hace",
    faqs: [
      {
        q: "¿Quién tiene mi dinero ahora mismo?",
        a: "DriveLink, en una cuenta separada de nuestros fondos operativos. Los pagos se procesan con Stripe, la misma empresa que maneja los pagos de Amazon, Shopify e Instacart. Nosotros no podemos gastarlo y ninguna de las partes puede retirarlo mientras el trato esté abierto.",
      },
      {
        q: "¿Cuándo me pagan realmente?",
        a: "En el momento en que ingresas el código de 6 dígitos del comprador. Ese es el disparador. Si el comprador desaparece sin darte el código, los fondos se liberan automáticamente 7 días después de la fecha de entrega, para que nadie pueda dejar tu dinero atrapado ignorándote.",
      },
      {
        q: "¿Y si el comprador paga y luego quiere su dinero de vuelta?",
        a: "Una vez que ingresas el código y los fondos se liberan, el trato queda cerrado de nuestro lado. Antes de eso, el comprador solo puede cancelar si el auto no ha cambiado de manos. Los pagos con tarjeta y banco tienen sus propias reglas de disputa, por eso retenemos los fondos un período mínimo antes de liberarlos en vez de pagar al instante.",
      },
      {
        q: "¿Y si el auto no es como lo describieron?",
        a: "El comprador inspecciona antes de entregar el código. Ese es el propósito de que el código esté en manos del comprador. Si algo está mal, no lo entrega y el trato no se completa.",
      },
      {
        q: "¿Cuánto cuesta?",
        a: "1% del precio de venta, pagado por quien inicia el trato. En un auto de $10,000 son $100. No hay cuota de publicación, ni suscripción, ni cargo si el trato no se concreta.",
      },
      {
        q: "¿Tengo que registrarme?",
        a: "Crearás una cuenta para que podamos pagarte y para que haya registro del trato. Toma unos dos minutos. Las transacciones grandes requieren verificación de identidad con Stripe, lo que protege a ambas partes.",
      },
      {
        q: "¿Quiénes son ustedes?",
        a: "DriveLink LLC, una empresa de Nueva Jersey. Somos una capa de custodia para ventas privadas de autos — no un concesionario ni un intermediario. No somos dueños de los autos, no tomamos posesión de ellos y no fijamos precios. Nuestro único trabajo es retener el dinero hasta que se confirme la entrega.",
      },
    ],
    ctaTitle: "¿Listo para continuar el trato?",
    ctaBody:
      "Configúralo aquí, o vuelve con la persona que te envió esto y dile que puedes proceder.",
    ctaButton: "Iniciar el trato",
    ctaNote: "Configurarlo es gratis. El 1% solo se cobra cuando el trato se concreta.",
  },
};

const CSS = `
.dl-ee{--ink:#0A1B33;--mute:#5B6B85;--line:#DFE5EE;--green:#0F7A4E;--green-bg:#E8F5EF;
  max-width:720px;margin:0 auto;padding:0 20px 80px;color:var(--ink);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;
  padding-top:env(safe-area-inset-top);}
.dl-ee-top{display:flex;justify-content:space-between;align-items:center;padding:18px 0 0;gap:12px;}
.dl-ee-back{background:none;border:0;padding:6px 0;font-size:15px;color:var(--mute);
  cursor:pointer;font-family:inherit;}
.dl-ee-back:hover{color:var(--ink);}
.dl-ee-eyebrow{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:var(--mute);
  font-weight:600;margin:40px 0 16px;}
.dl-ee h1{font-size:38px;line-height:1.12;letter-spacing:-1.2px;font-weight:800;margin:0 0 20px;}
.dl-ee-lede{font-size:18px;color:var(--mute);margin:0;max-width:560px;}
.dl-ee h2{font-size:14px;letter-spacing:1.6px;text-transform:uppercase;color:var(--mute);
  font-weight:700;margin:56px 0 24px;}
.dl-ee-track{border-left:2px solid var(--line);padding:0;margin:0;list-style:none;}
.dl-ee-step{position:relative;padding:0 0 28px 26px;}
.dl-ee-step:last-child{padding-bottom:0;}
.dl-ee-dot{position:absolute;left:-9px;top:4px;width:16px;height:16px;border-radius:50%;
  background:#fff;border:2px solid var(--line);}
.dl-ee-step.is-final .dl-ee-dot{border-color:var(--green);background:var(--green);}
.dl-ee-label{font-size:17px;font-weight:700;margin:0 0 4px;letter-spacing:-.2px;}
.dl-ee-detail{font-size:15px;color:var(--mute);margin:0 0 8px;}
.dl-ee-who{display:inline-block;font-size:12px;font-weight:600;letter-spacing:.3px;
  padding:4px 10px;border-radius:5px;background:#F1F4F9;color:var(--mute);}
.dl-ee-step.is-final .dl-ee-who{background:var(--green-bg);color:var(--green);}
.dl-ee-faq{border-top:1px solid var(--line);}
.dl-ee-faq-item{border-bottom:1px solid var(--line);}
.dl-ee-q{width:100%;text-align:left;background:none;border:0;padding:20px 32px 20px 0;
  font-size:17px;font-weight:600;color:var(--ink);cursor:pointer;position:relative;
  font-family:inherit;letter-spacing:-.2px;line-height:1.4;}
.dl-ee-q:hover{color:#12294C;}
.dl-ee-q::after{content:"+";position:absolute;right:4px;top:19px;font-size:22px;
  font-weight:400;color:var(--mute);}
.dl-ee-q[aria-expanded="true"]::after{content:"\\2013";}
.dl-ee-a{font-size:16px;color:var(--mute);padding:0 8px 22px 0;margin:0;max-width:620px;}
.dl-ee-cta{margin-top:64px;padding:32px;background:#0A1B33;border-radius:16px;color:#fff;}
.dl-ee-cta h3{font-size:24px;font-weight:800;letter-spacing:-.6px;margin:0 0 10px;}
.dl-ee-cta p{font-size:16px;color:#B9C9E0;margin:0 0 24px;}
.dl-ee-btn{background:#3DD68C;color:#062012;font-weight:700;font-size:17px;border:0;
  padding:15px 30px;border-radius:10px;cursor:pointer;font-family:inherit;}
.dl-ee-btn:hover{background:#35c17e;}
.dl-ee-note{font-size:13px;color:#7C93B8;margin:14px 0 0;}
@media (max-width:560px){
  .dl-ee h1{font-size:30px;}
  .dl-ee-lede{font-size:17px;}
  .dl-ee-cta{padding:26px 22px;}
}
`;

export default function EscrowExplained({ onBack, onStart }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(0);
  const t = COPY[lang === "es" ? "es" : "en"];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="dl-ee">
      <style>{CSS}</style>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <div className="dl-ee-top">
        {onBack ? (
          <button className="dl-ee-back" onClick={onBack}>
            {t.back}
          </button>
        ) : (
          <span />
        )}
        <LangToggle />
      </div>

      <p className="dl-ee-eyebrow">{t.eyebrow}</p>
      <h1>{t.h1}</h1>
      <p className="dl-ee-lede">{t.lede}</p>

      <h2>{t.trackTitle}</h2>
      <ol className="dl-ee-track">
        {t.steps.map((s, i) => (
          <li
            key={i}
            className={`dl-ee-step${i === t.steps.length - 1 ? " is-final" : ""}`}
          >
            <span className="dl-ee-dot" />
            <p className="dl-ee-label">{s.label}</p>
            <p className="dl-ee-detail">{s.detail}</p>
            <span className="dl-ee-who">{s.who}</span>
          </li>
        ))}
      </ol>

      <h2>{t.qTitle}</h2>
      <div className="dl-ee-faq">
        {t.faqs.map((f, i) => (
          <div className="dl-ee-faq-item" key={i}>
            <button
              className="dl-ee-q"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? -1 : i)}
            >
              {f.q}
            </button>
            {open === i && <p className="dl-ee-a">{f.a}</p>}
          </div>
        ))}
      </div>

      <div className="dl-ee-cta">
        <h3>{t.ctaTitle}</h3>
        <p>{t.ctaBody}</p>
        <button className="dl-ee-btn" onClick={onStart}>
          {t.ctaButton}
        </button>
        <p className="dl-ee-note">{t.ctaNote}</p>
      </div>
    </div>
  );
}
