// Site-wide switches that mirror backend state the client can't ask about.
//
// PAYMENTS_OPEN: live checkout (card and wire) is paused server-side while the
// direct-charge flow is rebuilt — create-checkout-session and
// create-wire-session return 503. Anything in the UI that promises a buyer can
// pay through DriveLink right now (ads, links) reads this. Flip to true in the
// same change that reopens checkout.
export const PAYMENTS_OPEN = false;
