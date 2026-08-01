'use strict';

// Order persistence. Orders are the one thing this app holds that is worth keeping:
// they carry the PSP and tender references a payment is reconciled by, and the
// refunded amount a partial refund is measured against. Everything else it stores
// (logo, QR content, members) can be re-entered by hand.
//
// The design is a write-behind cache, not a database layer: server.js keeps the
// orders in memory and reads them synchronously, and every change is mirrored here
// afterwards. That keeps the many `orders.find(...)` call sites untouched, and means
// a slow or broken storage account cannot stall a payment.
//
// Backend is chosen by configuration:
//   AZURE_STORAGE_CONNECTION_STRING set -> Azure Table Storage
//   otherwise                           -> a JSON file, for local development
// The file backend is not a substitute on Azure: a deploy replaces the application
// directory, which is exactly the data loss this module exists to prevent.

const fs = require('fs');
const path = require('path');

// Loaded lazily so a deployment that somehow lacks the package still boots and
// falls back to the file backend, rather than crashing on startup.
let TableClient = null;
try {
  ({ TableClient } = require('@azure/data-tables'));
} catch {
  // Not installed; the file backend is used instead.
}

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const TABLE_NAME = process.env.AZURE_ORDERS_TABLE || 'orders';
const PARTITION = 'order';

// How many orders are read back into memory at boot. Storage keeps everything; this
// only bounds what the order list shows and what the app holds in RAM.
const HISTORY_LIMIT = Number(process.env.ORDER_HISTORY_LIMIT) || 200;

const FILE_PATH = process.env.ORDER_STORE_FILE
  || path.join(__dirname, 'assets', 'orders.json');

// Table Storage caps a string property at 64 KiB, which is 32 768 UTF-16 code
// units. Stay clear of the edge: the JSON is measured in characters, and a receipt
// full of non-ASCII would encode wider than it measures.
const MAX_JSON_CHARS = 30000;

// Dropped in this order when an order does not fit, cheapest loss first. The two
// refund/cancel responses are only ever echoed to the API log. `response` is worth
// more: a reprint prefers the receipt data stored on the order, and without it has
// to ask the terminal, which fails once the terminal has dropped the transaction.
const HEAVY_FIELDS = ['refundResponse', 'cancelResponse', 'response'];

// Kept when even dropping every response leaves the order too large. Enough to
// show the order, refund it and reprint its line items.
const CORE_FIELDS = [
  'id', 'serviceId', 'status', 'createdAt', 'amount', 'currency', 'items',
  'terminalId', 'poiTransactionId', 'poiTimestamp', 'pspReference',
  'tenderReference', 'paymentBrand', 'maskedPan', 'refundedAmount', 'failureReason',
  // A pending order that survives a restart has to remember that a cancel was
  // already sent, or the list offers to send a second one.
  'error', 'viaTapToPay', 'loyalty', 'cancelRequested'
];

// Newest first is the order the app shows, and Table Storage can only scan a
// partition in ascending RowKey order, so the key counts down instead of up.
// `createdAt` never changes after an order is created, which is what makes the key
// stable enough to upsert against.
const MAX_TIMESTAMP = 9999999999999;

function rowKeyFor(order) {
  const created = Date.parse(order.createdAt) || 0;
  const countdown = String(Math.max(0, MAX_TIMESTAMP - created)).padStart(13, '0');
  return `${countdown}-${order.id}`;
}

// Returns the JSON to store, shedding the least useful fields until it fits.
function serialiseOrder(order) {
  let candidate = order;
  let json = JSON.stringify(candidate);
  const dropped = [];

  for (const field of HEAVY_FIELDS) {
    if (json.length <= MAX_JSON_CHARS) break;
    if (candidate[field] === undefined || candidate[field] === null) continue;
    candidate = { ...candidate, [field]: null };
    dropped.push(field);
    json = JSON.stringify(candidate);
  }

  if (json.length > MAX_JSON_CHARS) {
    const core = {};
    for (const field of CORE_FIELDS) {
      if (order[field] !== undefined) core[field] = order[field];
    }
    candidate = core;
    dropped.push('all but the core fields');
    json = JSON.stringify(candidate);
  }

  return { json, dropped };
}

// Writes are serialised through a single chain. Two updates to one order arrive in
// the order they happened, and a burst cannot open a connection per change.
let _tail = Promise.resolve();
function enqueue(work) {
  _tail = _tail.then(work).catch(err => {
    // Deliberately swallowed: the order is already in memory and already on the
    // client's screen. Losing the copy in storage must not fail the request.
    console.warn('[OrderStore] write failed:', err.message);
  });
  return _tail;
}

// --------------- Table backend ---------------
let _table = null;
let _tableReady = null;

