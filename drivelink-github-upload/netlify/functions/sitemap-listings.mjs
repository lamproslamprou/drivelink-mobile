// Dynamic sitemap for live listings — added 2026-09-04 as part of the
// listing-page SEO pass (see App.jsx's ListingDetailModal SEO useEffect).
//
// Listings change constantly (new ones, sold ones, removed ones), so a static
// sitemap file would go stale immediately. This queries Supabase live on every
// request and builds the XML on the fly instead — same reasoning as why
// listing_stats etc. are views rather than cached tables. Only `status=active`
// listings are included; RLS already scopes public reads the same way, this
// filter just avoids listing sold/archived/removed cars as canonical URLs.
//
// Uses the same public anon key src/supabase.js ships to every browser —
// RLS is the actual access control here, not key secrecy, so there's nothing
// sensitive in embedding it in a server-side function too.

const SUPABASE_URL = "https://ykzovtfwcjkaigwznrsi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrem92dGZ3Y2prYWlnd3pucnNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Nzc3ODMsImV4cCI6MjA5ODI1Mzc4M30.LprBsIabOD2xwXUgHoNeGQY9uHNNYKKfneNWKfY06WY";

const escapeXml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

export default async () => {
  let listings = [];
  try {
    // listings has no updated_at column (checked against the live schema) —
    // created_at is the only timestamp available for <lastmod>.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=id,created_at&status=eq.active&is_test=eq.false`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (res.ok) listings = await res.json();
  } catch {
    // Fall through with an empty list — an empty-but-valid sitemap beats a
    // 500 that could get this URL flagged as broken in Search Console.
  }

  const urls = listings.map((l) => {
    const lastmod = (l.created_at || "").slice(0, 10);
    return `  <url>
    <loc>${escapeXml(`https://drivelink.deals/listing/${l.id}`)}</loc>
${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ""}    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Listings churn often enough that an hour-old cache is fine — this
      // still beats a static file nobody remembers to regenerate.
      "Cache-Control": "public, max-age=3600",
    },
  });
};
