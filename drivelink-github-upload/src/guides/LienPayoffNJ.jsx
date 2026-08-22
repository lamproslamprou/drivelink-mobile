import GuideLayout from "./GuideLayout.jsx";

// Route: /guides/lien-payoff-nj
// Reader: mid-deal, just told the seller still owes money, deciding whether to
// walk. Short answer first; the explanation is for whoever keeps reading.

const DISCLAIMER =
  "This is general information about how lien payoffs work in New Jersey private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with the NJ MVC, and talk to a lawyer if real money is at stake.";

export default function LienPayoffNJ({ onBack, onStart, onNavigate }) {
  return (
    <GuideLayout
      onBack={onBack}
      onStart={onStart}
      onNavigate={onNavigate}
      about="Vehicle lien payoff in a New Jersey private car sale"
      eyebrow="New Jersey · Private sale guide"
      h1="The seller still owes money on the car. Now what?"
      lede="A loan on the car isn't a dealbreaker. It's a sequencing problem: the lender has to be paid before the title can come to you, and the order those two things happen in decides whether you get a car or a very expensive lesson."
      tldr={[
        "A lien means a lender has a legal claim on the car itself until the loan is paid off.",
        "In New Jersey the owner doesn't hold a title with a lien on it — the MVC sends that title to the lienholder. A seller with a current loan physically does not have the title to hand you.",
        "Never hand the seller the full price and trust them to pay the lender afterward. That's the failure everyone regrets.",
        "The safe version pays the lender directly, first, and the seller gets only what's left over.",
      ]}
      sections={[
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
      ]}
      faqs={[
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
      ]}
      cta={{
        title: "The safe way to sequence this",
        body: "DriveLink holds the buyer's money until the car and title have actually changed hands. On a deal with a lien that removes the exact gap where things go wrong — the seller can see the funds are real, and nobody is trusting anyone to pay a lender after the fact.",
        button: "See how it works",
      }}
      related={[
        { view: "lienPayoffPA", label: "Buying a car with a lien in Pennsylvania" },
        { view: "lienPayoffNY", label: "Buying a car with a lien in New York" },
      ]}
      disclaimer={DISCLAIMER}
    />
  );
}
