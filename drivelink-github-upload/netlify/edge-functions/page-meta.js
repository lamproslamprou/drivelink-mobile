// Per-page <title>, meta description, canonical, Open Graph / Twitter tags and
// JSON-LD for the site's static routes, injected into the raw HTML.
//
// Why an edge function: the site is a client-side SPA, so every route is served
// the same index.html. Anything that doesn't run JavaScript (link-preview
// unfurlers, Bing, AI-assistant fetchers, SEO audit crawlers) saw one generic
// title and description on every page. This runs for the routes listed in
// netlify.toml, takes the response Netlify was about to serve and rewrites only
// the <head> tags — <div id="root"> and every script are untouched, so the app
// boots exactly as before.
//
// Same philosophy as listing-meta.js: no bot sniffing, and it fails open — on
// any error it returns the normal response, so a meta-tag nicety can never
// break a page.
//
// The text comes from src/pageMeta.js (shared with App.jsx) and the FAQ
// JSON-LD from src/faqData.js, so there is a single source for both.

import { metaForPath, normalizeMetaPath, SITE_URL } from "../../src/pageMeta.js";
import { faqItemsEn } from "../../src/faqData.js";
import { platformFeeLabel } from "../../src/fee.js";

const OG_IMAGE = `${SITE_URL}/icons/icon-512.png`;

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
// JSON inside <script>: a literal "</script>" or "<!--" in the data would end the tag.
const jsonScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

function jsonLdFor(path) {
  if (path === "/faq") {
    return [{
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItemsEn().map((it) => ({
        "@type": "Question",
        name: it.q,
        acceptedAnswer: { "@type": "Answer", text: it.a },
      })),
    }];
  }
  if (path === "/pricing") {
    const fee = platformFeeLabel();
    return [{
      "@context": "https://schema.org",
      "@type": "Service",
      name: "DriveLink payment protection for private car sales",
      serviceType: "Protected payment for U.S. private-party vehicle sales",
      provider: { "@type": "Organization", name: "DriveLink", url: SITE_URL },
      areaServed: { "@type": "Country", name: "United States" },
      offers: [
        {
          "@type": "Offer",
          name: "List a car",
          price: "0",
          priceCurrency: "USD",
        },
        {
          "@type": "Offer",
          name: "Seller platform fee",
          priceCurrency: "USD",
          description: `${fee} of the sale price, paid by the seller only when the deal closes. Buyers pay nothing beyond the price of the car. No fee if the deal falls through. Card processing is charged separately by Stripe.`,
        },
      ],
    }];
  }
  return [];
}

// Real, crawlable body text for the routes whose raw HTML is otherwise just an
// empty <div id="root">. It goes in a <noscript> block, so people running the
// app never see it; crawlers and AI fetchers that don't execute JavaScript read
// a proper summary and follow real links. Written from the same sources as the
// visible pages (platformFeeLabel, faqItemsEn) so it can't drift into claims the
// site doesn't make.
const NAV_LINKS = [
  ["/browse", "Browse private-party cars"],
  ["/start-deal", "Start a protected deal on a car you already found"],
  ["/pricing", "Pricing and fee schedule"],
  ["/features", "Features"],
  ["/faq", "Frequently asked questions"],
  ["/safety", "Safety tips"],
  ["/about", "About DriveLink"],
  ["/inspectors", "Find a pre-purchase inspector"],
  ["/seller-toolkit", "Free seller toolkit"],
  ["/guides/", "Guides for buying and selling a car privately"],
  ["/vs/drivelink-vs-privateauto", "DriveLink vs PrivateAuto"],
  ["/vs/drivelink-vs-keysavvy", "DriveLink vs KeySavvy"],
  ["/vs/drivelink-vs-escrow-com", "DriveLink vs Escrow.com"],
];
const navHtml = () =>
  `<nav aria-label="DriveLink"><ul>${NAV_LINKS.map(([h, t]) => `<li><a href="${SITE_URL}${h}">${esc(t)}</a></li>`).join("")}</ul></nav>`;

function bodyFor(path, meta) {
  if (path === "/") {
    const fee = platformFeeLabel();
    return `<noscript>
      <main>
        <h1>DriveLink: private car sales with protected payment</h1>
        <p>${esc(meta.description)}</p>
        <p>DriveLink is for U.S. private-party car sales. A buyer pays through DriveLink, the payment is processed by Stripe, and the seller is paid only once the car and the signed title have changed hands, confirmed with a 6-digit handover code. It works on a car listed on DriveLink or on one you found on Facebook Marketplace, Craigslist or through a friend.</p>
        <h2>Cost</h2>
        <p>Listing a car is free. The seller pays ${esc(fee)} of the sale price, only when the deal closes. Buyers pay nothing beyond the price of the car. If the deal falls through, nobody pays DriveLink anything. Card processing is a separate Stripe charge.</p>
        <h2>Explore</h2>
        ${navHtml()}
        <p>DriveLink LLC, Branchburg, New Jersey. U.S. transactions only. Support: support@drivelink.deals. Instagram: https://instagram.com/drivelink_deals</p>
      </main>
    </noscript>`;
  }
  if (path === "/faq") {
    return `<noscript>
      <main>
        <h1>DriveLink frequently asked questions</h1>
        ${faqItemsEn().map((it) => `<h2>${esc(it.q)}</h2><p>${esc(it.a)}</p>`).join("\n        ")}
        ${navHtml()}
      </main>
    </noscript>`;
  }
  if (path === "/escrow") {
    return `<noscript>
      <main>
        <h1>How a DriveLink deal works</h1>
        <p>${esc(meta.description)}</p>
        ${navHtml()}
      </main>
    </noscript>`;
  }
  return "";
}

export default async (request, context) => {
  const response = await context.next();
  try {
    const path = normalizeMetaPath(new URL(request.url).pathname);
    const meta = metaForPath(path);
    if (!meta) return response;
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return response;

    const canonical = path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
    const head = `
    <title>${esc(meta.title)}</title>
    <meta name="description" content="${esc(meta.description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="DriveLink" />
    <meta property="og:title" content="${esc(meta.title)}" />
    <meta property="og:description" content="${esc(meta.description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${esc(OG_IMAGE)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${esc(meta.title)}" />
    <meta name="twitter:description" content="${esc(meta.description)}" />
    <meta name="twitter:image" content="${esc(OG_IMAGE)}" />
    ${jsonLdFor(path).map(jsonScript).join("\n    ")}
  `;

    const html = await response.text();
    const out = html
      .replace(/<title>.*?<\/title>/is, "")
      .replace(/<meta\s+name="description"[^>]*>/i, "")
      .replace(/<link\s+rel="canonical"[^>]*>/i, "")
      .replace(/<meta\s+property="og:[^>]*>/gi, "")
      .replace(/<meta\s+name="twitter:[^>]*>/gi, "")
      .replace(/<\/head>/i, `${head}\n  </head>`)
      .replace(/<div id="root"><\/div>/, (m) => `${m}\n    ${bodyFor(path, meta)}`);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    // HTML must revalidate on every load. A cached copy keeps pointing at the
    // previous deploy's hashed assets, which are gone, and the page renders blank.
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    return new Response(out, { status: response.status, headers });
  } catch {
    return response;
  }
};
