// --------------- Who may refund a Tap to Pay order ---------------
// A Tap to Pay refund is a ReversalRequest the Payments app carries out on the
// device itself. Nothing reaches that app over the cloud, so the question is not
// "is a terminal reachable" the way it is for every other order, but "is this the
// device that took the payment". Kept out of server.js so the rule can be tested
// without a boarded phone.

// A failed refund leaves the payment itself untouched, so the attempt has to stay
// repeatable — most often the device was simply unreachable the first time.
const REFUNDABLE_STATUSES = new Set(['paid', 'partially_refunded', 'refund_failed']);

// Returns { status, error } for the HTTP reply when the refund cannot go ahead,
// or null when it can.
function ttpRefundBlock(order, installationId, amount) {
  if (!order || !order.viaTapToPay) {
    return { status: 400, error: 'Order not found or was not taken with Tap to Pay' };
  }
  if (!REFUNDABLE_STATUSES.has(order.status)) {
    return { status: 400, error: 'Order is not eligible for refund' };
  }
  // A reversal names the POI transaction it reverses. A Tap to Pay order only
  // carries one if the full response could be read back after the payment, so an
  // order left with nothing but a short response cannot be refunded by reference.
  if (!order.poiTransactionId) {
    return {
      status: 400,
      error: 'This order has no POI transaction reference, so it cannot be refunded by reference'
    };
  }
  // The POI transaction belongs to the installation that produced it, so any other
  // device would be asking to reverse a transaction it never made.
  if (!installationId || installationId !== order.terminalId) {
    return { status: 409, error: 'This device did not take the payment, so it cannot refund it' };
  }
  const remaining = (order.amount || 0) - (order.refundedAmount || 0);
  if (!(amount > 0) || amount > remaining) {
    return {
      status: 400,
      error: `Amount must be between 0 and the remaining refundable ${remaining.toFixed(2)}`
    };
  }
  return null;
}

// The ReversalRequest body for a referenced refund, shared by the cloud route and
// the Tap to Pay one so the two cannot drift apart.
//
// A partial refund is a different request from a full one, and not only by the
// amount: Adyen requires SaleData.SaleTransactionID for it, as the merchant
// reference for the refund itself. A full reversal needs no reference of its own
// because the payment it reverses already identifies it. Sending a partial one
// without it is rejected before anything is refunded.
function buildReversalRequest(order, amount, refundReference, timestamp) {
  const reversal = {
    OriginalPOITransaction: {
      POITransactionID: {
        TransactionID: order.poiTransactionId,
        TimeStamp: order.poiTimestamp
      }
    },
    ReversalReason: 'MerchantCancel'
  };

  if (amount != null && amount < order.amount) {
    reversal.ReversedAmount = amount;
    reversal.SaleData = {
      SaleTransactionID: { TransactionID: refundReference, TimeStamp: timestamp }
    };
  }
  return reversal;
}

module.exports = { REFUNDABLE_STATUSES, ttpRefundBlock, buildReversalRequest };
