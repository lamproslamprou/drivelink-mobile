import GuideLayout from "./GuideLayout.jsx";

// Route: /guides/lien-payoff-pa
// PA's distinguishing fact is the notarized title assignment under 75 Pa.C.S.
// §1111 — both parties in one room, in front of an agent, at one moment. That
// single appointment is where the lien problem either resolves or detonates,
// so the whole page is organised around it.

const DISCLAIMER =
  "This is general information about how lien payoffs work in Pennsylvania private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with PennDOT, and talk to a lawyer if real money is at stake.";

export default function LienPayoffPA({ onBack, onStart, onNavigate }) {
  return (
    <GuideLayout
      onBack={onBack}
      onStart={onStart}
      onNavigate={onNavigate}
      about="Vehicle lien payoff in a Pennsylvania private car sale"
      eyebrow="Pennsylvania · Private sale guide"
      h1="Buying a car in PA when the seller still owes money"
      lede="Pennsylvania puts the whole transaction into a single appointment in front of a notary. That makes the paperwork cleaner than most states — and it makes an unresolved lien much harder to paper over, because you'll be sitting there when it surfaces."
      tldr={[
        "Pennsylvania requires the title assignment to be signed in front of a notary or authorized PennDOT agent. Both parties, same place, same time.",
        "A lender holding the title means there is nothing to notarize. The appointment cannot happen until the lien is released.",
        "The lien has to be paid off and released as part of the transaction, not after it.",
        "Pay the lender directly. The seller receives only what's left once the payoff clears.",
      ]}
      sections={[
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
      ]}
      faqs={[
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
      ]}
      cta={{
        title: "The safe way to sequence this",
        body: "DriveLink holds the buyer's money until the car and title have actually changed hands. In Pennsylvania that means funds sit secured while the lien clears and the notary appointment gets booked — the seller can see the money is real, and you're not paying anyone on a promise.",
        button: "See how it works",
      }}
      related={[
        { view: "lienPayoffNJ", label: "Buying a car with a lien in New Jersey" },
        { view: "lienPayoffNY", label: "Buying a car with a lien in New York" },
      ]}
      disclaimer={DISCLAIMER}
    />
  );
}
