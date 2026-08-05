// A Tap to Pay refund is carried out by the Payments app on the device itself, so
// the guard is about identity rather than reachability: only the boarded device
// that took the payment can reverse it. Getting that wrong either blocks a
// legitimate refund or asks a device to reverse a transaction it never made.
const test = require('node:test');
const assert = require('node:assert');
const { ttpRefundBlock, buildReversalRequest } = require('../ttpRefundPolicy');

const INSTALLATION = 'ANDROID-1234567890';

function ttpOrder(overrides = {}) {
  return {
    id: 'order-1',
    viaTapToPay: true,
    status: 'paid',
    amount: 50,
    refundedAmount: 0,
    poiTransactionId: 'POI-9876',
    poiTimestamp: '2026-08-05T10:00:00.000Z',
    terminalId: INSTALLATION,
    ...overrides
  };
}

test('the device that took the payment may refund it in full', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder(), INSTALLATION, 50), null);
});

test('a partial refund within the remaining amount is allowed', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder(), INSTALLATION, 20), null);
});

test('a different boarded device cannot refund the payment', () => {
  const blocked = ttpRefundBlock(ttpOrder(), 'ANDROID-OTHER', 50);
  assert.strictEqual(blocked.status, 409);
  assert.match(blocked.error, /did not take the payment/);
});

test('an unboarded device has no installation to match, so it is refused', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder(), '', 50).status, 409);
  assert.strictEqual(ttpRefundBlock(ttpOrder(), undefined, 50).status, 409);
});

test('an order with no POI transaction cannot be reversed by reference', () => {
  const blocked = ttpRefundBlock(ttpOrder({ poiTransactionId: null }), INSTALLATION, 50);
  assert.strictEqual(blocked.status, 400);
  assert.match(blocked.error, /no POI transaction reference/);
});

test('a refund that failed before can be attempted again', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder({ status: 'refund_failed' }), INSTALLATION, 50), null);
});

test('a partially refunded order can be refunded down to its remainder', () => {
  const order = ttpOrder({ status: 'partially_refunded', refundedAmount: 30 });
  assert.strictEqual(ttpRefundBlock(order, INSTALLATION, 20), null);
  const blocked = ttpRefundBlock(order, INSTALLATION, 20.01);
  assert.strictEqual(blocked.status, 400);
  assert.match(blocked.error, /remaining refundable 20\.00/);
});

test('a fully refunded or still pending order is not eligible', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder({ status: 'refunded' }), INSTALLATION, 10).status, 400);
  assert.strictEqual(ttpRefundBlock(ttpOrder({ status: 'pending' }), INSTALLATION, 10).status, 400);
});

test('a zero or negative amount is refused rather than sent to the device', () => {
  assert.strictEqual(ttpRefundBlock(ttpOrder(), INSTALLATION, 0).status, 400);
  assert.strictEqual(ttpRefundBlock(ttpOrder(), INSTALLATION, -5).status, 400);
  assert.strictEqual(ttpRefundBlock(ttpOrder(), INSTALLATION, undefined).status, 400);
});

test('a terminal order is not handled by this route at all', () => {
  const blocked = ttpRefundBlock(ttpOrder({ viaTapToPay: false }), INSTALLATION, 50);
  assert.strictEqual(blocked.status, 400);
  assert.match(blocked.error, /not.*taken with Tap to Pay/);
});

test('a missing order is refused rather than throwing', () => {
  assert.strictEqual(ttpRefundBlock(undefined, INSTALLATION, 50).status, 400);
});

// A partial reversal sent without SaleData.SaleTransactionID is refused by the
// Payments app before anything is refunded, which is how this was found: a full
// refund went through and a partial one came back as a bare error code.
test('a partial reversal carries the amount and its own merchant reference', () => {
  const built = buildReversalRequest(ttpOrder(), 20, 'refund-ref-1', '2026-08-05T12:00:00.000Z');
  assert.strictEqual(built.ReversedAmount, 20);
  assert.deepStrictEqual(built.SaleData, {
    SaleTransactionID: { TransactionID: 'refund-ref-1', TimeStamp: '2026-08-05T12:00:00.000Z' }
  });
});

test('a full reversal carries neither, being identified by the payment it reverses', () => {
  const built = buildReversalRequest(ttpOrder(), 50, 'refund-ref-1', '2026-08-05T12:00:00.000Z');
  assert.ok(!('ReversedAmount' in built));
  assert.ok(!('SaleData' in built));
});

test('every reversal names the POI transaction it reverses', () => {
  const order = ttpOrder();
  for (const amount of [20, 50]) {
    const built = buildReversalRequest(order, amount, 'r', '2026-08-05T12:00:00.000Z');
    assert.deepStrictEqual(built.OriginalPOITransaction.POITransactionID, {
      TransactionID: order.poiTransactionId,
      TimeStamp: order.poiTimestamp
    });
    assert.strictEqual(built.ReversalReason, 'MerchantCancel');
  }
});

test('a second partial refund is still partial, measured against the original amount', () => {
  // The remaining amount shrinks as refunds land, but what makes a reversal
  // partial is the original payment, not what is left of it. Comparing against
  // the remainder would send the last instalment as a full reversal.
  const order = ttpOrder({ status: 'partially_refunded', refundedAmount: 30 });
  const built = buildReversalRequest(order, 20, 'r', '2026-08-05T12:00:00.000Z');
  assert.strictEqual(built.ReversedAmount, 20);
  assert.ok(built.SaleData);
});
