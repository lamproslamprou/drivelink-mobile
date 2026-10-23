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
        a: "Stripe does. The buyer pays into the seller's own Stripe account, not DriveLink's, and DriveLink never receives or holds the money. DriveLink controls when that account can pay out to the seller's bank, and it does not do so until the buyer's handover code is entered, the buyer confirms, or an admin releases it. The seller isn't paid before then, and the money can be refunded to the buyer if the sale goes wrong.",
      },
      {
        q: "What stops DriveLink from just taking my payment?",
        a: `The sale price never comes to us: the buyer pays the seller's own Stripe account directly, and the seller can't withdraw it until the buyer's handover code is entered or the buyer confirms receipt. Our only revenue is the ${FEE} fee, taken when the deal closes.`,
      },
      {
        q: "When does the seller get paid?",
        a: "When the buyer releases the funds. The buyer gets a 6-digit handover code once their payment has cleared. Once they've inspected the car and have the keys and title in hand — and only then — they give the code to the seller, which triggers the payout. Release is immediate on our side, but Stripe holds card payments for about 2 business days after they are made (often longer on a seller's first payouts) before the money can leave their Stripe balance for their bank. If the handover happens days after payment, the payout goes out right away; if it happens within hours, it follows automatically once Stripe clears the payment. A bank deposit then typically takes another 1-2 business days.",
      },
      {
        q: "Can I pay by bank transfer instead of card?",
        a: "Yes. On any purchase of $500 or more you can pay by wire transfer instead of card. Choose \"Pay by wire transfer\" on the listing and we'll show you the bank details to send it to. The money goes to the seller's own Stripe account and is locked there until the handover is confirmed. Card is the default and clears in seconds; a wire usually takes 1-2 business days to arrive.",
      },
      {
        q: "I paid by wire transfer. Why don't I have a handover code?",
        a: "Because the wire hasn't arrived yet. We only issue the code once your payment has actually cleared — otherwise you could collect a car against a transfer that later fails, and the seller would be left with neither. We'll email your code the moment it clears. Until then, please don't arrange to collect the vehicle.",
        flag: true,
      },
      {
        q: "What if a wire transfer doesn't arrive?",
        a: "Nothing is lost. You aren't charged, no money is held, and the listing goes back on sale automatically — we email both you and the seller to say so. If the wire isn't received in time, the listing goes back on sale. Check the reference and amount with your bank. You're free to try again.",
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
        a: "Tell us. We check in with both parties automatically if a sale sits unconfirmed, and we'll ask each of you directly whether the car changed hands. The seller isn't paid out until it's resolved — nothing is released or refunded on a timer, and no one is left waiting indefinitely without a human looking at it.",
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
