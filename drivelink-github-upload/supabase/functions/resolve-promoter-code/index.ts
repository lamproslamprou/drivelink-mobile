// Resolves a standing Promoter code to a display name, and nothing else.
//
// Public on purpose: the person arriving on /p/:code is a stranger who has not
// signed in, and the deal screen has to tell them who referred them before it
// asks for an account. promoter_codes is RLS-scoped to its owner, so the
// service-role client is the only way to read it from an anonymous request.
//
// Returns a name or null. Never returns the user id, email, balance, or
// anything else about the promoter.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let code: unknown;
  try {
    ({ code } = await req.json());
  } catch {
    return json({ name: null });
  }

  if (typeof code !== "string" || code.length === 0 || code.length > 64) {
    return json({ name: null });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error } = await admin
    .from("promoter_codes")
    .select("user_id")
    .ilike("code", code)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("promoter code lookup failed:", error);
    return json({ name: null });
  }
  if (!row) return json({ name: null });

  const { data: profile } = await admin
    .from("users")
    .select("name")
    .eq("id", row.user_id)
    .maybeSingle();

  return json({ name: profile?.name ?? null });
});
