// Shared helpers used by every DriveLink Stripe edge function.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Service-role client — bypasses RLS. Only ever used inside edge functions,
// never exposed to the browser.
export function supabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function stripeClient() {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-06-20",
  });
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Verifies the caller's Supabase auth token and returns their user id.
// Every function that acts on behalf of a specific person calls this first —
// never trust a user_id passed in the request body alone.
export async function requireUser(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

// Sends a plain notification email via Resend. Requires RESEND_API_KEY to
// be set (supabase secrets set RESEND_API_KEY=re_...). Never throws — a
// failed notification email shouldn't break the actual business logic
// (a sale/ad purchase still succeeded even if this fails), so callers
// should call this without awaiting-and-failing-hard on it.
export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("sendEmail skipped — RESEND_API_KEY not set");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "DriveLink Notifications <notifications@drivelink.deals>",
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("sendEmail failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("sendEmail error:", err);
  }
}

// Platform + Promoter cut, mirrors the PLATFORM_FEE/PROMOTER_FEE constants
// in App.jsx. Keep these two files in sync if you ever change the percentages.
export const PLATFORM_FEE = 0.01;
export const PROMOTER_FEE = 0.01;
export const AUTO_RELEASE_DAYS = 7;
