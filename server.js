require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nexoCrypto = require('./nexoCrypto');
const { readInputResult, readEnableServiceResult } = require('./nexoParse');
const orderStore = require('./orderStore');
const { planCancel, DEFAULT_DISPATCH_WAIT_MS } = require('./cancelPolicy');
const { REFUNDABLE_STATUSES, ttpRefundBlock, buildReversalRequest } = require('./ttpRefundPolicy');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
const PORT = process.env.PORT || 3000;

// --------------- In-memory storage ---------------
// The working set. Orders are read synchronously all over this file, so the array
// stays authoritative for reads and `orderStore` mirrors every change behind it.
// Filled from storage at boot, before the server starts listening.
let orders = [];
let sseClients = [];
let terminals = process.env.ADYEN_TERMINAL_POIID
  ? process.env.ADYEN_TERMINAL_POIID.split(',').map(id => id.trim()).filter(Boolean)
      .map((id, i) => ({ poiId: id, active: i === 0 }))
  : [];

function getActivePoiId() {
  const t = terminals.find(t => t.active);
  return t ? t.poiId : '';
}

// Terminal models with a built-in receipt printer. A POI ID looks like
// "V400m-346536527", so the part before the first dash is the model name and is
// enough to decide whether a reprint button makes sense for an order.
const PRINTER_MODEL_PREFIXES = (process.env.PRINTER_TERMINAL_MODELS || 'S1F2,S1F4,V400,V240')
  .split(',').map(s => s.trim()).filter(Boolean);

// --------------- Tap to Pay (Android Payments app) config ---------------
const PAYMENTS_APP_MGMT_BASE = 'https://management-test.adyen.com/v1';
const PAYMENTS_APP_DEFAULT_STORE = process.env.ADYEN_PAYMENTS_APP_STORE_ID || 'ST32CQ6223229X5PBQCM9BCWF';

function getNexoSecurityKey() {
  return {
    AdyenCryptoVersion: 1,
    KeyIdentifier: process.env.ADYEN_NEXO_KEY_IDENTIFIER || '',
    KeyVersion: parseInt(process.env.ADYEN_NEXO_KEY_VERSION || '1', 10),
    Passphrase: process.env.ADYEN_NEXO_KEY_PASSPHRASE || ''
  };
}

// --------------- Auth config ---------------
// Single shared access code (no usernames), same model as the WebDemo project.
// It must come from the ACCESS_CODE environment variable: there is deliberately
// no hard-coded fallback, so a misconfigured server refuses every login instead
// of silently accepting a code that is visible in this repository.
const ACCESS_CODE = process.env.ACCESS_CODE || '';

function codeMatches(input) {
  if (!ACCESS_CODE) return false;
  if (typeof input !== 'string' || !input) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(ACCESS_CODE);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --------------- Login throttling (per client IP) ---------------
// A short access code is brute-forceable, so failures are counted in a rolling
// window and the IP is locked out for a while once the threshold is reached.
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_FAIL_THRESHOLD = 10;
const LOCK_DURATION_MS = 60 * 1000;
const loginState = new Map(); // ip -> { count, windowTs, lockedUntil }

// Normalize the client IP. Azure's X-Forwarded-For appends the client port,
// which changes per connection, so it must be stripped.
function clientIp(req) {
  let ip = req.ip || '';
  const v4 = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4) return v4[1];
  const v6 = ip.match(/^\[(.+)\]:\d+$/);
  if (v6) ip = v6[1];
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// --------------- Middleware ---------------
// The default 100 KB limit is too small for an uploaded receipt logo, which
// arrives as a base64 data URL.
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', true);

// --------------- Auth: stateless signed cookie ---------------
// The login state lives entirely in an HMAC-signed cookie, so it survives
// server restarts (unlike an in-memory session store) and works across
// multiple instances. The signing key must be a stable SESSION_SECRET.
const AUTH_COOKIE = 'pos_auth';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_SECRET = process.env.SESSION_SECRET || 'pos-web-app-secret-change-me';

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
}

