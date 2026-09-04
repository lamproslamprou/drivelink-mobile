// Phase 2 of the listing SEO work (Phase 1: App.jsx's ListingDetailModal +
// netlify/functions/sitemap-listings.mjs).
//
// Phase 1 only helps once JavaScript has run — fine for Google's crawler,
// which does execute JS, but useless for anything that reads the raw HTML
// response and stops there: link-preview unfurling (Instagram, iMessage,
// Facebook, Slack, Discord...) and less capable crawlers (Bing). Right now
// every shared DriveLink listing link unfurls as generic "DriveLink — Buy,
// Sell & Earn" branding instead of the actual car.
//
// Deliberately NOT user-agent sniffing to guess "is this a bot" — that list
// is never complete (Apple's iMessage fetcher isn't even consistently
// identifiable) and is an arms race against whatever unfurls links next.
// Instead this runs for every request to /listing/:id, real visitors
// included: it fetches the listing, rewrites the <title>/<meta
// name="description"> and injects og:*/twitter:*/JSON-LD into the HTML
// Netlify was about to serve, then hands it back untouched otherwise — the
// <div id="root"> and every script tag are never touched, so the React app
// boots and hydrates exactly as before for a real browser. A bot/crawler
// that never runs that JS still got the real content in the first response.
//
// Fails open on every error path (bad id, Supabase unreachable, listing
// gone) by returning the normal response — a meta-tag nicety must never be
// able to break the actual page.

const SUPABASE_URL = "https://ykzovtfwcjkaigwznrsi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrem92dGZ3Y2prYWlnd3pucnNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Nzc3ODMsImV4cCI6MjA5ODI1Mzc4M30.LprBsIabOD2xwXUgHoNeGQY9uHNNYKKfneNWKfY06WY";
const FALLBACK_IMAGE = "https://drivelink.deals/favicon.png";

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

export default async (request, context) => {
  const response = await context.next();

  const match = new URL(request.url).pathname.match(/^\/listing\/([^/?#]+)/);
  if (!match) return response;
  const id = match[1];

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=id,year,make,model,price,description,images,image,status,mileage&id=eq.${encodeURIComponent(id)}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return response;
    const listing = (await res.json())[0];
    if (!listing) return response;

    const priceStr = `$${(Number(listing.price) / 100).toLocaleString("en-US")}`;
    const title = `${listing.year} ${listing.make} ${listing.model} — ${priceStr} | DriveLink`;
    const description = (listing.description ? String(listing.description).slice(0, 155) : "") ||
      `${listing.year} ${listing.make} ${listing.model} for sale on DriveLink, ${priceStr}. Escrow-protected private car sale.`;
    const images = listing.images && listing.images.length ? listing.images : [listing.image].filter(Boolean);
    const image = images[0] || FALLBACK_IMAGE;
    const canonical = `https://drivelink.deals/listing/${listing.id}`;

    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": ["Product", "Vehicle"],
      name: `${listing.year} ${listing.make} ${listing.model}`,
      image: images.length ? images : [FALLBACK_IMAGE],
      vehicleModelDate: listing.year ? String(listing.year) : undefined,
      mileageFromOdometer: listing.mileage ? { "@type": "QuantitativeValue", value: listing.mileage, unitCode: "SMI" } : undefined,
      brand: listing.make ? { "@type": "Brand", name: listing.make } : undefined,
      offers: {
        "@type": "Offer",
        priceCurrency: "USD",
        price: (Number(listing.price) / 100).toFixed(2),
        availability: listing.status === "sold" ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
        url: canonical,
      },
    });

    const headInject = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:type" content="product" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(image)}" />
    <script type="application/ld+json">${jsonLd}</script>
  `;

    const html = await response.text();
    const out = html
      .replace(/<title>.*?<\/title>/is, "")
      .replace(/<meta\s+name="description"[^>]*>/i, "")
      .replace(/<\/head>/i, `${headInject}\n  </head>`);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("content-type", "text/html; charset=utf-8");
    // Short cache — listing price/status can change, but this doesn't need
    // to be instantaneous for a link-preview fetch.
    headers.set("cache-control", "public, max-age=300");

    return new Response(out, { status: response.status, headers });
  } catch {
    return response;
  }
};
