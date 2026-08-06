#!/usr/bin/env node
// Measures how long the Terminal API takes to answer, from this machine, over a run
// of real transactions.
//
// The question it exists for: when a payment reaches the terminal tens of seconds
// after the app says it was sent, are those seconds spent here or at Adyen? The app
// cannot answer that on its own, because it only ever sees one call at a time and
// has nothing to compare it against. This sends a series and reports the spread.
//
// Each round is a payment followed by an abort, because that is the shape the delay
// was first seen in: an abort's answer took 19.9s while the server's own share of it
// was 0ms. Every call is broken into the part spent waiting for a connection and the
// part spent waiting for Adyen, so a stalled pool and a slow API cannot be confused
// for one another.
//
// This rings up real transactions on a real device. Every one of them is cancelled
// immediately, and the run stops rather than continuing into a terminal that is not
// behaving, but it is not a dry run.
//
// Usage:
//   node scripts/adyen-latency.js --poi=S1F2L-000158251517655
//   node scripts/adyen-latency.js --runs=5 --amount=0.01 --arm=2500
//
// The API key is read from ADYEN_API_KEY in .env, never passed on the command line,
// where it would end up in shell history.

require('dotenv').config();
const diagnosticsChannel = require('diagnostics_channel');
const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v = 'true'] = a.slice(2).split('=');
      return [k, v];
    })
);

const RUNS = Number(args.runs || 15);
const AMOUNT = Number(args.amount || 0.01);
// How long to leave the payment alone before cancelling it. An abort that arrives
// before its payment has reached the terminal is answered 'Message not Found' and
// the sale runs on -- which is the one outcome this script must not cause fifteen
// times in a row. 2500ms is what the app settled on for the same reason.
const ARM_MS = Number(args.arm || 2500);
// Between rounds, so a terminal still finishing one transaction is not immediately
// asked for another. Adyen serialises per device, and a queue would be measured as
// latency that is really just the previous round.
const COOLDOWN_MS = Number(args.cooldown || 2000);
const CURRENCY = args.currency || process.env.CURRENCY || 'EUR';
const SALE_ID = process.env.ADYEN_SALE_ID || 'POSWebApp';
const BASE = args.base || 'https://terminal-api-test.adyen.com';
// Long enough that a slow round is recorded rather than cut short, since recording
// it is the entire point.
const PAYMENT_TIMEOUT_MS = Number(args.timeout || 90000);
const ABORT_TIMEOUT_MS = Number(args.aborttimeout || 60000);

const POI = args.poi
  || (process.env.ADYEN_TERMINAL_POIID || '').split(',')[0].trim();
const KEY = process.env.ADYEN_API_KEY;

