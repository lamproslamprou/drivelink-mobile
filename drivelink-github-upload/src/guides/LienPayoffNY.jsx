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

const DISCLAIMER =
  "This is general information about how lien payoffs work in New York private sales, not legal advice. Requirements change and individual situations vary. Confirm current requirements with the NY DMV, and talk to a lawyer if real money is at stake.";

export default function LienPayoffNY({ onBack, onStart, onNavigate }) {
  return (
    <GuideLayout
      onBack={onBack}
      onStart={onStart}
      onNavigate={onNavigate}
      about="Vehicle lien payoff in a New York private car sale"
      eyebrow="New York · Private sale guide"
      h1="Buying a car in NY when the seller still owes money"
      lede="New York prints the lienholder on the front of the title, which means you can see the problem before you pay. It also means the DMV's own warning is unusually blunt: take the title without a release, and the car can be repossessed out from under you."
      tldr={[
        "Check the front of the title for lienholder names before you hand over anything.",
        "If a lienholder is listed, get the original lien release before completing the purchase — not a copy, and not a promise.",
        "Without it you may become responsible for the lien, and the lender can repossess the car you just paid for.",
        "New York law requires regulated lenders to release a satisfied lien quickly, which gives you a deadline to hold people to.",
      ]}
      sections={[
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
      ]}
      faqs={[
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
      ]}
      cta={{
        title: "The safe way to sequence this",
        body: "DriveLink holds the buyer's money until the car and title have actually changed hands. In New York that means you're not choosing between paying on trust and losing the deal — funds sit secured while the release is produced, and the seller can see they're real.",
        button: "See how it works",
      }}
      related={[
        { view: "lienPayoffNJ", label: "Buying a car with a lien in New Jersey" },
        { view: "lienPayoffPA", label: "Buying a car with a lien in Pennsylvania" },
      ]}
      disclaimer={DISCLAIMER}
    />
  );
}
