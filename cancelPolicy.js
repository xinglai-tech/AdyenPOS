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
// treat a sent abort as a cancelled order. Case 1 is avoidable, which is what the
// delay below is for.

// Long enough for the payment to have reached the terminal over the cloud path
// the abort will follow. Overridable because a busy store on a slow link may need
// more, and nothing here depends on the exact figure.
const DEFAULT_MIN_ABORT_DELAY_MS = Number(process.env.ABORT_MIN_DELAY_MS) || 1500;

// Aborting a ServiceID the terminal has already finished with is at best a no-op.
// At worst the terminal applies it to whatever transaction started after it.
const CANCELLABLE_STATUSES = new Set(['pending']);

// Returns a refusal, an instruction to wait for the payment to be sent, or how long
// to hold the abort back.
function planCancel(order, { now = Date.now(), minDelayMs = DEFAULT_MIN_ABORT_DELAY_MS } = {}) {
  if (order && !CANCELLABLE_STATUSES.has(order.status)) {
    return { ok: false, status: order.status, reason: `This order is already ${order.status}` };
  }

  // No order recorded under this ServiceID yet. /api/payment checks the terminal is
  // reachable before it records anything, and the cancel button is live from the
  // moment the overlay opens, so a fast cancel lands inside that check. Treating
  // this as "send now" is what put an abort on the wire ahead of its own payment:
  // the terminal had no transaction to match the ServiceID against and discarded
  // it, then went on to take the card. The caller waits instead.
  if (!order) return { ok: true, waitForDispatch: true };

  // An order with no dispatch time was read back from storage at boot -- the field
  // is per-process and does not persist. Its payment reached the terminal long ago,
  // so there is nothing to wait behind.
  if (!order.dispatchedAt) return { ok: true, delayMs: 0 };

  // Math.max guards a clock that has gone backwards, which would otherwise produce
  // a negative delay and, worse, a negative timeout.
  const elapsed = now - order.dispatchedAt;
  return { ok: true, delayMs: Math.max(0, Math.min(minDelayMs, minDelayMs - elapsed)) };
}

// One abort is not always enough, and there used to be a timed retry loop here for
// it: the delay above stops the abort overtaking the payment in the cloud, but it
// cannot know when the terminal became able to act on an abort at all, and an abort
// discarded for arriving too early looks exactly like one that worked.
//
// The loop is gone because its timing was guesswork against a figure it did not
// know. Adyen's answer to a single abort has been seen to take tens of seconds, so
// a repeat sent 2s after the first went out long after the window it existed to
// cover; by then the sale had usually finished and the terminal answered with a
// Reject naming a ServiceID it no longer had. The retry belongs to whoever can see
// the sale is still running -- the cashier, whose cancel button is re-armed once
// the first abort has been answered.

// How long to wait for a payment to be recorded as sent before giving up and
// aborting anyway. The ceiling is set by /api/payment's reachability check, which
// runs before the order exists and has its own lookup timeout.
const DEFAULT_DISPATCH_WAIT_MS = Number(process.env.ABORT_DISPATCH_WAIT_MS) || 10000;

module.exports = {
  planCancel,
  CANCELLABLE_STATUSES,
  DEFAULT_MIN_ABORT_DELAY_MS,
  DEFAULT_DISPATCH_WAIT_MS
};
