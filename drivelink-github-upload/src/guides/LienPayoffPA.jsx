import { useLang } from "../i18n.jsx";
import GuideLayout from "./GuideLayout.jsx";

// Route: /guides/lien-payoff-pa
// PA's distinguishing fact is the notarized title assignment under 75 Pa.C.S.
// §1111 — both parties in one room, in front of an agent, at one moment. That
// single appointment is where the lien problem either resolves or detonates,
// so the whole page is organised around it.
//
// Fixed 2026-08-28: this content was hardcoded English JSX passed straight to
// GuideLayout, so the site-wide language toggle silently did nothing on this
// page. Restructured to the COPY = {en, es} pattern already used by
// EscrowExplained.jsx — GuideLayout now renders whichever language's object
// is selected below.

const ABOUT = "Vehicle lien payoff in a Pennsylvania private car sale";

const COPY = {
  en: {
    eyebrow: "Pennsylvania · Private sale guide",
    h1: "Buying a car in PA when the seller still owes money",
    lede:
      "Pennsylvania puts the whole transaction into a single appointment in front of a notary. That makes the paperwork cleaner than most states — and it makes an unresolved lien much harder to paper over, because you'll be sitting there when it surfaces.",
    tldr: [
      "Pennsylvania requires the title assignment to be signed in front of a notary or authorized PennDOT agent. Both parties, same place, same time.",
      "A lender holding the title means there is nothing to notarize. The appointment cannot happen until the lien is released.",
      "The lien has to be paid off and released as part of the transaction, not after it.",
      "Pay the lender directly. The seller receives only what's left once the payoff clears.",
    ],
    sections: [
      {
        h: "Why Pennsylvania is different",
        p: [
          "In most states a private sale means the seller signs the back of the title and hands it over. Pennsylvania doesn't work that way. Under 75 Pa.C.S. §1111 the seller's signature on the title assignment must be sworn before a notary public or an authorized PennDOT agent, and the transfer is only complete once the required sections are signed and notarized. If more than one owner is named on the title, all of them have to sign.",
          "In practice that means you and the seller go together to a notary, tag service, or authorized agent, with the original title — not a copy — and photo ID for both of you. If there was a lien, the lien release paperwork comes to that appointment too.",
          "This is genuinely good for a buyer. It puts an identity-checking third party between you and a fraudulent transfer, and it forces the title question to be answered in the room rather than promised for later. What it doesn't do is protect your money, because nothing about the notary process holds funds.",
        ],
      },
      {
        h: "Where the lien breaks the process",
        p: [
          "While a loan is active, the lender holds the title. There is no document for the notary to notarize, so the appointment simply cannot happen. This is the point most people discover the lien matters — after they've agreed a price and often after money has moved.",
          "If the lender participates in Pennsylvania's electronic lien and title program, the title exists electronically rather than on paper. In that case the seller usually needs to request conversion to a paper title before a private sale can be completed, and that request takes time. Ask early.",
          "The sequence that fails is the familiar one: buyer pays the seller, seller promises to clear the loan, and the notary appointment gets scheduled for 'once the title arrives.' Sometimes it arrives. When it doesn't, the buyer has paid in full for a car they cannot legally have transferred to them.",
        ],
      },
      {
        h: "How to run it properly",
        style: "steps",
        p: [
          "Ask for a payoff quote from the lender before agreeing to anything. It's a written figure valid through a specific date, and it's more than the loan balance because it includes interest to that date.",
          "Establish whether the payoff is above or below the sale price. If the seller owes more than the car is selling for, they need to bring cash to close the gap. That's their problem, and it needs solving before you go any further.",
          "Ask whether the title is paper or electronic. If it's electronic, the seller starts the conversion now, because that timeline sits on the critical path to your notary appointment.",
          "Pay the lender directly rather than paying the seller and hoping. Call the lender with the seller present, confirm their third-party payoff process, and send the payoff amount to them. The seller receives the remainder.",
          "Wait for the lien release and the physical title, then book the notary appointment. Go together, bring the original title, the release paperwork, and photo ID for both parties. Everything is signed in front of the agent at once.",
        ],
      },
      {
        h: "The rest of the Pennsylvania paperwork",
        p: [
          "The buyer pays a title fee and 6% Pennsylvania sales tax on the purchase price, or 7% in Allegheny County, handled through the agent at transfer. Form MV-4ST is the sales-and-use-tax return that goes with the title transfer.",
          "Pennsylvania plates stay with the seller rather than the car, so they come off before you drive away. The buyer needs to apply for title within the window PennDOT allows after purchase, so don't let a title delay quietly run past it.",
          "PennDOT doesn't require a bill of sale to process the transfer, but write one anyway. It records the price, the odometer reading, the VIN and the date, and it's the only thing you'll have if the sale is ever disputed.",
          "Pennsylvania requires annual safety and, in many counties, emissions inspection for registered vehicles. Neither is required to complete a private sale, but the buyer will need a valid inspection shortly after, so a car with an expired sticker is a cost you should be pricing in.",
        ],
      },
      {
        h: "When to walk",
        style: "flags",
        p: [
          "The seller won't get a payoff quote from their lender.",
          "The seller wants to be paid in full before the lien is released, with the notary appointment scheduled for later.",
          "The seller resists going to the notary together, or suggests signing separately and sorting it out afterward.",
          "The payoff is higher than the sale price and there's no answer about who covers the shortfall.",
          "The name on the title doesn't match the ID of the person selling you the car.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do both the buyer and seller really have to be at the notary?",
        a: "The seller's signature on the title assignment has to be witnessed and notarized by an authorized agent, and in practice buyer and seller attend together so the whole transfer is completed in one visit. Separate notarized power of attorney forms are the workaround when someone genuinely can't attend, but going together is simpler and safer.",
      },
      {
        q: "Can the notary appointment happen before the lien is released?",
        a: "No, because the lender has the title and there is nothing to sign. Getting the lien released is the thing that unblocks the appointment, not the other way around.",
      },
      {
        q: "What if the lender has an electronic title?",
        a: "Ask the seller to request conversion to a paper title before you plan the sale. It's a normal request but it takes time, and discovering it on the day you meant to close is how deals fall apart.",
      },
      {
        q: "Who pays the sales tax?",
        a: "The buyer, at 6% of the purchase price, or 7% in Allegheny County. It's paid through the authorized agent as part of the transfer rather than collected by the seller.",
      },
      {
        q: "Do I get the plates with the car?",
        a: "No. Pennsylvania plates belong to the seller and come off before you drive away. Plan how the car gets home before you close.",
      },
      {
        q: "How long does the lien release take?",
        a: "Anywhere from a few days to several weeks depending on the lender. Agree with the seller in advance what happens to the money and the car during that window, and don't let it be 'you take the car and we'll finish the paperwork later.'",
      },
    ],
    cta: {
      title: "The safe way to sequence this",
      body: "DriveLink holds the buyer's money until the car and title have actually changed hands. In Pennsylvania that means funds sit secured while the lien clears and the notary appointment gets booked — the seller can see the money is real, and you're not paying anyone on a promise.",
      button: "See how it works",
    },
    related: [
      { view: "lienPayoffNJ", label: "Buying a car with a lien in New Jersey" },
      { view: "lienPayoffNY", label: "Buying a car with a lien in New York" },
    ],
    disclaimer:
      "This is general information about how lien payoffs work in Pennsylvania private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with PennDOT, and talk to a lawyer if real money is at stake.",
  },
  es: {
    eyebrow: "Pensilvania · Guía de venta privada",
    h1: "Comprar un auto en Pensilvania cuando el vendedor todavía debe dinero",
    lede:
      "Pensilvania reúne toda la transacción en una sola cita frente a un notario. Eso hace que el papeleo sea más ordenado que en la mayoría de los estados — y hace que un gravamen sin resolver sea mucho más difícil de disimular, porque tú vas a estar ahí sentado cuando salga a la luz.",
    tldr: [
      "Pensilvania exige que la cesión del título se firme frente a un notario o un agente autorizado de PennDOT. Ambas partes, mismo lugar, mismo momento.",
      "Si el prestamista tiene el título, no hay nada que notariar. La cita no puede ocurrir hasta que se libere el gravamen.",
      "El gravamen tiene que pagarse y liberarse como parte de la transacción, no después de ella.",
      "Págale directamente al prestamista. El vendedor recibe solo lo que sobra una vez que se liquida el pago.",
    ],
    sections: [
      {
        h: "Por qué Pensilvania es diferente",
        p: [
          "En la mayoría de los estados, una venta privada significa que el vendedor firma al reverso del título y lo entrega. Pensilvania no funciona así. Según 75 Pa.C.S. §1111, la firma del vendedor en la cesión del título debe hacerse bajo juramento ante un notario público o un agente autorizado de PennDOT, y la transferencia solo se completa una vez que las secciones requeridas están firmadas y notariadas. Si el título tiene más de un dueño, todos tienen que firmar.",
          "En la práctica, eso significa que tú y el vendedor van juntos a un notario, un servicio de placas o un agente autorizado, con el título original — no una copia — e identificación con foto para ambos. Si había un gravamen, el papeleo de liberación del gravamen también se lleva a esa cita.",
          "Esto realmente juega a favor del comprador. Pone a un tercero que verifica identidad entre tú y una transferencia fraudulenta, y obliga a resolver la cuestión del título ahí mismo, en vez de dejarla como una promesa para después. Lo que no hace es proteger tu dinero, porque el proceso del notario no retiene fondos de ninguna forma.",
        ],
      },
      {
        h: "Dónde el gravamen rompe el proceso",
        p: [
          "Mientras el préstamo está activo, el prestamista tiene el título. No hay ningún documento para que el notario notarice, así que la cita simplemente no puede ocurrir. Este es el punto donde la mayoría de la gente descubre que el gravamen importa — después de haber acordado un precio y muchas veces después de que el dinero ya se movió.",
          "Si el prestamista participa en el programa electrónico de gravámenes y títulos de Pensilvania, el título existe de forma electrónica en vez de en papel. En ese caso, el vendedor normalmente tiene que solicitar la conversión a un título en papel antes de que se pueda completar una venta privada, y esa solicitud toma tiempo. Pregunta con anticipación.",
          "La secuencia que falla es la de siempre: el comprador le paga al vendedor, el vendedor promete saldar el préstamo, y la cita con el notario se agenda para 'cuando llegue el título.' A veces llega. Cuando no llega, el comprador ya pagó el precio completo por un auto que legalmente no le pueden transferir.",
        ],
      },
      {
        h: "Cómo hacerlo correctamente",
        style: "steps",
        p: [
          "Pide una cotización de liquidación al prestamista antes de acordar nada. Es una cifra por escrito, válida hasta una fecha específica, y es más que el saldo del préstamo porque incluye los intereses hasta esa fecha.",
          "Determina si la liquidación es mayor o menor que el precio de venta. Si el vendedor debe más de lo que se está vendiendo el auto, necesita aportar efectivo para cubrir la diferencia. Ese es su problema, y hay que resolverlo antes de avanzar.",
          "Pregunta si el título es en papel o electrónico. Si es electrónico, el vendedor debe iniciar la conversión ahora mismo, porque ese plazo está en la ruta crítica hacia tu cita con el notario.",
          "Págale directamente al prestamista en vez de pagarle al vendedor y confiar en que todo salga bien. Llama al prestamista con el vendedor presente, confirma su proceso para pagos de terceros, y envíale el monto de la liquidación. El vendedor recibe el resto.",
          "Espera a que llegue la liberación del gravamen y el título físico, y luego agenda la cita con el notario. Vayan juntos, lleven el título original, el papeleo de liberación, e identificación con foto para ambas partes. Todo se firma frente al agente al mismo tiempo.",
        ],
      },
      {
        h: "El resto del papeleo de Pensilvania",
        p: [
          "El comprador paga una cuota por el título y un impuesto de venta del 6% de Pensilvania sobre el precio de compra, o del 7% en el condado de Allegheny, que se maneja a través del agente al momento de la transferencia. El formulario MV-4ST es la declaración de impuesto de venta y uso que acompaña la transferencia del título.",
          "Las placas de Pensilvania se quedan con el vendedor, no con el auto, así que hay que quitarlas antes de irte manejando. El comprador tiene que solicitar el título dentro del plazo que permite PennDOT después de la compra, así que no dejes que un retraso con el título se pase de esa fecha sin darte cuenta.",
          "PennDOT no exige un contrato de compraventa para procesar la transferencia, pero redacta uno de todas formas. Registra el precio, la lectura del odómetro, el VIN y la fecha, y es lo único que tendrás si alguna vez se disputa la venta.",
          "Pensilvania exige una inspección de seguridad anual y, en muchos condados, una inspección de emisiones para los vehículos registrados. Ninguna de las dos se necesita para completar una venta privada, pero el comprador va a necesitar una inspección vigente poco después, así que un auto con la calcomanía vencida es un costo que debes tomar en cuenta al calcular el precio.",
        ],
      },
      {
        h: "Cuándo alejarse del trato",
        style: "flags",
        p: [
          "El vendedor no consigue una cotización de liquidación de su prestamista.",
          "El vendedor quiere que le paguen el total antes de que se libere el gravamen, con la cita del notario agendada para después.",
          "El vendedor se resiste a ir juntos al notario, o sugiere firmar por separado y arreglarlo después.",
          "La liquidación es mayor que el precio de venta y no hay respuesta sobre quién cubre la diferencia.",
          "El nombre en el título no coincide con la identificación de la persona que te está vendiendo el auto.",
        ],
      },
    ],
    faqs: [
      {
        q: "¿De verdad tienen que estar el comprador y el vendedor en la notaría?",
        a: "La firma del vendedor en la cesión del título debe ser presenciada y notariada por un agente autorizado, y en la práctica el comprador y el vendedor asisten juntos para completar toda la transferencia en una sola visita. Los poderes notariales por separado son la solución cuando alguien realmente no puede asistir, pero ir juntos es más simple y más seguro.",
      },
      {
        q: "¿Puede la cita con el notario ocurrir antes de que se libere el gravamen?",
        a: "No, porque el prestamista tiene el título y no hay nada que firmar. Conseguir que se libere el gravamen es lo que habilita la cita, no al revés.",
      },
      {
        q: "¿Qué pasa si el prestamista tiene un título electrónico?",
        a: "Pídele al vendedor que solicite la conversión a un título en papel antes de planear la venta. Es una solicitud normal pero toma tiempo, y descubrirlo el mismo día en que pensabas cerrar el trato es justo cómo se caen los tratos.",
      },
      {
        q: "¿Quién paga el impuesto de venta?",
        a: "El comprador, al 6% del precio de compra, o al 7% en el condado de Allegheny. Se paga a través del agente autorizado como parte de la transferencia, no lo cobra el vendedor.",
      },
      {
        q: "¿Las placas vienen con el auto?",
        a: "No. Las placas de Pensilvania son del vendedor y se quitan antes de que te vayas manejando. Planea cómo vas a llevarte el auto antes de cerrar el trato.",
      },
      {
        q: "¿Cuánto tarda la liberación del gravamen?",
        a: "Desde unos días hasta varias semanas, según el prestamista. Acuerda con el vendedor de antemano qué pasa con el dinero y el auto durante ese periodo, y no dejes que la respuesta sea 'te llevas el auto y terminamos el papeleo después.'",
      },
    ],
    cta: {
      title: "La forma segura de ordenar esto",
      body: "DriveLink retiene el dinero del comprador hasta que el auto y el título realmente cambian de manos. En Pensilvania eso significa que los fondos quedan resguardados mientras se libera el gravamen y se agenda la cita con el notario — el vendedor puede ver que el dinero es real, y tú no le estás pagando a nadie por una promesa.",
      button: "Ver cómo funciona",
    },
    related: [
      { view: "lienPayoffNJ", label: "Comprar un auto con gravamen en Nueva Jersey" },
      { view: "lienPayoffNY", label: "Comprar un auto con gravamen en Nueva York" },
    ],
    disclaimer:
      "Esta es información general sobre cómo funcionan las liquidaciones de gravámenes en ventas privadas en Pensilvania, no es asesoría legal. Los requisitos cambian y cada situación es distinta. Confirma los requisitos vigentes con PennDOT, y consulta a un abogado si hay dinero de por medio.",
  },
};

export default function LienPayoffPA({ onBack, onStart, onNavigate }) {
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
