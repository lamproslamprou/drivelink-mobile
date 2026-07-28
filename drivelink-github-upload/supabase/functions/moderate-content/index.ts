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
}> = {
  listing: {
    table: "listings",
    // `vin` is excluded on purpose: structured alphanumeric, false positives only.
    textColumns: ["make", "model", "color", "description", "location_text"],
    ownerColumn: "seller_id",
    imageColumn: "image",
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
  threshold: number;
  decision: Decision;
  strikes: number;
  severity: "soft" | "hard";
  label: string;
}

// Tuned for a car marketplace. `violence` sits very high on purpose — listing
// copy is full of "this thing is a killer". Retune from real scores after a
// week; every check logs its full score vector to moderation_events.scores.
//
// self-harm rejects the content but never strikes or bans. Someone in crisis
// should not be punished by an automated system.
const POLICY: Record<string, Rule> = {
  "sexual/minors":          { threshold: 0.05, decision: "ban",    strikes: 0, severity: "hard", label: "sexual content involving minors" },
  "illicit/violent":        { threshold: 0.50, decision: "strike", strikes: 2, severity: "hard", label: "weapons or violent illicit content" },
  "harassment/threatening": { threshold: 0.40, decision: "strike", strikes: 2, severity: "hard", label: "threats" },
  "hate/threatening":       { threshold: 0.30, decision: "strike", strikes: 2, severity: "hard", label: "threatening hate speech" },
  "hate":                   { threshold: 0.50, decision: "strike", strikes: 1, severity: "hard", label: "hate speech" },
  "sexual":                 { threshold: 0.60, decision: "strike", strikes: 1, severity: "soft", label: "sexual content" },
  "violence/graphic":       { threshold: 0.70, decision: "strike", strikes: 1, severity: "soft", label: "graphic violence" },
  "illicit":                { threshold: 0.75, decision: "strike", strikes: 1, severity: "soft", label: "illicit content" },
  "harassment":             { threshold: 0.80, decision: "strike", strikes: 1, severity: "soft", label: "harassment" },
  "violence":               { threshold: 0.92, decision: "strike", strikes: 1, severity: "soft", label: "violent content" },
  "self-harm/instructions": { threshold: 0.50, decision: "reject", strikes: 0, severity: "soft", label: "self-harm instructions" },
  "self-harm/intent":       { threshold: 0.50, decision: "reject", strikes: 0, severity: "soft", label: "self-harm" },
  "self-harm":              { threshold: 0.60, decision: "reject", strikes: 0, severity: "soft", label: "self-harm" },
};

const STRIKE_LIMIT = 3;
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

  for (const [cat, score] of Object.entries(merged)) {
    const rule = POLICY[cat];
    if (!rule || score < rule.threshold) continue;
    if (
      !worst ||
      rank[rule.decision] > rank[worst.rule.decision] ||
      (rank[rule.decision] === rank[worst.rule.decision] &&
        rule.strikes > worst.rule.strikes)
    ) {
      worst = { rule, category: cat, score };
    }
  }

  const top = Object.entries(merged).sort((a, b) => b[1] - a[1])[0];
  return { hit: worst, scores: merged, topCategory: top?.[0] ?? null, topScore: top?.[1] ?? null };
}

/** Object path inside car-images, or null if the URL is external. */
function ownObjectPath(url: string): string | null {
  const i = url.indexOf(PUBLIC_PREFIX);
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_PREFIX.length).split("?")[0]);
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

  if (surface === "profile") {
    const text = (body.text ?? "").trim();
    if (!text) return json({ status: "approved" });
    inputs.push({ type: "text", text: text.slice(0, 8000) });
    excerpt = text.slice(0, 500);
  } else {
    if (!body.contentId) return json({ error: "contentId is required" }, 400);

    const cols = [...config!.textColumns, config!.ownerColumn];
    if (config!.imageColumn) cols.push(config!.imageColumn);

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
      excerpt = text.slice(0, 500);
    }

    if (config!.imageColumn) {
      const raw = r[config!.imageColumn];
      if (typeof raw === "string" && /^https?:\/\//i.test(raw.trim())) {
        imageUrl = raw.trim();
        inputs.push({ type: "image_url", image_url: { url: imageUrl } });
      }
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

  // --- classify (fail closed) ----------------------------------------------
  let results: ModerationResult[];
  try {
    results = await classify(inputs);
  } catch (e) {
    await admin.from("moderation_events").insert({
      user_id: userId,
      surface,
      content_id: body.contentId ?? null,
      action: "error",
      severity: "clean",
      excerpt: String(e).slice(0, 500),
    });
    return json({
      status: "pending",
      reason: "Moderation service unavailable. Your content is under review.",
    }, 202);
  }

  const { hit, scores, topCategory, topScore } = decide(results);

  // --- clean ---------------------------------------------------------------
  if (!hit) {
    if (config) {
      await admin
        .from(config.table)
        .update({ moderation_status: "approved", moderated_at: new Date().toISOString() })
        .eq("id", body.contentId);
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
  if (rule.severity === "hard" && imageUrl) {
    const objectPath = ownObjectPath(imageUrl);
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
