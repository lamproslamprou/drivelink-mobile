// POST /payout-promoter
//
// Admin-only, gated by a fresh users.role = 'admin' read — one source of
// truth for who's an admin. Sends a real Stripe transfer to a promoter's
// connected account. Falls back gracefully: if the promoter hasn't set up
// payouts, the frontend keeps using the manual record-payout path.
//
// ORDERING (this is the important part):
//   1. debit the balance atomically  — fails safe if insufficient
//   2. transfer via Stripe           — idempotent, cannot double-send
//   3. record the payout row
//   4. if 2 fails, credit the balance back
//
// The old order (check → transfer → insert → decrement) meant a failure
// after the transfer left the promoter paid with their balance intact,
// so they could be paid again. Debiting first inverts the failure mode:
// the worst case is a debit with no transfer, which is visible in the
// balance and correctable, rather than silent money loss.
//
// MONEY IS CENTS. As of migration 20260803_05_money_to_cents, users.balance
// and payouts.amount are CENTS, the frontend sends `amount` in CENTS, and
// Stripe transfers are cents. There is no conversion anywhere in this file.
// The debit RPC and the payouts insert were already unit-agnostic and stayed
// correct through the conversion; only the Stripe transfer had a `* 100`, and
// leaving it would have sent a promoter one hundred times their payout with
// nothing downstream to reject it.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = supabaseAdmin();

  // Declared out here so the catch block can tell whether a rollback is owed.
  let debited = false;
  let promoterId: string | null = null;
  let debitAmount = 0;

  try {
    const callerId = await requireUser(req);
    const { user_id, amount, note, idempotency_key } = await req.json();

    if (!user_id || amount == null || Number(amount) <= 0) {
      return jsonResponse({ error: "user_id and a positive amount are required" }, 400);
    }

    const stripe = stripeClient();

    // --- authorization: read the caller's role from the database, never
    // --- from the request body or the JWT's claims.
    const { data: caller } = await supabase
      .from("users").select("role").eq("id", callerId).single();
    if (caller?.role !== "admin") {
      return jsonResponse({ error: "Not authorized to issue payouts" }, 403);
    }

    const { data: promoter, error: promoterErr } = await supabase
      .from("users")
      .select("id, name, balance, stripe_account_id, stripe_payouts_enabled")
      .eq("id", user_id)
      .single();
    if (promoterErr || !promoter) {
      return jsonResponse({ error: "Promoter not found" }, 404);
    }
    if (!promoter.stripe_payouts_enabled || !promoter.stripe_account_id) {
      return jsonResponse({
        error: "This promoter hasn't set up Stripe payouts — use the manual record-payout flow instead",
      }, 409);
    }

    // --- 1. atomic debit -----------------------------------------------------
    // Replaces read-then-compare. Two concurrent calls can't both succeed:
    // the second sees the decremented balance and updates no rows.
    const { data: newBalance, error: debitErr } = await supabase.rpc(
      "debit_promoter_balance",
      { p_user_id: promoter.id, p_amount: Number(amount) },
    );

    if (debitErr) {
      return jsonResponse({ error: `Couldn't debit balance: ${debitErr.message}` }, 500);
    }
    if (newBalance === null) {
      return jsonResponse({
        error: `Amount exceeds ${promoter.name ?? "promoter"}'s tracked balance`,
      }, 409);
    }

    debited = true;
    promoterId = promoter.id;
    debitAmount = Number(amount);

    // --- 2. transfer ---------------------------------------------------------
    // The idempotency key is what stops a double-click, a client retry, or a
    // dropped response from sending the money twice. Stripe remembers keys for
    // 24h and returns the ORIGINAL transfer instead of creating a second one.
    //
    // Default key is deterministic from the payout's contents, so a retry of
    // the same payout is deduped. Consequence: two genuinely separate payouts
    // of the same amount to the same promoter within 24h need a distinguishing
    // note, or an explicit idempotency_key from the caller.
    const key = idempotency_key ??
      `promoter_payout_${promoter.id}_${amount}_${note ?? ""}`;

    const transfer = await stripe.transfers.create({
      // Already cents. No conversion — see the note at the top of this file.
      amount: Math.round(Number(amount)),
      currency: "usd",
      destination: promoter.stripe_account_id,
      transfer_group: `promoter_payout_${promoter.id}`,
      metadata: {
        promoter_id: promoter.id,
        issued_by: callerId,
        note: note ?? "",
      },
    }, { idempotencyKey: key });

    // --- 3. record -----------------------------------------------------------
    // The money is already gone at this point, so a failure here must NOT roll
    // back the debit — the balance is correct, only the audit row is missing.
    // Surface it loudly so it can be reconciled by hand.
    const { error: insertErr } = await supabase.from("payouts").insert({
      id: "po" + Date.now(),
      user_id: promoter.id,
      amount,
      method: "Stripe",
      note: note || null,
      stripe_transfer_id: transfer.id,
    });

    if (insertErr) {
      console.error("PAYOUT RECORDED IN STRIPE BUT NOT IN DB", {
        transfer: transfer.id, promoter: promoter.id, amount,
      });
      return jsonResponse({
        error: `Transfer ${transfer.id} succeeded and the balance was debited, but the payout row failed to save: ${insertErr.message}. Record it manually.`,
        transferId: transfer.id,
        transferred: amount,
      }, 500);
    }

    return jsonResponse({
      transferred: amount,
      transferId: transfer.id,
      remainingBalance: newBalance,
    });
  } catch (err) {
    // --- 4. roll back a debit whose transfer never landed --------------------
    if (debited && promoterId) {
      const { error: creditErr } = await supabase.rpc("credit_promoter_balance", {
        p_user_id: promoterId,
        p_amount: debitAmount,
      });
      if (creditErr) {
        console.error("ROLLBACK FAILED — balance debited with no transfer", {
          promoter: promoterId, amount: debitAmount, error: creditErr.message,
        });
      }
    }

    console.error("payout-promoter error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
