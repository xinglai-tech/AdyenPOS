require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nexoCrypto = require('./nexoCrypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --------------- In-memory storage (swap to Azure Storage later) ---------------
let orders = [];
let sseClients = [];
const MAX_TERMINALS = 5;
let terminals = process.env.ADYEN_TERMINAL_POIID
  ? process.env.ADYEN_TERMINAL_POIID.split(',').map(id => id.trim()).filter(Boolean)
      .map((id, i) => ({ poiId: id, active: i === 0 }))
  : [];

function getActivePoiId() {
  const t = terminals.find(t => t.active);
  return t ? t.poiId : '';
}

// --------------- Tap to Pay (Android Payments app) config ---------------
const PAYMENTS_APP_MGMT_BASE = 'https://management-test.adyen.com/v1';
const PAYMENTS_APP_DEFAULT_STORE = process.env.ADYEN_PAYMENTS_APP_STORE_ID || 'ST32CQ6223229X5PBQCM9BCWF';
// App Link base for the TEST Payments app
const PAYMENTS_APP_LINK_BASE = 'https://www.adyen.com/test';

function getNexoSecurityKey() {
  return {
    AdyenCryptoVersion: 1,
    KeyIdentifier: process.env.ADYEN_NEXO_KEY_IDENTIFIER || '',
    KeyVersion: parseInt(process.env.ADYEN_NEXO_KEY_VERSION || '1', 10),
    Passphrase: process.env.ADYEN_NEXO_KEY_PASSPHRASE || ''
  };
}

// --------------- Auth config ---------------
const AUTH_USERS = (process.env.AUTH_USERS || 'admin:admin').split(',').map(pair => {
  const [username, password] = pair.split(':');
  return { username, password };
});

// --------------- Middleware ---------------
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'pos-web-app-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// --------------- Auth: login / logout routes (before auth middleware) ---------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = AUTH_USERS.find(u => u.username === username && u.password === password);
  if (user) {
    req.session.user = username;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid username or password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// --------------- Webhook: no auth required ---------------
// (webhook route is registered later but we skip auth for it here)

// --------------- Auth middleware ---------------
app.use((req, res, next) => {
  // Skip auth for webhook and display notifications
  if (req.path === '/api/webhook' || req.path === '/api/display') return next();
  // Skip auth for login page assets
  if (req.path === '/login.html') return next();
  // Skip auth for service worker and manifest (needed for PWA)
  if (req.path === '/sw.js' || req.path === '/manifest.json') return next();

  if (req.session && req.session.user) return next();

  // API requests get 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Page requests redirect to login
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));

// --------------- Helpers ---------------
function extractPspReference(paymentResponse) {
  if (!paymentResponse) return null;

  // 1. Try AdditionalResponse (URL-encoded params)
  const additional = paymentResponse.Response?.AdditionalResponse;
  if (additional) {
    try {
      const params = new URLSearchParams(additional);
      const psp = params.get('pspReference');
      if (psp) return psp;
    } catch { /* ignore */ }
    const match = additional.match(/pspReference=([^&]+)/);
    if (match) return match[1];
  }

  // 2. Try PaymentAcquirerData
  const acquirerTxId = paymentResponse.PaymentResult
    ?.PaymentAcquirerData?.AcquirerTransactionID?.TransactionID;
  if (acquirerTxId) return acquirerTxId;

  // 3. Try deep search in response JSON string
  const json = JSON.stringify(paymentResponse);
  const deepMatch = json.match(/"pspReference"\s*:\s*"([^"]+)"/);
  if (deepMatch) return deepMatch[1];

  console.log('[PSP] Could not find pspReference in:', json.substring(0, 500));
  return null;
}

function extractTenderReference(paymentResponse) {
  if (!paymentResponse) return null;
  const additional = paymentResponse.Response?.AdditionalResponse;
  if (additional) {
    try {
      const params = new URLSearchParams(additional);
      const ref = params.get('tenderReference');
      if (ref) return ref;
    } catch { /* ignore */ }
    const match = additional.match(/tenderReference=([^&]+)/);
    if (match) return match[1];
  }
  const json = JSON.stringify(paymentResponse);
  const deepMatch = json.match(/"tenderReference"\s*:\s*"([^"]+)"/);
  if (deepMatch) return deepMatch[1];
  return null;
}

