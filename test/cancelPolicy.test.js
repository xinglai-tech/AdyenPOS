// Cancelling a payment the instant it is sent used to leave the terminal taking
// the card while the POS showed the order as cancelled: the abort overtook the
// payment, the terminal had no such ServiceID to abort and dropped it, and the
// sale went through anyway.
//
// The timed hold that used to live here is gone -- the cancel button is not offered
// for the first seconds of a sale, so the press it absorbed cannot be made. What is
// left to pin down is which orders may be aborted at all, and that a cancel naming
// a payment this server has not recorded waits for it rather than going out blind.
const test = require('node:test');
const assert = require('node:assert');
const { planCancel } = require('../cancelPolicy');

const NOW = 1_800_000_000_000;

function pendingOrder(extra) {
  return { serviceId: 'abc123', status: 'pending', ...extra };
}

test('a pending payment may be aborted', () => {
  const plan = planCancel(pendingOrder({ dispatchedAt: NOW - 200 }));
  assert.deepEqual(plan, { ok: true });
});

test('an unrecorded order makes the abort wait for the payment to be sent', () => {
  // Nothing under this ServiceID yet, which now means the cancel and its payment
  // never met: different instances, or opposite sides of a restart. Sending on that
  // basis put the abort on the wire ahead of its own payment -- the terminal had no
  // transaction to match the ServiceID against and discarded it.
  const plan = planCancel(undefined);
  assert.deepEqual(plan, { ok: true, waitForDispatch: true });
});

test('a recovered order may be aborted', () => {
  // dispatchedAt is per-process and is not persisted, so an order that has one
  // missing was read back at boot. Its payment reached the terminal long ago.
  assert.deepEqual(planCancel(pendingOrder()), { ok: true });
});

test('waiting is never asked for on an order that is already resolved', () => {
  // The refusal has to be reached first, or a cancel arriving after the payment
  // finished would sit in the wait loop instead of being turned away.
  const plan = planCancel({ status: 'paid' });
  assert.equal(plan.ok, false);
  assert.equal(plan.waitForDispatch, undefined);
});

// Aborting a ServiceID the terminal has finished with is at best a no-op, and at
// worst the terminal applies it to whatever transaction started after it.
for (const status of ['paid', 'cancelled', 'failed', 'refunded', 'error']) {
  test(`a ${status} order is refused rather than aborted`, () => {
    const plan = planCancel(pendingOrder({ status, dispatchedAt: NOW - 200 }));
    assert.equal(plan.ok, false);
    assert.equal(plan.status, status);
    assert.match(plan.reason, new RegExp(status));
  });
}

// Repeating an abort is no longer the server's job -- see cancelPolicy.js. A cancel
// that was answered but did not stop the sale is pressed again by the cashier, so
// the only rule left here is that a second press is still allowed while the order
// is pending, even though a cancel has already been asked for.
test('a pending order that has already been asked to cancel may be aborted again', () => {
  const plan = planCancel(pendingOrder({ cancelRequested: true, dispatchedAt: NOW - 5000 }));
  assert.equal(plan.ok, true);
});