function makeAuthToken() {
  const payload = { sid: uuidv4(), exp: Date.now() + SESSION_TTL_MS };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${signPayload(b64)}`;
}

function verifyAuthToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signPayload(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || !payload.sid || typeof payload.exp !== 'number') return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

function authCookieParts(req, value, maxAgeSeconds) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${AUTH_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Attach the verified login state (if any) to every request as req.auth.
app.use((req, res, next) => {
  req.auth = verifyAuthToken(readCookie(req, AUTH_COOKIE));
  next();
});

// --------------- Auth: login / logout routes (before auth middleware) ---------------
app.post('/api/login', (req, res) => {
  if (!ACCESS_CODE) {
    return res.status(503).json({
      error: 'Login unavailable: ACCESS_CODE is not configured on the server.'
    });
  }

  const now = Date.now();
  const ip = clientIp(req);
  let s = loginState.get(ip);
  if (!s) {
    s = { count: 0, windowTs: now, lockedUntil: 0 };
    loginState.set(ip, s);
  }

  // Currently locked out -> reject everything, including the correct code.
  if (now < s.lockedUntil) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
  }
  // Reset the failure counter once the counting window has elapsed.
  if (now - s.windowTs > LOGIN_WINDOW_MS) {
    s.count = 0;
    s.windowTs = now;
  }

  if (codeMatches(req.body && req.body.code)) {
    loginState.delete(ip);
    res.setHeader('Set-Cookie', authCookieParts(req, makeAuthToken(), Math.floor(SESSION_TTL_MS / 1000)));
    return res.json({ ok: true });
  }

  s.count += 1;
  if (s.count >= LOGIN_FAIL_THRESHOLD) {
    s.lockedUntil = now + LOCK_DURATION_MS;
    s.count = 0;
    s.windowTs = now;
  }
  res.status(401).json({ error: 'Invalid access code' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', authCookieParts(req, '', 0));
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

  if (req.auth) return next();

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

// The card number as far as it may be kept: the first six digits and the last four.
// Only card payments carry one, so a wallet or a cash tender yields null and the UI
// leaves the row out.
function extractMaskedPan(paymentResponse) {
  if (!paymentResponse) return null;
  // The terminal already formats it as "541333 **** 9999", which is exactly the
  // first six and last four, so it is preferred over rebuilding one.
  const masked = paymentResponse.PaymentResult?.PaymentInstrumentData?.CardData?.MaskedPan;
  if (masked) return String(masked).replace(/\s+/g, ' ').trim();

  const additional = paymentResponse.Response?.AdditionalResponse;
  if (additional) {
    try {
      const params = new URLSearchParams(additional);
      const bin = params.get('cardBin');
      const last4 = params.get('cardSummary');
      if (bin && last4) return `${bin} **** ${last4}`;
      // A summary on its own is still worth showing: it is what a shopper reads off
      // their own card to identify the payment.
      if (last4) return `**** ${last4}`;
    } catch { /* ignore */ }
  }
  return null;
}

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.write(payload));
}

// Every order change goes through here. Telling the clients and writing the order
// down are the same event, so keeping them together means a new code path cannot
// remember one and forget the other. The write is deliberately not awaited: the
// cashier is watching a terminal, not a storage account.
function orderChanged(order) {
  broadcastSSE('orderUpdate', order);
  orderStore.save(order);
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

// A cardholder can hold a terminal for a long time, so the default deadline is
// deliberately generous — it exists to stop a request hanging forever, not to
// cut a live transaction short. Calls that never touch the terminal (and so
// should answer immediately) pass a much shorter `timeoutMs`.
const ADYEN_TIMEOUT_MS = Number(process.env.ADYEN_REQUEST_TIMEOUT_MS) || 130000;
const ADYEN_LOOKUP_TIMEOUT_MS = 10000;
// Reversals, prints and status lookups run without anyone at the terminal, so
// there is no cardholder to wait for: if the device is going to answer at all it
// does so in seconds. Waiting the full interactive deadline for these only leaves
// the cashier staring at a spinner.
const ADYEN_UNATTENDED_TIMEOUT_MS = Number(process.env.ADYEN_UNATTENDED_TIMEOUT_MS) || 10000;

async function adyenRequest(endpoint, body, opts = {}) {
  // Mirror the outgoing request to the API log. Done here rather than at each call
  // site because every Terminal API call funnels through this function, so one
  // broadcast covers payments, card acquisition, printing, aborts and the rest.
  // `silent` is for housekeeping calls the user never asked for, which would
  // otherwise bury the request they did ask for.
  if (!opts.silent) {
    broadcastSSE('apiRequest', {
      // Declared by the caller rather than read off the MessageCategory. The category
      // cannot name these on its own: a refund and a sale are both 'Payment', and
      // cancelling a sale and cancelling a card read are both 'Abort'. The client
      // logs the matching response under the same string, so the two halves pair up.
      label: opts.label || body?.SaleToPOIRequest?.MessageHeader?.MessageCategory || '',
      endpoint,
      payload: body
    });
  }

  const timeoutMs = opts.timeoutMs || ADYEN_TIMEOUT_MS;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-API-key': process.env.ADYEN_API_KEY || ''
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    // A timeout means the outcome is unknown, not that the request failed, so say
    // so plainly: callers must not record it as a decline. `code` travels out to the
    // client, which holds this message on screen longer than an ordinary error.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      const secs = Math.round(timeoutMs / 1000);
      // Only a call that is actually routed to a device may be reported as the
      // device not answering. Lookups Adyen answers from its own records are not,
      // and blaming a terminal for one of those sent people to check hardware that
      // was never asked anything -- while telling them to wait for it to come back
      // online, which no amount of waiting would change.
      const timeoutError = new Error(opts.touchesDevice === false
        ? `Adyen did not answer the ${opts.label || 'lookup'} request within ${secs}s. Nothing was asked of a terminal, so this does not mean one is offline.`
        : `The terminal did not respond within ${secs}s, please retry when the terminal is online.`);
      timeoutError.code = 'ADYEN_TIMEOUT';
      throw timeoutError;
    }
    throw err;
  }
  // async endpoint returns 200 with "ok" text, not JSON
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

// --------------- Connected terminals ---------------
// Answered by Adyen from its own records, so it returns in well under a second and
// never waits on the device. Cached briefly so a burst of requests costs one lookup.
//
// This used to also run as a preflight before every terminal-bound request, to stop
// one being sent to a device that was not there. It was removed: Adyen refuses a
// request for an absent terminal quickly and says why, which is the same answer the
// preflight gave -- only the preflight charged every payment a lookup to get it, up
// to a ten-second wait that appeared nowhere in the log. What the preflight was
// genuinely protecting was the async path, which ignored its own acknowledgement;
// that is now checked where it belongs.
const CONNECTED_CACHE_MS = 5000;
let _connectedCache = { data: null, at: 0 };

async function fetchConnectedTerminals({ force = false, silent = false } = {}) {
  if (!force && _connectedCache.data && Date.now() - _connectedCache.at < CONNECTED_CACHE_MS) {
    return _connectedCache.data;
  }
  const data = await adyenRequest(
    'https://terminal-api-test.adyen.com/connectedTerminals',
    { merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '' },
    { timeoutMs: ADYEN_LOOKUP_TIMEOUT_MS, silent, label: 'Connected terminals', touchesDevice: false }
  );
  _connectedCache = { data, at: Date.now() };
  return data;
}

// --------------- API: Config (expose non-secret config to frontend) ---------------
app.get('/api/config', (req, res) => {
  res.json({
    poiId: getActivePoiId(),
    terminals,
    saleId: process.env.ADYEN_SALE_ID || 'POSWebApp',
    merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT || '',
    printerModels: PRINTER_MODEL_PREFIXES,
    currency: process.env.CURRENCY || 'EUR',
    sessionId: (req.auth && req.auth.sid) || '',
    tapToPay: {
      defaultStoreId: PAYMENTS_APP_DEFAULT_STORE,
      // true when the Nexo shared key is configured so payments can be encrypted
      encryptionReady: !!(process.env.ADYEN_NEXO_KEY_PASSPHRASE && process.env.ADYEN_NEXO_KEY_IDENTIFIER)
    }
  });
});

// --------------- API: User Activity (presence) ---------------
app.post('/api/activity', (req, res) => {
  const sessionId = (req.auth && req.auth.sid) || '';
  broadcastSSE('userActivity', { sessionId, timestamp: Date.now() });
  res.json({ ok: true });
});

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

// --------------- API: Add Terminals ---------------
// Adds every terminal that is online for this merchant account and not already in
// the list.
//
// This used to take one typed POI ID and check it against the same online list. The
// typing was busywork with a wrong answer available: the merchant account already
// determines which terminals exist, so the only thing a person could contribute was
// a typo, answered by a "not online" error they could do nothing about.
app.post('/api/terminal/discover', async (_req, res) => {
  try {
    const data = await fetchConnectedTerminals({ force: true });
    const online = data.uniqueTerminalIds || [];
    const known = new Set(terminals.map(t => t.poiId));
    const added = online.filter(id => !known.has(id));

    for (const poiId of added) {
      terminals.push({ poiId, active: terminals.length === 0 });
    }
    if (added.length) broadcastSSE('terminalUpdate', terminals);

    res.json({
      added,
      onlineCount: online.length,
      terminals
    });
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
app.post('/api/terminals', async (req, res) => {
  // The client re-checks the terminal after every EventSource reconnect, which is
  // not the user asking for anything. It used to be indistinguishable from a real
  // check here, with two consequences: it called Adyen every time, bypassing the
  // cache, and adyenRequest broadcast its request mirror to every connected client
  // -- so an unpaired 'Connected terminals' REQ appeared in everyone's log, with no
  // response beside it, triggered by nobody.
  //
  // An explicit check must still never answer from the cache: showing a terminal as
  // online because it was five seconds ago is the one thing this button is for.
  const background = req.body?.silent === true;
  try {
    res.json(await fetchConnectedTerminals({ force: !background, silent: background }));
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
        // Deliberately false: this endpoint is also used by automatic pending-order
        // recovery, and reprinting a receipt on every status poll would make the
        // terminal spit out paper without the user asking for it. Reprinting is
        // handled explicitly by /api/reprint-receipt.
        ReceiptReprintFlag: false,
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
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { timeoutMs: ADYEN_UNATTENDED_TIMEOUT_MS, label: 'Transaction status' });

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
        order.failureReason = describeFailure(paymentResponse);
        order.response = data;
        settleLoyalty(order);
        const poiData = paymentResponse.POIData;
        if (poiData?.POITransactionID) {
          order.poiTransactionId = poiData.POITransactionID.TransactionID;
          order.poiTimestamp = poiData.POITransactionID.TimeStamp;
        }
        order.pspReference = extractPspReference(paymentResponse);
        order.tenderReference = extractTenderReference(paymentResponse);
        order.paymentBrand = extractPaymentBrand(paymentResponse);
        order.maskedPan = extractMaskedPan(paymentResponse);
        orderChanged(order);
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

// --------------- Receipt printing helpers ---------------
// The receipt goes out as three print requests, because a request carries a
// single OutputFormat and, as test prints on the S1F2L showed, its XHTML renderer
// only draws a document whose root element is a bare <img/>. A wrapping element,
// text and tables all print nothing while still answering Success. So:
//   1. XHTML  - the logo image
//   2. Text   - the payment details
//   3. BarCode - the QR code

// Characters per line on the printer, used to right-align values against labels.
const RECEIPT_PRINT_WIDTH = parseInt(process.env.RECEIPT_PRINT_WIDTH || '32', 10);

// Scanned by the shopper, printed at the very bottom of the receipt. Editable at
// runtime, so the current value is kept next to the logo on disk.
const RECEIPT_QR_URL_DEFAULT = process.env.RECEIPT_QR_URL || 'https://adyen.com.cn';
const RECEIPT_QR_MAX_LENGTH = 512;
const RECEIPT_SETTINGS_FILE = path.join(__dirname, 'assets', 'receipt-settings.json');

let receiptQrUrl = RECEIPT_QR_URL_DEFAULT;
try {
  const stored = JSON.parse(fs.readFileSync(RECEIPT_SETTINGS_FILE, 'utf8'));
  if (typeof stored.qrUrl === 'string' && stored.qrUrl.trim()) receiptQrUrl = stored.qrUrl.trim();
} catch {
  // No stored settings yet: keep the default.
}

function saveReceiptSettings() {
  fs.writeFileSync(RECEIPT_SETTINGS_FILE, JSON.stringify({ qrUrl: receiptQrUrl }, null, 2));
}

// A PNG uploaded through the app wins over the bundled Adyen logo. It lives next
// to it on disk, so on Azure it survives restarts but not a redeploy.
const RECEIPT_LOGO_FILE = path.join(__dirname, 'assets', 'receipt-logo.png');
const RECEIPT_LOGO_CUSTOM_FILE = path.join(__dirname, 'assets', 'receipt-logo-custom.png');

// Adyen caps a printed image at 256000 bytes. Stay clear of it: the PNG travels
// inside the base64-encoded XHTML document, which inflates it by a third.
const RECEIPT_LOGO_MAX_BYTES = 180000;

// Widest the print head can render. An image wider than this is rejected rather
// than scaled, because scaling a 1-bit image server-side needs an image library.
const RECEIPT_LOGO_MAX_WIDTH = 384;
const RECEIPT_LOGO_MAX_HEIGHT = 300;

// Reads width and height out of a PNG's IHDR chunk, which always comes first and
// at a fixed offset, and doubles as a check that this really is a PNG.
function readPngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// The logo the receipt is currently printed with, or null if neither file is
// readable. Cached, because it is read on every print.
let _logo;
function loadReceiptLogo() {
  if (_logo === undefined) {
    _logo = null;
    for (const file of [RECEIPT_LOGO_CUSTOM_FILE, RECEIPT_LOGO_FILE]) {
      try {
        const buffer = fs.readFileSync(file);
        const size = readPngSize(buffer);
        if (!size) continue;
        _logo = {
          base64: buffer.toString('base64'),
          bytes: buffer.length,
          custom: file === RECEIPT_LOGO_CUSTOM_FILE,
          ...size
        };
        break;
      } catch {
        // Missing or unreadable: fall through to the next candidate.
      }
    }
    if (!_logo) console.warn('No receipt logo available; receipts print without one');
  }
  return _logo;
}

// Technical card and acquirer details that Adyen puts on the receipt but that are
// noise for the shopper. Dropped when we render our own printout.
const RECEIPT_HIDDEN_KEYS = new Set([
  'panSeq', 'preferredName', 'cardType', 'paymentMethodVariant', 'posEntryMode',
  'aid', 'mid', 'tid', 'ptid', 'authCode', 'txRef',
  // We print our own store name, the PSP reference identifies the payment better
  // than our internal UUID, and the type is always the same here.
  'cardholderHeader', 'merchantTitle', 'mref', 'txtype',
  // Adyen's "Retain for your records" footer; not wanted on our printout.
  'retain'
]);

// Pull the receipt data out of either a PaymentResponse or the PaymentResponse
// nested inside a TransactionStatusResponse, so the same helper works for a
// stored payment response and for a freshly fetched transaction status.
function extractPaymentReceipt(root, qualifier = 'CustomerReceipt') {
  const sale = root?.SaleToPOIResponse || root;
  const paymentResponse = sale?.PaymentResponse
    || sale?.TransactionStatusResponse?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
  const receipts = paymentResponse?.PaymentReceipt;
  if (!Array.isArray(receipts) || receipts.length === 0) return null;
  const match = receipts.find(r => r?.DocumentQualifier === qualifier) || receipts[0];
  const items = match?.OutputContent?.OutputText;
  return Array.isArray(items) && items.length > 0 ? items : null;
}

// Adyen returns receipt lines as form-encoded key/name/value triplets, e.g.
// "name=Date&value=29%2f07%2f2026&key=txdate". They become intermediate line
// objects here, which renderReceiptXhtml turns into markup.
function buildReceiptLines(items, insertions = {}) {
  const lines = [];
  const inserted = new Set();
  for (const item of items) {
    const raw = typeof item?.Text === 'string' ? item.Text : '';
    const params = new URLSearchParams(raw);
    const key = params.get('key') || '';
    const name = params.get('name');
    const value = params.get('value');

    if (insertions[key] && !inserted.has(key)) {
      lines.push(...insertions[key]);
      inserted.add(key);
    }
    if (RECEIPT_HIDDEN_KEYS.has(key)) continue;
    const bold = item?.CharacterStyle === 'Bold';

    if (!name && !value) {
      // "filler" is an intentional blank line; empty headerN/footerN entries are
      // unconfigured merchant header slots and would print as stray blank lines.
      if (key === 'filler') lines.push({ type: 'blank' });
      continue;
    }
    if (!value) {
      lines.push({ type: 'centred', text: name, bold });
      continue;
    }
    lines.push({ type: 'pair', label: name || '', value, bold });
  }
  // The receipt layout is generated dynamically, so an anchor key may be absent.
  // Append anything that never found its anchor rather than dropping it.
  for (const [key, extra] of Object.entries(insertions)) {
    if (!inserted.has(key)) lines.push(...extra);
  }
  return lines;
}

// Removing fields leaves the surrounding "filler" separators stacked up, so drop
// leading, trailing and repeated blank lines to keep the printout tight. Trailing
// ones matter most: they push the QR code that follows down the paper.
function collapseBlankLines(lines) {
  const out = [];
  for (const line of lines) {
    const isBlank = line.type === 'blank';
    if (isBlank && (out.length === 0 || out[out.length - 1].type === 'blank')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].type === 'blank') out.pop();
  return out;
}

// The PSP reference is the identifier used to look the payment up in the Customer
// Area, so it is worth printing even though Adyen's receipt data omits it.
function buildPspLines(order) {
  if (!order?.pspReference) return [];
  return [{ type: 'pair', label: 'PSP ref.', value: order.pspReference }];
}

// Renders the purchased products as receipt lines. Adyen's receipt data only
// describes the payment, never the basket, so line items can only come from our
// own order record.
function buildItemLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) return [];
  const currency = order.currency || '';
  const lines = [{ type: 'blank' }];
  for (const item of items) {
    const qty = item.qty || 1;
    lines.push({
      type: 'pair',
      label: `${item.name || 'Item'} x${qty}`,
      value: `${currency} ${((item.price || 0) * qty).toFixed(2)}`.trim()
    });
  }
  // Without this the item lines would add up to more than the amount charged,
  // because the points were taken off the basket before the card was asked to pay.
  if (order.loyalty?.pointsUsed > 0) {
    lines.push({
      type: 'pair',
      label: `Points redeemed (${order.loyalty.pointsUsed})`,
      value: `- ${currency} ${order.loyalty.pointsUsed.toFixed(2)}`.trim()
    });
  }
  lines.push({ type: 'blank' });
  return lines;
}

// Turns the line objects into Text output, padding each label out with spaces so
// its value lands against the right edge of the paper.
function renderReceiptText(lines) {
  return lines.map(line => {
    if (line.type === 'blank') return { Text: '', EndOfLineFlag: true };
    const style = line.bold ? 'Bold' : 'Normal';
    if (line.type === 'centred') {
      return { Text: line.text, CharacterStyle: style, Alignment: 'Centred', EndOfLineFlag: true };
    }
    const gap = RECEIPT_PRINT_WIDTH - line.label.length - line.value.length;
    return {
      Text: gap > 0 ? line.label + ' '.repeat(gap) + line.value : `${line.label} ${line.value}`,
      CharacterStyle: style,
      EndOfLineFlag: true
    };
  });
}

// The one XHTML shape this terminal renders: a bare <img/> root, no wrapper. The
// space after "base64," is required by Adyen.
function renderLogoXhtml(logo) {
  const width = Math.min(logo.width, RECEIPT_LOGO_MAX_WIDTH);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<img src="data:image/png;base64, ${logo.base64}" width="${width}"/>`;
}

