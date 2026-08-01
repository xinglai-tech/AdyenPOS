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

// One abort is not enough. The delay above stops the abort overtaking the payment
// in the cloud, but it cannot know when the terminal finished starting the
// transaction and became able to act on an abort at all -- a cancel pressed the
// moment the button appears can still land in that window and be discarded, and
// nothing in the response distinguishes that from an abort that worked.
//
// So the abort is repeated while the order is still pending. This is safe to do:
// the request names the ServiceID it refers to, so a repeat that arrives after the
// transaction has already stopped cannot affect anything else, and the loop ends
// as soon as the PaymentResponse settles the order.
const DEFAULT_ABORT_RETRY_MS = Number(process.env.ABORT_RETRY_MS) || 2000;
const DEFAULT_ABORT_ATTEMPTS = Number(process.env.ABORT_ATTEMPTS) || 3;

// `attempt` is the number already made, so the first call passes 1.
function shouldRetryAbort(order, attempt, maxAttempts = DEFAULT_ABORT_ATTEMPTS) {
  if (attempt >= maxAttempts) return false;
  // Gone from the list, or the PaymentResponse has landed and decided the outcome.
  if (!order || order.status !== 'pending') return false;
  // Nobody asked for this any more.
  return order.cancelRequested === true;
}

// How long to wait for a payment to be recorded as sent before giving up and
// aborting anyway. The ceiling is set by /api/payment's reachability check, which
// runs before the order exists and has its own lookup timeout.
const DEFAULT_DISPATCH_WAIT_MS = Number(process.env.ABORT_DISPATCH_WAIT_MS) || 10000;

module.exports = {
  planCancel,
  shouldRetryAbort,
  CANCELLABLE_STATUSES,
  DEFAULT_MIN_ABORT_DELAY_MS,
  DEFAULT_ABORT_RETRY_MS,
  DEFAULT_ABORT_ATTEMPTS,
  DEFAULT_DISPATCH_WAIT_MS
};
