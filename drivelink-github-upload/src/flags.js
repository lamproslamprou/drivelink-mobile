// Site-wide switches that mirror backend state the client can't ask about.
//
// PAYMENTS_OPEN: live checkout (card and wire) is paused server-side while the
// direct-charge flow is rebuilt — create-checkout-session and
// create-wire-session return 503. Anything in the UI that promises a buyer can
// pay through DriveLink right now (ads, links) reads this. Flip to true in the
// same change that reopens checkout.
export const PAYMENTS_OPEN = false;

// WIRE_OPEN: wire transfer is switched off while DIRECT_CHARGES=on (create-wire-
// session returns "not available"). It stays off until bank transfers have been
// re-tested as direct charges in Stripe test mode. Hides the wire button and
// keeps site copy from advertising it. Flip to true together with the backend.
export const WIRE_OPEN = false;