if (!KEY) {
  console.error('ADYEN_API_KEY is not set. Put it in .env (which is gitignored) and try again.');
  process.exit(1);
}
if (!POI) {
  console.error('No terminal. Pass --poi=<POI ID> or set ADYEN_TERMINAL_POIID in .env.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const serviceId = () => randomUUID().replace(/-/g, '').slice(0, 10);

// --------------- Timing ---------------
// Attribution is by the request object, not by the async context an event arrives
// in. Only request:create is published in the caller's context; everything later
// runs on the socket's, which belongs to whichever request opened the connection.
const ctxStore = new AsyncLocalStorage();
const traced = new WeakMap();
let connectionsOpened = 0;

diagnosticsChannel.subscribe('undici:request:create', ({ request }) => {
  const ctx = ctxStore.getStore();
  if (ctx) traced.set(request, ctx);
});
diagnosticsChannel.subscribe('undici:client:sendHeaders', ({ request }) => {
  const ctx = traced.get(request);
  if (ctx) ctx.sentAt = Date.now();
});
diagnosticsChannel.subscribe('undici:client:connected', () => {
  connectionsOpened++;
});

async function call(body, timeoutMs) {
  const ctx = { startedAt: Date.now(), connectionsAtStart: connectionsOpened };
  let res, err;
  try {
    res = await ctxStore.run(ctx, () => fetch(`${BASE}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-API-key': KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    }));
  } catch (e) {
    err = e;
  }

  let parsed = null;
  if (res) {
    const text = await res.text();
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  }

  const doneAt = Date.now();
  return {
    error: err ? (err.name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : err.message) : null,
    status: res ? res.status : null,
    body: parsed,
    // Everything before the request went out on a socket is this process; everything
    // after it is Adyen and the terminal. Falls back to the start when the request
    // never reached a socket, so a failure reports something rather than NaN.
    connMs: (ctx.sentAt || doneAt) - ctx.startedAt,
    wireMs: doneAt - (ctx.sentAt || ctx.startedAt),
    totalMs: doneAt - ctx.startedAt,
    // Approximate: connections are not published per request, so this says a
    // connection opened around the same time, not that this request caused it.
    newConnection: connectionsOpened > ctx.connectionsAtStart
  };
}

function header(category, poiId, id = serviceId()) {
  return {
    ProtocolVersion: '3.0',
    MessageClass: 'Service',
    MessageCategory: category,
    MessageType: 'Request',
    ServiceID: id,
    SaleID: SALE_ID,
    POIID: poiId
  };
}

function paymentBody(id) {
  return {
    SaleToPOIRequest: {
      MessageHeader: header('Payment', POI, id),
      PaymentRequest: {
        SaleData: {
          SaleTransactionID: { TransactionID: randomUUID(), TimeStamp: new Date().toISOString() }
        },
        PaymentTransaction: {
          AmountsReq: { Currency: CURRENCY, RequestedAmount: AMOUNT }
        }
      }
    }
  };
}

function abortBody(paymentServiceId) {
  return {
    SaleToPOIRequest: {
      MessageHeader: header('Abort', POI),
      AbortRequest: {
        AbortReason: 'MerchantAbort',
        MessageReference: {
          MessageCategory: 'Payment',
          ServiceID: paymentServiceId,
          SaleID: SALE_ID,
          POIID: POI
        }
      }
    }
  };
}

// --------------- Reporting ---------------
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function summarise(name, values) {
  if (!values.length) return `${name}: no samples`;
  const mean = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return `${name.padEnd(22)} min ${String(percentile(values, 0)).padStart(6)}  `
    + `median ${String(percentile(values, 50)).padStart(6)}  `
    + `p90 ${String(percentile(values, 90)).padStart(6)}  `
    + `max ${String(percentile(values, 100)).padStart(6)}  `
    + `mean ${String(mean).padStart(6)}`;
}

// What the terminal said about the payment. 'Success' means the abort lost the race
// and money was actually taken, which is a reason to stop rather than a data point.
function paymentOutcome(body) {
  const response = body?.SaleToPOIResponse?.PaymentResponse?.Response;
  if (!response) return body?.raw ? `raw: ${String(body.raw).slice(0, 40)}` : 'no PaymentResponse';
  if (response.Result === 'Success') return 'SUCCESS';
  return response.ErrorCondition || response.Result || 'unknown';
}

// Adyen puts the readable part in a form-encoded AdditionalResponse, so the reason
// a cancel was refused -- 'Message not Found', the one worth recognising here --
// arrives percent-encoded and long enough to break the table.
function readMessage(additionalResponse) {
  const raw = String(additionalResponse || '');
  let message = '';
  try { message = new URLSearchParams(raw).get('message') || ''; } catch { /* not form-encoded */ }
  return (message || raw).slice(0, 28);
}

function abortOutcome(body) {
  if (body?.raw) return String(body.raw).slice(0, 28);
  const response = body?.SaleToPOIResponse?.AbortResponse?.Response;
  if (!response) return 'no AbortResponse';
  if (response.Result === 'Failure') {
    const detail = readMessage(response.AdditionalResponse) || response.ErrorCondition || '';
    return `refused${detail ? ` (${detail})` : ''}`;
  }
  return response.Result || 'ok';
}

async function main() {
  console.log(`Terminal API latency — ${RUNS} rounds against ${POI}`);
  console.log(`${BASE}  ${CURRENCY} ${AMOUNT.toFixed(2)}  cancel after ${ARM_MS}ms  ${COOLDOWN_MS}ms between rounds`);
  console.log('Each round rings up a real transaction and cancels it.\n');
  console.log('  #   payment: conn    wire   total   outcome        abort: conn    wire   total   outcome');
  console.log('  ' + '-'.repeat(96));

  const stats = { paymentConn: [], abortConn: [], abortWire: [], paymentTotal: [] };
  let consecutiveRefusals = 0;
  let stopped = null;

  for (let i = 1; i <= RUNS; i++) {
    const id = serviceId();

    // Not awaited: the sync endpoint holds this open until the terminal is done, and
    // the abort that ends it has to go out while it is still in flight.
    const payment = call(paymentBody(id), PAYMENT_TIMEOUT_MS)
      .then(r => r, e => ({ error: e.message, connMs: 0, wireMs: 0, totalMs: 0 }));

    await sleep(ARM_MS);
    const abort = await call(abortBody(id), ABORT_TIMEOUT_MS);
    const pay = await payment;

    const payResult = pay.error || paymentOutcome(pay.body);
    const abortResult = abort.error || abortOutcome(abort.body);

    const row = (label, r) => `${String(r.connMs).padStart(6)}${r.newConnection ? '*' : ' '}`
      + `${String(r.wireMs).padStart(7)} ${String(r.totalMs).padStart(7)}`;

    console.log(
      `  ${String(i).padStart(2)}         ${row('payment', pay)}   ${payResult.padEnd(14).slice(0, 14)}`
      + `        ${row('abort', abort)}   ${abortResult}`
    );

    if (!pay.error) {
      stats.paymentConn.push(pay.connMs);
      stats.paymentTotal.push(pay.totalMs);
    }
    if (!abort.error) {
      stats.abortConn.push(abort.connMs);
      stats.abortWire.push(abort.wireMs);
    }

    // A payment that went through means the abort lost the race and the shopper was
    // charged. Continuing would charge fourteen more.
    if (payResult === 'SUCCESS') {
      stopped = `round ${i} was charged rather than cancelled — the abort arrived too late. `
        + `Raise --arm above ${ARM_MS} before trying again.`;
      break;
    }

    consecutiveRefusals = abortResult.startsWith('refused') ? consecutiveRefusals + 1 : 0;
    if (consecutiveRefusals >= 2) {
      stopped = `two cancels in a row were refused — the terminal may have a transaction still open. `
        + `Check it before running this again.`;
      break;
    }

    if (i < RUNS) await sleep(COOLDOWN_MS);
  }

  console.log('\n  ' + '-'.repeat(96));
  console.log('  ' + summarise('payment conn wait', stats.paymentConn));
  console.log('  ' + summarise('abort conn wait', stats.abortConn));
  console.log('  ' + summarise('abort round trip', stats.abortWire));
  console.log('  ' + summarise('payment total', stats.paymentTotal));
  console.log(`\n  ${connectionsOpened} connection(s) opened for ${stats.paymentConn.length + stats.abortConn.length} request(s). `
    + `A * marks a request that coincided with a new one.`);

  console.log('\n  conn  = waiting for a connection in this process, before any bytes went out.');
  console.log('  wire  = from the request leaving to the answer arriving. Adyen and the terminal.');
  console.log('\n  A large conn points at the HTTP client. A large abort round trip points at Adyen:');
  console.log('  an abort is answered from Adyen\'s side and never waits for a cardholder.');

  if (stopped) {
    console.log(`\n  STOPPED after ${stats.paymentTotal.length} round(s): ${stopped}`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('\nRun failed:', err.message);
  process.exitCode = 1;
});
