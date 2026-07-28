// POST /delete-user
// Admin-only, gated by users.role = 'admin' (same source of truth as the
// frontend Admin tab and every other admin-gated function).
//
// Deletion has to happen in three places, in this order:
//
//   1. Storage objects — storage.objects references auth.users and does NOT
//      cascade. Files left behind make step 3 fail with the unhelpful
//      "Database error deleting user".
//   2. Database rows    — public.users.id is `text` and auth.users.id is
//      `uuid`, so there is no FK between them. Deleting the auth account
//      does not touch public.users.
//   3. auth.users       — last, because steps 1 and 2 depend on it existing.
//
// The previous version did 3 then 2, with no transaction. When step 2 failed
// on a foreign key the account was left half-deleted: login gone, profile row
// orphaned, no rollback. Doing auth last means a failure leaves the account
// intact and retryable instead.
//
// Request:  { user_id: string, mode?: "anonymize" | "purge", force?: boolean }
// Response: { deleted, name, email, hadAuthAccount, mode, storage, database }
//           (superset of the old shape — the Admin tab keeps working)
//
// MODES
//   anonymize (default) — scrubs name/phone/address/avatar, replaces email
//     with deleted+<id>@drivelink.invalid, sets deleted_at, deletes listings
//     and messages. KEEPS the users row, so orders/transactions/payouts and
//     moderation_events stay referentially intact and the frontend renders
//     "[deleted]" instead of blank spots where seller?.name used to resolve.
//     This is strictly better than the old behaviour for real accounts.
//   purge — deletes the users row outright. For test/seed accounts.
//
// NOTE: for abusive accounts, ban rather than delete. Deletion frees the
// email for re-registration and destroys the moderation audit trail.

import {
  corsHeaders,
  jsonResponse,
  requireUser,
  supabaseAdmin,
} from "../_shared/helpers.ts";

// `quarantine` is deliberately absent — that is preserved evidence and must
// survive account deletion.
const PURGE_BUCKETS = ["car-images", "pending-images", "avatars"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recursively collect every object path under a user's folder. */
async function collectPaths(
  supabase: ReturnType<typeof supabaseAdmin>,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 3) return [];

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });

  if (error || !data) return [];

  const paths: string[] = [];
  for (const item of data) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      paths.push(...(await collectPaths(supabase, bucket, full, depth + 1)));
    } else {
      paths.push(full);
    }
  }
  return paths;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const callerId = await requireUser(req);
    const { user_id, mode: rawMode, force } = await req.json();

    if (!user_id) throw new Error("user_id is required");
    if (user_id === callerId) {
      throw new Error("You can't delete your own account this way");
    }

    const mode = rawMode === "purge" ? "purge" : "anonymize";
    const supabase = supabaseAdmin();

    const { data: caller } = await supabase
      .from("users").select("role").eq("id", callerId).single();
    if (caller?.role !== "admin") {
      throw new Error("Not authorized to delete users");
    }

    const { data: target } = await supabase
      .from("users").select("id, name, email").eq("id", user_id).single();
    if (!target) throw new Error("User not found");

    // --- evidence guard ---------------------------------------------------
    // Never let a purge destroy the record of a hard violation. Ban instead.
    const { data: hardEvents } = await supabase
      .from("moderation_events")
      .select("id, top_category, created_at")
      .eq("user_id", user_id)
      .eq("severity", "hard")
      .limit(5);

    if (mode === "purge" && hardEvents?.length && !force) {
      return jsonResponse({
        error:
          "This account has hard moderation violations on record. Purging destroys evidence you may be required to retain. Ban it instead, or resend with force: true.",
        events: hardEvents,
      }, 409);
    }

    // --- 1. storage -------------------------------------------------------
    const storage: Record<string, number> = {};
    for (const bucket of PURGE_BUCKETS) {
      try {
        const paths = await collectPaths(supabase, bucket, user_id);
        if (!paths.length) continue;
        for (let i = 0; i < paths.length; i += 100) {
          await supabase.storage.from(bucket).remove(paths.slice(i, i + 100));
        }
        storage[bucket] = paths.length;
      } catch (e) {
        // A missing bucket is fine; a real failure should not abort the run,
        // but it must be visible in the response.
        storage[bucket] = -1;
        console.error(`storage purge failed for ${bucket}:`, e);
      }
    }

    // --- 2. database ------------------------------------------------------
    const { data: dbResult, error: dbError } = await supabase.rpc(
      "admin_delete_user",
      { target_user_id: user_id, mode },
    );
    if (dbError) {
      throw new Error(`Couldn't remove database rows: ${dbError.message}`);
    }

    // --- 3. auth ----------------------------------------------------------
    // Some accounts — especially older test/seed data — exist only as a users
    // row with no matching Supabase Auth account (their id isn't a real auth
    // UUID). Only attempt the auth deletion if the id is UUID-shaped.
    const hadAuthAccount = UUID_RE.test(user_id);
    if (hadAuthAccount) {
      const { error: authErr } = await supabase.auth.admin.deleteUser(user_id);
      if (authErr) {
        // Steps 1 and 2 are already done, so failing here would strand the
        // account in a usable state. Ban it so it cannot be logged into
        // while you work out what is still holding the reference.
        await supabase.auth.admin.updateUserById(user_id, {
          ban_duration: "876000h",
        });
        return jsonResponse({
          deleted: false,
          banned: true,
          name: target.name,
          email: target.email,
          hadAuthAccount,
          mode,
          storage,
          database: dbResult,
          error: `Data removed and account locked, but the auth record could not be deleted: ${authErr.message}`,
        }, 500);
      }
    }

    return jsonResponse({
      deleted: true,
      name: target.name,
      email: target.email,
      hadAuthAccount,
      mode,
      storage,
      database: dbResult,
    });
  } catch (err) {
    console.error("delete-user error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
