// Cancelling a payment the instant it is sent used to leave the terminal taking
// the card while the POS showed the order as cancelled: the abort overtook the
// payment, the terminal had no such ServiceID to abort and dropped it, and the
// sale went through anyway. These pin down the two rules that prevent it.
const test = require('node:test');
const assert = require('node:assert');
const { planCancel } = require('../cancelPolicy');

const MIN = 1500;
const NOW = 1_800_000_000_000;

function pendingOrder(extra) {
  return { serviceId: 'abc123', status: 'pending', ...extra };
}

test('an abort sent moments after the payment is held back', () => {
  const order = pendingOrder({ dispatchedAt: NOW - 200 });
  const plan = planCancel(order, { now: NOW, minDelayMs: MIN });
  assert.equal(plan.ok, true);
  assert.equal(plan.delayMs, 1300, 'should wait out the remainder of the window');
});

test('an abort sent the same millisecond waits the whole window', () => {
  const order = pendingOrder({ dispatchedAt: NOW });
  assert.equal(planCancel(order, { now: NOW, minDelayMs: MIN }).delayMs, MIN);
});

test('an abort for a payment already underway goes out immediately', () => {
  const order = pendingOrder({ dispatchedAt: NOW - 30_000 });
  assert.equal(planCancel(order, { now: NOW, minDelayMs: MIN }).delayMs, 0);
});

test('a clock that has gone backwards never produces a longer wait', () => {
  const order = pendingOrder({ dispatchedAt: NOW + 60_000 });
  const plan = planCancel(order, { now: NOW, minDelayMs: MIN });
  assert.equal(plan.delayMs, MIN, 'capped at the window, never beyond it');
});

test('an unrecorded order makes the abort wait for the payment to be sent', () => {
  // /api/payment checks the terminal is reachable before it records anything, and
  // that check is an await. A cancel pressed during it finds nothing, and sending
  // on that basis put the abort on the wire ahead of its own payment -- the
  // terminal had no transaction to match the ServiceID against and discarded it.
  const plan = planCancel(undefined, { now: NOW, minDelayMs: MIN });
  assert.deepEqual(plan, { ok: true, waitForDispatch: true });
});

test('a recovered order is aborted without delay', () => {
  // dispatchedAt is per-process and is not persisted, so an order that has one
  // missing was read back at boot: its payment reached the terminal long ago and
  // there is nothing to wait behind.
  const plan = planCancel(pendingOrder(), { now: NOW, minDelayMs: MIN });
  assert.deepEqual(plan, { ok: true, delayMs: 0 });
});

test('waiting is never asked for on an order that is already resolved', () => {
  // The refusal has to be reached first, or a cancel arriving after the payment
  // finished would sit in the wait loop instead of being turned away.
  const plan = planCancel({ status: 'paid' }, { now: NOW, minDelayMs: MIN });
  assert.equal(plan.ok, false);
  assert.equal(plan.waitForDispatch, undefined);
});

// Aborting a ServiceID the terminal has finished with is at best a no-op, and at
// worst the terminal applies it to whatever transaction started after it.
for (const status of ['paid', 'cancelled', 'failed', 'refunded', 'error']) {
  test(`a ${status} order is refused rather than aborted`, () => {
    const plan = planCancel(pendingOrder({ status, dispatchedAt: NOW - 200 }), { now: NOW, minDelayMs: MIN });
    assert.equal(plan.ok, false);
    assert.equal(plan.status, status);
    assert.match(plan.reason, new RegExp(status));
  });
}

test('a paid order is refused even though its dispatch was recent', () => {
  // Order of checks matters: the status test has to come before the delay, or a
  // payment that succeeded within the window would still be aborted.
  const plan = planCancel(pendingOrder({ status: 'paid', dispatchedAt: NOW }), { now: NOW, minDelayMs: MIN });
  assert.equal(plan.ok, false);
});

// Repeating an abort is no longer the server's job -- see cancelPolicy.js. A cancel
// that was answered but did not stop the sale is pressed again by the cashier, so
// the only rule left here is that a second press is still allowed while the order
// is pending, even though a cancel has already been asked for.
test('a pending order that has already been asked to cancel may be aborted again', () => {
  const plan = planCancel(pendingOrder({ cancelRequested: true, dispatchedAt: NOW - MIN }), { now: NOW, minDelayMs: MIN });
  assert.equal(plan.ok, true);
  assert.equal(plan.delayMs, 0);
});
