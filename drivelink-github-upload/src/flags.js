// Site-wide switches that mirror backend state the client can't ask about.
//
// PAYMENTS_OPEN: card checkout is live in direct-charge mode (verified end to end 2026-10-23). It was paused server-side while the
// direct-charge flow is rebuilt — create-checkout-session and
// create-wire-session return 503. Anything in the UI that promises a buyer can
// pay through DriveLink right now (ads, links) reads this. Flip to true in the
// same change that reopens checkout.
export const PAYMENTS_OPEN = true;

// WIRE_OPEN: wire transfer (bank transfer for purchases of $15,000 or more) as a
// direct charge on the seller's own Stripe account. Turned on for the Stripe test-
// mode run 2026-10-23; flip back to false if that run fails. Shows the wire button
// and lets site copy mention it.
export const WIRE_OPEN = true;
