// POST /delete-user
// Admin-only, gated by users.role = 'admin' (same source of truth as the
// frontend Admin tab and every other admin-gated function). Removes a
// person's ability to log in entirely (deletes their Supabase Auth account
// via the admin API, which only works with the service role key — this
// can't be done from the browser) and removes their row from the users
// table.
//
// IMPORTANT — what this does NOT do: it does not touch their historical
// listings, offers, messages, referrals, reviews, disputes, or payouts.
// Those rows stay in place with a seller_id/buyer_id/user_id that no longer
// resolves to anyone — the frontend already handles a missing user
// gracefully in most places (e.g. `seller?.name`), but you'll see "Unknown"
// or blank spots where their name used to show. This is intentional: for
// real accounts with real transaction history, silently deleting that
// history alongside the login would destroy records you may need later
// (disputes, tax/accounting, etc). For pure test accounts with no real
// activity, that's a non-issue.
import { corsHeaders, jsonResponse, requireUser, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { user_id } = await req.json();
    if (!user_id) throw new Error("user_id is required");
    if (user_id === callerId) throw new Error("You can't delete your own account this way");

    const supabase = supabaseAdmin();

    const { data: caller } = await supabase.from("users").select("role").eq("id", callerId).single();
    if (caller?.role !== "admin") throw new Error("Not authorized to delete users");

    const { data: target } = await supabase.from("users").select("id, name, email").eq("id", user_id).single();
    if (!target) throw new Error("User not found");

    // Some accounts — especially older test/seed data — exist only as a
    // users table row with no matching Supabase Auth account (their id
    // isn't a real auth UUID). Only attempt the auth deletion if the id is
    // actually UUID-shaped; otherwise there's no login to remove anyway.
    const isRealAuthId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id);

    if (isRealAuthId) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(user_id);
      if (authErr) throw new Error(`Couldn't delete auth account: ${authErr.message}`);
    }

    const { error: rowErr } = await supabase.from("users").delete().eq("id", user_id);
    if (rowErr) throw new Error(`${isRealAuthId ? "Auth account deleted, but couldn't" : "Couldn't"} remove users row: ${rowErr.message}`);

    return jsonResponse({ deleted: true, name: target.name, email: target.email, hadAuthAccount: isRealAuthId });
  } catch (err) {
    console.error("delete-user error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
