// ============================================================================
// DriveLink — moderate-content Edge Function
//
// Single chokepoint for user-generated content moderation.
// Classifier: OpenAI omni-moderation-latest (free, text + images).
//
// POST body:
//   { surface: "listing" | "message", contentId: "<row id>" }
//   { surface: "profile", text: "..." }
//
// Response:
//   { status: "approved" | "rejected" | "blocked" | "pending",
//     reason?, category?, strikes? }
//
// FAILS CLOSED: if OpenAI is unreachable, content stays 'pending', which the
// listings_hide_unapproved RESTRICTIVE policy makes invisible to everyone but
// the author.
//
// IMAGES: listings.image is a single URL that may point at car-images OR at
// any external host. The classifier accepts an arbitrary image URL, so the
// listing check sends text fields and the image together in one request.
// That covers pasted external URLs, which a staging-bucket upload flow would
// have missed entirely.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// ---------------------------------------------------------------------------
// Schema config — verified against information_schema on 2026-07-28.
// listings has NO `title` column; messages uses `body`, not `content`.
// ---------------------------------------------------------------------------
const SURFACES: Record<string, {
  table: string;
  textColumns: string[];
  ownerColumn: string;
  imageColumn?: string;
  imageArrayColumn?: string;
}> = {
  listing: {
    table: "listings",
    // `vin` is excluded on purpose: structured alphanumeric, false positives only.
    textColumns: ["make", "model", "color", "description", "location_text"],
    ownerColumn: "seller_id",
    imageColumn: "image",
    // listings.images is a JSON array of up to ~20 photos. Checking only the
    // first one let a seller put a clean car photo in `image` and anything
    // they liked in the rest.
    imageArrayColumn: "images",
  },
  message: {
    table: "messages",
    textColumns: ["body"],
    ownerColumn: "sender_id",
  },
};

const PUBLIC_IMAGE_BUCKET = "car-images";
const QUARANTINE_BUCKET = "quarantine";
const PUBLIC_PREFIX = `/storage/v1/object/public/${PUBLIC_IMAGE_BUCKET}/`;

type Decision = "reject" | "strike" | "ban";

interface Rule {
  hold: number;       // >= this but < threshold: hold for manual review
  threshold: number;  // >= this: act (reject / strike / ban)
  decision: Decision;
  strikes: number;
  severity: "soft" | "hard";
  label: string;
}

// THREE TIERS, not two:
//   score >= threshold  -> reject / strike / ban
//   score >= hold       -> stays 'pending' (invisible) and goes to the admin
//                          queue for a human decision. No strike.
//   below both          -> approved
//
// The hold band is what makes this strict without punishing false positives.
// Nothing borderline reaches buyers, but a seller writing "this thing is an
// absolute killer" gets a short review rather than a strike on their account.
//
// self-harm rejects the content but never strikes or bans. Someone in crisis
// should not be punished by an automated system.
const POLICY: Record<string, Rule> = {
  "sexual/minors":          { hold: 0.01, threshold: 0.03, decision: "ban",    strikes: 0, severity: "hard", label: "sexual content involving minors" },
  "illicit/violent":        { hold: 0.20, threshold: 0.40, decision: "strike", strikes: 2, severity: "hard", label: "weapons or violent illicit content" },
  "harassment/threatening": { hold: 0.15, threshold: 0.30, decision: "strike", strikes: 2, severity: "hard", label: "threats" },
  "hate/threatening":       { hold: 0.10, threshold: 0.20, decision: "strike", strikes: 2, severity: "hard", label: "threatening hate speech" },
  "hate":                   { hold: 0.15, threshold: 0.35, decision: "strike", strikes: 1, severity: "hard", label: "hate speech" },
  "sexual":                 { hold: 0.20, threshold: 0.45, decision: "strike", strikes: 1, severity: "soft", label: "sexual content" },
  "violence/graphic":       { hold: 0.25, threshold: 0.55, decision: "strike", strikes: 1, severity: "soft", label: "graphic violence" },
  "illicit":                { hold: 0.30, threshold: 0.60, decision: "strike", strikes: 1, severity: "soft", label: "illicit content" },
  "harassment":             { hold: 0.35, threshold: 0.65, decision: "strike", strikes: 1, severity: "soft", label: "harassment" },
  "violence":               { hold: 0.50, threshold: 0.85, decision: "strike", strikes: 1, severity: "soft", label: "violent content" },
  "self-harm/instructions": { hold: 0.25, threshold: 0.45, decision: "reject", strikes: 0, severity: "soft", label: "self-harm instructions" },
  "self-harm/intent":       { hold: 0.25, threshold: 0.45, decision: "reject", strikes: 0, severity: "soft", label: "self-harm" },
  "self-harm":              { hold: 0.30, threshold: 0.55, decision: "reject", strikes: 0, severity: "soft", label: "self-harm" },
};

