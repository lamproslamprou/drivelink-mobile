import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_DAYS = 14;
const MIN_COMPARABLES_FOR_INTERNAL = 3; // below this, fall back to real web search
const WEB_SEARCH_MAX_USES = 3; // caps cost per assessment (~$0.03 in search fees)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { listing_id } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // Serve the cached assessment if it's recent and the listing hasn't been edited since
    if (listing.deal_assessment && listing.deal_assessment_at) {
      const ageMs = Date.now() - new Date(listing.deal_assessment_at).getTime();
      const editedSince = listing.last_active_at && new Date(listing.last_active_at) > new Date(listing.deal_assessment_at);
      if (ageMs < CACHE_DAYS * 24 * 60 * 60 * 1000 && !editedSince) {
        return new Response(JSON.stringify({ assessment: listing.deal_assessment, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Comparable pool: other active listings, same make + model
    const { data: comparables } = await supabase
      .from("listings")
      .select("price, mileage, year")
      .eq("make", listing.make)
      .eq("model", listing.model)
      .eq("status", "active")
      .neq("id", listing_id);

    const comps = comparables || [];
    const prices = comps.map(c => c.price).filter(Boolean);

    let assessment;

    if (prices.length >= MIN_COMPARABLES_FOR_INTERNAL) {
      // ── Path A: enough DriveLink data — free internal comparison, no web search
      assessment = await runInternalAssessment(listing, prices);
    } else {
      // ── Path B: not enough internal data — fall back to real web search
      try {
        assessment = await runWebSearchAssessment(listing, prices.length);
      } catch (webErr) {
        console.error("Web search assessment failed, falling back to internal:", webErr);
        assessment = prices.length > 0
          ? await runInternalAssessment(listing, prices)
          : {
              rating: "not_enough_data",
              summary: `There aren't enough comparable ${listing.make} ${listing.model} listings yet — and live market research didn't return a confident result this time. Try again shortly.`,
              source: "none",
              comparable_count: 0,
            };
      }
    }

    await supabase.from("listings").update({ deal_assessment: assessment, deal_assessment_at: new Date().toISOString() }).eq("id", listing_id);

    return new Response(JSON.stringify({ assessment, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Path A: compares against DriveLink's own active listings only. Free —
// no web search tool used, just a short Claude call to turn stats into a
// plain-language verdict.
async function runInternalAssessment(listing: any, prices: number[]) {
  const avgPrice = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceDiffPct = Math.round(((listing.price - avgPrice) / avgPrice) * 100);

  const prompt = `You are a pricing assistant for DriveLink, a peer-to-peer car marketplace. Given the stats below, return ONLY a JSON object (no markdown, no commentary) shaped exactly like:
{"rating": "great_deal" | "fair_price" | "above_market", "summary": "one or two plain-language sentences"}

Listing: ${listing.year} ${listing.make} ${listing.model}, priced at $${listing.price}, ${listing.mileage} miles.
Comparable active DriveLink listings: ${prices.length} other ${listing.make} ${listing.model} listings, averaging $${avgPrice} (range $${minPrice}-$${maxPrice}).
This listing is ${priceDiffPct > 0 ? `${priceDiffPct}% above` : `${Math.abs(priceDiffPct)}% below`} that average.

Be factual and measured — this is based only on DriveLink's current listings, not a full market appraisal. Don't claim more certainty than that.`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) throw new Error(`AI request failed: ${await aiRes.text()}`);
  const aiData = await aiRes.json();
  const rawText = aiData?.content?.find((c: any) => c.type === "text")?.text || "{}";
  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch {
    parsed = { rating: "fair_price", summary: "We compared this listing against similar cars on DriveLink, but couldn't generate a detailed summary this time." };
  }

  return {
    rating: parsed.rating || "fair_price",
    summary: parsed.summary || "",
    source: "internal",
    comparable_count: prices.length,
    avg_price: avgPrice,
    price_diff_pct: priceDiffPct,
  };
}

// ── Path B: too few DriveLink comparables to be useful, so Claude does real
// web research (used-car listing sites, pricing guides) via the web_search
// tool. Capped at WEB_SEARCH_MAX_USES searches to bound cost (~$0.03-0.05
// in search fees per call, plus token cost for reading results).
async function runWebSearchAssessment(listing: any, internalComparableCount: number) {
  const prompt = `You are a pricing assistant for DriveLink, a peer-to-peer car marketplace. DriveLink doesn't have enough of its own listings to compare this car against, so research current market pricing for it using web search.

Car: ${listing.year} ${listing.make} ${listing.model}, ${listing.mileage} miles, listed at $${listing.price}.

Search for typical asking prices for comparable used ${listing.year} (or nearby model years) ${listing.make} ${listing.model} with similar mileage, from listing sites and pricing guides. Then respond with ONLY a JSON object as your final message (no markdown, no commentary, no citations or quoted text) shaped exactly like:
{"rating": "great_deal" | "fair_price" | "above_market", "summary": "one or two plain-language sentences describing how this price compares to what you found", "estimated_market_range": "e.g. $18,000-$21,000"}

Be factual and measured. Do not quote or closely paraphrase any single source — synthesize a general sense of market pricing in your own words.`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
    }),
  });

  if (!aiRes.ok) throw new Error(`AI web search request failed: ${await aiRes.text()}`);
  const aiData = await aiRes.json();

  // With tool use, content is a mix of block types (server_tool_use, web_search_tool_result,
  // text). We want the LAST text block, which is Claude's final synthesized answer after
  // it's done searching.
  const textBlocks = (aiData?.content || []).filter((c: any) => c.type === "text");
  const rawText = textBlocks.length ? textBlocks[textBlocks.length - 1].text : "{}";

  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
  } catch {
    // Model didn't return clean JSON (can happen if it got chatty) — fail up
    // to the caller so it can fall back to internal-only or a safe default.
    throw new Error("Web search assessment did not return parseable JSON");
  }

  return {
    rating: parsed.rating || "fair_price",
    summary: parsed.summary || "",
    estimated_market_range: parsed.estimated_market_range || null,
    source: "web_search",
    comparable_count: internalComparableCount,
  };
}