// One print request. A request carries a single OutputFormat, so text, XHTML and
// barcode content cannot be combined in one message.
async function sendPrintContent(poiId, outputContent, documentQualifier = 'Document') {
  return adyenRequest('https://terminal-api-test.adyen.com/sync', {
    SaleToPOIRequest: {
      MessageHeader: {
        ProtocolVersion: '3.0',
        MessageClass: 'Device',
        MessageCategory: 'Print',
        MessageType: 'Request',
        ServiceID: uuidv4().replace(/-/g, '').slice(0, 10),
        SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
        POIID: poiId
      },
      PrintRequest: {
        PrintOutput: {
          DocumentQualifier: documentQualifier,
          ResponseMode: 'PrintEnd',
          OutputContent: outputContent
        }
      }
    }
  }, { timeoutMs: ADYEN_UNATTENDED_TIMEOUT_MS, label: 'Print receipt' });
}

// --------------- API: Receipt Settings ---------------
function describeLogo(logo) {
  if (!logo) return { present: false, custom: false };
  return {
    present: true,
    custom: logo.custom,
    width: logo.width,
    height: logo.height,
    bytes: logo.bytes,
    dataUrl: `data:image/png;base64,${logo.base64}`
  };
}

app.get('/api/receipt-settings', (_req, res) => {
  res.json({
    logo: describeLogo(loadReceiptLogo()),
    qrUrl: receiptQrUrl,
    qrUrlDefault: RECEIPT_QR_URL_DEFAULT,
    limits: {
      maxWidth: RECEIPT_LOGO_MAX_WIDTH,
      maxHeight: RECEIPT_LOGO_MAX_HEIGHT,
      maxBytes: RECEIPT_LOGO_MAX_BYTES,
      maxQrLength: RECEIPT_QR_MAX_LENGTH
    }
  });
});

// Any text can be encoded in a QR code, so the only limit is how much the code
// can hold before it gets too dense for the printer to render legibly.
app.post('/api/receipt-qr', (req, res) => {
  const qrUrl = typeof req.body.qrUrl === 'string' ? req.body.qrUrl.trim() : '';
  if (!qrUrl) return res.status(400).json({ error: 'The QR code content cannot be empty' });
  if (qrUrl.length > RECEIPT_QR_MAX_LENGTH) {
    return res.status(400).json({
      error: `The content is ${qrUrl.length} characters, over the ${RECEIPT_QR_MAX_LENGTH} that print legibly`
    });
  }
  try {
    receiptQrUrl = qrUrl;
    saveReceiptSettings();
    res.json({ qrUrl: receiptQrUrl });
  } catch (err) {
    res.status(500).json({ error: `Could not store the QR content: ${err.message}` });
  }
});

app.delete('/api/receipt-qr', (_req, res) => {
  try {
    receiptQrUrl = RECEIPT_QR_URL_DEFAULT;
    saveReceiptSettings();
    res.json({ qrUrl: receiptQrUrl });
  } catch (err) {
    res.status(500).json({ error: `Could not reset the QR content: ${err.message}` });
  }
});

// Takes a PNG data URL. The browser already downscales and thresholds the picked
// file; these checks are the guard that whatever arrives can actually be printed.
app.post('/api/receipt-logo', (req, res) => {
  const { dataUrl } = req.body;
  const base64 = typeof dataUrl === 'string' ? dataUrl.replace(/^data:image\/png;base64,/, '') : '';
  if (!base64 || base64 === dataUrl) {
    return res.status(400).json({ error: 'Expected a PNG data URL' });
  }

  const buffer = Buffer.from(base64, 'base64');
  const size = readPngSize(buffer);
  if (!size) {
    return res.status(400).json({ error: 'The uploaded file is not a valid PNG image' });
  }
  if (buffer.length > RECEIPT_LOGO_MAX_BYTES) {
    return res.status(400).json({
      error: `The image is ${Math.round(buffer.length / 1024)} KB, over the ${Math.round(RECEIPT_LOGO_MAX_BYTES / 1024)} KB the terminal accepts`
    });
  }
  if (size.width > RECEIPT_LOGO_MAX_WIDTH || size.height > RECEIPT_LOGO_MAX_HEIGHT) {
    return res.status(400).json({
      error: `The image is ${size.width}x${size.height} px, over the ${RECEIPT_LOGO_MAX_WIDTH}x${RECEIPT_LOGO_MAX_HEIGHT} px the printer can render`
    });
  }

  try {
    fs.writeFileSync(RECEIPT_LOGO_CUSTOM_FILE, buffer);
    _logo = undefined;
    res.json(describeLogo(loadReceiptLogo()));
  } catch (err) {
    res.status(500).json({ error: `Could not store the logo: ${err.message}` });
  }
});

// Removing the uploaded file falls back to the bundled Adyen logo.
app.delete('/api/receipt-logo', (_req, res) => {
  try {
    fs.rmSync(RECEIPT_LOGO_CUSTOM_FILE, { force: true });
    _logo = undefined;
    res.json(describeLogo(loadReceiptLogo()));
  } catch (err) {
    res.status(500).json({ error: `Could not remove the logo: ${err.message}` });
  }
});

