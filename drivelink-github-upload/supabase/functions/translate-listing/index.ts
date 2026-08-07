// POST /translate-listing
// Translates a listing's seller-written text on demand.
//
// Deploy: supabase functions deploy translate-listing
//
// ── WHY ON DEMAND AND NOT AT WRITE TIME ─────────────────────────────────────
// A seller's description is the one part of a listing that cannot be handled
// by the static i18n dictionary — it is free text in whatever language they
// typed. Translating it eagerly on every listing would burn tokens on cars
// nobody reads and would put a machine translation in front of buyers who
// never asked for one. On demand, cached, with the original one click away.
//
// ── WHY THE ORIGINAL MUST STAY REACHABLE ────────────────────────────────────
// This is a car sale. "No rust" and "minor rust" are a few hundred dollars
// apart, and a mistranslation of a condition disclosure is the kind of thing
// that ends up in a dispute. The UI shows "Translated · Show original" and the
// original text is never overwritten — translations live in their own column,
// keyed by language.
//
// ── WHAT IS TRANSLATED ──────────────────────────────────────────────────────
// description and deal_assessment.summary. NOT make, model, VIN, price, or
// mileage: those are identifiers and numbers, and a model name that has been
// "translated" is worse than useless when the buyer goes to search for it.
//
// ── CACHE ───────────────────────────────────────────────────────────────────
// listing_translations is keyed (listing_id, lang, source_hash). The hash is
// of the source text, so a seller editing their description invalidates the
// cached translation automatically rather than leaving a stale one in place.
import {
  corsHeaders,
  jsonResponse,
  supabaseAdmin,
} from "../_shared/helpers.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPPORTED = ["es", "en"];

// Cheap and fast; this is short-form prose, not reasoning work.
const MODEL = "gpt-4o-mini";

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

    const { listing_id, lang } = await req.json();
    if (!listing_id) throw new Error("listing_id is required");
    if (!SUPPORTED.includes(lang)) throw new Error(`Unsupported language: ${lang}`);

    const supabase = supabaseAdmin();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, description, deal_assessment, status")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    // No auth check on purpose: this reads only fields already public on an
    // active listing and returns a translation of them. It does gate on status
    // so a removed or archived listing cannot be mined through this path.
    if (!["active", "pending"].includes(listing.status)) {
      return jsonResponse({ error: "Listing is not available" }, 404);
    }

    const summary =
      listing.deal_assessment && typeof listing.deal_assessment === "object"
        ? (listing.deal_assessment as Record<string, unknown>).summary ?? null
        : null;

    const source = JSON.stringify({
      description: listing.description ?? "",
      summary: summary ?? "",
    });

    if (!listing.description && !summary) {
      return jsonResponse({ nothingToTranslate: true });
    }

    const hash = await sha256(source);

    // ── Cache hit ──────────────────────────────────────────────────────────
    const { data: cached } = await supabase
      .from("listing_translations")
      .select("description, summary")
      .eq("listing_id", listing.id)
      .eq("lang", lang)
      .eq("source_hash", hash)
      .maybeSingle();

    if (cached) {
      return jsonResponse({
        cached: true,
        lang,
        description: cached.description,
        summary: cached.summary,
      });
    }

    // ── Translate ──────────────────────────────────────────────────────────
    const targetName = lang === "es" ? "Spanish (Latin American)" : "English";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `You translate used-car listing text into ${targetName}. ` +
              "Rules: translate faithfully and do not soften, strengthen, omit or add any claim " +
              "about the vehicle's condition, history, damage or mechanical state — a buyer will " +
              "make a purchase decision from this text. Keep numbers, units, measurements, VINs, " +
              "trim names, model names and manufacturer names exactly as written. Preserve the " +
              "seller's tone. If a phrase has no natural equivalent, keep the original in " +
              "parentheses after your translation. " +
              'Respond ONLY with JSON: {"description": string, "summary": string}. ' +
              "Use an empty string for any field whose input was empty.",
          },
          {
            role: "user",
            content: JSON.stringify({
              description: listing.description ?? "",
              summary: summary ?? "",
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("translate-listing: OpenAI error", res.status, detail);
      return jsonResponse({ error: "Translation service unavailable" }, 502);
    }

    const payload = await res.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "{}";

    let parsed: { description?: string; summary?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("translate-listing: unparseable model output", raw.slice(0, 300));
      return jsonResponse({ error: "Translation service returned bad data" }, 502);
    }

    const out = {
      description: String(parsed.description ?? ""),
      summary: String(parsed.summary ?? ""),
    };

    // ── Cache. Failure here is not fatal — the caller still gets its text ──
    const { error: cacheErr } = await supabase
      .from("listing_translations")
      .upsert(
        {
          listing_id: listing.id,
          lang,
          source_hash: hash,
          description: out.description,
          summary: out.summary,
        },
        { onConflict: "listing_id,lang" },
      );
    if (cacheErr) console.error("translate-listing: cache write failed", cacheErr.message);

    return jsonResponse({ cached: false, lang, ...out });
  } catch (err) {
    console.error("translate-listing error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
