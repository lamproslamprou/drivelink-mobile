// English FAQ items, shared by FAQView.jsx and the edge function that injects
// FAQPage JSON-LD into the raw HTML of /faq (netlify/edge-functions/page-meta.js).
// Kept dependency-free (plain JS, only imports fee.js) so both can load it.
import { platformFeeLabel, promoActive } from "./fee.js";

export function faqItemsEn() {
  const FEE = platformFeeLabel();
  const PROMO_EN = promoActive() ? " (half our usual 1%, through October 31)" : "";
  return [
      {
        q: "Who actually holds my money?",
        a: "Stripe does. Payments go into a Stripe-held balance tied to the deal, not into a DriveLink bank account. We're the layer that tells Stripe when the conditions are met.",
      },
      {
        q: "What stops DriveLink from just taking my payment?",
        a: `We can't move the funds to ourselves. The payout goes to the seller's own Stripe-connected account. Our only revenue is the ${FEE} fee, taken when the deal closes.`,
      },
      {
        q: "When does the seller get paid?",
        a: "When the buyer releases the funds. The buyer gets a 6-digit handover code once their payment has cleared. Once they've inspected the car and have the keys and title in hand — and only then — they give the code to the seller, which triggers the payout.",
      },
      {
        q: "Can I pay by bank transfer instead of card?",
        a: "On purchases over $15,000, yes — bank transfer is offered at checkout alongside card, and it costs far less to process. Card payments clear in seconds; bank transfers take about 5 business days. Bank transfer is available to buyers who have completed identity verification.",
      },
      {
        q: "I paid by bank transfer. Why don't I have a handover code?",
        a: "Because the money hasn't arrived yet. We only issue the code once your payment has actually cleared — otherwise you could collect a car against a transfer that later fails, and the seller would be left with neither. We'll email your code the moment it clears. Until then, please don't arrange to collect the vehicle.",
        flag: true,
      },
      {
        q: "What if a bank transfer doesn't go through?",
        a: "Nothing is lost. You aren't charged, no money is held, and the listing goes back on sale automatically — we email both you and the seller to say so. Banks return transfers for ordinary reasons like available balance or account restrictions; yours can tell you which. You're free to try again by bank transfer or card.",
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
        a: "Tell us. We check in with both parties automatically if a sale sits unconfirmed, and we'll ask each of you directly whether the car changed hands. Funds stay in escrow until it's resolved — nothing is paid out or refunded on a timer, and no one is left waiting indefinitely without a human looking at it.",
      },
      {
        q: "Why should I trust a company I've never heard of?",
        a: "You don't have to take our word for much. DriveLink LLC is registered in New Jersey with a federal EIN, and our identity is verified with Stripe. The protection comes from where the money sits and who can release it, not from our reputation.",
      },
      {
        q: "What does it cost?",
        a: `${FEE} of the sale price${PROMO_EN}, charged once when the deal closes. No listing fees, no subscription, and nothing if the deal falls through.`,
      },
      {
        q: "Do I have to list my car on DriveLink?",
        a: "No. If you've already found a buyer or seller somewhere else, you can start a deal directly and use DriveLink just for the payment.",
      },
      {
        q: "Is my personal information safe?",
        a: "Card details go straight to Stripe and never hit our servers. We collect what's needed to run the deal and verify identity, nothing more.",
      },
  ];
}