// --------------- API: Reprint Receipt ---------------
// Reprints the shopper receipt of an earlier payment on the terminal that took
// it. ReceiptReprintFlag on a TransactionStatus request does not reliably put
// paper out (it mainly returns the receipt data), so this instead renders the
// receipt data itself and sends explicit Terminal API Print requests.
// Requires a cloud-connected terminal with a built-in printer; the Payments app
// (Tap to Pay) cannot print at all.
app.post('/api/reprint-receipt', async (req, res) => {
  const { serviceId } = req.body;
  const order = orders.find(o => o.serviceId === serviceId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.viaTapToPay) {
    return res.status(400).json({ error: 'Receipt reprint is not supported for Tap to Pay payments' });
  }
  const poiId = order.terminalId || getActivePoiId();
  if (!poiId) return res.status(400).json({ error: 'No terminal is selected' });

  try {
    // Prefer the receipt data already stored with the order: it survives even
    // after the terminal has dropped the transaction from its local history.
    let items = extractPaymentReceipt(order.response);
    let statusResponse = null;

    if (!items) {
      const statusHeader = makeHeader('TransactionStatus');
      statusHeader.POIID = poiId;
      statusResponse = await adyenRequest('https://terminal-api-test.adyen.com/sync', {
        SaleToPOIRequest: {
          MessageHeader: statusHeader,
          TransactionStatusRequest: {
            ReceiptReprintFlag: false,
            DocumentQualifier: ['CustomerReceipt'],
            MessageReference: {
              MessageCategory: 'Payment',
              ServiceID: serviceId,
              SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
              POIID: poiId
            }
          }
        }
      }, { timeoutMs: ADYEN_UNATTENDED_TIMEOUT_MS, label: 'Transaction status' });
      items = extractPaymentReceipt(statusResponse);
    }

    if (!items) {
      const errorCondition = statusResponse?.SaleToPOIResponse?.TransactionStatusResponse?.Response?.ErrorCondition || '';
      return res.status(400).json({
        error: errorCondition === 'NotFound'
          ? 'The terminal no longer has this transaction stored, so its receipt cannot be reprinted.'
          : 'No receipt data is available for this order.',
        errorCondition,
        adyenResponse: statusResponse
      });
    }

    const lines = collapseBlankLines(buildReceiptLines(items, {
      mref: buildPspLines(order),
      totalAmount: buildItemLines(order)
    }));

    // The paper does not advance between requests, so these three print as one
    // continuous receipt in the order they are sent.
    const steps = [];
    const runStep = async (name, outputContent, documentQualifier) => {
      const data = await sendPrintContent(poiId, outputContent, documentQualifier);
      const response = data?.SaleToPOIResponse?.PrintResponse?.Response;
      steps.push({ step: name, result: response?.Result, errorCondition: response?.ErrorCondition, adyenResponse: data });
      return response?.Result === 'Success';
    };

    const logo = loadReceiptLogo();
    if (logo) {
      await runStep('logo', {
        OutputFormat: 'XHTML',
        OutputXHTML: Buffer.from(renderLogoXhtml(logo), 'utf8').toString('base64')
      });
    }
    const detailsOk = await runStep('details', {
      OutputFormat: 'Text',
      OutputText: renderReceiptText(lines)
    });
    await runStep('qrCode', {
      OutputFormat: 'BarCode',
      OutputBarcode: { BarcodeType: 'QRCode', BarcodeValue: receiptQrUrl }
    }, 'CustomerReceipt');

    if (detailsOk) {
      return res.json({ success: true, steps });
    }
    const failed = steps.find(s => s.result !== 'Success');
    res.status(400).json({
      error: `Print failed${failed?.errorCondition ? ` (${failed.errorCondition})` : ''}`,
      errorCondition: failed?.errorCondition || '',
      steps
    });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

// --------------- API: Clear Orders ---------------
app.delete('/api/orders', async (req, res) => {
  orders.length = 0;
  // A dedicated event, not `init`: clients treat `init` as a reconnect snapshot
  // and merge it, so an empty `init` would no longer clear their list.
  broadcastSSE('ordersCleared', {});
  // Awaited, unlike an ordinary change: without it a reload could bring back the
  // orders that were just cleared, which looks like the button did nothing.
  await orderStore.clear();
  res.json({ status: 'cleared' });
});

// --------------- Loyalty: member store ---------------
// A member is recognised by the card alias returned by a card acquisition, which
// is why the alias is the one field that has to be filled in from a real card
// read. Edits are written next to the seed file, so on Azure they survive a
// restart but not a redeploy, exactly like the receipt logo.
const MEMBERS_DEFAULT_FILE = path.join(__dirname, 'assets', 'members.default.json');
const MEMBERS_FILE = path.join(__dirname, 'assets', 'members.json');

// Points redeem 1:1 against the basket currency, so they are whole currency units.
const MEMBER_MAX_POINTS = 1000000;

// The terminal cannot authorise a zero amount, so a full-basket redemption has to
// leave something behind for the card to pay.
const LOYALTY_MIN_CHARGE = 0.01;

// Icons the terminal will draw above a custom message. Anything else is refused, so
// the value is checked rather than passed straight through from the client.
const DISPLAY_ICONS = ['Accepted', 'AcceptedAnimated', 'Declined', 'DeclinedAnimated', 'Idle'];

function normaliseMember(raw, index) {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `member-${index + 1}`,
    displayName: typeof raw?.displayName === 'string' ? raw.displayName : '',
    email: typeof raw?.email === 'string' ? raw.email : '',
    points: Number.isFinite(Number(raw?.points)) ? Math.max(0, Math.floor(Number(raw.points))) : 0,
    alias: typeof raw?.alias === 'string' ? raw.alias.trim() : ''
  };
}

function readMembersFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Expected an array of members');
  return parsed.map(normaliseMember);
}

let members = [];
let membersAreDefaults = true;
try {
  members = readMembersFile(MEMBERS_FILE);
  membersAreDefaults = false;
} catch {
  try {
    members = readMembersFile(MEMBERS_DEFAULT_FILE);
  } catch (err) {
    console.warn(`No loyalty members available: ${err.message}`);
  }
}

function saveMembers() {
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members, null, 2));
  membersAreDefaults = false;
}

// Aliases come back from the terminal as an opaque token; compare them without
// case sensitivity so an alias pasted in by hand still matches.
function findMemberByAlias(alias) {
  const needle = (alias || '').trim().toLowerCase();
  if (!needle) return null;
  return members.find(m => m.alias && m.alias.toLowerCase() === needle) || null;
}

// How many points this basket can absorb, leaving a chargeable remainder. Floored
// to a whole number because one point is worth one currency unit, so a fractional
// redemption would mean fractional points.
function redeemableAmount(points, amount) {
  return Math.max(0, Math.floor(Math.min(points, amount - LOYALTY_MIN_CHARGE)));
}

function validateMemberInput(body) {
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName) return { error: 'A name is required' };
  if (displayName.length > 60) return { error: 'The name is longer than 60 characters' };

  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: `"${email}" is not a valid email address` };
  }

  const rawPoints = body?.points;
  const points = rawPoints === '' || rawPoints === null || rawPoints === undefined ? 0 : Number(rawPoints);
  if (!Number.isFinite(points) || points < 0) return { error: 'Points must be zero or more' };
  if (points > MEMBER_MAX_POINTS) return { error: `Points cannot exceed ${MEMBER_MAX_POINTS}` };

  const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
  if (alias.length > 64) return { error: 'The alias is longer than 64 characters' };

  return { value: { displayName, email, points: Math.floor(points), alias } };
}

// --------------- API: Loyalty members ---------------
app.get('/api/members', (_req, res) => {
  res.json({ members, usingDefaults: membersAreDefaults, minCharge: LOYALTY_MIN_CHARGE });
});

// The editor saves everything at once, so this replaces the whole list: rows added
// or removed in the UI are only committed here. Nothing is written unless every
// row validates, otherwise a single typo could half-save the list.
app.put('/api/members', (req, res) => {
  const incoming = req.body?.members;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'A members array is required' });
  }

  const next = [];
  const seenAliases = new Set();
  for (let i = 0; i < incoming.length; i++) {
    const { error, value } = validateMemberInput(incoming[i]);
    if (error) return res.status(400).json({ error: `Row ${i + 1}: ${error}`, index: i });

    // Two members sharing an alias would make the card lookup ambiguous, and it
    // would silently resolve to whichever one happens to come first.
    const key = value.alias.toLowerCase();
    if (key) {
      if (seenAliases.has(key)) {
        return res.status(400).json({ error: `Row ${i + 1}: that alias is already used by another member`, index: i });
      }
      seenAliases.add(key);
    }

    const id = typeof incoming[i]?.id === 'string' && incoming[i].id
      ? incoming[i].id
      : `member-${uuidv4().slice(0, 8)}`;
    next.push({ id, ...value });
  }

  const previous = members;
  members = next;
  try {
    saveMembers();
    res.json({ members });
  } catch (err) {
    members = previous;
    res.status(500).json({ error: `Could not store the members: ${err.message}` });
  }
});