const STRIKE_LIMIT = 3;
// Cap per request. Every photo is checked, but a listing with 20 images
// would otherwise make one very slow call.
const MAX_IMAGES = 10;
const PERMANENT_BAN = "876000h"; // 100 years

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

interface ModerationResult {
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

async function classify(
  input: Array<Record<string, unknown>>,
): Promise<ModerationResult[]> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()).results ?? [];
}

/** Worst hit across every input in the request. */
function decide(results: ModerationResult[]) {
  const merged: Record<string, number> = {};
  for (const r of results) {
    for (const [cat, score] of Object.entries(r.category_scores ?? {})) {
      merged[cat] = Math.max(merged[cat] ?? 0, score as number);
    }
  }

  const rank: Record<Decision, number> = { reject: 1, strike: 2, ban: 3 };
  let worst: { rule: Rule; category: string; score: number } | null = null;
  let held: { rule: Rule; category: string; score: number } | null = null;

  for (const [cat, score] of Object.entries(merged)) {
    const rule = POLICY[cat];
    if (!rule) continue;

    if (score >= rule.threshold) {
      if (
        !worst ||
        rank[rule.decision] > rank[worst.rule.decision] ||
        (rank[rule.decision] === rank[worst.rule.decision] &&
          rule.strikes > worst.rule.strikes)
      ) {
        worst = { rule, category: cat, score };
      }
    } else if (score >= rule.hold) {
      // Track the hold candidate that cleared its band by the widest margin.
      if (!held || score / rule.hold > held.score / held.rule.hold) {
        held = { rule, category: cat, score };
      }
    }
  }

  const top = Object.entries(merged).sort((a, b) => b[1] - a[1])[0];
  return {
    hit: worst,
    held,
    scores: merged,
    topCategory: top?.[0] ?? null,
    topScore: top?.[1] ?? null,
  };
}

/**
 * Defeat basic filter evasion. The classifier handles natural language well
 * but is weaker against deliberate obfuscation: "h4te", "s l u r", "hαte"
 * with a Greek alpha. Normalizing and submitting BOTH the raw and normalized
 * text costs nothing (same request, two inputs) and the worst score across
 * either one wins.
 */
function normalize(text: string): string {
  let t = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // Cyrillic and Greek homoglyphs commonly used to dodge filters
  const homoglyphs: Record<string, string> = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y",
    "і": "i", "ѕ": "s", "ν": "v", "α": "a", "ο": "o", "ρ": "p", "τ": "t",
    "κ": "k", "ε": "e", "ι": "i",
  };
  t = t.replace(/[аеорсхуіѕναορτκει]/g, (c) => homoglyphs[c] ?? c);

  // Leetspeak
  t = t.toLowerCase()
    .replace(/[4@]/g, "a").replace(/[3]/g, "e").replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o").replace(/[5$]/g, "s").replace(/[7]/g, "t");

  // Collapse letter-spacing ("s l u r") and character runs ("sluuuur")
  t = t.replace(/\b(?:[a-z]\s){2,}[a-z]\b/g, (m) => m.replace(/\s/g, ""));
  t = t.replace(/(.)\1{2,}/g, "$1$1");

  // Strip separators used to break up words
  t = t.replace(/[._\-*+]/g, "");

  return t.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Profanity list.
//
// The classifier scores HARM (hate, threats, sexual, violence). It has no
// profanity category at all, so "Jesus Fucking Christ" as a display name
// scores clean on every axis and gets approved. That is correct behaviour for
// the model and wrong for a marketplace.
//
// Division of labour: the classifier catches slurs and threats, this list
// catches obscenity. Applied to the surfaces in PROFANITY_SURFACES only —
// listing copy tolerates the odd swear word, a display name shown next to
// every listing does not.
// ---------------------------------------------------------------------------
const PROFANITY_SURFACES = ["profile"];

const PROFANITY = [
  "fuck", "shit", "cunt", "bitch", "bastard", "asshole", "arsehole",
  "pussy", "twat", "wank", "bollocks", "prick",
  // "dick" and "cock" are deliberately absent: Dick is a given name and Cock
  // is a surname. On a display-name filter that false positive is worse than
  // the miss.
  "slut", "whore", "piss", "crap", "damn", "goddamn", "jerkoff",
  "motherfucker", "bullshit", "dumbass", "jackass", "douche",
];

