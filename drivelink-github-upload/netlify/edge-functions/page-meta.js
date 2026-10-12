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
      serviceType: "Escrow-style payment holding for U.S. private-party vehicle sales",
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
      .replace(/<\/head>/i, `${head}\n  </head>`);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "public, max-age=300");
    return new Response(out, { status: response.status, headers });
  } catch {
    return response;
  }
};
