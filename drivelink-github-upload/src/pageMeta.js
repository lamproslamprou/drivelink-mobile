// ============================================================================
// DriveLink — per-page <title> and meta description.
//
// ONE table, read by two things:
//   1. App.jsx sets document.title / meta description from it when the view
//      changes (so SPA navigation and Google's JS rendering see the right tags);
//   2. netlify/edge-functions/page-meta.js injects the same tags (plus og:*,
//      twitter:*, canonical and JSON-LD) into the raw HTML, so crawlers and
//      link-unfurlers that never run JS see them too.
// Plain JS, no JSX, imports only fee.js — both consumers must be able to load it.
//
// Titles stay under ~60 characters. Not listed here on purpose: /inspectors
// (InspectorsView sets its own), /listing/* (ListingDetailModal + listing-meta.js)
// and the lien-payoff guides (set by their own components).
// ============================================================================
import { platformFeeLabel } from "./fee.js";

export const SITE_URL = "https://drivelink.deals";
export const DEFAULT_TITLE = "DriveLink — Private Car Sales with Escrow Built In (US)";
export const DEFAULT_DESCRIPTION =
  "Pay for a used car safely. Funds are held in escrow until you have the keys and the signed title. U.S. private car sales, $0 to list.";

export function pageMetaTable() {
  const FEE = platformFeeLabel();
  return {
    "/": {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    "/browse": {
      title: "Used Cars for Sale by Owner, Escrow on Every Sale | DriveLink",
      description:
        "Browse private-party used cars listed directly by their owners. The buyer's payment is held in escrow until the car and signed title change hands.",
    },
    "/start-deal": {
      title: "Start a Protected Deal on Any Private Car Sale | DriveLink",
      description:
        "Found a car on Facebook Marketplace or Craigslist? Start a deal on that car and the buyer's money is held until the keys and title change hands.",
    },
    "/faq": {
      title: "Is DriveLink Safe? How Your Money Is Protected",
      description:
        "Who holds the money, what stops DriveLink from taking it, and what happens if a sale goes wrong. Straight answers before you pay for a used car.",
    },
    "/about": {
      title: "About DriveLink: Who Runs It, Where Your Money Sits",
      description:
        "DriveLink LLC is a New Jersey company. How a sale works, what it costs, where funds are held between payment and release, and who to email.",
    },
    "/pricing": {
      title: `DriveLink Pricing: ${FEE} Seller Fee, $0 to List`,
      description: `Sellers pay ${FEE} of the sale price when a deal closes. $0 to list, buyers pay nothing beyond the car's price, and nothing if the deal falls through.`,
    },
    "/features": {
      title: "DriveLink Features: Escrow, Handover Code, Disputes",
      description:
        "How DriveLink works step by step: escrow up to $250,000, use it on a car you already found, ID verification, the 6-digit handover code, and disputes.",
    },
    "/safety": {
      title: "Private Car Sale Safety Tips: Meetups, VIN, Title | DriveLink",
      description:
        "Where to meet, what to check on the VIN and title, and how to avoid common private car sale scams before you hand over money or keys.",
    },
    "/escrow": {
      title: "How DriveLink Escrow Works for a Private Car Sale",
      description:
        "Someone sent you a DriveLink link? Here is where the money sits, when the seller gets paid, and what happens if something goes wrong.",
    },
    "/advertise": {
      title: "Advertise on DriveLink to Private Car Buyers and Sellers",
      description:
        "Put your business in front of people buying and selling cars privately. Placement options and how to get started.",
    },
    "/promoter": {
      title: "DriveLink Promoter Program: Earn 1% on Closed Car Deals",
      description:
        "Know someone buying or selling a car? Share your link and earn 1% when their deal closes through DriveLink escrow.",
    },
    "/terms": {
      title: "Terms of Service | DriveLink",
      description: "The terms for using DriveLink to buy, sell and pay for private car sales in the United States.",
    },
    "/privacy": {
      title: "Privacy Policy | DriveLink",
      description: "What DriveLink collects, why, and who it is shared with.",
    },
    "/vs/drivelink-vs-privateauto": {
      title: "DriveLink vs PrivateAuto: Fees and How They Differ",
      description:
        "PrivateAuto charges $29 to list plus $150 per sale. DriveLink is $0 to list and a percentage when the deal closes. Side-by-side fees on real sale prices.",
    },
    "/vs/drivelink-vs-keysavvy": {
      title: "DriveLink vs KeySavvy: Fees and How They Differ",
      description:
        "KeySavvy handles title as a licensed dealer for $99 per side. DriveLink holds the payment while you hand over the car yourselves. Where each fits.",
    },
    "/vs/drivelink-vs-escrow-com": {
      title: "DriveLink vs Escrow.com for a Private Car Sale",
      description:
        "Escrow.com is general-purpose; DriveLink is built for one U.S. private car handover with a 6-digit release code. Where each fits.",
    },
  };
}

export const normalizeMetaPath = (p) =>
  (String(p || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/");

export function metaForPath(path) {
  return pageMetaTable()[normalizeMetaPath(path)] || null;
}