const PROFANITY_RE = new RegExp(
  `\\b(${PROFANITY.join("|")})(s|es|ed|ing|er|ers)?\\b`,
  "i",
);

/** Returns the matched word, or null. Checks normalized text so l33t is caught. */
function findProfanity(text: string): string | null {
  for (const candidate of [text, normalize(text)]) {
    const m = candidate.match(PROFANITY_RE);
    if (m) return m[1];
  }
  return null;
}

/** Object path inside car-images, or null if the URL is external. */
function ownObjectPath(url: string): string | null {
  const i = url.indexOf(PUBLIC_PREFIX);
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_PREFIX.length).split("?")[0]);
}

/** Log the failure and leave the row pending — invisible, which is safe. */
async function failClosed(
  admin: ReturnType<typeof createClient>,
  userId: string,
  surface: string,
  contentId: string | null,
  message: string,
) {
  await admin.from("moderation_events").insert({
    user_id: userId,
    surface,
    content_id: contentId,
    action: "error",
    severity: "clean",
    excerpt: message.slice(0, 500),
  });
  return json({
    status: "pending",
    reason: "Moderation service unavailable. Your content is under review.",
  }, 202);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing Authorization header" }, 401);

  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return json({ error: "Invalid token" }, 401);

  const userId = authData.user.id;

  const { data: userRow } = await admin
    .from("users")
    .select("id, moderation_strikes, blocked_at")
    .eq("id", userId)
    .maybeSingle();

  if (userRow?.blocked_at) {
    return json({ status: "blocked", reason: "Account suspended." }, 403);
  }

  let body: { surface?: string; contentId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const surface = body.surface ?? "";
  const config = SURFACES[surface];
  if (surface !== "profile" && !config) {
    return json({ error: `Unknown surface: ${surface}` }, 400);
  }

  // --- gather inputs -------------------------------------------------------
  // Always re-read from the database. Trusting a client-supplied copy of the
  // text is the entire bypass: send clean text, insert dirty text.
  const inputs: Array<Record<string, unknown>> = [];
  let excerpt = "";
  let imageUrl: string | null = null;
  let imageUrls: string[] = [];
  let proposedName: string | null = null;

  if (surface === "profile") {
    // Read the proposed name from the database, never from the request body.
    // A client-supplied string could differ from what was actually stored.
    const { data: prof, error: profErr } = await admin
      .from("users")
      .select("pending_name, name_status")
      .eq("id", userId)
      .maybeSingle();

    if (profErr) return json({ error: `Read failed: ${profErr.message}` }, 500);

    const text = (prof?.pending_name ?? "").trim();
    if (!text) return json({ status: "approved" });

    inputs.push({ type: "text", text: text.slice(0, 8000) });
    const norm = normalize(text);
    if (norm && norm !== text.toLowerCase()) {
      inputs.push({ type: "text", text: norm.slice(0, 8000) });
    }
    excerpt = text.slice(0, 500);
    proposedName = text;
  } else {
    if (!body.contentId) return json({ error: "contentId is required" }, 400);

    const cols = [...config!.textColumns, config!.ownerColumn];
    if (config!.imageColumn) cols.push(config!.imageColumn);
    if (config!.imageArrayColumn) cols.push(config!.imageArrayColumn);

    const { data: row, error: rowErr } = await admin
      .from(config!.table)
      .select(cols.join(","))
      .eq("id", body.contentId)
      .maybeSingle();

    if (rowErr) return json({ error: `Read failed: ${rowErr.message}` }, 500);
    if (!row) return json({ error: "Content not found" }, 404);

    const r = row as Record<string, unknown>;
    if (r[config!.ownerColumn] !== userId) {
      return json({ error: "Not your content" }, 403);
    }

    const text = config!.textColumns
      .map((c) => r[c])
      .filter((v) => typeof v === "string" && (v as string).trim())
      .join("\n\n");

    if (text.trim()) {
      inputs.push({ type: "text", text: text.slice(0, 8000) });
      const norm = normalize(text);
      if (norm && norm !== text.toLowerCase()) {
        inputs.push({ type: "text", text: norm.slice(0, 8000) });
      }
      excerpt = text.slice(0, 500);
    }

    // Collect every photo: the primary URL plus the array.
    const urls: string[] = [];
    if (config!.imageColumn) {
      const raw = r[config!.imageColumn];
      if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) {
        urls.push(raw.trim());
      }
    }
    if (config!.imageArrayColumn) {
      let arr = r[config!.imageArrayColumn];
      if (typeof arr === "string") {
        try { arr = JSON.parse(arr); } catch { arr = null; }
      }
      if (Array.isArray(arr)) {
        for (const u of arr) {
          if (typeof u === "string" && /^https?:\/\//i.test(u.trim())) {
            urls.push(u.trim());
          }
        }
      }
    }

    imageUrls = [...new Set(urls)].slice(0, MAX_IMAGES);
    imageUrl = imageUrls[0] ?? null;
    for (const u of imageUrls) {
      inputs.push({ type: "image_url", image_url: { url: u } });
    }
  }

  if (inputs.length === 0) {
    if (config) {
      await admin
        .from(config.table)
        .update({ moderation_status: "approved", moderated_at: new Date().toISOString() })
        .eq("id", body.contentId);
    }
    return json({ status: "approved" });
  }

  // --- profanity (deterministic, before the classifier) --------------------
  if (PROFANITY_SURFACES.includes(surface)) {
    const word = findProfanity(excerpt);
    if (word) {
      if (surface === "profile") {
        await admin
          .from("users")
          .update({ pending_name: null, name_status: "rejected" })
          .eq("id", userId);
      }
      await admin.from("moderation_events").insert({
        user_id: userId,
        surface,
        content_id: body.contentId ?? null,
        action: "reject",
        severity: "soft",
        top_category: "profanity",
        excerpt: excerpt.slice(0, 500),
      });
      return json({
        status: "rejected",
        category: "profanity",
        reason: "Display names can't contain profanity. Please choose another.",
      });
    }
  }

  // --- classify (fail closed) ----------------------------------------------
  // A dead image URL makes the whole request 400, which would strand the row
  // in 'pending' forever. Retry text-only, but do NOT auto-approve: an image
  // we could not check is an unverified image, so it goes to review instead.
  let results: ModerationResult[];
  let imageUnverified = false;
  try {
    results = await classify(inputs);
  } catch (e0) {
    const msg = String(e0);
    const imageFailed = /Failed to download image|invalid_image|unsupported image|timed out/i.test(msg);
    const textOnly = inputs.filter((i) => i.type === "text");

    if (imageFailed && textOnly.length > 0) {
      try {
        results = await classify(textOnly);
        imageUnverified = true;
      } catch (e1) {
        return await failClosed(admin, userId, surface, body.contentId ?? null, String(e1));
      }
    } else {
      return await failClosed(admin, userId, surface, body.contentId ?? null, msg);
    }
  }


  const { hit, held, scores, topCategory, topScore } = decide(results);

  // --- hold for review -----------------------------------------------------
  // Below the action threshold but above the hold band. The row stays
  // 'pending', so RLS keeps it invisible to everyone but its author, and it
  // lands in admin_moderation_queue for a human call. No strike is applied.
  if (!hit && !held && imageUnverified) {
    await admin.from("moderation_events").insert({
      user_id: userId, surface, content_id: body.contentId ?? null,
      action: "hold", severity: "soft",
      top_category: "image_unverified", top_score: null, scores,
      excerpt: `Text clean, image could not be fetched: ${imageUrl}`.slice(0, 500),
    });
    return json({
      status: "held",
      reason: "We couldn't load your photo, so this is being reviewed before it goes live. Re-uploading the image usually fixes it.",
    });
  }

  if (!hit && held && surface === "profile") {
    await admin.from("moderation_events").insert({
      user_id: userId, surface, content_id: null,
      action: "hold", severity: held.rule.severity,
      top_category: held.category, top_score: held.score, scores,
      excerpt: `Proposed display name held: ${proposedName}`.slice(0, 500),
    });
    return json({
      status: "held",
      reason: "Your new display name is being reviewed. Your current name stays visible until then.",
    });
  }

  if (!hit && held) {
    await admin.from("moderation_events").insert({
      user_id: userId,
      surface,
      content_id: body.contentId ?? null,
      action: "hold",
      severity: held.rule.severity,
      top_category: held.category,
      top_score: held.score,
      scores,
      excerpt: imageUrl ? `${excerpt}\n[image] ${imageUrl}`.slice(0, 500) : excerpt,
    });
    return json({
      status: "held",
      reason: "This is being reviewed before it goes live. You'll usually see it published within a few hours.",
    });
  }

  // --- clean ---------------------------------------------------------------
  if (!hit) {
    if (config) {
      await admin
        .from(config.table)
        .update({ moderation_status: "approved", moderated_at: new Date().toISOString() })
        .eq("id", body.contentId);
    }
    if (surface === "profile" && proposedName) {
      // Service role, so guard_display_name lets this through.
      await admin
        .from("users")
        .update({ name: proposedName, pending_name: null, name_status: "approved" })
        .eq("id", userId);
    }
    await admin.from("moderation_events").insert({
      user_id: userId,
      surface,
      content_id: body.contentId ?? null,
      action: "allow",
      severity: "clean",
      top_category: topCategory,
      top_score: topScore,
      scores,
      reviewed_at: new Date().toISOString(),
    });
    return json({ status: "approved" });
  }

  // --- violation -----------------------------------------------------------
  const { rule, category, score } = hit;
  let quarantinePath: string | null = null;

  // Preserve evidence for hard violations rather than deleting it. A
  // sexual/minors hit carries a US reporting obligation under 18 USC 2258A.
  // External URLs cannot be captured — the logged URL is all there is.
  for (const u of (rule.severity === "hard" ? imageUrls : [])) {
    const objectPath = ownObjectPath(u);
    if (objectPath) {
      try {
        const { data: file } = await admin.storage.from(PUBLIC_IMAGE_BUCKET).download(objectPath);
        if (file) {
          quarantinePath = `${userId}/${Date.now()}-${objectPath.split("/").pop()}`;
          await admin.storage.from(QUARANTINE_BUCKET).upload(quarantinePath, file, {
            contentType: file.type || "image/jpeg",
            upsert: true,
          });
          await admin.storage.from(PUBLIC_IMAGE_BUCKET).remove([objectPath]);
        }
      } catch (e) {
        console.error("quarantine failed:", e);
      }
    }
  }

  if (config) {
    await admin
      .from(config.table)
      .update({ moderation_status: "rejected", moderated_at: new Date().toISOString() })
      .eq("id", body.contentId);
  }
  if (surface === "profile") {
    // Drop the proposed name; the approved one on `name` is untouched.
    await admin
      .from("users")
      .update({ pending_name: null, name_status: "rejected" })
      .eq("id", userId);
  }

  const priorStrikes = userRow?.moderation_strikes ?? 0;
  const newStrikes = priorStrikes + rule.strikes;
  const shouldBan = rule.decision === "ban" || newStrikes >= STRIKE_LIMIT;

  if (rule.strikes > 0 || shouldBan) {
    await admin
      .from("users")
      .update({
        moderation_strikes: newStrikes,
        ...(shouldBan
          ? {
              blocked_at: new Date().toISOString(),
              blocked_reason:
                rule.decision === "ban"
                  ? `Auto-ban: ${rule.label}`
                  : `Auto-ban: ${newStrikes} policy violations (latest: ${rule.label})`,
            }
          : {}),
      })
      .eq("id", userId);
  }

  if (shouldBan) {
    await admin.auth.admin.updateUserById(userId, { ban_duration: PERMANENT_BAN });

    // Pull everything of theirs down. Uses `status` too, since anything
    // running with the service role bypasses RLS and would still see them.
    await admin
      .from("listings")
      .update({ moderation_status: "rejected", status: "archived", moderated_at: new Date().toISOString() })
      .eq("seller_id", userId)
      .neq("moderation_status", "rejected");

    await admin
      .from("messages")
      .update({ moderation_status: "rejected", moderated_at: new Date().toISOString() })
      .eq("sender_id", userId)
      .neq("moderation_status", "rejected");
  }

  await admin.from("moderation_events").insert({
    user_id: userId,
    surface,
    content_id: body.contentId ?? null,
    action: shouldBan ? "ban" : rule.decision,
    severity: rule.severity,
    top_category: category,
    top_score: score,
    scores,
    excerpt: imageUrl ? `${excerpt}\n[image] ${imageUrl}`.slice(0, 500) : excerpt,
    storage_path: quarantinePath,
  });

  if (shouldBan) {
    return json({
      status: "blocked",
      reason: "Your account has been suspended for violating our content policy. Contact support@drivelink.deals to appeal.",
    }, 403);
  }

  return json({
    status: "rejected",
    category: rule.label,
    strikes: newStrikes,
    reason: rule.strikes > 0
      ? `This content was rejected (${rule.label}). Warning ${newStrikes} of ${STRIKE_LIMIT} — further violations will suspend your account.`
      : `This content was rejected (${rule.label}).`,
  });
});
