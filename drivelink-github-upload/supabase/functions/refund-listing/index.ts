// POST /refund-listing
// Two callers, distinguished by the `action` field:
//   { action: "open_dispute", listing_id }   — buyer flags a problem, blocks
//                                               auto-release until resolved.
//   { action: "refund", listing_id }         — admin-only: issues a real
//                                               Stripe refund to the buyer.
//                                               Only works if funds haven't
//                                               already been released to the
//                                               seller (funds_released=false).
//
// This intentionally does NOT auto-refund on dispute — that decision should
// go through a human, since car sales involve a physical handoff that
// Stripe's dispute system knows nothing about.
import { corsHeaders, jsonResponse, requireUser, stripeClient, supabaseAdmin } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const callerId = await requireUser(req);
    const { action, listing_id } = await req.json();
    if (!listing_id || !action) throw new Error("listing_id and action are required");

    const supabase = supabaseAdmin();
    const stripe = stripeClient();

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, buyer_id, seller_id, status, funds_released, stripe_payment_intent_id, dispute_status")
      .eq("id", listing_id)
      .single();
    if (listingErr || !listing) throw new Error("Listing not found");

    if (action === "open_dispute") {
      if (listing.buyer_id !== callerId) throw new Error("Only the buyer can open a dispute on this listing");
      if (listing.funds_released) throw new Error("Funds have already been released — this needs manual resolution");

      await supabase.from("listings").update({ dispute_status: "open" }).eq("id", listing.id);
      return jsonResponse({ disputeOpened: true });
    }

    if (action === "refund") {
      // Admin-only. Check against your own admin/role column — this project
      // doesn't have one wired in yet, so this throws until you add that
      // check. Do NOT deploy this branch open to any authenticated user.
      const { data: caller } = await supabase.from("users").select("is_admin").eq("id", callerId).single();
      if (!caller?.is_admin) throw new Error("Not authorized to issue refunds");

      if (listing.funds_released) {
        throw new Error("Funds already transferred to seller — this requires manual seller-side recovery, not a refund");
      }
      if (!listing.stripe_payment_intent_id) throw new Error("No payment found for this listing");

      const refund = await stripe.refunds.create({
        payment_intent: listing.stripe_payment_intent_id,
      });

      await supabase
        .from("listings")
        .update({ status: "active", dispute_status: "refunded", buyer_id: null })
        .eq("id", listing.id);

      return jsonResponse({ refunded: true, refundId: refund.id });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    console.error("refund-listing error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
