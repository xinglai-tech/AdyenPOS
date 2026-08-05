'use strict';

// When a cancel may be sent to the terminal, and when it has to wait.
//
// An AbortRequest is best-effort. The response to it says the terminal accepted
// the abort *message*; it does not say the payment stopped. Two things follow, and
// both of them have bitten this app:
//
//   1. A cancel sent immediately after the payment can reach the terminal before
//      the payment does. The terminal has no such ServiceID to abort, discards the
//      message, and then goes on to display the amount and take the card -- while
//      the cashier has already been told the sale was cancelled.
//
//   2. Once the transaction is past the point of no return the abort is ignored,
//      and the payment completes normally.
//
// Case 2 can only be resolved by the PaymentResponse, so the caller must never
// treat a sent abort as a cancelled order.
//
// Case 1 used to be handled here, by holding the abort back until 1500ms had passed
// since the payment was dispatched. That is gone. It made the server sit on a
// request the cashier had already made, which on screen is indistinguishable from a
// terminal ignoring it, and it bought nothing the interface could not buy more
// honestly: the cancel button now simply does not exist for the first seconds of a
// sale, so the press that needed holding back cannot be made in the first place.

// Aborting a ServiceID the terminal has already finished with is at best a no-op.
// At worst the terminal applies it to whatever transaction started after it.
const CANCELLABLE_STATUSES = new Set(['pending']);

// Returns a refusal, or an instruction to wait for the payment to be sent.
function planCancel(order) {
  if (order && !CANCELLABLE_STATUSES.has(order.status)) {
    return { ok: false, status: order.status, reason: `This order is already ${order.status}` };
  }

  // No order recorded under this ServiceID yet. Treating that as "send now" is what
  // put an abort on the wire ahead of its own payment: the terminal had no
  // transaction to match the ServiceID against and discarded it, then went on to
  // take the card. The caller waits instead.
  //
  // The window this covers has narrowed twice -- a reachability check that ran
  // before the order was recorded is gone, and the cancel button no longer exists
  // during the first seconds of a sale -- so reaching it now means the cancel and
  // its payment never met: different instances, or opposite sides of a restart.
  if (!order) return { ok: true, waitForDispatch: true };

  return { ok: true };
}

// One abort is not always enough, and there used to be a timed retry loop here for
// it: nothing this server can see says when the terminal became able to act on an
// abort at all, and an abort ignored for arriving too early looks exactly like one
// that worked.
//
// The loop is gone because its timing was guesswork against a figure it did not
// know. Adyen's answer to a single abort has since been measured at 19894ms with
// nothing at all spent in this server, and a second press -- or simply waiting --
// settles the sale, which says the early abort was not discarded but held. A repeat
// sent 2s after the first therefore went out an order of magnitude too early to
// cover the window it existed for; by then the sale had usually finished and the
// terminal answered with a Reject naming a ServiceID it no longer had. The retry
// belongs to whoever can see the sale is still running -- the cashier, whose cancel
// button is re-armed after 3s rather than on an answer that may be twenty seconds
// out.

// How long to wait for a payment to be recorded as sent before giving up and
// aborting anyway. Generous rather than tuned: the wait it covers is now only a
// request in flight, and the deadline is reached only when that request never
// arrives at all -- a cancel that outlived a restart, or one that reached an
// instance the payment did not. Both are cases where waiting achieves nothing, so
// the figure decides how long they stall and not much else.
const DEFAULT_DISPATCH_WAIT_MS = Number(process.env.ABORT_DISPATCH_WAIT_MS) || 10000;

module.exports = {
  planCancel,
  CANCELLABLE_STATUSES,
  DEFAULT_DISPATCH_WAIT_MS
};
