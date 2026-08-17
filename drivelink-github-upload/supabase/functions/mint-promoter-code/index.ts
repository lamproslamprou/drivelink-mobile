// supabase/functions/mint-promoter-code/index.ts
//
// POST /mint-promoter-code
// Called by the self-serve Promoter page at /promoter when a signed-in user
// asks for their share code.
//
// The minting logic itself moved to _shared/promoter.ts on 2026-08-17 so that
// release-funds can mint a seller's code at payout time using the exact same
// collision-retry and idempotency rules. This file is now just auth plus the
// HTTP shape the frontend already expects.
//
// RESPONSE SHAPE IS UNCHANGED: { code, created } on success, { error } on
// failure, same status codes as before. The Promoter page is live and reads
// these fields — do not rename them.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensurePromoterCode } from "../_shared/promoter.ts";

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

  // ensurePromoterCode never throws. A null code means it could not mint, and
  // the reason is already in the function logs.
  const result = await ensurePromoterCode(admin, userData.user.id);

  if (!result.code) {
    return json({ error: "Couldn't create your code. Try again." }, 500);
  }

  return json({ code: result.code, created: result.created });
});