function tableClient() {
  if (!_table) _table = TableClient.fromConnectionString(CONNECTION_STRING, TABLE_NAME);
  return _table;
}

function ensureTable() {
  if (!_tableReady) {
    _tableReady = tableClient().createTable().catch(err => {
      // Already there is the normal case after the first run.
      if (err.statusCode !== 409) throw err;
    });
  }
  return _tableReady;
}

async function tableSave(order) {
  await ensureTable();
  const { json, dropped } = serialiseOrder(order);
  if (dropped.length) {
    console.warn(`[OrderStore] order ${order.id} too large to store whole; dropped ${dropped.join(', ')}`);
  }
  // A few fields are stored flat as well as inside the JSON, so an order can be
  // found in the portal or in a query without parsing every row.
  await tableClient().upsertEntity({
    partitionKey: PARTITION,
    rowKey: rowKeyFor(order),
    serviceId: order.serviceId || '',
    status: order.status || '',
    createdAt: order.createdAt || '',
    amount: Number(order.amount) || 0,
    currency: order.currency || '',
    data: json
  }, 'Replace');
}

async function tableLoad() {
  await ensureTable();
  const loaded = [];
  const entities = tableClient().listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'` }
  });
  for await (const entity of entities) {
    try {
      loaded.push(JSON.parse(entity.data));
    } catch (err) {
      console.warn(`[OrderStore] skipping unreadable row ${entity.rowKey}: ${err.message}`);
    }
    if (loaded.length >= HISTORY_LIMIT) break;
  }
  return loaded;
}

async function tableClear() {
  await ensureTable();
  const entities = tableClient().listEntities({
    queryOptions: { filter: `PartitionKey eq '${PARTITION}'`, select: ['PartitionKey', 'RowKey'] }
  });
  for await (const entity of entities) {
    await tableClient().deleteEntity(entity.partitionKey, entity.rowKey);
  }
}

// --------------- File backend ---------------
// Holds the whole list, because a file has to be rewritten as a whole. Writes are
// debounced so a payment that updates an order three times writes once.
const FILE_DEBOUNCE_MS = 300;
let _fileOrders = null;
let _fileTimer = null;

function fileList() {
  if (!_fileOrders) _fileOrders = new Map();
  return _fileOrders;
}

function fileFlush() {
  const list = [...fileList().values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, HISTORY_LIMIT);
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(list, null, 2));
}

function fileSave(order) {
  fileList().set(order.id, order);
  if (_fileTimer) return;
  _fileTimer = setTimeout(() => {
    _fileTimer = null;
    try {
      fileFlush();
    } catch (err) {
      console.warn('[OrderStore] write failed:', err.message);
    }
  }, FILE_DEBOUNCE_MS);
  // A pending write must not hold the process open on shutdown.
  if (_fileTimer.unref) _fileTimer.unref();
}

function fileLoad() {
  let parsed = [];
  try {
    parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch {
    // Nothing stored yet.
  }
  if (!Array.isArray(parsed)) parsed = [];
  const list = fileList();
  list.clear();
  for (const order of parsed) {
    if (order && order.id) list.set(order.id, order);
  }
  return parsed.slice(0, HISTORY_LIMIT);
}

function fileClear() {
  fileList().clear();
  fileFlush();
}

// --------------- Public interface ---------------
const usingTable = !!(CONNECTION_STRING && TableClient);

function describe() {
  if (usingTable) return `Azure Table Storage (table "${TABLE_NAME}")`;
  if (CONNECTION_STRING && !TableClient) {
    return `local file ${FILE_PATH} (@azure/data-tables is not installed)`;
  }
  return `local file ${FILE_PATH} (no AZURE_STORAGE_CONNECTION_STRING; orders will not survive a redeploy)`;
}

// Read back at boot only. A failure here is not fatal: the app starts with an empty
// order list, which is what it did before orders were persisted at all.
async function load() {
  try {
    const loaded = usingTable ? await tableLoad() : fileLoad();
    console.log(`[OrderStore] loaded ${loaded.length} order(s) from ${describe()}`);
    return loaded;
  } catch (err) {
    console.warn(`[OrderStore] could not load orders: ${err.message}`);
    return [];
  }
}

// Fire and forget. Callers have already told the client about the change.
function save(order) {
  if (!order || !order.id) return;
  // Snapshotted because the caller keeps mutating the live object, and the write
  // happens later in the queue.
  const snapshot = { ...order };
  if (usingTable) enqueue(() => tableSave(snapshot));
  else enqueue(async () => fileSave(snapshot));
}

function clear() {
  return enqueue(() => (usingTable ? tableClear() : fileClear()));
}

module.exports = { describe, load, save, clear, serialiseOrder, rowKeyFor };