function extractPaymentBrand(paymentResponse) {
  if (!paymentResponse) return null;
  // 1. CardData.PaymentBrand (most common for card payments)
  const cardBrand = paymentResponse.PaymentResult?.PaymentInstrumentData?.CardData?.PaymentBrand;
  if (cardBrand) return cardBrand;
  // 2. AdditionalResponse paymentMethod or paymentMethodVariant
  const additional = paymentResponse.Response?.AdditionalResponse;
  if (additional) {
    try {
      const params = new URLSearchParams(additional);
      return params.get('paymentMethodVariant') || params.get('paymentMethod') || null;
    } catch { /* ignore */ }
  }
  return null;
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.write(payload));
}

function makeHeader(category, messageType = 'Request') {
  return {
    ProtocolVersion: '3.0',
    MessageClass: 'Service',
    MessageCategory: category,
    MessageType: messageType,
    ServiceID: uuidv4().replace(/-/g, '').slice(0, 10),
    SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
    POIID: getActivePoiId()
  };
}

async function adyenRequest(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-API-key': process.env.ADYEN_API_KEY || ''
    },
    body: JSON.stringify(body)
  });
  // async endpoint returns 200 with "ok" text, not JSON
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// --------------- API: Config (expose non-secret config to frontend) ---------------
app.get('/api/config', (req, res) => {
  res.json({
    poiId: getActivePoiId(),
    terminals,
    maxTerminals: MAX_TERMINALS,
    saleId: process.env.ADYEN_SALE_ID || 'POSWebApp',
    merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '',
    currency: process.env.CURRENCY || 'EUR',
    username: req.session.user || '',
    sessionId: req.sessionID || '',
    tapToPay: {
      defaultStoreId: PAYMENTS_APP_DEFAULT_STORE,
      // true when the Nexo shared key is configured so payments can be encrypted
      encryptionReady: !!(process.env.ADYEN_NEXO_KEY_PASSPHRASE && process.env.ADYEN_NEXO_KEY_IDENTIFIER)
    }
  });
});

// --------------- API: User Activity (presence) ---------------
app.post('/api/activity', (req, res) => {
  const username = req.session.user || 'unknown';
  const sessionId = req.sessionID || '';
  broadcastSSE('userActivity', { username, sessionId, timestamp: Date.now() });
  res.json({ ok: true });
});

// --------------- API: Orders ---------------
app.get('/api/orders', (_req, res) => res.json(orders));

// --------------- API: SSE for real-time updates ---------------
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current orders as initial state
  res.write(`event: init\ndata: ${JSON.stringify(orders)}\n\n`);

  // Heartbeat every 30s to keep connection alive through load balancers
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 30000);

  sseClients.push(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c !== res);
  });
});

