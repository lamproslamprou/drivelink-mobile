import { useLang } from "../i18n.jsx";
import GuideLayout from "./GuideLayout.jsx";

// Route: /guides/lien-payoff-ny
// NY's distinguishing fact is that the lienholder is printed on the front of
// the title and the DMV warns in plain language that a buyer who accepts it
// without a release may become responsible for the lien and have the car
// repossessed. That is the sharpest version of the risk in any of these three
// states, so it leads.
//
// Second NY-specific lever: VTL §2121 plus DFS guidance obliges regulated
// lenders to release a lien within three business days of payment clearing.
// That's a deadline a buyer can actually cite.
//
// Fixed 2026-08-28: this content was hardcoded English JSX passed straight to
// GuideLayout, so the site-wide language toggle silently did nothing on this
// page. Restructured to the COPY = {en, es} pattern already used by
// EscrowExplained.jsx — GuideLayout now renders whichever language's object
// is selected below.

const ABOUT = "Vehicle lien payoff in a New York private car sale";

const COPY = {
  en: {
    eyebrow: "New York · Private sale guide",
    h1: "Buying a car in NY when the seller still owes money",
    lede:
      "New York prints the lienholder on the front of the title, which means you can see the problem before you pay. It also means the DMV's own warning is unusually blunt: take the title without a release, and the car can be repossessed out from under you.",
    tldr: [
      "Check the front of the title for lienholder names before you hand over anything.",
      "If a lienholder is listed, get the original lien release before completing the purchase — not a copy, and not a promise.",
      "Without it you may become responsible for the lien, and the lender can repossess the car you just paid for.",
      "New York law requires regulated lenders to release a satisfied lien quickly, which gives you a deadline to hold people to.",
    ],
    sections: [
      {
        h: "You can see the lien. Look.",
        p: [
          "New York's title certificate lists lienholder names and addresses on the front. Unlike states where the document is held by the lender and the buyer never sees it, here the information is usually right in front of you before money moves. The DMV's advice is to check that front panel on any title before you accept it.",
          "If a lienholder is listed, the DMV is direct about what to ask for: original proof that the lien has been released, which normally means an official release from the lender. The word original matters. A photocopy, a screenshot, or a text message saying it's handled is not the document.",
          "The consequence of skipping this is stated just as plainly. Accept a title with a listed lienholder and no release, and you may become responsible for that lien — with the lender able to repossess the vehicle for non-payment on a loan that was never yours.",
        ],
      },
      {
        h: "What the release actually looks like",
        p: [
          "There are two accepted forms. The lienholder can provide a Notice of Recorded Lien, form MV-901, showing the loan satisfied. Or they can supply a letter — on the lender's official letterhead, signed by an officer of the company, containing the vehicle information, and notarized if the signer isn't a loan officer.",
          "Getting a clean title certificate with the lien removed is a separate, slower step. It's done by mail rather than at a DMV office: the original title, the release document, and a fee go to the DMV's title services in Albany, and the replacement title comes back weeks to a couple of months later.",
          "That timeline is worth planning around. The release document is what protects you at the moment of sale; the reissued clean title is administrative cleanup that happens afterward. Don't confuse the two, and don't wait on the second before completing a properly released transfer.",
        ],
      },
      {
        h: "The three-day rule you can hold people to",
        p: [
          "New York doesn't leave lien release timing to the lender's convenience. Section 2121 of the Vehicle and Traffic Law requires prompt release once a loan is satisfied, and the Department of Financial Services has directed regulated institutions financing vehicle sales to release liens no later than three business days after payment clears.",
          "That guidance exists because lenders were routinely taking weeks, and it gives you something concrete to say on the phone. A lender telling a seller the release will take six weeks is not describing what New York requires of them.",
          "New York also runs an Electronic Lien Transfer program, which posts liens and releases electronically and is materially faster than paper. It's worth asking the seller whether their lender participates.",
        ],
      },
      {
        h: "How to run it properly",
        style: "steps",
        p: [
          "Look at the front of the title before you agree to anything. If a lienholder is named, you now know the shape of the deal.",
          "Ask the seller for a payoff quote from that lender — a written figure valid through a stated date, which includes interest and is not the same as the balance shown in their app.",
          "Compare payoff to sale price. If the seller owes more than the car is selling for, they have to cover the difference in cash before any of this works.",
          "Pay the lender directly for the payoff amount rather than paying the seller and trusting the rest. The seller receives only what remains once the lender is satisfied.",
          "Collect the original lien release — MV-901 or a compliant letter — before you take the car or hand over the balance. If the lender drags, the three-business-day expectation is the thing to raise.",
          "Complete the sales tax paperwork. Both parties fill out the DTF-802 statement of transaction, which is how the purchase price is documented for tax at the DMV.",
        ],
      },
      {
        h: "When to walk",
        style: "flags",
        p: [
          "There's a lienholder on the front of the title and the seller has no release, only reassurance.",
          "You're offered a copy of a release rather than the original document.",
          "The seller wants payment in full now and will get the release later.",
          "The payoff exceeds the sale price with no explanation of who covers the gap.",
          "Anything on the title is altered, crossed out, written over, or erased — the DMV won't accept it, and neither should you.",
          "The person selling the car isn't the person named on the front of the title.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I buy a car in New York if the title shows a lien?",
        a: "Yes, provided the lien is paid off and you receive the original release before you complete the purchase. What you must not do is accept the title on the promise that a release is coming.",
      },
      {
        q: "What happens if I pay and the lien is never released?",
        a: "The DMV's own warning is that you may become responsible for the lien and the vehicle could be repossessed for non-payment. Your recourse is a civil claim against the seller, which is a much worse position than simply not paying until the release exists.",
      },
      {
        q: "Is a photocopy of the lien release enough?",
        a: "No. New York wants the original document. Keep a copy for yourself, but the original is what goes to the DMV and what protects you.",
      },
      {
        q: "How fast should the lender release the lien?",
        a: "New York requires prompt release once payment clears, and state guidance to regulated lenders sets an expectation of no more than three business days. Lenders in the electronic transfer program are typically faster still.",
      },
      {
        q: "How long until I get a title with no lien on it?",
        a: "That's a separate mail-in process to the DMV in Albany and takes considerably longer — plan on weeks to a couple of months. The release document is what matters at the point of sale.",
      },
      {
        q: "What paperwork do I need for sales tax?",
        a: "The DTF-802 statement of transaction, completed by both the seller and the buyer, is the usual proof of purchase price. You'll pay the tax when you title and register the vehicle.",
      },
    ],
    cta: {
      title: "The safe way to sequence this",
      body: "DriveLink holds the buyer's money until the car and title have actually changed hands. In New York that means you're not choosing between paying on trust and losing the deal — funds sit secured while the release is produced, and the seller can see they're real.",
      button: "See how it works",
    },
    related: [
      { view: "lienPayoffNJ", label: "Buying a car with a lien in New Jersey" },
      { view: "lienPayoffPA", label: "Buying a car with a lien in Pennsylvania" },
    ],
    disclaimer:
      "This is general information about how lien payoffs work in New York private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with the NY DMV, and talk to a lawyer if real money is at stake.",
  },
  es: {
    eyebrow: "Nueva York · Guía de venta privada",
    h1: "Comprar un auto en Nueva York cuando el vendedor todavía debe dinero",
    lede:
      "Nueva York imprime el nombre del acreedor del gravamen al frente del título, lo que significa que puedes ver el problema antes de pagar. También significa que la advertencia del propio DMV es inusualmente directa: acepta el título sin una liberación, y te pueden quitar el auto por embargo.",
    tldr: [
      "Revisa el frente del título para ver si aparece el nombre de algún acreedor de gravamen antes de entregar nada.",
      "Si aparece un acreedor, consigue la liberación original del gravamen antes de completar la compra — no una copia, y no una promesa.",
      "Sin ella, tú podrías volverte responsable del gravamen, y el prestamista puede embargar el auto que acabas de pagar.",
      "La ley de Nueva York exige que los prestamistas regulados liberen un gravamen ya pagado rápidamente, lo que te da un plazo concreto al cual puedes exigir que se ciñan.",
    ],
    sections: [
      {
        h: "Puedes ver el gravamen. Míralo.",
        p: [
          "El certificado de título de Nueva York enumera los nombres y direcciones de los acreedores del gravamen en el frente. A diferencia de otros estados donde el documento lo tiene el prestamista y el comprador nunca lo ve, aquí normalmente tienes la información justo frente a ti antes de que se mueva el dinero. El consejo del DMV es revisar ese panel frontal en cualquier título antes de aceptarlo.",
          "Si aparece un acreedor, el DMV es directo sobre qué pedir: prueba original de que el gravamen se liberó, lo que normalmente significa una liberación oficial del prestamista. La palabra original importa. Una fotocopia, una captura de pantalla o un mensaje de texto diciendo que ya está resuelto no es el documento.",
          "La consecuencia de saltarse esto se explica con la misma claridad. Si aceptas un título con un acreedor listado y sin liberación, tú podrías volverte responsable de ese gravamen — y el prestamista puede embargar el vehículo por falta de pago de un préstamo que nunca fue tuyo.",
        ],
      },
      {
        h: "Cómo es realmente la liberación",
        p: [
          "Hay dos formas aceptadas. El acreedor puede entregar un Notice of Recorded Lien, formulario MV-901, que muestra el préstamo saldado. O puede entregar una carta — en el membrete oficial del prestamista, firmada por un funcionario de la empresa, con la información del vehículo, y notariada si quien firma no es un oficial de préstamos.",
          "Conseguir un certificado de título limpio, sin el gravamen, es un paso separado y más lento. Se hace por correo en vez de en una oficina del DMV: el título original, el documento de liberación y una cuota se envían al departamento de títulos del DMV en Albany, y el título de reemplazo llega semanas o hasta un par de meses después.",
          "Vale la pena planear en torno a ese plazo. El documento de liberación es lo que te protege en el momento de la venta; el título limpio reemitido es limpieza administrativa que ocurre después. No confundas los dos, y no esperes al segundo para completar una transferencia debidamente liberada.",
        ],
      },
      {
        h: "La regla de tres días que puedes exigir",
        p: [
          "Nueva York no deja el momento de la liberación del gravamen a la conveniencia del prestamista. La Sección 2121 de la Ley de Vehículos y Tránsito exige una liberación pronta una vez que el préstamo está saldado, y el Departamento de Servicios Financieros ha instruido a las instituciones reguladas que financian ventas de vehículos a liberar los gravámenes a más tardar tres días hábiles después de que se confirme el pago.",
          "Esa directriz existe porque los prestamistas solían tardarse semanas de forma rutinaria, y te da algo concreto que decir por teléfono. Un prestamista que le dice al vendedor que la liberación tardará seis semanas no está describiendo lo que Nueva York les exige.",
          "Nueva York también tiene un programa de Transferencia Electrónica de Gravámenes, que registra gravámenes y liberaciones de forma electrónica y es considerablemente más rápido que el papel. Vale la pena preguntarle al vendedor si su prestamista participa.",
        ],
      },
      {
        h: "Cómo hacerlo correctamente",
        style: "steps",
        p: [
          "Revisa el frente del título antes de acordar nada. Si aparece un acreedor, ya sabes qué forma tiene el trato.",
          "Pídele al vendedor una cotización de liquidación de ese prestamista — una cifra por escrito válida hasta una fecha indicada, que incluye intereses y no es lo mismo que el saldo que aparece en su aplicación.",
          "Compara la liquidación con el precio de venta. Si el vendedor debe más de lo que se está vendiendo el auto, tiene que cubrir la diferencia en efectivo antes de que nada de esto funcione.",
          "Págale directamente al prestamista el monto de la liquidación en vez de pagarle al vendedor y confiar en el resto. El vendedor recibe solo lo que queda una vez que el prestamista está satisfecho.",
          "Consigue la liberación original del gravamen — el MV-901 o una carta que cumpla los requisitos — antes de llevarte el auto o entregar el saldo. Si el prestamista se demora, el plazo de tres días hábiles es lo que debes hacer valer.",
          "Completa el papeleo del impuesto de venta. Ambas partes llenan el formulario DTF-802, la declaración de la transacción, que es como se documenta el precio de compra para efectos fiscales en el DMV.",
        ],
      },
      {
        h: "Cuándo alejarse del trato",
        style: "flags",
        p: [
          "Hay un acreedor en el frente del título y el vendedor no tiene liberación, solo promesas.",
          "Te ofrecen una copia de la liberación en vez del documento original.",
          "El vendedor quiere el pago completo ahora y conseguirá la liberación después.",
          "La liquidación supera el precio de venta sin explicación de quién cubre la diferencia.",
          "Cualquier cosa en el título está alterada, tachada, sobrescrita o borrada — el DMV no lo va a aceptar, y tú tampoco deberías.",
          "La persona que te vende el auto no es la persona que aparece al frente del título.",
        ],
      },
    ],
    faqs: [
      {
        q: "¿Puedo comprar un auto en Nueva York si el título muestra un gravamen?",
        a: "Sí, siempre que el gravamen esté pagado y recibas la liberación original antes de completar la compra. Lo que no debes hacer es aceptar el título con la promesa de que la liberación va a llegar.",
      },
      {
        q: "¿Qué pasa si pago y el gravamen nunca se libera?",
        a: "La propia advertencia del DMV es que tú podrías volverte responsable del gravamen y el vehículo podría ser embargado por falta de pago. Tu único recurso sería un reclamo civil contra el vendedor, una posición mucho peor que simplemente no pagar hasta que exista la liberación.",
      },
      {
        q: "¿Basta con una fotocopia de la liberación del gravamen?",
        a: "No. Nueva York quiere el documento original. Guarda una copia para ti, pero el original es lo que va al DMV y lo que te protege.",
      },
      {
        q: "¿Qué tan rápido debe liberar el gravamen el prestamista?",
        a: "Nueva York exige una liberación pronta una vez que se confirma el pago, y la directriz estatal para prestamistas regulados establece una expectativa de no más de tres días hábiles. Los prestamistas dentro del programa de transferencia electrónica suelen ser todavía más rápidos.",
      },
      {
        q: "¿Cuánto tardo en obtener un título sin el gravamen?",
        a: "Ese es un trámite por correo aparte hacia el DMV en Albany y toma considerablemente más tiempo — calcula desde semanas hasta un par de meses. El documento de liberación es lo que importa en el momento de la venta.",
      },
      {
        q: "¿Qué papeleo necesito para el impuesto de venta?",
        a: "El formulario DTF-802, la declaración de la transacción, llenado por el vendedor y el comprador, es la prueba habitual del precio de compra. Pagarás el impuesto cuando titules y registres el vehículo.",
      },
    ],
    cta: {
      title: "La forma segura de ordenar esto",
      body: "DriveLink retiene el dinero del comprador hasta que el auto y el título realmente cambian de manos. En Nueva York eso significa que no tienes que elegir entre pagar confiando ciegamente o perder el trato — los fondos quedan resguardados mientras se produce la liberación, y el vendedor puede ver que son reales.",
      button: "Ver cómo funciona",
    },
    related: [
      { view: "lienPayoffNJ", label: "Comprar un auto con gravamen en Nueva Jersey" },
      { view: "lienPayoffPA", label: "Comprar un auto con gravamen en Pensilvania" },
    ],
    disclaimer:
      "Esta es información general sobre cómo funcionan las liquidaciones de gravámenes en ventas privadas en Nueva York, no es asesoría legal. Los requisitos cambian y cada situación es distinta. Confirma los requisitos vigentes con el DMV de Nueva York, y consulta a un abogado si hay dinero de por medio.",
  },
};

export default function LienPayoffNY({ onBack, onStart, onNavigate }) {
  const { lang } = useLang();
  const t = COPY[lang === "es" ? "es" : "en"];
  return (
    <GuideLayout
      onBack={onBack}
      onStart={onStart}
      onNavigate={onNavigate}
      about={ABOUT}
      {...t}
    />
  );
}
