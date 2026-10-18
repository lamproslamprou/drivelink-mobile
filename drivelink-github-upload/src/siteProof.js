// ============================================================================
// DriveLink — real proof the marketing pages can show.
//
// Everything here starts EMPTY on purpose, and every component that reads it
// renders nothing until it has real content. The site audit (Oct 12 2026) asked
// for a named founder, customer stories, usage numbers and third-party
// validation — all of which have to be true to be worth showing. Nothing is
// invented: fill these in as the real material exists, redeploy, and the blocks
// appear. Never put a number or quote in here that you can't back up.
// ============================================================================

// Named founder. Shown on /about ("Who runs it") and in the homepage footer.
// Needs name + photo + a profile link to carry the trust weight the audit wants.
//   photo:    path under /public, e.g. "/founder.jpg" (a real headshot)
//   profile:  LinkedIn or X URL
//   why:      one paragraph, same plain voice as the About page. { en, es } or a string.
export const FOUNDER = {
  name: "",
  role: "Founder",
  photo: "",
  profile: "",
  profileLabel: "LinkedIn",
  why: { en: "", es: "" },
};

// Customer stories. Real, named, with permission. Shown as a wall on the
// homepage between the escrow steps and the role cards.
//   { quote, name, role: "Buyer" | "Seller", photo?, outcome?, before? }
//   quote:   one or two sentences in their words ("Funds released the same afternoon we met.")
//   name:    first name + last initial, as they agreed
//   outcome: optional short result line, e.g. "$18,400 sale, closed in 1 day"
//   before:  optional "what they used to do" line, e.g. "Used to take a cashier's check"
export const TESTIMONIALS = [];

// Usage line under the hero stats. Use only numbers that are true today.
// Fill the ones you want shown; zero/empty fields are skipped.
// (Sold-car counts are deliberately NOT a field — those stay admin-only.)
export const USAGE = {
  dealsStarted: 0,
  carsListed: 0,
  // Optional avatar row of real early users who agreed to appear: [{ name, photo }]
  people: [],
};

// Third-party validation: review-site widgets, Product Hunt, press. Real and dated only.
//   { label: "Trustpilot", detail: "4.8 from 12 reviews", href, date: "Oct 2026" }
export const THIRD_PARTY = [];

// Hero visual. The audit wants the product's own deal screen (funds held in
// escrow, release state visible) instead of the stock car photo. Drop a real
// screenshot into /public (e.g. /hero-deal-screen.png), set src, redeploy.
// Until then the homepage shows a built "Example deal" mock (HeroDealMock.jsx),
// which uses the alt text below.
export const HERO_SCREENSHOT = {
  src: "",
  alt: {
    en: "DriveLink deal screen showing the buyer's payment protected until the handover code is entered",
    es: "Pantalla de un trato en DriveLink: el pago del comprador queda retenido hasta que se ingresa el código de entrega",
  },
};