// --------------- API: Add Terminal ---------------
app.post('/api/terminal/add', async (req, res) => {
  const { poiId } = req.body;
  if (!poiId || !poiId.trim()) {
    return res.status(400).json({ error: 'Terminal ID is required' });
  }
  const id = poiId.trim();
  if (terminals.find(t => t.poiId === id)) {
    return res.status(400).json({ error: 'Terminal already added' });
  }
  if (terminals.length >= MAX_TERMINALS) {
    return res.status(400).json({ error: `Maximum ${MAX_TERMINALS} terminals. Please remove one first.` });
  }

  try {
    const data = await adyenRequest(
      'https://terminal-api-test.adyen.com/connectedTerminals',
      { merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '' }
    );
    const onlineList = data.uniqueTerminalIds || [];
    if (!onlineList.includes(id)) {
      return res.status(404).json({ error: `Terminal ${id} is not online`, terminals: onlineList });
    }

    const isFirst = terminals.length === 0;
    terminals.push({ poiId: id, active: isFirst });
    broadcastSSE('terminalUpdate', terminals);
    res.json({ success: true, terminals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Delete Terminal ---------------
app.post('/api/terminal/delete', (req, res) => {
  const { poiId } = req.body;
  const idx = terminals.findIndex(t => t.poiId === poiId);
  if (idx < 0) return res.status(404).json({ error: 'Terminal not found' });

  const wasActive = terminals[idx].active;
  terminals.splice(idx, 1);
  if (wasActive && terminals.length > 0) {
    terminals[0].active = true;
  }
  broadcastSSE('terminalUpdate', terminals);
  res.json({ success: true, terminals });
});

// --------------- API: Select Active Terminal ---------------
app.post('/api/terminal/select', (req, res) => {
  const { poiId } = req.body;
  const target = terminals.find(t => t.poiId === poiId);
  if (!target) return res.status(404).json({ error: 'Terminal not found' });

  terminals.forEach(t => t.active = false);
  target.active = true;
  broadcastSSE('terminalUpdate', terminals);
  res.json({ success: true, terminals });
});

// --------------- API: Connected Terminals ---------------
app.post('/api/terminals', async (_req, res) => {
  try {
    const data = await adyenRequest(
      'https://terminal-api-test.adyen.com/connectedTerminals',
      { merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '' }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Transaction Status ---------------
app.post('/api/transaction-status', async (req, res) => {
  const { serviceId } = req.body;
  const order = orders.find(o => o.serviceId === serviceId);
  const poiId = (order && order.terminalId) || getActivePoiId();

  const header = makeHeader('TransactionStatus');
  header.POIID = poiId;

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      TransactionStatusRequest: {
        ReceiptReprintFlag: true,
        DocumentQualifier: ['CashierReceipt', 'CustomerReceipt'],
        MessageReference: {
          MessageCategory: 'Payment',
          ServiceID: serviceId,
          SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
          POIID: poiId
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload);

    // If Adyen returns a completed payment result, update the order
    const statusResponse = data?.SaleToPOIResponse?.TransactionStatusResponse;
    const repeatedResponse = statusResponse?.RepeatedMessageResponse;
    const paymentResponse = repeatedResponse?.RepeatedResponseMessageBody?.PaymentResponse;

    if (paymentResponse) {
      const order = orders.find(o => o.serviceId === serviceId);
      console.log(`[TxStatus] serviceId=${serviceId}, orderFound=${!!order}, paymentResult=${paymentResponse.Response?.Result}`);
      if (order) {
        const result = paymentResponse.Response?.Result;
        if (result === 'Success') {
          order.status = 'paid';
        } else if (result === 'Failure') {
          const errorCondition = paymentResponse.Response?.ErrorCondition;
          order.status = (errorCondition === 'Aborted' || errorCondition === 'Cancel') ? 'cancelled' : 'failed';
        }
        order.response = data;
        const poiData = paymentResponse.POIData;
        if (poiData?.POITransactionID) {
          order.poiTransactionId = poiData.POITransactionID.TransactionID;
          order.poiTimestamp = poiData.POITransactionID.TimeStamp;
        }
        order.pspReference = extractPspReference(paymentResponse);
        order.tenderReference = extractTenderReference(paymentResponse);
        order.paymentBrand = extractPaymentBrand(paymentResponse);
        broadcastSSE('orderUpdate', order);
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Clear Orders ---------------
app.delete('/api/orders', (req, res) => {
  orders.length = 0;
  broadcastSSE('init', orders);
  res.json({ status: 'cleared' });
});

// --------------- API: Make Payment ---------------
app.post('/api/payment', async (req, res) => {
  const { amount, currency, items, useAsync, serviceId: clientServiceId, allowedPaymentBrand } = req.body;

  const header = makeHeader('Payment');
  // Allow client to provide serviceId so it can issue cancel during sync wait
  if (clientServiceId) header.ServiceID = clientServiceId;
  const transactionId = uuidv4();
  const timestamp = new Date().toISOString();

  const order = {
    id: transactionId,
    serviceId: header.ServiceID,
    items,
    amount,
    currency: currency || process.env.CURRENCY || 'EUR',
    status: 'pending',
    createdAt: timestamp,
    response: null,
    poiTransactionId: null,
    poiTimestamp: null,
    pspReference: null,
    tenderReference: null,
    terminalId: getActivePoiId(),
    refundedAmount: 0
  };
  orders.unshift(order);
  broadcastSSE('orderUpdate', order);

  const endpoint = useAsync
    ? 'https://terminal-api-test.adyen.com/async'
    : 'https://terminal-api-test.adyen.com/sync';

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: {
            TransactionID: transactionId,
            TimeStamp: timestamp
          }
        },
        PaymentTransaction: {
          AmountsReq: {
            Currency: order.currency,
            RequestedAmount: amount
          },
          ...(allowedPaymentBrand ? {
            TransactionConditions: {
              AllowedPaymentBrand: [allowedPaymentBrand]
            }
          } : {})
        }
      }
    }
  };

  try {
    const data = await adyenRequest(endpoint, payload);

    if (useAsync) {
      // Async: respond immediately; real result arrives via webhook
      return res.json({ orderId: transactionId, serviceId: header.ServiceID, status: 'submitted' });
    }

    // Sync: process response
    const result = data?.SaleToPOIResponse?.PaymentResponse?.Response?.Result;
    const errorCondition = data?.SaleToPOIResponse?.PaymentResponse?.Response?.ErrorCondition;
    // Preserve 'cancelled' status if cancel was already processed
    if (order.status !== 'cancelled') {
      if (result === 'Success') order.status = 'paid';
      else if (errorCondition === 'Aborted' || errorCondition === 'Cancel') order.status = 'cancelled';
      else order.status = 'failed';
    }
    order.response = data;

    const paymentResp = data?.SaleToPOIResponse?.PaymentResponse;
    const poiData = paymentResp?.POIData;
    if (poiData?.POITransactionID) {
      order.poiTransactionId = poiData.POITransactionID.TransactionID;
      order.poiTimestamp = poiData.POITransactionID.TimeStamp;
    }
    order.pspReference = extractPspReference(paymentResp);
    order.tenderReference = extractTenderReference(paymentResp);
    order.paymentBrand = extractPaymentBrand(paymentResp);

    broadcastSSE('orderUpdate', order);
    try { res.json({ order, adyenResponse: data }); } catch (_) { /* client may have disconnected */ }
  } catch (err) {
    if (order.status !== 'cancelled') {
      order.status = 'error';
      order.error = err.message;
    }
    broadcastSSE('orderUpdate', order);
    try { res.status(500).json({ error: err.message, orderId: transactionId }); } catch (_) { /* client disconnected */ }
  }
});

// --------------- API: Cancel (Abort) Payment ---------------
app.post('/api/cancel', async (req, res) => {
  const { serviceId } = req.body;
  const order = orders.find(o => o.serviceId === serviceId);
  const poiId = (order && order.terminalId) || getActivePoiId();

  const header = makeHeader('Abort');
  header.POIID = poiId;

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      AbortRequest: {
        AbortReason: 'MerchantAbort',
        MessageReference: {
          MessageCategory: 'Payment',
          ServiceID: serviceId,
          SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
          POIID: poiId
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload);

    const cancelledOrder = orders.find(o => o.serviceId === serviceId);
    if (cancelledOrder) {
      cancelledOrder.status = 'cancelled';
      cancelledOrder.cancelResponse = data;
      broadcastSSE('orderUpdate', cancelledOrder);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Referenced Refund ---------------
app.post('/api/refund', async (req, res) => {
  const { orderId, amount } = req.body;
  const order = orders.find(o => o.id === orderId);

  if (!order || (order.status !== 'paid' && order.status !== 'partially_refunded')) {
    return res.status(400).json({ error: 'Order not found or not eligible for refund' });
  }
  if (!order.poiTransactionId) {
    return res.status(400).json({ error: 'Missing POI transaction data for referenced refund' });
  }
  const remaining = order.amount - (order.refundedAmount || 0);
  if (amount > remaining) {
    return res.status(400).json({ error: `Amount exceeds remaining refundable: ${remaining.toFixed(2)}` });
  }

  const reversalRequest = {
    OriginalPOITransaction: {
      POITransactionID: {
        TransactionID: order.poiTransactionId,
        TimeStamp: order.poiTimestamp
      }
    },
    ReversalReason: 'MerchantCancel'
  };

  if (amount && amount < order.amount) {
    reversalRequest.ReversedAmount = amount;
  }

  const refundHeader = makeHeader('Reversal');

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: refundHeader,
      ReversalRequest: reversalRequest
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload);
    const result = data?.SaleToPOIResponse?.ReversalResponse?.Response?.Result;
    if (result === 'Success') {
      order.refundedAmount = (order.refundedAmount || 0) + (amount || order.amount);
      order.status = order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    } else {
      order.status = 'refund_failed';
    }
    order.refundResponse = data;
    broadcastSSE('orderUpdate', order);
    res.json({ order, adyenResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Unreferenced Refund ---------------
app.post('/api/refund/unreferenced', async (req, res) => {
  const { orderId, amount } = req.body;
  const order = orders.find(o => o.id === orderId);

  if (!order || (order.status !== 'paid' && order.status !== 'partially_refunded')) {
    return res.status(400).json({ error: 'Order not found or not eligible for refund' });
  }
  const remaining = order.amount - (order.refundedAmount || 0);
  if (amount > remaining) {
    return res.status(400).json({ error: `Amount exceeds remaining refundable: ${remaining.toFixed(2)}` });
  }

  const unrefHeader = makeHeader('Payment');

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: unrefHeader,
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: {
            TransactionID: uuidv4(),
            TimeStamp: new Date().toISOString()
          }
        },
        PaymentTransaction: {
          AmountsReq: {
            Currency: order.currency || process.env.CURRENCY || 'EUR',
            RequestedAmount: amount
          }
        },
        PaymentData: {
          PaymentType: 'Refund'
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload);
    const result = data?.SaleToPOIResponse?.PaymentResponse?.Response?.Result;
    if (result === 'Success') {
      order.refundedAmount = (order.refundedAmount || 0) + amount;
      order.status = order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    } else {
      order.status = 'refund_failed';
    }
    order.refundResponse = data;
    broadcastSSE('orderUpdate', order);
    res.json({ order, adyenResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Tap to Pay — generate boarding token ---------------
// Step 2 of boarding: authenticate the app instance with the Payments App API.
app.post('/api/taptopay/boarding-token', async (req, res) => {
  const { boardingRequestToken, storeId } = req.body;
  if (!boardingRequestToken) {
    return res.status(400).json({ error: 'boardingRequestToken is required' });
  }
  const merchantId = process.env.ADYEN_MERCHANT_ACCOUNT || '';
  if (!merchantId) {
    return res.status(500).json({ error: 'ADYEN_MERCHANT_ACCOUNT is not configured' });
  }
  const store = (storeId && storeId.trim()) || PAYMENTS_APP_DEFAULT_STORE;
  const url = `${PAYMENTS_APP_MGMT_BASE}/merchants/${encodeURIComponent(merchantId)}/stores/${encodeURIComponent(store)}/generatePaymentsAppBoardingToken`;

  try {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-API-key': process.env.ADYEN_API_KEY || ''
      },
      body: JSON.stringify({ boardingRequestToken })
    });
    const text = await apiRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || data.detail || 'Failed to generate boarding token', details: data });
    }
    // { installationId, boardingToken }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Tap to Pay — build encrypted nexo payment request ---------------
// Returns a Base64URL-encoded, Nexo-encrypted Terminal API request to embed in
// the Payments app `nexo` App Link.
app.post('/api/taptopay/payment-request', async (req, res) => {
  const { amount, currency, installationId, items } = req.body;
  if (!installationId) {
    return res.status(400).json({ error: 'installationId is required (board the device first)' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'A positive amount is required' });
  }
  const securityKey = getNexoSecurityKey();
  if (!securityKey.Passphrase || !securityKey.KeyIdentifier) {
    return res.status(500).json({ error: 'Nexo shared key is not configured on the server' });
  }

  const serviceId = uuidv4().replace(/-/g, '').slice(0, 10);
  const transactionId = uuidv4();
  const timestamp = new Date().toISOString();
  const cur = currency || process.env.CURRENCY || 'EUR';

  const messageHeader = {
    ProtocolVersion: '3.0',
    MessageClass: 'Service',
    MessageCategory: 'Payment',
    MessageType: 'Request',
    ServiceID: serviceId,
    SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
    POIID: installationId
  };

  const terminalApiRequest = {
    SaleToPOIRequest: {
      MessageHeader: messageHeader,
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: { TransactionID: transactionId, TimeStamp: timestamp }
        },
        PaymentTransaction: {
          AmountsReq: { Currency: cur, RequestedAmount: amount }
        }
      }
    }
  };

  try {
    const secured = nexoCrypto.encrypt(messageHeader, JSON.stringify(terminalApiRequest), securityKey);
    const wrapped = { SaleToPOIRequest: secured };
    const request = Buffer.from(JSON.stringify(wrapped), 'utf-8').toString('base64url');

    // Track as an order so it shows in the Orders list
    const order = {
      id: transactionId,
      serviceId,
      items: items || [],
      amount,
      currency: cur,
      status: 'pending',
      createdAt: timestamp,
      response: null,
      poiTransactionId: null,
      poiTimestamp: null,
      pspReference: null,
      tenderReference: null,
      terminalId: installationId,
      viaTapToPay: true,
      refundedAmount: 0
    };
    orders.unshift(order);
    broadcastSSE('orderUpdate', order);

    res.json({ request, serviceId, transactionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Tap to Pay — revoke an app instance ---------------
app.post('/api/taptopay/revoke', async (req, res) => {
  const { installationId } = req.body;
  if (!installationId) {
    return res.status(400).json({ error: 'installationId is required' });
  }
  const merchantId = process.env.ADYEN_MERCHANT_ACCOUNT || '';
  const url = `${PAYMENTS_APP_MGMT_BASE}/merchants/${encodeURIComponent(merchantId)}/paymentsApps/${encodeURIComponent(installationId)}/revoke`;
  try {
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-API-key': process.env.ADYEN_API_KEY || ''
      },
      body: '{}'
    });
    const text = await apiRes.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || 'Revoke failed', details: data });
    }
    res.json({ ok: true, details: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- Webhook: Adyen async notification / event URL ---------------
app.post('/api/webhook', (req, res) => {
  const body = req.body;
  console.log('[Webhook] Received:', JSON.stringify(body, null, 2));

  // Handle async payment response
  const saleResponse = body?.SaleToPOIResponse;
  if (saleResponse) {
    const header = saleResponse.MessageHeader;
    const paymentResponse = saleResponse.PaymentResponse;

    if (paymentResponse) {
      const result = paymentResponse.Response?.Result;
      const serviceId = header?.ServiceID;

      const order = orders.find(o => o.serviceId === serviceId);
      if (order) {
        const errCond = paymentResponse.Response?.ErrorCondition;
        if (result === 'Success') order.status = 'paid';
        else if (errCond === 'Aborted' || errCond === 'Cancel') order.status = 'cancelled';
        else order.status = 'failed';
        if (result !== 'Success') {
          const friendlyMessages = {
            'Busy': 'Terminal busy — another transaction in progress',
            'Aborted': 'Transaction cancelled',
            'Cancel': 'Transaction cancelled',
            'Refusal': 'Payment declined',
            'NotFound': 'Transaction not found',
            'UnavailableService': 'Terminal service unavailable',
            'InvalidCard': 'Invalid card',
            'WrongPIN': 'Wrong PIN entered',
          };
          const additional = paymentResponse.Response?.AdditionalResponse || '';
          let rawMsg = '';
          try { rawMsg = new URLSearchParams(additional).get('message') || ''; } catch {}
          if (!rawMsg) rawMsg = additional.match(/message=([^&]*)/)?.[1] || '';
          // Check for known cancel patterns in raw message
          if (rawMsg.match(/cancel/i) || rawMsg.match(/merchant\s*cancel/i)) {
            order.failureReason = 'Transaction cancelled by merchant';
          } else {
            order.failureReason = friendlyMessages[errCond] || rawMsg || errCond || 'Unknown error';
          }
        }
        order.response = body;

        const poiData = paymentResponse.POIData;
        if (poiData?.POITransactionID) {
          order.poiTransactionId = poiData.POITransactionID.TransactionID;
          order.poiTimestamp = poiData.POITransactionID.TimeStamp;
        }
        order.pspReference = extractPspReference(paymentResponse);
        order.tenderReference = extractTenderReference(paymentResponse);
        order.paymentBrand = extractPaymentBrand(paymentResponse);
        broadcastSSE('orderUpdate', order);
      }
    }

    // Handle reversal response from async
    const reversalResponse = saleResponse.ReversalResponse;
    if (reversalResponse) {
      const result = reversalResponse.Response?.Result;
      // Try to find order by serviceId from original request
      // For referenced refund the header ServiceID matches our refund call
      broadcastSSE('reversalResult', { result, response: body });
    }
  }

  // Handle EventNotification
  const saleRequest = body?.SaleToPOIRequest;
  if (saleRequest?.EventNotification) {
    const eventData = saleRequest.EventNotification;
    console.log('[Webhook] EventNotification:', eventData);

    // Handle Reject (e.g. timeout) — mark matching order as failed
    if (eventData.EventToNotify === 'Reject') {
      const header = saleRequest.MessageHeader;
      const details = eventData.EventDetails || '';
      const message = new URLSearchParams(details).get('message') || details;

      // Try to find the original serviceId from the RejectedMessage
      let origServiceId = null;
      if (eventData.RejectedMessage) {
        try {
          const decoded = JSON.parse(Buffer.from(eventData.RejectedMessage, 'base64').toString());
          origServiceId = decoded?.SaleToPOIRequest?.MessageHeader?.ServiceID
            || decoded?.SaleToPOIRequest?.TransactionStatusRequest?.MessageReference?.ServiceID;
        } catch (e) { console.warn('[Webhook] Failed to decode RejectedMessage:', e.message); }
      }

      const matchId = origServiceId || header?.ServiceID;
      if (matchId) {
        const order = orders.find(o => o.serviceId === matchId && o.status === 'pending');
        if (order) {
          order.status = 'failed';
          order.failureReason = message || 'Timed out waiting for terminal response';
          order.response = body;
          console.log(`[Webhook] Order ${order.id} marked failed (Reject): ${order.failureReason}`);
          broadcastSSE('orderUpdate', order);
        }
      }
    }

    broadcastSSE('eventNotification', eventData);
  }

  res.status(200).json({ status: 'ok' });
});

// --------------- Display Notification URL ---------------
app.post('/api/display', (req, res) => {
  const body = req.body;
  console.log('[Display] Received:', JSON.stringify(body, null, 2));

  const displayReq = body?.SaleToPOIRequest?.DisplayRequest;
  if (displayReq) {
    const outputs = displayReq.DisplayOutput || [];
    const events = [];

    for (const output of outputs) {
      const content = output.OutputContent || {};
      // Format: PredefinedContent with ReferenceID (e.g. "event=WAIT_FOR_PIN")
      const refId = content.PredefinedContent?.ReferenceID || '';
      if (refId) {
        const params = new URLSearchParams(refId);
        const event = params.get('event') || params.get('Event');
        const result = params.get('Result') || params.get('result');
        const transactionId = params.get('TransactionID') || params.get('transactionID');
        if (event) events.push({ type: 'event', event, result, transactionId, refId });
      }
      // Fallback: OutputText (some terminals may use this)
      const textItems = content.OutputText || [];
      const text = textItems.map(t => t.Text).filter(Boolean).join(' ');
      if (text) events.push({ type: 'text', text });
    }

    const device = outputs[0]?.Device || 'CashierDisplay';
    const infoQualify = outputs[0]?.InfoQualify || 'Status';
    const poiId = body?.SaleToPOIRequest?.MessageHeader?.POIID || '';

    broadcastSSE('displayNotification', {
      events,
      device,
      infoQualify,
      poiId
    });
  }

  res.status(200).json({ status: 'ok' });
});

// --------------- SPA fallback ---------------
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------- Start ---------------
app.listen(PORT, () => {
  console.log(`POS Web App running at http://localhost:${PORT}`);
});