// --------------- API: Loyalty — read the card ---------------
// A card acquisition asks the terminal for the card's alias without taking any
// money, which is what makes member lookup before the payment possible. The
// POITransactionID it returns is then quoted by the payment as
// CardAcquisitionReference, so the shopper presents the card only once.
app.post('/api/loyalty/read-card', async (req, res) => {
  const poiId = getActivePoiId();
  if (!poiId) return res.status(400).json({ error: 'No terminal is selected' });

  const header = makeHeader('CardAcquisition');
  // The client supplies the ServiceID so it can abort the read while this request
  // is still waiting for the shopper to present a card, exactly as the payment
  // flow does for its cancel button.
  if (req.body?.serviceId) header.ServiceID = req.body.serviceId;
  const transactionId = uuidv4();
  const timestamp = new Date().toISOString();

  // The amount is what allows a contactless card to be processed during the
  // acquisition. Without it the shopper has to tap a second time for the payment,
  // however the discount is settled. It is an opening figure, not a commitment:
  // the payment carries the final amount once the points are applied.
  const total = Number(req.body?.amount);
  const hasTotal = Number.isFinite(total) && total > 0;

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      CardAcquisitionRequest: {
        SaleData: {
          SaleTransactionID: { TransactionID: transactionId, TimeStamp: timestamp },
          // 'Customer' returns an alias that is stable for this card across
          // transactions, so it can identify a member. 'Transaction' would give a
          // one-off token that is useless for lookup.
          TokenRequestedType: 'Customer'
        },
        CardAcquisitionTransaction: {
          ...(hasTotal ? { TotalAmount: total } : {}),
          // Declares that a payment follows, rather than an unreferenced refund.
          PaymentType: 'Normal'
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { label: 'Card read' });
    const acquisition = data?.SaleToPOIResponse?.CardAcquisitionResponse;
    const response = acquisition?.Response;

    if (response?.Result !== 'Success') {
      return res.status(400).json({
        error: `Card read failed${response?.ErrorCondition ? ` (${response.ErrorCondition})` : ''}`,
        errorCondition: response?.ErrorCondition || '',
        adyenResponse: data
      });
    }

    const cardData = acquisition?.PaymentInstrumentData?.CardData;
    // The alias normally arrives as a payment token; some terminals only report it
    // in the form-encoded AdditionalResponse, so both are checked.
    let alias = cardData?.PaymentToken?.TokenValue || '';
    if (!alias) {
      try { alias = new URLSearchParams(response?.AdditionalResponse || '').get('alias') || ''; } catch { /* not form-encoded */ }
    }

    const poiTransaction = acquisition?.POIData?.POITransactionID;
    if (!poiTransaction?.TransactionID) {
      return res.status(400).json({ error: 'The terminal did not return a card acquisition reference', adyenResponse: data });
    }

    const member = findMemberByAlias(alias);
    res.json({
      serviceId: header.ServiceID,
      alias,
      maskedPan: cardData?.MaskedPan || '',
      paymentBrand: cardData?.PaymentBrand || '',
      cardAcquisition: {
        transactionId: poiTransaction.TransactionID,
        timeStamp: poiTransaction.TimeStamp
      },
      member: member ? { ...member } : null,
      adyenResponse: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Loyalty — abort a card read still in progress ---------------
// While the terminal is still prompting for the card, the read is stopped the same
// way a payment is: an abort quoting the ServiceID of the request to kill. The
// pending read-card call then comes back with Failure / Aborted.
app.post('/api/loyalty/abort', async (req, res) => {
  const { serviceId } = req.body;
  if (!serviceId) return res.status(400).json({ error: 'A serviceId is required' });

  const poiId = getActivePoiId();
  const header = makeHeader('Abort');
  header.POIID = poiId;

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      AbortRequest: {
        AbortReason: 'MerchantAbort',
        MessageReference: {
          MessageCategory: 'CardAcquisition',
          ServiceID: serviceId,
          SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
          POIID: poiId
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { label: 'Cancel card read' });
    res.json({ ok: true, adyenResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Loyalty — release a completed card acquisition ---------------
// Once the card has been read, the terminal holds the card data and sits on 'One
// moment' waiting for the payment that quotes it. An abort will not clear that,
// because the card acquisition itself already finished successfully. The documented
// way out is an EnableService with AbortTransaction, which makes the terminal
// discard the card data and return to idle.
app.post('/api/loyalty/release', async (req, res) => {
  const poiId = getActivePoiId();
  if (!poiId) return res.status(400).json({ error: 'No terminal is selected' });

  // Left out, the terminal falls back to its own screen: 'Canceled', a red cross and
  // 'Transaction canceled'. A DisplayOutput replaces all three. OutputText is a
  // header and a footer rather than a list of lines, and PredefinedContent picks the
  // icon, where Idle means none at all.
  const header = typeof req.body?.messageHeader === 'string' ? req.body.messageHeader.trim() : '';
  const footer = typeof req.body?.messageFooter === 'string' ? req.body.messageFooter.trim() : '';
  const icon = DISPLAY_ICONS.includes(req.body?.icon) ? req.body.icon : 'Idle';

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: makeHeader('EnableService'),
      EnableServiceRequest: {
        TransactionAction: 'AbortTransaction',
        ...(header ? {
          DisplayOutput: {
            Device: 'CustomerDisplay',
            InfoQualify: 'Display',
            OutputContent: {
              OutputFormat: 'Text',
              PredefinedContent: { ReferenceID: icon },
              OutputText: [
                { Text: header },
                ...(footer ? [{ Text: footer }] : [])
              ]
            }
          }
        } : {})
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { label: 'Release card' });
    const parsed = readEnableServiceResult(data);
    const reason = [parsed.errorCondition, parsed.message].filter(Boolean).join(': ');
    res.json({
      ok: parsed.result === 'Success',
      result: parsed.result || null,
      error: parsed.result === 'Success' ? undefined : `Could not release the terminal${reason ? ` (${reason})` : ''}`,
      adyenResponse: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Loyalty — ask the shopper on the terminal ---------------
// An Input request with GetConfirmation puts a two-button question on the
// terminal, so the member's name and balance are shown to the shopper by the
// terminal itself rather than read out loud at the till.
app.post('/api/loyalty/confirm', async (req, res) => {
  const { memberId, amount, currency } = req.body;
  const poiId = getActivePoiId();
  if (!poiId) return res.status(400).json({ error: 'No terminal is selected' });

  const member = members.find(m => m.id === memberId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const total = Number(amount);
  if (!Number.isFinite(total) || total <= 0) {
    return res.status(400).json({ error: 'A basket amount is required' });
  }

  const discount = redeemableAmount(member.points, total);
  const cur = currency || process.env.CURRENCY || 'EUR';
  const payable = Math.round((total - discount) * 100) / 100;

  const header = makeHeader('Input');
  // Input is a device-level message, not a transaction service.
  header.MessageClass = 'Device';

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: header,
      InputRequest: {
        DisplayOutput: {
          Device: 'CustomerDisplay',
          InfoQualify: 'Display',
          OutputContent: {
            OutputFormat: 'Text',
            // Required: without it the terminal rejects the whole message with
            // MessageFormat / 'PredefinedContent field missing and required' and
            // stays on 'One moment' instead of showing the question.
            PredefinedContent: { ReferenceID: 'GetConfirmation' },
            // The four entries are positional: title, body, left button, right
            // button. The title is clipped at roughly 20 characters on a portrait
            // display, so the detail goes in the body instead.
            OutputText: [
              { Text: 'Welcome back' },
              { Text: `Our VIP ${member.displayName}\nRedeem ${discount} of ${member.points} points?\nYou pay ${cur} ${payable.toFixed(2)}` },
              // Declining charges the full basket straight away, so the button says
              // what it costs rather than leaving the shopper to infer it.
              { Text: `No - Pay ${total.toFixed(2)} ${cur}` },
              { Text: 'Yes' }
            ]
          }
        },
        InputData: {
          Device: 'CustomerInput',
          InfoQualify: 'Input',
          InputCommand: 'GetConfirmation',
          MaxInputTime: 30
        }
      }
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { label: 'Confirmation' });
    const parsed = readInputResult(data);

    if (parsed.result !== 'Success') {
      // The terminal explains itself in AdditionalResponse, so pass that through
      // rather than reporting a bare 'no answer'.
      const reason = [parsed.errorCondition, parsed.message].filter(Boolean).join(': ');
      return res.status(400).json({
        error: `The terminal did not answer the question${reason ? ` (${reason})` : ''}`,
        errorCondition: parsed.errorCondition,
        adyenResponse: data
      });
    }

    const confirmed = parsed.confirmed;
    res.json({
      confirmed,
      pointsAvailable: member.points,
      discount: confirmed ? discount : 0,
      finalAmount: Math.round((total - (confirmed ? discount : 0)) * 100) / 100,
      adyenResponse: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Points are spent only once the payment is actually paid, so an abandoned or
// declined transaction leaves the balance untouched. A later refund does not put
// them back: reverse that by editing the balance in the User data modal.
function settleLoyalty(order) {
  const loyalty = order?.loyalty;
  if (!loyalty || loyalty.applied || loyalty.pointsUsed <= 0) return;
  if (order.status !== 'paid') return;

  const member = members.find(m => m.id === loyalty.memberId);
  if (!member) return;
  member.points = Math.max(0, member.points - loyalty.pointsUsed);
  loyalty.applied = true;
  try {
    saveMembers();
  } catch (err) {
    console.warn(`Could not persist the redeemed points: ${err.message}`);
  }
}

// Turns a failed PaymentResponse into a line a cashier can act on. Neither half of
// the raw answer is fit to show: ErrorCondition is a protocol enum ('Aborted',
// 'Refusal'), and the terminal's own wording is buried in a form-encoded
// AdditionalResponse. This lived inline in the webhook, so async payments got a
// readable reason and sync ones got nothing at all -- which is why the sync overlay
// fell back to printing the enum.
const FAILURE_MESSAGES = {
  Busy: 'Terminal busy \u2014 another transaction in progress',
  Aborted: 'Transaction cancelled',
  Cancel: 'Transaction cancelled',
  Refusal: 'Payment declined',
  NotFound: 'Transaction not found',
  UnavailableService: 'Terminal service unavailable',
  InvalidCard: 'Invalid card',
  WrongPIN: 'Wrong PIN entered'
};

// Adyen refuses an async submission with a JSON body rather than the plain 'ok' it
// answers when the request has been taken. The shape varies by reason, so the known
// carriers are tried in turn and the raw body is the last resort -- better a cashier
// sees something they can quote than a bare 'submission refused'.
function describeAsyncRefusal(data) {
  const fromResponse = data?.SaleToPOIResponse?.PaymentResponse?.Response;
  const text = data?.message
    || data?.error
    || fromResponse?.AdditionalResponse
    || fromResponse?.ErrorCondition
    || (typeof data?.raw === 'string' ? data.raw : '');
  return text
    ? `Adyen did not accept the payment request: ${text}`
    : 'Adyen did not accept the payment request, so nothing was sent to the terminal.';
}

// Returns '' for a successful payment, so the caller can assign unconditionally and
// have a later success clear a reason left over from an earlier attempt.
function describeFailure(paymentResponse) {
  const response = paymentResponse?.Response;
  if (!response || response.Result === 'Success') return '';

  const errorCondition = response.ErrorCondition || '';
  const additional = response.AdditionalResponse || '';
  let rawMessage = '';
  try { rawMessage = new URLSearchParams(additional).get('message') || ''; } catch { /* not form-encoded */ }
  if (!rawMessage) rawMessage = additional.match(/message=([^&]*)/)?.[1] || '';

  // A merchant cancel is reported in the message rather than the ErrorCondition,
  // so the text is checked before the enum is mapped.
  if (/cancel/i.test(rawMessage)) return 'Transaction cancelled by merchant';
  return FAILURE_MESSAGES[errorCondition] || rawMessage || errorCondition || 'Unknown error';
}

// --------------- API: Make Payment ---------------
app.post('/api/payment', async (req, res) => {
  const {
    amount, currency, items, useAsync, serviceId: clientServiceId,
    allowedPaymentBrand, forceEntryMode, cardAcquisitionReference, loyalty
  } = req.body;

  // Restricting the card entry mode is what turns a payment into Manual Key Entry
  // ('Keyed'), where the terminal itself prompts for the card number and expiry.
  // Adyen Support has to enable MKE on the terminal first, and only these values
  // are accepted by the Terminal API.
  const ENTRY_MODES = ['Keyed', 'Contactless', 'ICC', 'MagStripe', 'Manual', 'Tapped', 'RFID', 'Scanned', 'File', 'SynchronousICC'];
  if (forceEntryMode && !ENTRY_MODES.includes(forceEntryMode)) {
    return res.status(400).json({ error: `Unsupported entry mode: ${forceEntryMode}` });
  }

  // A redemption is re-checked here rather than trusted: the amount the terminal
  // is asked to authorise has to match the points the balance can actually cover.
  let redemption = null;
  if (loyalty && Number(loyalty.pointsUsed) > 0) {
    const member = members.find(m => m.id === loyalty.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const pointsUsed = Math.floor(Number(loyalty.pointsUsed));
    const originalAmount = Number(loyalty.originalAmount);
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return res.status(400).json({ error: 'The basket amount before the discount is required' });
    }
    if (pointsUsed > member.points) {
      return res.status(400).json({ error: `${member.displayName} only has ${member.points} points` });
    }
    if (pointsUsed > redeemableAmount(member.points, originalAmount)) {
      return res.status(400).json({ error: 'The discount would leave nothing for the card to pay' });
    }
    if (Math.abs((originalAmount - pointsUsed) - Number(amount)) > 0.005) {
      return res.status(400).json({ error: 'The discounted amount does not match the points redeemed' });
    }
    redemption = {
      memberId: member.id,
      displayName: member.displayName,
      pointsUsed,
      originalAmount: Math.round(originalAmount * 100) / 100,
      applied: false
    };
  }

  if (!getActivePoiId()) return res.status(400).json({ error: 'No terminal is selected' });

  const header = makeHeader('Payment');
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
    refundedAmount: 0,
    ...(redemption ? { loyalty: redemption } : {})
  };
  orders.unshift(order);
  orderChanged(order);

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
          ...(allowedPaymentBrand || forceEntryMode ? {
            TransactionConditions: {
              ...(allowedPaymentBrand ? { AllowedPaymentBrand: [allowedPaymentBrand] } : {}),
              ...(forceEntryMode ? { ForceEntryMode: [forceEntryMode] } : {})
            }
          } : {})
        },
        // Quoting the card acquisition means the terminal reuses the card the
        // shopper already presented, instead of asking for it a second time.
        ...(cardAcquisitionReference?.transactionId ? {
          PaymentData: {
            CardAcquisitionReference: {
              TransactionID: cardAcquisitionReference.transactionId,
              TimeStamp: cardAcquisitionReference.timeStamp
            }
          }
        } : {})
      }
    }
  };

  // Read back by awaitDispatch, which holds an abort until the payment it refers to
  // has actually been sent. Set as late as possible so it measures the dispatch, not
  // the validation above it.
  order.dispatchedAt = Date.now();

  try {
    const data = await adyenRequest(endpoint, payload, { label: 'Payment' });

    if (useAsync) {
      // The async endpoint answers with the text 'ok' once Adyen has taken the
      // request for delivery; the terminal's own answer arrives later by webhook.
      // That acknowledgement used to be ignored and 'submitted' returned regardless,
      // so a request Adyen refused outright -- which is what happens, in well under
      // a second, when the terminal is not connected -- left an order sitting
      // pending for a webhook that was never coming. The reachability preflight was
      // covering for this; checking the answer here is what it was standing in for.
      //
      // A refusal is a definite 'failed': nothing reached the terminal, so unlike a
      // timeout there is no unknown outcome to resolve later. If the acknowledgement
      // is ever something other than 'ok' on success, the webhook still settles the
      // order by ServiceID and corrects the status.
      if (data?.raw !== 'ok') {
        order.status = 'failed';
        order.failureReason = describeAsyncRefusal(data);
        order.error = order.failureReason;
        orderChanged(order);
        return res.status(502).json({ error: order.failureReason, orderId: transactionId });
      }
      return res.json({ orderId: transactionId, serviceId: header.ServiceID, status: 'submitted' });
    }

    // Sync: process response
    const result = data?.SaleToPOIResponse?.PaymentResponse?.Response?.Result;
    const errorCondition = data?.SaleToPOIResponse?.PaymentResponse?.Response?.ErrorCondition;
    // This is the authoritative outcome and it overwrites whatever the order said.
    // It used to be skipped for an order already marked 'cancelled', which meant a
    // cancel the terminal had ignored permanently hid a payment that went on to
    // succeed: money taken, order shown as cancelled. Nothing marks an order
    // cancelled ahead of this point any more -- /api/cancel only records that a
    // cancel was asked for -- so the guard has nothing left to protect.
    if (result === 'Success') order.status = 'paid';
    else if (errorCondition === 'Aborted' || errorCondition === 'Cancel') order.status = 'cancelled';
    else order.status = 'failed';
    order.response = data;
    settleLoyalty(order);

    const paymentResp = data?.SaleToPOIResponse?.PaymentResponse;
    order.failureReason = describeFailure(paymentResp);
    const poiData = paymentResp?.POIData;
    if (poiData?.POITransactionID) {
      order.poiTransactionId = poiData.POITransactionID.TransactionID;
      order.poiTimestamp = poiData.POITransactionID.TimeStamp;
    }
    order.pspReference = extractPspReference(paymentResp);
    order.tenderReference = extractTenderReference(paymentResp);
    order.paymentBrand = extractPaymentBrand(paymentResp);
    order.maskedPan = extractMaskedPan(paymentResp);

    orderChanged(order);
    try { res.json({ order, adyenResponse: data }); } catch (_) { /* client may have disconnected */ }
  } catch (err) {
    // No PaymentResponse arrived, so the terminal's state is unknown -- including
    // whether a cancel that was asked for actually took. 'error' says exactly that,
    // and leaves the order in the list for a status check to resolve.
    order.status = 'error';
    order.error = err.message;
    orderChanged(order);
    try { res.status(500).json({ error: err.message, orderId: transactionId }); } catch (_) { /* client disconnected */ }
  }
});

// --------------- API: Cancel (Abort) Payment ---------------
function abortPayment(serviceId, poiId) {
  const header = makeHeader('Abort');
  header.POIID = poiId;

  return adyenRequest('https://terminal-api-test.adyen.com/sync', {
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
  }, { label: 'Cancel' });
}

// Waits for the payment an abort refers to to actually reach the terminal.
//
// /api/payment records the order, and then its dispatch time, only after it has
// checked the terminal is reachable -- and that check is an await. A cancel pressed
// during it finds nothing under the ServiceID, and sending on that basis is what
// put the abort ahead of its own payment in the log.
//
// Polling is enough: the value being waited on is a field on an in-memory object
// updated in the same process, so this costs a timer and nothing else.
const DISPATCH_POLL_MS = 50;

async function awaitDispatch(serviceId) {
  const deadline = Date.now() + DEFAULT_DISPATCH_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(DISPATCH_POLL_MS);
    const order = orders.find(o => o.serviceId === serviceId);
    // Resolved while waiting -- most likely the reachability check refused the
    // payment. Handing it back lets planCancel refuse the abort on its status.
    if (order?.dispatchedAt || (order && order.status !== 'pending')) return order;
  }
  return orders.find(o => o.serviceId === serviceId) || null;
}

// This endpoint asks the terminal to stop; it does not decide the outcome. See
// cancelPolicy.js for why an accepted abort is not a cancelled payment. The order
// keeps its 'pending' status and only the PaymentResponse resolves it.
app.post('/api/cancel', async (req, res) => {
  const { serviceId } = req.body;
  if (!serviceId) return res.status(400).json({ error: 'A serviceId is required' });

  let order = orders.find(o => o.serviceId === serviceId);
  let plan = planCancel(order);
  if (!plan.ok) return res.status(409).json({ error: plan.reason, status: plan.status });

  // The payment has not been recorded as sent yet, so there is nothing at the
  // terminal for this abort to match.
  if (plan.waitForDispatch) {
    order = await awaitDispatch(serviceId);
    plan = planCancel(order);
    if (!plan.ok) return res.status(409).json({ error: plan.reason, status: plan.status });
  }

  // The payment's terminal, not whichever one is selected now. A cancel is often
  // pressed after the cashier has moved on to another device, and an abort sent to
  // that one would name a ServiceID it has never seen.
  const poiId = (order && order.terminalId) || getActivePoiId();

  try {
    const data = await abortPayment(serviceId, poiId);

    // The terminal can refuse the abort outright. Checked defensively because a
    // bare acknowledgement carrying no Response at all is also a normal answer.
    const abortResult = data?.SaleToPOIResponse?.AbortResponse?.Response?.Result;
    const accepted = abortResult !== 'Failure';

    if (order) {
      // Not a status. The cashier needs to see that a cancel is in flight, but the
      // sale is still live on the terminal until its PaymentResponse says otherwise.
      order.cancelRequested = true;
      // When, so the order list can offer a second attempt rather than latching its
      // cancel button off for good. In async mode that list is the only place a
      // cancel can be pressed, and a first abort that arrived before the payment --
      // which the terminal rejects with 'Message not Found' -- left nothing to press
      // again, so the sale ran on until the terminal timed out minutes later.
      order.cancelRequestedAt = Date.now();
      order.cancelResponse = data;
      orderChanged(order);
    }

    // One abort per press. This used to be followed by a background retry loop, on
    // the grounds that an abort landing before the terminal can act on one is
    // discarded silently. But Adyen's answer to an abort can take tens of seconds,
    // so a retry fired on a timer went out long after the window it was meant to
    // cover -- by then the sale had usually ended, and the terminal answered the
    // repeat with a Reject naming a ServiceID it no longer knew. The client re-arms
    // its cancel button instead, which puts the retry where the information is.
    res.json({ ok: true, accepted, adyenResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

// --------------- API: Referenced Refund ---------------
app.post('/api/refund', async (req, res) => {
  const { orderId, amount } = req.body;
  const order = orders.find(o => o.id === orderId);

  if (!order || !REFUNDABLE_STATUSES.has(order.status)) {
    return res.status(400).json({ error: 'Order not found or not eligible for refund' });
  }
  if (!order.poiTransactionId) {
    return res.status(400).json({ error: 'Missing POI transaction data for referenced refund' });
  }
  const remaining = order.amount - (order.refundedAmount || 0);
  if (amount > remaining) {
    return res.status(400).json({ error: `Amount exceeds remaining refundable: ${remaining.toFixed(2)}` });
  }
  // An absent amount means a full reversal, but a zero or negative one is a bad
  // request. Left through, it reads the same as absent further down and reverses
  // the whole payment — the opposite of what a zero refund asks for.
  if (amount != null && !(amount > 0)) {
    return res.status(400).json({ error: 'Refund amount must be greater than 0' });
  }

  const reversalRequest = buildReversalRequest(order, amount, uuidv4(), new Date().toISOString());

  const refundHeader = makeHeader('Reversal');

  const payload = {
    SaleToPOIRequest: {
      MessageHeader: refundHeader,
      ReversalRequest: reversalRequest
    }
  };

  try {
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { timeoutMs: ADYEN_UNATTENDED_TIMEOUT_MS, label: 'Refund' });
    const result = data?.SaleToPOIResponse?.ReversalResponse?.Response?.Result;
    if (result === 'Success') {
      order.refundedAmount = (order.refundedAmount || 0) + (amount || order.amount);
      order.status = order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    } else {
      order.status = 'refund_failed';
    }
    order.refundResponse = data;
    orderChanged(order);
    res.json({ order, adyenResponse: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Unreferenced Refund ---------------
app.post('/api/refund/unreferenced', async (req, res) => {
  const { orderId, amount } = req.body;
  const order = orders.find(o => o.id === orderId);

  if (!order || !REFUNDABLE_STATUSES.has(order.status)) {
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
    const data = await adyenRequest('https://terminal-api-test.adyen.com/sync', payload, { label: 'Refund' });
    const result = data?.SaleToPOIResponse?.PaymentResponse?.Response?.Result;
    if (result === 'Success') {
      order.refundedAmount = (order.refundedAmount || 0) + amount;
      order.status = order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    } else {
      order.status = 'refund_failed';
    }
    order.refundResponse = data;
    orderChanged(order);
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
    orderChanged(order);

    res.json({ request, serviceId, transactionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------- API: Tap to Pay — build encrypted nexo referenced refund ---------------
// The Payments app takes a referenced refund as a ReversalRequest over the same
// App Link a payment uses, with POIID set to the boarded installationId. There is
// no cloud path to the app, so /api/refund cannot serve these orders.
app.post('/api/taptopay/refund-request', (req, res) => {
  const { orderId, amount, installationId } = req.body;
  const order = orders.find(o => o.id === orderId);

  const blocked = ttpRefundBlock(order, installationId, amount);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error });

  const securityKey = getNexoSecurityKey();
  if (!securityKey.Passphrase || !securityKey.KeyIdentifier) {
    return res.status(500).json({ error: 'Nexo shared key is not configured on the server' });
  }

  const serviceId = uuidv4().replace(/-/g, '').slice(0, 10);
  const messageHeader = {
    ProtocolVersion: '3.0',
    MessageClass: 'Service',
    MessageCategory: 'Reversal',
    MessageType: 'Request',
    ServiceID: serviceId,
    SaleID: process.env.ADYEN_SALE_ID || 'POSWebApp',
    POIID: installationId
  };

  const reversalRequest = buildReversalRequest(order, amount, uuidv4(), new Date().toISOString());

  try {
    const terminalApiRequest = {
      SaleToPOIRequest: { MessageHeader: messageHeader, ReversalRequest: reversalRequest }
    };
    const secured = nexoCrypto.encrypt(messageHeader, JSON.stringify(terminalApiRequest), securityKey);
    const request = Buffer.from(JSON.stringify({ SaleToPOIRequest: secured }), 'utf-8').toString('base64url');

    // Handing over to the App Link navigates the page away, so what this refund
    // was for cannot be held in the browser. It is parked on the order and read
    // back when the Payments app returns.
    order.refundPending = { serviceId, amount, startedAt: new Date().toISOString() };
    orderChanged(order);

    res.json({ request, serviceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The short App Link response carries the ciphertext and its trailer in two
// separate Base64URL parameters rather than one envelope.
function ttpDecryptShort(response, securityTrailer, securityKey) {
  const nexoBlob = Buffer.from(String(response), 'base64url').toString('utf-8');
  const stObj = JSON.parse(Buffer.from(String(securityTrailer), 'base64url').toString('utf-8'));
  return nexoCrypto.decrypt({
    NexoBlob: nexoBlob,
    SecurityTrailer: { Nonce: stObj.nonce || stObj.Nonce, Hmac: stObj.hmac || stObj.Hmac }
  }, securityKey);
}

// The plaintext is a JSON object, but the docs show a form-encoded example, so
// both are accepted.
function ttpParseShort(plaintext) {
  try {
    const obj = JSON.parse(plaintext);
    return { result: obj.result, url: obj.url, errorCondition: obj.errorCondition };
  } catch {
    const sp = new URLSearchParams(plaintext);
    return { result: sp.get('result'), url: sp.get('url'), errorCondition: sp.get('errorCondition') };
  }
}

// --------------- API: Tap to Pay — decrypt the nexo reversal response ---------------
app.post('/api/taptopay/refund-result', (req, res) => {
  const { response, securityTrailer, error } = req.body;

  // The Payments app can refuse the request outright, returning an `error` in the
  // App Link and no ciphertext at all. Nothing was refunded, but the refund parked
  // on the order has to be released — left behind, it would capture the result of
  // the next Tap to Pay refund, which is matched by exactly that field. The status
  // is deliberately untouched, so the order stays refundable and the attempt can be
  // repeated once the cause is dealt with.
  if (!response) {
    if (!error) return res.status(400).json({ error: 'response is required' });
    const abandoned = orders.find(o => o.viaTapToPay && o.refundPending);
    if (abandoned) {
      abandoned.refundError = error;
      delete abandoned.refundPending;
      orderChanged(abandoned);
    }
    console.log('[TTP refund-result] refused by the Payments app:', error);
    return res.json({ result: 'Failure', errorCondition: error, order: abandoned || null });
  }

  const securityKey = getNexoSecurityKey();
  if (!securityKey.Passphrase || !securityKey.KeyIdentifier) {
    return res.status(500).json({ error: 'Nexo shared key is not configured on the server' });
  }

  const debug = { responseLength: String(response).length, mode: securityTrailer ? 'short' : 'full' };
  console.log('[TTP refund-result] incoming:', JSON.stringify(debug));

  try {
    let result, errorCondition, serviceId = null, full = null;

    if (securityTrailer) {
      const plaintext = ttpDecryptShort(response, securityTrailer, securityKey);
      debug.shortPlaintext = plaintext;
      console.log('[TTP refund-result] short plaintext:', plaintext);
      ({ result, errorCondition } = ttpParseShort(plaintext));
    } else {
      const normalized = String(response).replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
      const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf-8'));
      const secured = decoded.SaleToPOIResponse || decoded.SaleToPOIRequest;
      if (!secured || !secured.NexoBlob) {
        return res.status(400).json({ error: 'Unexpected response envelope', decoded, debug });
      }
      full = JSON.parse(nexoCrypto.decrypt(secured, securityKey));
      const reversalResponse = full?.SaleToPOIResponse?.ReversalResponse;
      serviceId = full?.SaleToPOIResponse?.MessageHeader?.ServiceID || null;
      result = reversalResponse?.Response?.Result;
      errorCondition = reversalResponse?.Response?.ErrorCondition;
    }

    // The short response carries no ServiceID, so the order is found by the
    // refund parked on it when the request was built.
    const order = (serviceId && orders.find(o => o.refundPending?.serviceId === serviceId))
      || orders.find(o => o.viaTapToPay && o.refundPending);

    if (!order) {
      return res.json({ result: result || null, errorCondition: errorCondition || null, response: full, debug, order: null });
    }

    const pending = order.refundPending;
    if (result === 'Success') {
      order.refundedAmount = (order.refundedAmount || 0) + pending.amount;
      order.status = order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    } else {
      order.status = 'refund_failed';
    }
    order.refundResponse = full || { short: debug.shortPlaintext };
    delete order.refundPending;
    orderChanged(order);

    res.json({ result: result || null, errorCondition: errorCondition || null, response: full, debug, order });
  } catch (err) {
    console.error('[TTP refund-result] error:', err.message);
    res.status(500).json({ error: `Decryption/parse failed: ${err.message}`, debug });
  }
});

// --------------- API: Tap to Pay — decrypt the nexo payment response ---------------
// The Payments app returns an encrypted, Base64URL-encoded SaleToPOIResponse to
// the returnUrl. Decrypt it, update the matching order, and return the result.
app.post('/api/taptopay/payment-result', async (req, res) => {
  const { response, securityTrailer } = req.body;
  if (!response) {
    return res.status(400).json({ error: 'response is required' });
  }
  const securityKey = getNexoSecurityKey();
  if (!securityKey.Passphrase || !securityKey.KeyIdentifier) {
    return res.status(500).json({ error: 'Nexo shared key is not configured on the server' });
  }

  // Full diagnostics, logged to the server console and echoed back to the UI.
  const debug = {
    responseRaw: response,
    responseLength: String(response).length,
    securityTrailerRaw: securityTrailer || null,
    mode: securityTrailer ? 'short' : 'full'
  };
  console.log('[TTP payment-result] incoming:', JSON.stringify(debug));

  try {
    if (securityTrailer) {
      // -------- SHORT response flow (docs.adyen.com Payments app) --------
      // `response`        = Base64URL( base64-ciphertext string )
      // `securityTrailer` = Base64URL( JSON { hmac, nonce, ... } )
      // decrypted plaintext = "result=Success&url=https://checkoutpos.../payments/{psp}"
      const nexoBlob = Buffer.from(String(response), 'base64url').toString('utf-8');
      const stObj = JSON.parse(Buffer.from(String(securityTrailer), 'base64url').toString('utf-8'));
      debug.nexoBlob = nexoBlob;
      debug.securityTrailerDecoded = stObj;

      const securedMessage = {
        NexoBlob: nexoBlob,
        SecurityTrailer: { Nonce: stObj.nonce || stObj.Nonce, Hmac: stObj.hmac || stObj.Hmac }
      };
      const plaintext = nexoCrypto.decrypt(securedMessage, securityKey);
      debug.shortPlaintext = plaintext;
      console.log('[TTP payment-result] short plaintext:', plaintext);

      // The plaintext is a JSON object {result, url, errorCondition, ...}. The
      // docs show a form-encoded example, so fall back to that if needed.
      let result, fullUrl, errorCondition;
      try {
        const obj = JSON.parse(plaintext);
        result = obj.result; fullUrl = obj.url; errorCondition = obj.errorCondition;
      } catch {
        const sp = new URLSearchParams(plaintext);
        result = sp.get('result'); fullUrl = sp.get('url'); errorCondition = sp.get('errorCondition');
      }

      // The PSP reference is the last path segment of the full-response URL.
      let pspReference = null;
      if (fullUrl) {
        const m = String(fullUrl).match(/\/payments\/([^/?#]+)/);
        if (m) pspReference = m[1];
      }

      // Optionally retrieve the full payment response from the returned URL.
      let fullResponse = null;
      if (fullUrl) {
        try {
          const apiRes = await fetch(fullUrl, { headers: { 'x-API-key': process.env.ADYEN_API_KEY || '' } });
          const text = await apiRes.text();
          try { fullResponse = JSON.parse(text); } catch { fullResponse = { raw: text }; }
          console.log('[TTP payment-result] full response:', JSON.stringify(fullResponse));
        } catch (e) {
          console.warn('[TTP payment-result] failed to fetch full response:', e.message);
          fullResponse = { error: e.message };
        }
      }

      // Update the matching order. ServiceID is not in the short response, so
      // fall back to the most recent pending Tap to Pay order.
      const paymentResponse = fullResponse?.SaleToPOIResponse?.PaymentResponse;
      let order = orders.find(o => o.viaTapToPay && o.status === 'pending')
        || orders.find(o => o.viaTapToPay);
      if (order) {
        if (result === 'Success' || result === 'Partial') order.status = 'paid';
        else if (errorCondition === 'Aborted' || errorCondition === 'Cancel') order.status = 'cancelled';
        else order.status = 'failed';
        order.response = fullResponse || { short: plaintext };
        order.pspReference = pspReference;
        if (paymentResponse) {
          const poiData = paymentResponse.POIData;
          if (poiData?.POITransactionID) {
            order.poiTransactionId = poiData.POITransactionID.TransactionID;
            order.poiTimestamp = poiData.POITransactionID.TimeStamp;
          }
          order.pspReference = extractPspReference(paymentResponse) || pspReference;
          order.tenderReference = extractTenderReference(paymentResponse);
          order.paymentBrand = extractPaymentBrand(paymentResponse);
          order.maskedPan = extractMaskedPan(paymentResponse);
        }
        orderChanged(order);
      }

      return res.json({
        result: result || null,
        errorCondition: errorCondition || null,
        url: fullUrl || null,
        response: fullResponse,
        shortPlaintext: plaintext,
        debug,
        order: order || null
      });
    }

    // -------- LEGACY full-response envelope flow (fallback) --------
    const normalized = String(response).replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(normalized, 'base64').toString('utf-8'));
    const secured = decoded.SaleToPOIResponse || decoded.SaleToPOIRequest;
    if (!secured || !secured.NexoBlob) {
      return res.status(400).json({ error: 'Unexpected response envelope', decoded, debug });
    }

    const plaintext = nexoCrypto.decrypt(secured, securityKey);
    const data = JSON.parse(plaintext);

    const saleResponse = data?.SaleToPOIResponse;
    const paymentResponse = saleResponse?.PaymentResponse;
    const serviceId = saleResponse?.MessageHeader?.ServiceID;
    let order = orders.find(o => o.serviceId === serviceId);

    if (order && paymentResponse) {
      const result = paymentResponse.Response?.Result;
      const errCond = paymentResponse.Response?.ErrorCondition;
      if (result === 'Success') order.status = 'paid';
      else if (errCond === 'Aborted' || errCond === 'Cancel') order.status = 'cancelled';
      else order.status = 'failed';
      order.response = data;
      const poiData = paymentResponse.POIData;
      if (poiData?.POITransactionID) {
        order.poiTransactionId = poiData.POITransactionID.TransactionID;
        order.poiTimestamp = poiData.POITransactionID.TimeStamp;
      }
      order.pspReference = extractPspReference(paymentResponse);
      order.tenderReference = extractTenderReference(paymentResponse);
      order.paymentBrand = extractPaymentBrand(paymentResponse);
      order.maskedPan = extractMaskedPan(paymentResponse);
      orderChanged(order);
    }

    res.json({
      result: paymentResponse?.Response?.Result || null,
      errorCondition: paymentResponse?.Response?.ErrorCondition || null,
      response: data,
      debug,
      order: order || null
    });
  } catch (err) {
    console.error('[TTP payment-result] error:', err.message, '| debug:', JSON.stringify(debug));
    res.status(500).json({ error: `Decryption/parse failed: ${err.message}`, debug });
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

// --------------- API: Tap to Pay — list app instances (verify board/revoke state) ---------------
// Used to confirm the real server-side state of an installationId, since the
// Payments app on the device keeps showing "boarded" from its local state.
app.get('/api/taptopay/instances', async (req, res) => {
  const merchantId = process.env.ADYEN_MERCHANT_ACCOUNT || '';
  if (!merchantId) {
    return res.status(500).json({ error: 'ADYEN_MERCHANT_ACCOUNT is not configured' });
  }
  const store = (req.query.storeId || '').toString().trim() || PAYMENTS_APP_DEFAULT_STORE;
  const url = `${PAYMENTS_APP_MGMT_BASE}/merchants/${encodeURIComponent(merchantId)}/stores/${encodeURIComponent(store)}/paymentsApps`;
  try {
    const apiRes = await fetch(url, {
      headers: { 'x-API-key': process.env.ADYEN_API_KEY || '' }
    });
    const text = await apiRes.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || 'Failed to list app instances', details: data });
    }
    res.json(data);
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
        settleLoyalty(order);
        order.failureReason = describeFailure(paymentResponse);
        order.response = body;

        const poiData = paymentResponse.POIData;
        if (poiData?.POITransactionID) {
          order.poiTransactionId = poiData.POITransactionID.TransactionID;
          order.poiTimestamp = poiData.POITransactionID.TimeStamp;
        }
        order.pspReference = extractPspReference(paymentResponse);
        order.tenderReference = extractTenderReference(paymentResponse);
        order.paymentBrand = extractPaymentBrand(paymentResponse);
        order.maskedPan = extractMaskedPan(paymentResponse);
        orderChanged(order);
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
          orderChanged(order);
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
// API paths must not fall through to it: answering a missing endpoint with
// index.html makes the caller fail on "Unexpected token '<'" instead of on a 404.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.path}` });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --------------- Start ---------------
// The Tap to Pay Payments app returns its encrypted (~8KB) SaleToPOIResponse by
// appending it as a query parameter to our return URL. Azure's reverse proxy
// also duplicates the full URL into headers like X-Original-URL, so the request
// line + headers can exceed Node's default 16KB maxHeaderSize and be rejected
// with HTTP 431 before Express ever sees it. Raise the limit to accommodate it.
const serverOptions = { maxHeaderSize: 64 * 1024 };

// Serving TLS here is for local development only: on Azure the platform
// terminates HTTPS at its front end and forwards plain HTTP, so the certificate
// files are absent there and this falls back to http. Generate them with
// `npm run certs`.
const HTTPS_KEY_FILE = process.env.HTTPS_KEY_FILE || path.join(__dirname, 'certs', 'localhost-key.pem');
const HTTPS_CERT_FILE = process.env.HTTPS_CERT_FILE || path.join(__dirname, 'certs', 'localhost-cert.pem');

let tlsOptions = null;
try {
  tlsOptions = {
    key: fs.readFileSync(HTTPS_KEY_FILE),
    cert: fs.readFileSync(HTTPS_CERT_FILE)
  };
} catch {
  // No certificate: stay on http.
}

const server = tlsOptions
  ? https.createServer({ ...serverOptions, ...tlsOptions }, app)
  : http.createServer(serverOptions, app);

// Orders are read back before the first request is served, so a client that
// connects immediately after a restart gets the real list rather than an empty one
// it would then have to be corrected out of.
orderStore.load().then(stored => {
  orders = stored;
  // Orders stored before the masked card number was recorded still carry the payment
  // response it comes from, so the field is filled in rather than left blank forever.
  for (const order of orders) {
    if (!order.maskedPan && order.response) {
      order.maskedPan = extractMaskedPan(order.response?.SaleToPOIResponse?.PaymentResponse);
    }
  }
  server.listen(PORT, () => {
    console.log(`POS Web App running at ${tlsOptions ? 'https' : 'http'}://localhost:${PORT}`);
  });
});
