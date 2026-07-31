// Table Storage refuses an entity whose string property exceeds 64 KiB, and an
// Adyen payment response carrying receipt data can approach that on its own. A
// rejected write is silent by design (the order is already in memory and on the
// screen), so an order that is too large would simply never be stored. These tests
// pin down the shedding order and the key that makes newest-first reads work.
const test = require('node:test');
const assert = require('node:assert');
const { serialiseOrder, rowKeyFor } = require('../orderStore');

function orderWith(extra) {
  return {
    id: 'a1b2c3',
    serviceId: '1234567890',
    status: 'paid',
    createdAt: '2026-07-31T10:20:30.000Z',
    amount: 12.5,
    currency: 'SGD',
    items: [{ name: 'Coffee', qty: 1, price: 12.5 }],
    terminalId: 'S1F2-000158251517655',
    poiTransactionId: 'p1',
    pspReference: 'ABC123',
    refundedAmount: 0,
    ...extra
  };
}

// A string long enough that the order cannot fit whatever else is on it.
function bulk(chars) {
  return { blob: 'x'.repeat(chars) };
}

test('a small order is stored whole', () => {
  const { json, dropped } = serialiseOrder(orderWith({ response: { ok: true } }));
  assert.deepStrictEqual(dropped, []);
  assert.strictEqual(JSON.parse(json).response.ok, true);
});

test('the refund response is dropped before the payment response', () => {
  const { json, dropped } = serialiseOrder(orderWith({
    refundResponse: bulk(40000),
    response: { ok: true }
  }));
  assert.deepStrictEqual(dropped, ['refundResponse']);
  // The payment response survives, because a reprint reads its receipt data.
  assert.strictEqual(JSON.parse(json).response.ok, true);
});

test('the payment response is dropped only once nothing cheaper is left', () => {
  // Large enough that shedding the cancel response alone does not make it fit.
  const { json, dropped } = serialiseOrder(orderWith({
    cancelResponse: bulk(20000),
    response: bulk(35000)
  }));
  assert.deepStrictEqual(dropped, ['cancelResponse', 'response']);
  const stored = JSON.parse(json);
  assert.strictEqual(stored.response, null);
  // The order itself is intact: it can still be listed, refunded and reprinted.
  assert.strictEqual(stored.pspReference, 'ABC123');
  assert.strictEqual(stored.items.length, 1);
});

test('an order that is still too large keeps its core fields', () => {
  const { json, dropped } = serialiseOrder(orderWith({ stray: 'y'.repeat(40000) }));
  assert.ok(dropped.includes('all but the core fields'));
  const stored = JSON.parse(json);
  assert.strictEqual(stored.stray, undefined);
  assert.strictEqual(stored.id, 'a1b2c3');
  assert.strictEqual(stored.poiTransactionId, 'p1');
});

test('everything stored stays inside the property limit', () => {
  const { json } = serialiseOrder(orderWith({ response: bulk(80000) }));
  assert.ok(json.length <= 30000, `stored ${json.length} characters`);
});

test('a newer order sorts before an older one', () => {
  const older = rowKeyFor(orderWith({ createdAt: '2026-07-31T10:00:00.000Z' }));
  const newer = rowKeyFor(orderWith({ createdAt: '2026-07-31T11:00:00.000Z' }));
  // Table Storage only scans a partition in ascending RowKey order, so the newest
  // order has to produce the smallest key.
  assert.ok(newer < older, `${newer} should sort before ${older}`);
});

test('the row key is stable across updates to the same order', () => {
  const order = orderWith({ status: 'pending' });
  const before = rowKeyFor(order);
  order.status = 'refunded';
  order.refundedAmount = 12.5;
  // An unstable key would store a second copy of the order instead of updating it.
  assert.strictEqual(rowKeyFor(order), before);
});

test('an order with no timestamp still produces a usable key', () => {
  const key = rowKeyFor({ id: 'nodate' });
  assert.match(key, /^\d{13}-nodate$/);
});
