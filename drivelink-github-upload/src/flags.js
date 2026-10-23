// Site-wide switches that mirror backend state the client can't ask about.
//
// PAYMENTS_OPEN: card checkout is live in direct-charge mode (verified end to end 2026-10-23). It was paused server-side while the
// direct-charge flow is rebuilt — create-checkout-session and
// create-wire-session return 503. Anything in the UI that promises a buyer can
// pay through DriveLink right now (ads, links) reads this. Flip to true in the
// same change that reopens checkout.
export const PAYMENTS_OPEN = true;

// WIRE_OPEN: wire transfer (bank transfer, available on purchases of $500 or more) as a
// direct charge on the seller's own Stripe account. Verified end to end in Stripe
// test mode on 2026-10-23. Shows the wire button and lets site copy mention it.
export const WIRE_OPEN = true;
