import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomSuffix(len = 6): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function slugFromName(name: string | null): string {
  const cleaned = (name ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return cleaned.length >= 2 ? cleaned : "DL";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Sign in to get a Promoter code." }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userErr || !userData?.user) {
    return json({ error: "Sign in to get a Promoter code." }, 401);
  }
  const userId = userData.user.id;

  const { data: existing, error: existingErr } = await admin
    .from("promoter_codes")
    .select("code")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (existingErr) {
    console.error("promoter_codes lookup failed:", existingErr);
    return json({ error: "Couldn't look up your code. Try again." }, 500);
  }
  if (existing?.code) {
    return json({ code: existing.code, created: false });
  }

  const { data: profile } = await admin
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();

  const prefix = slugFromName(profile?.name ?? null);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${prefix}-${randomSuffix()}`;
    const { error: insertErr } = await admin
      .from("promoter_codes")
      .insert({ code, user_id: userId, active: true });

    if (!insertErr) return json({ code, created: true });

    if (insertErr.code === "23505") {
      const { data: raced } = await admin
        .from("promoter_codes")
        .select("code")
        .eq("user_id", userId)
        .eq("active", true)
        .maybeSingle();
      if (raced?.code) return json({ code: raced.code, created: false });
      continue;
    }

    console.error("promoter_codes insert failed:", insertErr);
    return json({ error: "Couldn't create your code. Try again." }, 500);
  }

  return json({ error: "Couldn't create your code. Try again." }, 500);
});
