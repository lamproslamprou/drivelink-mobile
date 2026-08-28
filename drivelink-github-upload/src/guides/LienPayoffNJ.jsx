import { useLang } from "../i18n.jsx";
import GuideLayout from "./GuideLayout.jsx";

// Route: /guides/lien-payoff-nj
// Reader: mid-deal, just told the seller still owes money, deciding whether to
// walk. Short answer first; the explanation is for whoever keeps reading.
//
// Fixed 2026-08-28: this content was hardcoded English JSX passed straight to
// GuideLayout, so the site-wide language toggle silently did nothing on this
// page. Restructured to the COPY = {en, es} pattern already used by
// EscrowExplained.jsx — GuideLayout now renders whichever language's object
// is selected below.

const ABOUT = "Vehicle lien payoff in a New Jersey private car sale";

const COPY = {
  en: {
    eyebrow: "New Jersey · Private sale guide",
    h1: "The seller still owes money on the car. Now what?",
    lede:
      "A loan on the car isn't a dealbreaker. It's a sequencing problem: the lender has to be paid before the title can come to you, and the order those two things happen in decides whether you get a car or a very expensive lesson.",
    tldr: [
      "A lien means a lender has a legal claim on the car itself until the loan is paid off.",
      "In New Jersey the owner doesn't hold a title with a lien on it — the MVC sends that title to the lienholder. A seller with a current loan physically does not have the title to hand you.",
      "Never hand the seller the full price and trust them to pay the lender afterward. That's the failure everyone regrets.",
      "The safe version pays the lender directly, first, and the seller gets only what's left over.",
    ],
    sections: [
      {
        h: "What a lien actually is",
        p: [
          "When someone borrows money to buy a car, the lender records a security interest against the vehicle. That's the lien. The claim is on the car, not on the seller personally — which is the part that matters to you, because the claim follows the vehicle when it changes hands.",
          "New Jersey handles this in a way that catches people out. The MVC does not issue a lien-encumbered title to the owner; titles showing an active lien go to the lienholder, and the owner receives one only after the lien is satisfied and released. So a seller with a current loan cannot show you the title, because they don't have it.",
          "New Jersey also moves a lot of this electronically. If a loan was paid off recently, the release and the title may have passed between lender and MVC digitally rather than arriving in the seller's mailbox on paper. A seller saying the title is coming isn't automatically stalling — but it isn't proof either.",
        ],
      },
      {
        h: "How this goes wrong",
        p: [
          "The failure has one shape. The buyer pays the seller the full price. The seller intends to pay off the loan and either doesn't, can't, or takes long enough that it stops mattering. The lien stays on the car, the title is never released, and the buyer is driving something they can't register in their own name while a lender still has a claim on it.",
          "There is no version of this the MVC can fix for you. The lien is real, the debt belongs to the seller, and your money is gone. Recovering it becomes a civil matter against someone who has already shown you what they do with money.",
          "The variant that stings more is the seller who genuinely meant to pay it off and then something came up. Intent doesn't change the outcome, which is exactly why the structure matters more than your read on the person.",
        ],
      },
      {
        h: "How a payoff actually works",
        style: "steps",
        p: [
          "Ask the seller for a payoff quote from their lender. It's a standard request — a written figure, good through a specific date, stating exactly what the lender needs to release the lien. It is not the same as the loan balance, because it includes interest through the quote date.",
          "Compare that number to the sale price. If the payoff is lower, the deal is simple: the lender takes the payoff, the seller keeps the difference. If the payoff is higher, the seller is upside down and someone has to cover the gap in cash before the lien clears — and it isn't going to be you.",
          "Pay the lender directly, not the seller. Most lenders accept payoff from a third party, and many will walk you through it if you call with the account number and the seller on the line. The seller receives only what's left after the lender is satisfied.",
          "Wait for the release before you consider it done. The lender notifies the MVC and a clear title is issued, or the lender sends a release letter and the stamped title. This takes days to weeks depending on the lender. A seller pushing you to take the car and sort the title out later is asking you to absorb their risk.",
        ],
      },
      {
        h: "What New Jersey specifically requires",
        p: [
          "The lien has to be released before ownership transfers cleanly. Where the lienholder is a bank or credit union, the release comes through the institution. Where the lienholder is an individual or a private company, New Jersey wants the release noted on the original title plus a notarized lien release letter, dated and signed, with the title endorsed to show the lien is satisfied.",
          "If a title is sitting with a lienholder and needs to come to the MVC, form OS/SS-54 is the mechanism — an application asking the lienholder to release the title so the vehicle can be titled in New Jersey.",
          "The transfer has a clock on it. New Jersey or dealer-reassigned titles must be transferred within 10 working days of the sale date, and missing that carries a penalty. Don't let a lien delay push you past it without knowing you're doing it.",
          "Two things sellers forget. New Jersey plates belong to the owner rather than the car, so they come off before the buyer drives away. And the seller should file the Notice of Transfer and Release of Liability with the MVC — it's free, and it protects them from whatever happens with the car afterward.",
        ],
      },
      {
        h: "When to walk",
        style: "flags",
        p: [
          "The seller won't produce a payoff quote. It costs them one phone call, so refusing to make it is the answer.",
          "The seller wants the full amount in cash and will take care of the loan tomorrow. That's the failure described above, offered to you in advance.",
          "The payoff exceeds the sale price and nobody can explain who is covering the difference.",
          "The name on the loan isn't the name of the person selling you the car, with no clear explanation of who actually owns it.",
          "The seller is pushing to complete before the lien is released, using time pressure — another buyer, a deadline, a move. Urgency and unresolved liens are a bad combination.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I legally buy a car that has a lien on it?",
        a: "Yes, and it happens constantly. What you cannot safely do is pay for it in a way that leaves the lien in place. The purchase is fine; the sequencing has to be right.",
      },
      {
        q: "How do I check whether a car has a lien?",
        a: "Ask the seller directly and ask to see the title. In New Jersey a seller who can't produce one should be able to explain why — and 'the bank has it' is a real answer that also tells you there's an active loan. A vehicle history report and an MVC title search are additional checks.",
      },
      {
        q: "What if the seller owes more than the car is worth?",
        a: "Then the seller has to bring cash to close the gap before the lien can be released. That's their problem to solve, not yours to finance. Plenty of deals die here, and that's the system working.",
      },
      {
        q: "Can I just pay the lender myself?",
        a: "Usually yes, and it's the safest structure. Call the lender with the seller present, get the payoff figure and their process for third-party payment, and pay them directly. The seller gets the balance afterward.",
      },
      {
        q: "How long does a lien release take?",
        a: "It varies by lender, from days to several weeks. New Jersey processes many titles electronically, which helps, but it isn't instant. Agree in advance what happens to the car and the money during that window.",
      },
      {
        q: "Do I need a bill of sale?",
        a: "New Jersey doesn't legally require one for a private sale, but you want it anyway. It records the price, odometer reading, VIN and date — all of which matter later at the MVC and if anything is disputed.",
      },
    ],
    cta: {
      title: "The safe way to sequence this",
      body: "DriveLink holds the buyer's money until the car and title have actually changed hands. On a deal with a lien that removes the exact gap where things go wrong — the seller can see the funds are real, and nobody is trusting anyone to pay a lender after the fact.",
      button: "See how it works",
    },
    related: [
      { view: "lienPayoffPA", label: "Buying a car with a lien in Pennsylvania" },
      { view: "lienPayoffNY", label: "Buying a car with a lien in New York" },
    ],
    disclaimer:
      "This is general information about how lien payoffs work in New Jersey private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with the NJ MVC, and talk to a lawyer if real money is at stake.",
  },
  es: {
    eyebrow: "Nueva Jersey · Guía de venta privada",
    h1: "El vendedor todavía debe dinero por el auto. ¿Y ahora qué?",
    lede:
      "Un préstamo sobre el auto no es motivo para cancelar el trato. Es un problema de orden: hay que pagarle al prestamista antes de que el título pueda llegar a tus manos, y el orden en que ocurran esas dos cosas decide si terminas con un auto o con una lección muy cara.",
    tldr: [
      "Un gravamen significa que un prestamista tiene un derecho legal sobre el auto mismo hasta que se pague el préstamo.",
      "En Nueva Jersey el dueño no tiene en sus manos un título con gravamen — la MVC le envía ese título al prestamista. Un vendedor con un préstamo activo físicamente no tiene el título para entregártelo.",
      "Nunca le entregues al vendedor el precio completo confiando en que después le pagará al prestamista. Ese es el error que todos terminan lamentando.",
      "La forma segura es pagarle directamente al prestamista, primero, y el vendedor recibe solo lo que sobra.",
    ],
    sections: [
      {
        h: "Qué es realmente un gravamen",
        p: [
          "Cuando alguien pide dinero prestado para comprar un auto, el prestamista registra un interés de garantía sobre el vehículo. Eso es el gravamen. El derecho recae sobre el auto, no sobre el vendedor como persona — y esa es la parte que te importa a ti, porque el derecho sigue al vehículo cuando cambia de dueño.",
          "Nueva Jersey maneja esto de una forma que sorprende a mucha gente. La MVC no emite un título con gravamen al dueño; los títulos que muestran un gravamen activo van al prestamista, y el dueño recibe uno solo después de que el gravamen se paga y se libera. Así que un vendedor con un préstamo activo no puede mostrarte el título, porque no lo tiene.",
          "Nueva Jersey también maneja gran parte de esto de forma electrónica. Si un préstamo se pagó hace poco, la liberación y el título pueden haber pasado entre el prestamista y la MVC digitalmente, en vez de llegar en papel al buzón del vendedor. Que un vendedor diga que el título está en camino no significa automáticamente que esté dando largas — pero tampoco es prueba de nada.",
        ],
      },
      {
        h: "Cómo se puede arruinar esto",
        p: [
          "El fracaso siempre tiene la misma forma. El comprador le paga al vendedor el precio completo. El vendedor tiene la intención de pagar el préstamo y, o no lo hace, o no puede, o se tarda tanto que deja de importar. El gravamen se queda en el auto, el título nunca se libera, y el comprador termina manejando algo que no puede registrar a su nombre mientras un prestamista todavía tiene un derecho sobre él.",
          "No existe una versión de esto que la MVC pueda resolver por ti. El gravamen es real, la deuda es del vendedor, y tu dinero ya se fue. Recuperarlo se convierte en un asunto civil contra alguien que ya te demostró qué hace con el dinero.",
          "La variante que más duele es la del vendedor que sí tenía la intención genuina de pagarlo y luego surgió algo. La intención no cambia el resultado, y por eso la estructura del trato importa más que la impresión que te dé la persona.",
        ],
      },
      {
        h: "Cómo funciona realmente una liquidación",
        style: "steps",
        p: [
          "Pídele al vendedor una cotización de liquidación de su prestamista. Es una solicitud estándar — una cifra por escrito, válida hasta una fecha específica, que indica exactamente cuánto necesita el prestamista para liberar el gravamen. No es lo mismo que el saldo del préstamo, porque incluye los intereses hasta la fecha de la cotización.",
          "Compara esa cifra con el precio de venta. Si la liquidación es menor, el trato es sencillo: el prestamista recibe la liquidación y el vendedor se queda con la diferencia. Si la liquidación es mayor, el vendedor está en negativo y alguien tiene que cubrir esa diferencia en efectivo antes de que se libere el gravamen — y esa persona no serás tú.",
          "Págale directamente al prestamista, no al vendedor. La mayoría de los prestamistas aceptan pagos de terceros, y muchos te guían en el proceso si llamas con el número de cuenta y el vendedor en la línea. El vendedor recibe solo lo que sobra después de que el prestamista queda satisfecho.",
          "Espera a que llegue la liberación antes de dar el trato por cerrado. El prestamista notifica a la MVC y se emite un título limpio, o el prestamista envía una carta de liberación junto con el título sellado. Esto toma desde días hasta semanas, según el prestamista. Un vendedor que te presiona para que te lleves el auto y arregles el título después te está pidiendo que asumas su riesgo.",
        ],
      },
      {
        h: "Qué exige específicamente Nueva Jersey",
        p: [
          "El gravamen tiene que liberarse antes de que la propiedad se transfiera limpiamente. Cuando el prestamista es un banco o una cooperativa de crédito, la liberación llega a través de la institución. Cuando el prestamista es una persona o una empresa privada, Nueva Jersey exige que la liberación quede anotada en el título original, más una carta de liberación de gravamen notariada, fechada y firmada, con el título endosado para mostrar que el gravamen quedó satisfecho.",
          "Si un título está en manos del prestamista y necesita llegar a la MVC, el formulario OS/SS-54 es el mecanismo — una solicitud que le pide al prestamista que libere el título para que el vehículo pueda titularse en Nueva Jersey.",
          "La transferencia tiene un plazo. Los títulos de Nueva Jersey o reasignados por un concesionario deben transferirse dentro de los 10 días hábiles siguientes a la fecha de venta, y no cumplirlo tiene una multa. No dejes que un retraso por el gravamen te haga pasar ese plazo sin darte cuenta.",
          "Dos cosas que los vendedores suelen olvidar. En Nueva Jersey las placas le pertenecen al dueño, no al auto, así que hay que quitarlas antes de que el comprador se vaya manejando. Y el vendedor debe presentar ante la MVC el Notice of Transfer and Release of Liability (aviso de transferencia y exención de responsabilidad) — es gratis, y lo protege de lo que le pase al auto después.",
        ],
      },
      {
        h: "Cuándo alejarse del trato",
        style: "flags",
        p: [
          "El vendedor no consigue una cotización de liquidación. Le cuesta una sola llamada, así que negarse a hacerla ya es una respuesta en sí misma.",
          "El vendedor quiere el monto completo en efectivo y promete encargarse del préstamo mañana. Eso es exactamente el fracaso descrito arriba, ofrecido por adelantado.",
          "La liquidación supera el precio de venta y nadie puede explicar quién va a cubrir la diferencia.",
          "El nombre en el préstamo no es el de la persona que te está vendiendo el auto, y no hay una explicación clara de quién es realmente el dueño.",
          "El vendedor insiste en cerrar el trato antes de que se libere el gravamen, usando presión de tiempo — otro comprador, una fecha límite, una mudanza. La urgencia y un gravamen sin resolver son una mala combinación.",
        ],
      },
    ],
    faqs: [
      {
        q: "¿Puedo comprar legalmente un auto que tiene un gravamen?",
        a: "Sí, y pasa todo el tiempo. Lo que no puedes hacer de forma segura es pagarlo de una manera que deje el gravamen intacto. La compra en sí no es el problema; el orden en que ocurren las cosas sí lo es.",
      },
      {
        q: "¿Cómo verifico si un auto tiene un gravamen?",
        a: "Pregúntale directamente al vendedor y pide ver el título. En Nueva Jersey, un vendedor que no puede mostrarlo debería poder explicar por qué — y 'lo tiene el banco' es una respuesta válida que además te dice que hay un préstamo activo. Un reporte del historial del vehículo y una búsqueda de título en la MVC son verificaciones adicionales.",
      },
      {
        q: "¿Qué pasa si el vendedor debe más de lo que vale el auto?",
        a: "Entonces el vendedor tiene que aportar efectivo para cubrir la diferencia antes de que se pueda liberar el gravamen. Ese es su problema por resolver, no el tuyo por financiar. Muchos tratos se caen aquí, y eso es el sistema funcionando como debe.",
      },
      {
        q: "¿Puedo simplemente pagarle yo mismo al prestamista?",
        a: "Por lo general sí, y es la estructura más segura. Llama al prestamista con el vendedor presente, obtén la cifra de liquidación y su proceso para pagos de terceros, y págale directamente. El vendedor recibe el saldo después.",
      },
      {
        q: "¿Cuánto tarda la liberación de un gravamen?",
        a: "Varía según el prestamista, de días a varias semanas. Nueva Jersey procesa muchos títulos electrónicamente, lo cual ayuda, pero no es instantáneo. Acuerden de antemano qué pasa con el auto y el dinero durante ese periodo.",
      },
      {
        q: "¿Necesito un contrato de compraventa?",
        a: "Nueva Jersey no lo exige legalmente para una venta privada, pero te conviene tenerlo de todas formas. Registra el precio, la lectura del odómetro, el VIN y la fecha — datos que importan después en la MVC y si algo se disputa.",
      },
    ],
    cta: {
      title: "La forma segura de ordenar esto",
      body: "DriveLink retiene el dinero del comprador hasta que el auto y el título realmente cambian de manos. En un trato con gravamen, eso elimina exactamente el punto donde las cosas suelen salir mal — el vendedor puede ver que los fondos son reales, y nadie tiene que confiar en que alguien le pagará al prestamista después.",
      button: "Ver cómo funciona",
    },
    related: [
      { view: "lienPayoffPA", label: "Comprar un auto con gravamen en Pensilvania" },
      { view: "lienPayoffNY", label: "Comprar un auto con gravamen en Nueva York" },
    ],
    disclaimer:
      "Esta es información general sobre cómo funcionan las liquidaciones de gravámenes en ventas privadas en Nueva Jersey, no es asesoría legal. Los requisitos cambian y cada situación es distinta. Confirma los requisitos vigentes con la MVC de Nueva Jersey, y consulta a un abogado si hay dinero de por medio.",
  },
};

export default function LienPayoffNJ({ onBack, onStart, onNavigate }) {
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
