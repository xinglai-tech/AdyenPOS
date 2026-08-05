// How many entries the API log keeps before the oldest are dropped.
const LOG_MAX_ENTRIES = 60;
// Above this many OutputText lines, the log summarises them instead of listing them.
const LOG_MAX_OUTPUT_LINES = 6;

// ====================== State ======================
const state = {
  cart: [],        // { product, qty }
  orders: [],
  config: {},
  isAsync: localStorage.getItem('posAsyncMode') === 'true',
  terminalOnline: false,
  pendingServiceId: null  // track current sync payment for cancel
};

// ====================== Products ======================
const PRODUCT_SVGS = {
  harddrive: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="14" y="28" width="72" height="44" rx="6" fill="#334155" stroke="#1e293b" stroke-width="2.5"/>
    <rect x="18" y="32" width="64" height="30" rx="3" fill="#475569"/>
    <line x1="18" y1="62" x2="82" y2="62" stroke="#1e293b" stroke-width="2"/>
    <circle cx="74" cy="67" r="3" fill="#22c55e"/>
    <circle cx="64" cy="67" r="3" fill="#64748b" stroke="#475569" stroke-width="1"/>
    <rect x="22" y="66" width="20" height="3" rx="1" fill="#64748b"/>
    <rect x="24" y="38" width="52" height="18" rx="2" fill="#1e293b" opacity=".3"/>
    <path d="M30 47H70" stroke="#94a3b8" stroke-width="1" opacity=".4"/>
    <path d="M30 43H70" stroke="#94a3b8" stroke-width="1" opacity=".4"/>
    <path d="M30 51H70" stroke="#94a3b8" stroke-width="1" opacity=".4"/>
  </svg>`,
  keyboard: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="32" width="84" height="40" rx="5" fill="#334155" stroke="#1e293b" stroke-width="2.5"/>
    <rect x="14" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="27" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="40" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="53" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="66" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="79" y="38" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="14" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="27" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="40" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="53" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="66" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="79" y="49" width="10" height="8" rx="1.5" fill="#475569"/>
    <rect x="27" y="60" width="46" height="8" rx="1.5" fill="#475569"/>
  </svg>`,
  mouse: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 16C50 16 46 8 50 4S54 8 54 16" stroke="#475569" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <rect x="28" y="16" width="44" height="68" rx="22" fill="#334155" stroke="#1e293b" stroke-width="2.5"/>
    <line x1="50" y1="16" x2="50" y2="44" stroke="#1e293b" stroke-width="2"/>
    <rect x="46" y="24" width="8" height="14" rx="4" fill="#475569" stroke="#64748b" stroke-width="1.5"/>
    <ellipse cx="50" cy="60" rx="10" ry="6" fill="#475569" opacity=".3"/>
  </svg>`,
  burger: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 45C18 32 30 22 50 22S82 32 82 45H18Z" fill="#ea580c" stroke="#c2410c" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="35" cy="34" rx="2" ry="1.5" fill="#fbbf24" opacity=".6"/>
    <ellipse cx="55" cy="30" rx="2" ry="1.5" fill="#fbbf24" opacity=".6"/>
    <ellipse cx="65" cy="38" rx="2" ry="1.5" fill="#fbbf24" opacity=".6"/>
    <rect x="16" y="45" width="68" height="8" rx="2" fill="#22c55e" stroke="#16a34a" stroke-width="1.5"/>
    <path d="M16 53H84" stroke="#dc2626" stroke-width="3"/>
    <rect x="16" y="56" width="68" height="8" rx="1" fill="#fbbf24" stroke="#d97706" stroke-width="1.5"/>
    <rect x="16" y="64" width="68" height="8" rx="1" fill="#a16207" stroke="#854d0e" stroke-width="1.5"/>
    <path d="M18 72H82C82 72 82 82 50 82S18 72 18 72Z" fill="#ea580c" stroke="#c2410c" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>`,
  icecream: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M36 52L50 92L64 52" fill="#d97706" stroke="#b45309" stroke-width="2" stroke-linejoin="round"/>
    <path d="M40 62L60 62" stroke="#b45309" stroke-width="1" opacity=".4"/>
    <path d="M42 70L58 70" stroke="#b45309" stroke-width="1" opacity=".4"/>
    <circle cx="50" cy="40" r="18" fill="#f472b6" stroke="#ec4899" stroke-width="2.5"/>
    <circle cx="36" cy="32" r="12" fill="#fbbf24" stroke="#f59e0b" stroke-width="2.5"/>
    <circle cx="64" cy="32" r="12" fill="#a78bfa" stroke="#8b5cf6" stroke-width="2.5"/>
    <circle cx="40" cy="28" r="2" fill="#92400e" opacity=".5"/>
    <circle cx="54" cy="36" r="2" fill="#92400e" opacity=".5"/>
    <circle cx="60" cy="28" r="2" fill="#92400e" opacity=".5"/>
  </svg>`,
  noodles: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="70" rx="34" ry="14" fill="#fde68a" stroke="#d97706" stroke-width="2.5"/>
    <path d="M16 62C16 62 16 70 50 70S84 62 84 62V70C84 78 68 84 50 84S16 78 16 70V62Z" fill="#fbbf24" stroke="#d97706" stroke-width="2"/>
    <path d="M24 58Q30 30 40 24" stroke="#ea580c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M36 60Q40 32 50 22" stroke="#ea580c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M48 60Q50 34 58 24" stroke="#ea580c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M60 58Q58 32 66 22" stroke="#ea580c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <path d="M72 56Q68 34 74 26" stroke="#ea580c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    <circle cx="30" cy="64" r="2" fill="#16a34a"/>
    <circle cx="55" cy="66" r="2" fill="#16a34a"/>
    <circle cx="70" cy="63" r="1.5" fill="#16a34a"/>
  </svg>`,
  headphones: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 55C20 35 33 20 50 20S80 35 80 55" stroke="#334155" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="12" y="52" width="16" height="28" rx="8" fill="#1e293b" stroke="#0f172a" stroke-width="2.5"/>
    <rect x="72" y="52" width="16" height="28" rx="8" fill="#1e293b" stroke="#0f172a" stroke-width="2.5"/>
    <rect x="15" y="56" width="10" height="12" rx="3" fill="#334155"/>
    <rect x="75" y="56" width="10" height="12" rx="3" fill="#334155"/>
    <path d="M20 55V58" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
    <path d="M80 55V58" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  phone: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="28" y="10" width="44" height="80" rx="8" fill="#1e293b" stroke="#0f172a" stroke-width="2.5"/>
    <rect x="32" y="20" width="36" height="56" rx="2" fill="#38bdf8"/>
    <rect x="32" y="20" width="36" height="56" rx="2" fill="url(#phoneGrad)" opacity=".3"/>
    <circle cx="50" cy="83" r="3" fill="#334155"/>
    <rect x="42" y="13" width="16" height="3" rx="1.5" fill="#334155"/>
    <defs><linearGradient id="phoneGrad" x1="32" y1="20" x2="68" y2="76"><stop stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  </svg>`,
  laptop: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="18" width="64" height="44" rx="4" fill="#1e293b" stroke="#0f172a" stroke-width="2.5"/>
    <rect x="22" y="22" width="56" height="36" rx="2" fill="#38bdf8"/>
    <path d="M10 66H90L85 78H15L10 66Z" fill="#334155" stroke="#1e293b" stroke-width="2" stroke-linejoin="round"/>
    <rect x="40" y="69" width="20" height="4" rx="1" fill="#475569"/>
    <circle cx="50" cy="40" r="6" fill="#0ea5e9" opacity=".5"/>
    <path d="M44 44L50 38L56 44" stroke="#fff" stroke-width="1.5" fill="none" opacity=".6"/>
  </svg>`
};

const PRODUCTS = [
  { id: 'icecream', name: 'Ice Cream', price: 5, color: '#fce7f3' },
  { id: 'noodles',  name: 'Noodles',   price: 15, color: '#fef3c7' },
  { id: 'burger',   name: 'Burger',    price: 20, color: '#fef3c7' },
  { id: 'mouse', name: 'Mouse', price: 30, color: '#f1f5f9' },
  { id: 'keyboard', name: 'Keyboard', price: 50, color: '#dbeafe' },
  { id: 'harddrive', name: 'Hard Drive', price: 100, color: '#e2e8f0' },
  { id: 'headphones', name: 'Headphones', price: 1000, color: '#e2e8f0' },
  { id: 'phone',  name: 'Phone',   price: 2000, color: '#e0f2fe' },
  { id: 'laptop', name: 'Laptop',  price: 3000, color: '#f1f5f9' }
];

// ====================== DOM refs ======================
const $productGrid     = document.getElementById('product-grid');
const $cartItems       = document.getElementById('cart-items');
const $cartTotal       = document.getElementById('cart-total-amount');
const $btnPay          = document.getElementById('btn-pay');
const $btnClearCart     = document.getElementById('btn-clear-cart');
const $btnCheckTerm    = document.getElementById('btn-check-terminal');
const $terminalList    = document.getElementById('terminal-list');
const $btnAddTerm      = document.getElementById('btn-add-terminal');
const $toggleAsync     = document.getElementById('toggle-async');
const $orderList       = document.getElementById('order-list');
const $orderCount      = document.getElementById('order-count');
const $btnClearOrders  = document.getElementById('btn-clear-orders');
const $orderSearch     = document.getElementById('order-search-input');
const $apiResponse     = document.getElementById('api-response');
const $btnClearResp    = document.getElementById('btn-clear-response');
const $btnToggleLog    = document.getElementById('btn-toggle-log');
const $rightCol        = document.getElementById('right-col');
const $btnLogout       = document.getElementById('btn-logout');
const $logoPreviewImg  = document.getElementById('logo-preview-img');
const $logoMeta        = document.getElementById('logo-meta');
const $inputLogoFile   = document.getElementById('input-logo-file');
const $btnLogoUpload   = document.getElementById('btn-logo-upload');
const $btnLogoReset    = document.getElementById('btn-logo-reset');
const $receiptModal    = document.getElementById('receipt-modal');
const $btnReceiptOpen  = document.getElementById('btn-receipt-open');
const $btnReceiptClose = document.getElementById('btn-receipt-close');
const $inputQrUrl      = document.getElementById('input-qr-url');
const $qrMeta          = document.getElementById('qr-meta');
const $btnQrSave       = document.getElementById('btn-qr-save');
const $btnQrReset      = document.getElementById('btn-qr-reset');

// Loyalty
const $loyaltyModal    = document.getElementById('loyalty-modal');
const $btnLoyaltyOpen  = document.getElementById('btn-loyalty-open');
const $btnLoyaltyClose = document.getElementById('btn-loyalty-close');
const $btnLoyaltyRead  = document.getElementById('btn-loyalty-read');
const $btnLoyaltyPay   = document.getElementById('btn-loyalty-pay');
const $btnLoyaltyCancel = document.getElementById('btn-loyalty-cancel');
const $btnLoyaltyCopy  = document.getElementById('btn-loyalty-copy');
const $loyaltyBasket   = document.getElementById('loyalty-basket');
const $loyaltySteps    = document.getElementById('loyalty-steps');
const $loyaltyAliasRow = document.getElementById('loyalty-alias-row');
const $loyaltyAlias    = document.getElementById('loyalty-alias');
const $userdataModal   = document.getElementById('userdata-modal');
const $btnUserdataOpen = document.getElementById('btn-userdata-open');
const $btnUserdataClose = document.getElementById('btn-userdata-close');
const $btnUserdataAdd  = document.getElementById('btn-userdata-add');
const $btnUserdataSave = document.getElementById('btn-userdata-save');
const $userdataList    = document.getElementById('userdata-list');

// Terminal display
const $terminalDisplay = document.getElementById('terminal-display-content');
const $btnClearDisplay = document.getElementById('btn-clear-display');

// Overlay
const $overlay         = document.getElementById('payment-overlay');
const $overlaySpinner  = document.getElementById('overlay-spinner');
const $overlayTitle    = document.getElementById('overlay-title');
const $overlayMsg      = document.getElementById('overlay-message');
const $overlayAmount   = document.getElementById('overlay-amount');
const $overlayResult   = document.getElementById('overlay-result');
const $btnCheckStatus  = document.getElementById('btn-check-status');
const $btnCancelPay    = document.getElementById('btn-cancel-payment');
const $btnCloseOverlay = document.getElementById('btn-close-overlay');
const $btnDetachOverlay = document.getElementById('btn-detach-overlay');

// Refund modal
const $refundModal     = document.getElementById('refund-modal');
const $btnRefundOk     = document.getElementById('btn-refund-confirm');
const $btnRefundCancel = document.getElementById('btn-refund-cancel');


// ====================== Init ======================
let _sseReady = false;
let _terminalReady = false;

function tryRecoverPending() {
  if (_sseReady && _terminalReady) recoverPendingOrders();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  renderTerminals();
  renderProducts();
  renderCart();
  $toggleAsync.checked = state.isAsync;
  document.getElementById('terminal-display').style.display = state.isAsync ? '' : 'none';
  setupSSE();
  bindEvents();
  refreshIcons();
  initTapToPay();
  await handleTtpReturn();
  if (state.config.poiId) checkTerminal();
});

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
  } catch { /* ignore */ }
}

// ====================== SSE ======================
function setupSSE() {
  const es = new EventSource('/api/events');
  let _sawInit = false;

  es.addEventListener('init', async (e) => {
    // The server is the single source of truth for orders, so mirror its list even
    // when that means clearing the page after a restart.
    state.orders = JSON.parse(e.data);
    renderOrders();
    _sseReady = true;
    tryRecoverPending();

    if (!_sawInit) {
      _sawInit = true;
      return;
    }

    // A second `init` means EventSource reconnected. Re-sync the config so the
    // page stops offering a terminal the server no longer considers active, but
    // stay quiet unless something actually changed.
    const previousTerminals = (state.config.terminals || []).map(t => t.poiId).join(',');
    await loadConfig();
    const currentTerminals = (state.config.terminals || []).map(t => t.poiId).join(',');
    renderTerminals();

    if (previousTerminals !== currentTerminals) {
      showToast('Reconnected — terminal list changed on the server', 'warning');
    }
    if (state.config.poiId) checkTerminal({ silent: true });
  });

  // Every Terminal API request the server sends is mirrored here, so the log shows
  // what went out and not only what came back. It arrives while the call is still
  // in flight, so it lands just below its own response once that is logged.
  es.addEventListener('apiRequest', (e) => {
    const { label, endpoint, payload } = JSON.parse(e.data);
    // The server names each call, and the response below is logged under the same
    // name, so a request and its answer read as a pair. The endpoint used to be
    // appended -- "Payment · sync" against a response titled "Payment (Sync)" --
    // but that suffix is a URL path segment, it is 'sync' for every call except an
    // async payment, and it made the two halves look unrelated.
    const route = String(endpoint || '').split('/').pop();
    showApiResponse(label || route || 'Terminal API', payload, 'request');
  });

  es.addEventListener('ordersCleared', () => {
    state.orders = [];
    renderOrders();
  });

  es.addEventListener('orderUpdate', (e) => {
    const order = JSON.parse(e.data);
    const idx = state.orders.findIndex(o => o.id === order.id);
    const isNew = idx < 0;
    const hadResponse = !isNew && state.orders[idx].response;
    if (idx >= 0) {
      state.orders[idx] = order;
    } else {
      state.orders.unshift(order);
    }
    renderOrders();
    // Log payment response via SSE only for async/cancel (sync already logs it)
    if (order.response && !hadResponse && !state._syncLogged?.[order.serviceId]) {
      showApiResponse('Payment', order.response);
    }
    // If overlay is waiting for this order's final response, close it.
    //
    // Skipped while a request that will report the outcome itself is still in
    // flight for this order. The server broadcasts the update before it replies, so
    // this always arrived first and wrote its own wording, which the reply then
    // overwrote a moment later -- the cashier saw "Payment cancelled" replaced by
    // "Aborted". This branch is for async mode and recovered orders, where nothing
    // else is going to report anything.
    if (state.pendingServiceId && order.serviceId === state.pendingServiceId
        && order.status !== 'pending' && state._overlayOwner !== order.serviceId) {
      // showOverlayResult schedules its own close, so no timer is needed here.
      showOverlayResult(order.status === 'paid', paymentOutcomeMessage(order));
      state.pendingServiceId = null;
    }
  });

  // Protocol chatter the terminal sends unprompted: Initialised, CardInserted,
  // PrintFinished and so on. It belongs in the log, not in the banner, which is for
  // the few things the cashier has to act on.
  es.addEventListener('eventNotification', (e) => {
    const data = JSON.parse(e.data);
    showApiResponse(`EventNotification · ${data.EventToNotify || 'notification'}`, data);
  });

  es.addEventListener('displayNotification', (e) => {
    const data = JSON.parse(e.data);
    updateTerminalDisplay(data);
  });

  es.addEventListener('terminalUpdate', (e) => {
    state.config.terminals = JSON.parse(e.data);
    renderTerminals();
  });

  // User activity presence
  const $actBanner = document.getElementById('activity-banner');
  const $actText = document.getElementById('activity-banner-text');
  let _actHideTimer = null;
  es.addEventListener('userActivity', (e) => {
    const data = JSON.parse(e.data);
    const mySession = state.config.sessionId || '';
    if (!mySession || data.sessionId === mySession) return;
    $actText.textContent = 'Another user has used this POS app in last 30 seconds, please kindly wait and don\'t click anywhere until this banner disappear';
    $actBanner.classList.remove('hidden');
    clearTimeout(_actHideTimer);
    _actHideTimer = setTimeout(() => $actBanner.classList.add('hidden'), 30000);
  });

  es.onerror = () => {
    console.warn('SSE connection lost, reconnecting...');
  };
}

// Debounced activity ping
let _actPingTimer = null;
document.addEventListener('click', () => {
  if (_actPingTimer) return;
  _actPingTimer = setTimeout(() => { _actPingTimer = null; }, 10000);
  fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
});

// ====================== Terminal Display ======================
const EVENT_DISPLAY = {
  'TENDER_CREATED':       'Transaction started',
  'CARD_INSERTED':        'Card inserted',
  'CARD_PRESENTED':       'Card presented',
  'CARD_SWIPED':          'Card swiped',
  'WAIT_FOR_APP_SELECTION': 'Waiting for app selection...',
  'APPLICATION_SELECTED':  'App selected',
  'ASK_SIGNATURE':        'Signature required',
  'CHECK_SIGNATURE':      'Check signature',
  'SIGNATURE_CHECKED':    'Signature verified',
  'WAIT_FOR_PIN':         'Waiting for PIN...',
  'PIN_ENTERED':          'PIN entered',
  'PRINT_RECEIPT':        'Printing receipt...',
  'RECEIPT_PRINTED':      'Receipt printed',
  'CARD_REMOVED':         'Card removed',
  'TENDER_FINAL':         'Transaction complete',
  'ASK_DCC':              'DCC offered',
  'DCC_ACCEPTED':         'DCC accepted',
  'DCC_REJECTED':         'DCC rejected',
  'ASK_GRATUITY':         'Waiting for tip...',
  'GRATUITY_ENTERED':     'Tip entered',
  'BALANCE_QUERY_STARTED': 'Checking balance...',
  'BALANCE_QUERY_COMPLETED': 'Balance checked',
  'PROVIDE_CARD_DETAILS': 'Waiting for card details...',
  'CARD_DETAILS_PROVIDED': 'Card details entered',
};

const _termDisplayState = {}; // { poiId: { txnId, clearTimer } }

function updateTerminalDisplay(data) {
  const { events, poiId } = data;
  if (!events || events.length === 0) return;

  const key = poiId || '_default';
  if (!_termDisplayState[key]) _termDisplayState[key] = { txnId: null, clearTimer: null };
  const ts = _termDisplayState[key];

  let isFinal = false;

  for (const e of events) {
    if (e.type !== 'event') continue;
    if (e.event === 'TENDER_CREATED' && e.transactionId) {
      ts.txnId = e.transactionId;
      clearTimeout(ts.clearTimer);
    }
    if (e.event === 'TENDER_FINAL' || e.event === 'CARD_REMOVED' || e.event === 'RECEIPT_PRINTED') {
      isFinal = true;
    }
  }

  const lines = events.map(e => {
    if (e.type === 'event') {
      let text = EVENT_DISPLAY[e.event] || e.event;
      if (e.event === 'TENDER_FINAL' && e.result) {
        text += e.result === 'Success' ? ' — Approved' : ` — ${e.result}`;
      }
      return text;
    }
    return e.text || '';
  }).filter(Boolean);

  ts.lines = lines;

  clearTimeout(ts.clearTimer);
  if (isFinal) {
    ts.clearTimer = setTimeout(() => {
      ts.txnId = null;
      ts.lines = null;
      renderTerminalDisplay();
    }, 5000);
  }

  renderTerminalDisplay();
  reportDisplayOnOverlay(key, lines);
}

// Sync mode keeps the payment dialog up, and it covers the panel these lines
// normally go to. The cashier is standing at the terminal waiting, so this is where
// they are worth the most: 'Waiting for PIN...' answers the question being asked,
// where the fixed 'Please complete the payment on the terminal...' does not.
function reportDisplayOnOverlay(key, lines) {
  if (state.isAsync) return;
  // Cleared before the result is shown, so the events a terminal sends after its
  // PaymentResponse -- receipt printed, card removed -- cannot overwrite the outcome.
  if (!state.pendingServiceId) return;
  if (_overlayDetached || $overlay.classList.contains('hidden')) return;
  // A cancel has been asked for. What is happening to that request now matters more
  // than which step the transaction had reached.
  if (state._cancelling) return;

  // The dialog speaks for one payment. Now that a till may hold any number of
  // terminals, another one's events would otherwise narrate the wrong sale. A
  // notification carrying no POIID is not attributable, so it is let through.
  const order = state.orders.find(o => o.serviceId === state.pendingServiceId);
  const paying = order?.terminalId || state.config.poiId || '';
  if (key !== '_default' && paying && key !== paying) return;

  const latest = lines[lines.length - 1];
  if (latest) $overlayMsg.textContent = latest;
}

// The clear button lives in the panel's head, not in here, so this owns every child
// of the content box and replaces the lot. It used to insert before that button and
// skip it when clearing, which stopped being true once the head was split out: the
// button is no longer a child of this element, and insertBefore rejects a reference
// node that is not one. The first event of a transaction emptied the box and threw,
// leaving it collapsed and blank for the rest of the session.
function renderTerminalDisplay() {
  const keys = Object.keys(_termDisplayState);
  const activeEntries = keys.filter(k => _termDisplayState[k].lines && _termDisplayState[k].lines.length > 0);

  if (activeEntries.length === 0) {
    const idle = document.createElement('span');
    idle.className = 'terminal-display-idle';
    idle.textContent = 'Idle';
    $terminalDisplay.replaceChildren(idle);
    return;
  }

  const frag = document.createDocumentFragment();
  activeEntries.forEach(k => {
    const ts = _termDisplayState[k];
    const block = document.createElement('div');
    block.className = 'terminal-display-block';
    if (k !== '_default') block.innerHTML += `<div class="terminal-display-label">${k}</div>`;
    block.innerHTML += (ts.lines || []).map(l => `<div class="terminal-display-line">${l}</div>`).join('');
    frag.appendChild(block);
  });
  $terminalDisplay.replaceChildren(frag);
}

function clearTerminalDisplay() {
  for (const k of Object.keys(_termDisplayState)) {
    clearTimeout(_termDisplayState[k].clearTimer);
    delete _termDisplayState[k];
  }
  // Nothing is active now, so the render puts the panel back to Idle by itself.
  renderTerminalDisplay();
}

// ====================== Products ======================
function renderProducts() {
  const disabled = !state.terminalOnline;
  $productGrid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card${disabled ? ' disabled' : ''}" data-id="${p.id}" style="background:${p.color}">
      <div class="product-img">${PRODUCT_SVGS[p.id]}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">${state.config.currency || 'EUR'} ${p.price.toFixed(2)}</div>
    </div>
  `).join('');
}

// ====================== Cart ======================
function addToCart(productId) {
  if (!state.terminalOnline) {
    showToast('Terminal is offline — check terminal first', 'warning');
    return;
  }
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  const existing = state.cart.find(c => c.product.id === productId);
  if (existing) {
    existing.qty++;
  } else {
    state.cart.push({ product, qty: 1 });
  }
  renderCart();
}

function updateQty(productId, delta) {
  const item = state.cart.find(c => c.product.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(c => c.product.id !== productId);
  }
  renderCart();
}

function clearCart() {
  state.cart = [];
  renderCart();
}

function cartTotal() {
  return state.cart.reduce((sum, c) => sum + c.product.price * c.qty, 0);
}

function renderCart() {
  const cur = state.config.currency || 'EUR';
  if (state.cart.length === 0) {
    $cartItems.innerHTML = '<div class="empty-state">Cart is empty</div>';
    $cartTotal.textContent = `${cur} 0.00`;
    $btnPay.disabled = true;
    return;
  }

  $cartItems.innerHTML = state.cart.map(c => `
    <div class="cart-item">
      <div class="cart-item-info">
        <span class="cart-item-emoji">${PRODUCT_SVGS[c.product.id]}</span>
        <div>
          <div class="cart-item-name">${c.product.name}</div>
          <div class="cart-item-unit-price">${cur} ${c.product.price.toFixed(2)} each</div>
        </div>
      </div>
      <div class="cart-item-right">
        <div class="cart-item-controls">
          <button class="btn-qty" onclick="updateQty('${c.product.id}', -1)">−</button>
          <span class="cart-item-qty">${c.qty}</span>
          <button class="btn-qty" onclick="updateQty('${c.product.id}', 1)">+</button>
        </div>
        <div class="cart-item-subtotal">${cur} ${(c.product.price * c.qty).toFixed(2)}</div>
      </div>
    </div>
  `).join('');

  $cartTotal.textContent = `${cur} ${cartTotal().toFixed(2)}`;
  $btnPay.disabled = false;
}

// ====================== Orders ======================
// Every status an order can hold once its payment has succeeded. A refund, whether
// it went through, was declined or is only partial, does not undo that fact.
const PAID_STATUSES = new Set(['paid', 'partially_refunded', 'refunded', 'refund_failed']);

// Why this order's terminal actions cannot be used, or null when they can. Every
// action on a card is bound to the terminal that took the payment, so the answer is
// per order and not per till: an order from another terminal is unusable even while
// the selected one is perfectly healthy.
function orderActionBlock(order) {
  // A Tap to Pay order is not bound to a terminal in the list at all — its
  // terminalId is a Payments app installation — so the list has nothing to say
  // about it and the device answers instead.
  if (order.viaTapToPay) return ttpActionBlock(order);

  const poiId = order.terminalId;
  if (!poiId) return state.terminalOnline ? null : 'The current terminal is offline';

  const name = terminalDisplayName(poiId);
  const known = (state.config.terminals || []).some(t => t.poiId === poiId);
  if (!known) return `${name} is no longer in the terminal list. Add it again to use this order.`;
  // Only trust the online set once a check has actually run, otherwise every order
  // would look unusable until the first one completes.
  if (state._terminalChecked && !state._terminalOnlineSet.has(poiId)) {
    return `${name} is offline. Bring it online to use this order.`;
  }
  if (poiId !== state.config.poiId) {
    return `This order was taken on ${name}. Switch the current terminal to it first.`;
  }
  return null;
}

// Which of the three things a Tap to Pay action needs is missing, or null when
// none is. The Payments app carries the reversal out on the device itself and
// there is no cloud path to reach it, so the only device that can refund a Tap to
// Pay payment is the boarded device that took it.
function ttpActionBlock(order) {
  if (!isAndroidDevice()) {
    return 'Tap to Pay orders can only be refunded from the Android device that took the payment.';
  }
  const installationId = localStorage.getItem('ttp_installationId') || '';
  if (!installationId) return 'This device is not boarded for Tap to Pay. Board it first.';
  if (installationId !== order.terminalId) {
    return 'This payment was taken on a different Tap to Pay device. Refund it from that one.';
  }
  return null;
}

// Orders carry text this app did not write: product names, Adyen error conditions,
// and a member's display name typed into user management. All of it is rendered
// through innerHTML, so all of it goes through here first.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A disabled button receives no pointer events, so the tip has to live on a wrapper
// around it rather than on the button itself.
function withActionTip(buttonHtml, tip) {
  if (!tip) return buttonHtml;
  return `<span class="action-tip" data-tip="${escapeHtml(tip)}">${buttonHtml}</span>`;
}

function renderOrders() {
  const cur = state.config.currency || 'EUR';
  $orderCount.textContent = state.orders.length;
  // An order can change while its dialog is open — a pending payment is the whole
  // reason the dialog has a status in it — so the dialog follows the list.
  refreshOpenOrderDetail();

  const query = ($orderSearch?.value || '').trim().toLowerCase();
  const filtered = query
    ? state.orders.filter(o =>
        (o.serviceId || '').toLowerCase().includes(query) ||
        (o.pspReference || '').toLowerCase().includes(query) ||
        (o.terminalId || '').toLowerCase().includes(query) ||
        (o.poiTransactionId || '').toLowerCase().includes(query))
    : state.orders;

  if (filtered.length === 0) {
    $orderList.innerHTML = query
      ? '<div class="empty-state">No matching orders</div>'
      : '<div class="empty-state">No orders yet</div>';
    return;
  }

  $orderList.innerHTML = filtered.map(o => {
    // Date as well as time: the list keeps up to 200 orders, so it spans days.
    const time = new Date(o.createdAt).toLocaleString();
    // Status and cancel are cloud Terminal API calls, so they stay off for Tap to
    // Pay orders. A referenced refund is the exception: the Payments app accepts a
    // ReversalRequest over the same App Link a payment uses. Both routes still need
    // a POI transaction to name — without one there is nothing to reverse.
    const canRefund = (o.status === 'paid' || o.status === 'partially_refunded' || o.status === 'refund_failed') && o.poiTransactionId;
    // Reprinting uses ReceiptReprintFlag, which Adyen does not support for the
    // Android Payments app, and only makes sense on terminals with a printer.
    // Keyed off "the payment succeeded" rather than the current status: a later
    // refund, or a refund that failed, does not invalidate the original receipt.
    const paymentSucceeded = PAID_STATUSES.has(o.status);
    const canReprint = paymentSucceeded && !o.viaTapToPay && terminalHasPrinter(o.terminalId);
    const blocked = orderActionBlock(o);
    const off = blocked ? ' disabled' : '';

    // A cancellation is not a failure. The reason for one only ever restates the
    // badge sitting next to it -- "Cancelled" above "Transaction cancelled" -- and
    // red on the card is meant for the orders a cashier still has to do something
    // about. The full reason stays in the detail dialog.
    const reason = o.status === 'cancelled' ? '' : o.failureReason;

    // The ServiceID, the payment method and the basket are left to the detail
    // dialog. What stays is what an order is looked up by, and each reference gets
    // its own line: sharing one truncated all of them.
    return `
      <div class="order-card" data-order-id="${escapeHtml(o.id)}">
        <div class="order-card-header">
          <span class="order-card-amount">${cur} ${(o.amount || 0).toFixed(2)}</span>
          <span class="status status-${o.status}">${orderStatusLabel(o)}</span>
        </div>
        ${reason ? `<div class="order-card-reason">${escapeHtml(reason)}</div>` : ''}
        ${o.pspReference ? `<div class="order-card-line order-card-psp">PSP: ${escapeHtml(o.pspReference)}</div>` : ''}
        <div class="order-card-line order-card-terminal${o.viaTapToPay ? ' is-route' : ''}">${o.viaTapToPay ? 'Tap to Pay' : escapeHtml(o.terminalId || '—')}</div>
        <div class="order-card-line order-card-time">${escapeHtml(time)}</div>
        ${o.status === 'pending' && !o.viaTapToPay ? `
          <div class="order-card-actions">
            ${withActionTip(`<button class="btn-check-order" onclick="queryOrderStatus('${o.serviceId}', this)"${off}><i data-lucide="search"></i>Check Status</button>`, blocked)}
            ${withActionTip(`<button class="btn-cancel-order" onclick="cancelOrder('${o.serviceId}', this)"${o.cancelRequested ? ' disabled' : off}><i data-lucide="x"></i>${o.cancelRequested ? 'Cancelling…' : 'Cancel'}</button>`, blocked)}
          </div>` : ''}
        ${canRefund || canReprint ? `
          <div class="order-card-actions">
            ${canRefund ? withActionTip(`<button class="btn-refund" onclick="promptRefund('${o.id}')"${off}><i data-lucide="rotate-ccw"></i>Refund</button>`, blocked) : ''}
            ${canReprint ? withActionTip(`<button class="btn-reprint" onclick="reprintReceipt('${o.serviceId}', this)"${off}><i data-lucide="printer"></i>Print Receipt</button>`, blocked) : ''}
          </div>` : ''}
      </div>
    `;
  }).join('');
  refreshIcons();
}

// ====================== Order detail ======================
const $orderDetailModal = document.getElementById('order-detail-modal');
const $orderDetailBody  = document.getElementById('order-detail-body');
const $btnOrderDetailClose = document.getElementById('btn-order-detail-close');

function detailRow(label, value, modifier = '') {
  if (value === null || value === undefined || value === '') return '';
  // A dl per pair, because dt and dd are only valid inside one.
  return `<dl class="order-detail-row${modifier}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></dl>`;
}

function renderOrderDetail(order) {
  const cur = state.config.currency || 'EUR';
  const money = n => `${cur} ${(Number(n) || 0).toFixed(2)}`;
  const loyalty = order.loyalty;

  const payment = [
    // The two fields the card no longer shows. `is-ref` marks the values that are
    // machine identifiers, which are the only ones set in monospace.
    detailRow('ServiceID', order.serviceId, ' is-ref'),
    detailRow('Payment method', order.paymentBrand ? formatBrand(order.paymentBrand) : ''),
    // Card payments only: the first six and last four digits, as the terminal
    // returned them. Absent for a wallet, so the row disappears by itself.
    detailRow('Card', order.maskedPan, ' is-ref'),
    detailRow('Status', orderStatusLabel(order)),
    detailRow('Time', order.createdAt ? new Date(order.createdAt).toLocaleString() : ''),
    detailRow('Entry', order.viaTapToPay ? 'Tap to Pay' : ''),
    // Only worth a row once something has actually been refunded.
    order.refundedAmount > 0 ? detailRow('Refunded', money(order.refundedAmount), ' is-refund') : ''
  ].join('');

  const references = [
    detailRow('PSP reference', order.pspReference, ' is-ref'),
    detailRow('Tender reference', order.tenderReference, ' is-ref'),
    detailRow('Terminal', order.terminalId, ' is-ref')
  ].join('');

  // A redemption is the only part of an order that names a person, so it gets its
  // own section rather than being buried among the references.
  const member = loyalty ? [
    detailRow('Customer', loyalty.displayName),
    detailRow('Points redeemed', `${loyalty.pointsUsed} pts`),
    detailRow('Basket before discount', money(loyalty.originalAmount)),
    detailRow('Paid by card', money(order.amount))
  ].join('') : '';

  const items = (order.items || []).map(i =>
    detailRow(`${i.name || 'Item'} x${i.qty || 1}`, money((i.price || 0) * (i.qty || 1)))
  ).join('');

  $orderDetailBody.innerHTML = `
    <div class="order-detail-head">
      <span class="order-detail-amount">${money(order.amount)}</span>
      <span class="status status-${order.status}">${orderStatusLabel(order)}</span>
    </div>
    ${order.failureReason || order.error ? `
      <div class="order-detail-section">
        <div class="order-detail-label">Failure</div>
        <div class="order-detail-reason">${escapeHtml(order.failureReason || order.error)}</div>
      </div>` : ''}
    <div class="order-detail-section">
      <div class="order-detail-label">Payment</div>
      ${payment}
    </div>
    ${member ? `
      <div class="order-detail-section">
        <div class="order-detail-label">Member</div>
        ${member}
      </div>` : ''}
    ${items ? `
      <div class="order-detail-section">
        <div class="order-detail-label">Items</div>
        ${items}
      </div>` : ''}
    ${references ? `
      <div class="order-detail-section">
        <div class="order-detail-label">References</div>
        ${references}
      </div>` : ''}
  `;
}

// Which order the dialog is showing, so an update to that order can be reflected
// while it is still on screen.
let _openOrderId = null;

function openOrderDetail(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  _openOrderId = orderId;
  renderOrderDetail(order);
  $orderDetailModal.classList.remove('hidden');
}

function refreshOpenOrderDetail() {
  if (!_openOrderId || $orderDetailModal.classList.contains('hidden')) return;
  const order = state.orders.find(o => o.id === _openOrderId);
  // Cleared orders take their dialog with them, rather than leaving a stale one up.
  if (order) renderOrderDetail(order);
  else closeOrderDetail();
}

function closeOrderDetail() {
  $orderDetailModal.classList.add('hidden');
  _openOrderId = null;
}

// Lucide replaces every `data-lucide` placeholder with an inline SVG, so it has to
// run again after any render that injects markup. Guarded because the library is
// loaded from a CDN: if that fails, the buttons still show their text labels.
function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons();
}

// A POI ID is "<model>-<serial>", e.g. "V400m-346536527", so the model prefix
// tells us whether the terminal has a built-in receipt printer.
function terminalHasPrinter(poiId) {
  if (!poiId) return false;
  const model = String(poiId).split('-')[0].toUpperCase();
  const prefixes = state.config.printerModels || [];
  return prefixes.some(p => model.startsWith(String(p).toUpperCase()));
}

async function reprintReceipt(serviceId, btn) {
  const order = state.orders.find(o => o.serviceId === serviceId);
  if (!order) {
    showToast('Order not found', 'error');
    return;
  }
  if (!ensureTerminalMatch(order)) return;
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Printing...'; }
  try {
    const res = await fetch('/api/reprint-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId })
    });
    const data = await res.json();
    showApiResponse('Print receipt', data.adyenResponse || data);
    if (res.ok) {
      showToast('Receipt sent to the terminal', 'success');
    } else {
      syncTerminalStateFromError(data);
      showRequestError(data, 'Reprint failed');
    }
  } catch (err) {
    showToast(`Reprint failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function formatStatus(s) {
  const map = {
    pending: 'Pending', paid: 'Paid', failed: 'Failed',
    cancelled: 'Cancelled', error: 'Error',
    refunded: 'Refunded', partially_refunded: 'Partial Refund', refund_failed: 'Refund Failed'
  };
  return map[s] || s;
}

// An asked-for cancel is not a cancelled sale: the terminal may be past the point
// of no return, and only its PaymentResponse settles the order. This reports the
// request without pretending it succeeded.
function orderStatusLabel(order) {
  if (order.status === 'pending' && order.cancelRequested) return 'Cancelling';
  return formatStatus(order.status);
}

// The one place a settled order is turned into the line shown on the payment
// overlay. There were two: the sync path read ErrorCondition straight out of the
// Adyen response and put protocol enums like "Aborted" in front of the cashier,
// while the SSE path built its own phrasing from the status. `failureReason` is
// already a finished sentence from the server, so it is shown as-is rather than
// appended to a prefix that would repeat it.
function paymentOutcomeMessage(order) {
  if (order.status === 'paid') return 'Payment successful';
  if (order.failureReason) return order.failureReason;
  return {
    cancelled: 'Payment cancelled',
    failed: 'Payment failed',
    error: 'Payment did not complete'
  }[order.status] || `Payment ${formatStatus(order.status).toLowerCase()}`;
}

function formatBrand(brand) {
  const map = {
    mc: 'Mastercard', visa: 'Visa', amex: 'Amex', maestro: 'Maestro',
    discover: 'Discover', jcb: 'JCB', cup: 'UnionPay', diners: 'Diners',
    eftpos_australia: 'eftpos', interac: 'Interac', cartebancaire: 'Carte Bancaire',
    bcmc: 'Bancontact', girocard: 'Girocard', alipay: 'Alipay', wechatpay: 'WeChat Pay',
    swish: 'Swish', twint: 'TWINT', paypal: 'PayPal',
  };
  return map[brand?.toLowerCase()] || brand;
}

// ====================== Terminal List ======================
// The models Adyen currently sells, keyed by the model part of a POI ID. The family
// only decides which outline is drawn: the exact casing matters far less than being
// able to tell a countertop unit from something the staff carry around.
const TERMINAL_MODELS = {
  AMS1:  { label: 'AMS1',       family: 'mobile' },
  SFO1:  { label: 'Adyen SFO1', family: 'countertop' },
  E285:  { label: 'e285',       family: 'reader' },
  S1U2:  { label: 'S1U2',       family: 'unattended' },
  P630:  { label: 'P630',       family: 'countertop' },
  V400M: { label: 'V400m',      family: 'printer' },
  V240M: { label: 'V240m Plus', family: 'printer' },
  V400C: { label: 'V400c Plus', family: 'countertop' },
  S1F2:  { label: 'S1F2',       family: 'printer' },
  S1E2L: { label: 'S1E2L',      family: 'mobile' },
  NYC1:  { label: 'NYC1',       family: 'reader' },
  M450:  { label: 'M450',       family: 'countertop' },
  S1E4:  { label: 'S1E4 Pro',   family: 'mobile' },
  S1F4:  { label: 'S1F4 Pro',   family: 'printer' }
};

// Models with a product shot in /img/terminals. Kept as a list rather than probing
// for the file so a missing image falls back to the outline without a failed
// request, and so newly added models are an explicit decision.
const TERMINAL_PHOTOS = new Set([
  'AMS1', 'SFO1', 'E285', 'S1U2', 'P630', 'V400M', 'V240M', 'V400C', 'S1F2', 'S1E2L', 'NYC1', 'M450'
]);

// Fallback for models with no photo, and for anything the list above does not cover.
// Line art stays legible at this size and cannot go stale when a model is refreshed.
const TERMINAL_ART = {
  mobile: '<rect x="9" y="3" width="22" height="50" rx="5"/><rect x="13" y="9" width="14" height="19" rx="2"/><circle cx="20" cy="41" r="2"/>',
  printer: '<rect x="9" y="3" width="22" height="50" rx="5"/><path d="M13 8h14"/><rect x="13" y="14" width="14" height="17" rx="2"/><circle cx="20" cy="43" r="2"/>',
  countertop: '<rect x="7" y="6" width="26" height="31" rx="4"/><rect x="11" y="11" width="18" height="14" rx="2"/><circle cx="20" cy="31" r="2"/><path d="M15 37v8M25 37v8M10 49h20"/>',
  unattended: '<rect x="7" y="8" width="26" height="40" rx="4"/><rect x="11" y="13" width="18" height="15" rx="2"/><path d="M13 37h10"/><path d="M31 22v10" stroke-width="3"/>',
  reader: '<rect x="10" y="14" width="20" height="28" rx="6"/><rect x="14" y="19" width="12" height="9" rx="2"/><path d="M17 35h6"/>'
};

// Splits "V400m-346536527" into the model it describes and the serial that follows.
// Unknown models still render: the label falls back to whatever the POI ID carries,
// so a terminal added before this list was updated is not left blank.
function terminalDisplayName(poiId) {
  return terminalModelInfo(poiId).title || poiId || 'Unknown terminal';
}

// Built from nodes rather than a template string so the terminal name can carry
// its own element: it is bold, and `white-space: nowrap` keeps a model/serial
// pair from being split across two lines.
function showTerminalMismatchBanner(orderTerminalId, reason = 'mismatch') {
  const name = document.createElement('strong');
  name.className = 'banner-terminal';
  name.textContent = terminalDisplayName(orderTerminalId);

  const tail = reason === 'deleted'
    ? ', which is no longer in the terminal list. Add it again to continue'
    : reason === 'offline'
      ? ', which is offline. Bring it online to continue'
      : '. Please switch the Current terminal to that device';

  // Held a second longer than a normal banner: it names a specific device the
  // reader has to match against the terminal picker before acting on it.
  showBanner([
    document.createTextNode('This order was processed on '),
    name,
    document.createTextNode(tail)
  ], 'warning', 6000);
}

// The server refuses terminal-bound requests it knows cannot be delivered, and
// says so with `terminalOffline`. Its verdict is fresher than ours, so adopt it:
// the buttons and the terminal card then agree with what just happened.
function syncTerminalStateFromError(data) {
  if (!data || !data.terminalOffline) return false;
  if (Array.isArray(data.connectedTerminals)) {
    state._terminalOnlineSet = new Set(data.connectedTerminals);
    state._terminalChecked = true;
    renderTerminals();
  }
  return true;
}

function ensureTerminalMatch(order) {
  // Old orders may not record a terminalId; allow those through rather than
  // blocking otherwise-valid refund/reprint actions.
  if (!order || !order.terminalId) return true;

  const terminals = state.config.terminals || [];
  const orderTerminal = terminals.find(t => t.poiId === order.terminalId);
  if (!orderTerminal) {
    showTerminalMismatchBanner(order.terminalId, 'deleted');
    return false;
  }

  const onlineSet = state._terminalOnlineSet;
  const isOffline = onlineSet && !onlineSet.has(order.terminalId);
  if (isOffline) {
    showTerminalMismatchBanner(order.terminalId, 'offline');
    return false;
  }

  if (order.terminalId !== state.config.poiId) {
    showTerminalMismatchBanner(order.terminalId, 'mismatch');
    return false;
  }
  return true;
}

function terminalModelInfo(poiId) {
  const text = String(poiId || '');
  const dash = text.indexOf('-');
  const rawModel = dash > 0 ? text.slice(0, dash) : text;
  const serial = dash > 0 ? text.slice(dash + 1) : '';
  const key = rawModel.toUpperCase();
  // Longest match first so S1E2L is not claimed by a shorter S1E2 entry.
  const matchKey = TERMINAL_MODELS[key] ? key
    : Object.keys(TERMINAL_MODELS).filter(k => key.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const match = TERMINAL_MODELS[matchKey];
  const label = match?.label || rawModel || 'Terminal';
  return {
    label,
    family: match?.family || 'mobile',
    photo: TERMINAL_PHOTOS.has(matchKey) ? `/img/terminals/${matchKey}.webp` : '',
    serial,
    title: serial ? `${label} - ${serial}` : label
  };
}

// One document-level listener rather than one per render: the picker markup is
// replaced wholesale every time the terminal list changes.
let _terminalPickerBound = false;
function bindTerminalPicker() {
  if (_terminalPickerBound) return;
  _terminalPickerBound = true;
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('terminal-picker');
    if (picker && !picker.contains(e.target)) picker.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.getElementById('terminal-picker')?.classList.remove('open');
  });
}

function renderTerminals() {
  const list = state.config.terminals || [];
  if (list.length === 0) {
    $terminalList.innerHTML = '<div class="terminal-empty">No terminals added</div>';
    state.config.poiId = '';
    state.terminalOnline = false;
    renderProducts();
    renderOrders();
    return;
  }

  const onlineSet = state._terminalOnlineSet || new Set();
  const checked = state._terminalChecked;
  const active = list.find(t => t.active) || list[0];
  const info = terminalModelInfo(active.poiId);
  const online = onlineSet.has(active.poiId);

  const options = list.map(t => {
    const opt = terminalModelInfo(t.poiId);
    const isActive = t.poiId === active.poiId;
    const off = checked && !onlineSet.has(t.poiId);
    return `
      <button type="button" class="terminal-option${isActive ? ' selected' : ''}" role="option"
              aria-selected="${isActive}" data-poi="${t.poiId}">
        <span class="terminal-option-name">${opt.title}</span>
        ${off ? '<span class="terminal-option-off">Offline</span>' : ''}
        <svg class="terminal-option-tick" viewBox="0 0 14 14" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5 5.5 11 12 3.5"/></svg>
      </button>`;
  }).join('');

  // The card is the trigger: a separate closed-state box on top of it would repeat
  // the same terminal twice. The remove button is a sibling rather than nested,
  // since a button cannot contain another button.
  $terminalList.innerHTML = `
    <div class="terminal-picker" id="terminal-picker">
      <button type="button" class="terminal-card" aria-haspopup="listbox">
        <span class="terminal-thumb">
          ${info.photo
            ? `<img src="${info.photo}" alt="${info.label}" loading="lazy">`
            : `<svg viewBox="0 0 40 56" fill="none" stroke="currentColor" stroke-width="1.6"
                    stroke-linecap="round" stroke-linejoin="round">${TERMINAL_ART[info.family]}</svg>`}
        </span>
        <span class="terminal-meta">
          <span class="terminal-model-row">
            <span class="terminal-model">${info.label}</span>
            ${checked ? `<span class="terminal-status-dot ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>` : ''}
          </span>
          ${info.serial ? `<span class="terminal-serial">${info.serial}</span>` : ''}
        </span>
        <svg class="terminal-picker-chevron" viewBox="0 0 12 8" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1.5 6 6.5l5-5"/></svg>
      </button>
      <button class="terminal-delete-btn" onclick="deleteTerminal('${active.poiId}')" title="Remove this terminal">✕</button>
      <div class="terminal-picker-menu" role="listbox">${options}</div>
    </div>`;

  const picker = document.getElementById('terminal-picker');
  picker.querySelector('.terminal-card')
    .addEventListener('click', () => picker.classList.toggle('open'));
  picker.querySelectorAll('.terminal-option').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.classList.remove('open');
      if (btn.dataset.poi !== active.poiId) selectTerminal(btn.dataset.poi);
    });
  });
  bindTerminalPicker();

  state.config.poiId = active.poiId;
  // Before the first check nothing is known, so stay permissive rather than
  // greying out the till; afterwards the check is the only source of truth. The
  // previous `!!active` here silently re-enabled a terminal known to be offline.
  state.terminalOnline = checked ? online : true;
  renderProducts();
  renderOrders();
}

async function selectTerminal(poiId) {
  try {
    const res = await fetch('/api/terminal/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poiId })
    });
    const data = await res.json();
    if (res.ok) {
      state.config.terminals = data.terminals;
      renderTerminals();
      showToast(`Active: ${poiId}`, 'success');
    }
  } catch (err) {
    showToast(`Select failed: ${err.message}`, 'error');
  }
}

async function deleteTerminal(poiId) {
  try {
    const res = await fetch('/api/terminal/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poiId })
    });
    const data = await res.json();
    if (res.ok) {
      state.config.terminals = data.terminals;
      renderTerminals();
      showToast(`Removed ${poiId}`, 'info');
    }
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

// ====================== Receipt Settings ======================
// The print head is 384 dots wide and can only burn or not burn each dot, so a
// picked file is downscaled and reduced to pure black and white in the browser
// before it is uploaded. That keeps it well inside the size the terminal accepts
// and shows the shopper-facing result in the preview.
const LOGO_MAX_WIDTH = 384;
const LOGO_MAX_HEIGHT = 300;
const LOGO_MAX_FILE_BYTES = 10 * 1024 * 1024;
const LOGO_THRESHOLD = 150;

function toMonochromePng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, LOGO_MAX_WIDTH / img.naturalWidth, LOGO_MAX_HEIGHT / img.naturalHeight);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // Flatten onto white first: dropping alpha would otherwise turn transparent
      // areas black and print a solid block.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const image = ctx.getImageData(0, 0, width, height);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        const luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const value = luma < LOGO_THRESHOLD ? 0 : 255;
        px[i] = px[i + 1] = px[i + 2] = value;
        px[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

function renderLogoPreview(data) {
  if (!data || !data.present) {
    $logoPreviewImg.removeAttribute('src');
    $logoMeta.textContent = 'No logo: receipts print without one';
    return;
  }
  $logoPreviewImg.src = data.dataUrl;
  $logoMeta.textContent = `${data.width}x${data.height} px · ${(data.bytes / 1024).toFixed(1)} KB · ${data.custom ? 'uploaded' : 'default'}`;
}

function renderQrSettings(data) {
  $inputQrUrl.value = data.qrUrl || '';
  // Nothing to say when the field holds the default: the input above already shows
  // it. The note is only worth the line when the content has been changed, where it
  // is the one place the original is still recoverable from.
  const isDefault = data.qrUrl === data.qrUrlDefault;
  $qrMeta.textContent = isDefault ? '' : `Custom content · default is ${data.qrUrlDefault}`;
  $qrMeta.hidden = isDefault;
}

async function loadReceiptSettings() {
  try {
    const res = await fetch('/api/receipt-settings');
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    const data = await res.json();
    renderLogoPreview(data.logo);
    renderQrSettings(data);
  } catch (err) {
    $logoMeta.textContent = `Could not load the receipt settings: ${err.message}`;
  }
}

async function saveQrUrl() {
  const qrUrl = $inputQrUrl.value.trim();
  if (!qrUrl) {
    showToast('Enter the content for the QR code', 'error');
    return;
  }
  $btnQrSave.disabled = true;
  try {
    const res = await fetch('/api/receipt-qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrUrl })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not save the QR content', 'error');
      return;
    }
    await loadReceiptSettings();
    showToast('QR code content saved', 'success');
  } catch (err) {
    showToast(`Could not save the QR content: ${err.message}`, 'error');
  } finally {
    $btnQrSave.disabled = false;
  }
}

async function resetQrUrl() {
  $btnQrReset.disabled = true;
  try {
    const res = await fetch('/api/receipt-qr', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Could not reset the QR content', 'error');
      return;
    }
    await loadReceiptSettings();
    showToast('Back to the default QR content', 'info');
  } catch (err) {
    showToast(`Could not reset the QR content: ${err.message}`, 'error');
  } finally {
    $btnQrReset.disabled = false;
  }
}

function openReceiptModal() {
  $receiptModal.classList.remove('hidden');
  loadReceiptSettings();
  refreshIcons();
}

function closeReceiptModal() {
  $receiptModal.classList.add('hidden');
}

async function uploadReceiptLogo(file) {
  if (!file) return;
  if (file.size > LOGO_MAX_FILE_BYTES) {
    showToast(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; pick one under 10 MB`, 'error');
    return;
  }
  $btnLogoUpload.disabled = true;
  try {
    const { dataUrl, width, height } = await toMonochromePng(file);
    const res = await fetch('/api/receipt-logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Upload failed', 'error');
      return;
    }
    renderLogoPreview(data);
    showToast(`Logo updated (${width}x${height} px)`, 'success');
    refreshIcons();
  } catch (err) {
    showToast(`Upload failed: ${err.message}`, 'error');
  } finally {
    $btnLogoUpload.disabled = false;
  }
}

async function resetReceiptLogo() {
  $btnLogoReset.disabled = true;
  try {
    const res = await fetch('/api/receipt-logo', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Reset failed', 'error');
      return;
    }
    renderLogoPreview(data);
    showToast('Back to the default logo', 'info');
  } catch (err) {
    showToast(`Reset failed: ${err.message}`, 'error');
  } finally {
    $btnLogoReset.disabled = false;
  }
}

// ====================== Loyalty ======================
// One card read serves the whole flow: the alias it returns identifies the member,
// and the reference it returns lets the payment reuse the same card. Both are kept
// here between the card read and the payment.
const _loyalty = {
  cardAcquisition: null,
  member: null,
  amount: 0,
  // ServiceID of the card acquisition, needed to abort it while it is still
  // waiting for the card.
  serviceId: null,
  reading: false,
  // True once the card has been read and the terminal is holding the card data,
  // waiting for a payment to quote it. Until that is consumed or released, the
  // terminal is stuck on 'One moment' and unusable for anything else.
  holding: false,
  // The card was read but matched no member. Releasing the terminal is then the
  // moment to tell the shopper why, since nothing else on the terminal will.
  unmatched: false
};

// Replaces the terminal's own 'Transaction canceled' screen when the card belongs to
// nobody. Two entries only: the terminal draws the first as a header and the second
// as a footer.
const LOYALTY_NOT_A_MEMBER = {
  messageHeader: 'Not a member',
  messageFooter: 'Contact staff to register',
  // No icon: a red cross would read as a card or payment problem, which this is not.
  icon: 'Idle'
};

function loyaltyReset() {
  _loyalty.cardAcquisition = null;
  _loyalty.member = null;
  _loyalty.amount = 0;
  _loyalty.serviceId = null;
  _loyalty.reading = false;
  _loyalty.holding = false;
  _loyalty.unmatched = false;
  $loyaltySteps.innerHTML = '';
  $loyaltySteps.classList.add('hidden');
  $loyaltyAliasRow.classList.add('hidden');
  $loyaltyAlias.value = '';
  $btnLoyaltyPay.classList.add('hidden');
  $btnLoyaltyCancel.classList.add('hidden');
}

function loyaltyStep(text, tone = 'info') {
  $loyaltySteps.classList.remove('hidden');
  const row = document.createElement('div');
  row.className = `loyalty-step loyalty-step-${tone}`;
  row.textContent = text;
  $loyaltySteps.appendChild(row);
}

function renderLoyaltyBasket() {
  const currency = state.config.currency || 'EUR';
  const count = state.cart.reduce((sum, c) => sum + c.qty, 0);
  $loyaltyBasket.textContent = count === 0
    ? 'Cart is empty — add products before reading a card'
    : `${count} item${count === 1 ? '' : 's'} · ${currency} ${cartTotal().toFixed(2)}`;
  // Reading a card is only meaningful against a basket: the discount and the
  // payment that follows are both derived from the total.
  $btnLoyaltyRead.disabled = count === 0;
}

function openLoyaltyModal() {
  loyaltyReset();
  renderLoyaltyBasket();
  $loyaltyModal.classList.remove('hidden');
  refreshIcons();
}

// Closing the panel must not strand the terminal: if a read is still running it is
// aborted, and if the card data is already being held it is released.
async function closeLoyaltyModal() {
  if (_loyalty.reading) {
    await loyaltyAbortRead();
    return;
  }
  if (_loyalty.holding) {
    await loyaltyRelease(_loyalty.unmatched ? LOYALTY_NOT_A_MEMBER : null);
  }
  $loyaltyModal.classList.add('hidden');
}

// Stops a read while the terminal is still asking for the card.
async function loyaltyAbortRead() {
  if (!_loyalty.serviceId) return;
  $btnLoyaltyCancel.disabled = true;
  try {
    const res = await fetch('/api/loyalty/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: _loyalty.serviceId })
    });
    const data = await res.json();
    showApiResponse('Cancel card read', data.adyenResponse || data);
    if (!res.ok) {
      loyaltyStep(data.error || 'Could not cancel the card read', 'error');
      return;
    }
    // The pending read-card call now returns Failure / Aborted and reports it.
    loyaltyStep('Cancel sent to the terminal', 'warning');
  } catch (err) {
    loyaltyStep(`Could not cancel the card read: ${err.message}`, 'error');
  } finally {
    $btnLoyaltyCancel.disabled = false;
  }
}

// Hands the held card data back so the terminal leaves 'One moment' and goes idle.
async function loyaltyRelease(message = null) {
  $btnLoyaltyClose.disabled = true;
  try {
    const res = await fetch('/api/loyalty/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message || {})
    });
    const data = await res.json();
    showApiResponse('Release card', data.adyenResponse || data);
    if (!res.ok || !data.ok) {
      // Leave the panel open: the terminal is still holding the card, and hiding
      // that would just look like the app had finished.
      loyaltyStep(data.error || 'Could not release the terminal — cancel on the terminal itself', 'error');
      return false;
    }
    _loyalty.holding = false;
    _loyalty.cardAcquisition = null;
    $btnLoyaltyPay.classList.add('hidden');
    loyaltyStep('Terminal released', 'ok');
    return true;
  } catch (err) {
    loyaltyStep(`Could not release the terminal: ${err.message}`, 'error');
    return false;
  } finally {
    $btnLoyaltyClose.disabled = false;
  }
}

// Card acquisition, member lookup and the confirmation question, in the order the
// terminal has to run them. The reference stays valid only briefly, so the payment
// is sent straight after.
async function loyaltyReadCard() {
  if (state.cart.length === 0) {
    showToast('Add products to the cart before reading a card', 'warning');
    return;
  }
  if (!state.terminalOnline) {
    showToast('Terminal is offline — check terminal first', 'warning');
    return;
  }

  loyaltyReset();
  _loyalty.amount = Math.round(cartTotal() * 100) / 100;
  // Generated here rather than server-side so the cancel button has something to
  // quote while the read is still in flight.
  _loyalty.serviceId = generateServiceId();
  _loyalty.reading = true;
  const currency = state.config.currency || 'EUR';

  $btnLoyaltyRead.disabled = true;
  $btnLoyaltyCancel.classList.remove('hidden');
  loyaltyStep('Waiting for the card on the terminal...');

  try {
    const res = await fetch('/api/loyalty/read-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The amount lets the terminal process a contactless card during the read,
      // which is what avoids asking the shopper to tap again for the payment.
      body: JSON.stringify({ serviceId: _loyalty.serviceId, amount: _loyalty.amount })
    });
    const data = await res.json();
    _loyalty.reading = false;
    $btnLoyaltyCancel.classList.add('hidden');
    showApiResponse('Card read', data.adyenResponse || data);

    if (!res.ok) {
      loyaltyStep(data.error || 'The card could not be read', 'error');
      return;
    }

    // From here the terminal holds the card data until a payment quotes it or it
    // is released.
    _loyalty.holding = true;
    _loyalty.cardAcquisition = data.cardAcquisition;
    if (data.alias) {
      $loyaltyAlias.value = data.alias;
      $loyaltyAliasRow.classList.remove('hidden');
    }
    loyaltyStep(`Card read${data.maskedPan ? ` · ${data.maskedPan}` : ''}${data.paymentBrand ? ` · ${data.paymentBrand}` : ''}`, 'ok');

    if (!data.member) {
      _loyalty.unmatched = true;
      loyaltyStep('No member matches this card — copy the alias into User management to link it', 'warning');
      loyaltyStep('The terminal is holding the card: pay the full amount, or Close to release it', 'warning');
      $btnLoyaltyPay.classList.remove('hidden');
      refreshIcons();
      return;
    }

    _loyalty.member = data.member;
    loyaltyStep(`${data.member.displayName} · ${data.member.points} points`, 'ok');

    if (data.member.points <= 0) {
      loyaltyStep('No points to redeem, charging the full amount', 'warning');
      await loyaltyPay(0);
      return;
    }

    loyaltyStep('Asking on the terminal whether to use the credit...');
    const confirmRes = await fetch('/api/loyalty/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: data.member.id, amount: _loyalty.amount, currency })
    });
    const confirmData = await confirmRes.json();
    showApiResponse('Confirmation', confirmData.adyenResponse || confirmData);

    if (!confirmRes.ok) {
      loyaltyStep(confirmData.error || 'The question was not answered', 'error');
      loyaltyStep('The terminal is holding the card: pay the full amount, or Close to release it', 'warning');
      $btnLoyaltyPay.classList.remove('hidden');
      refreshIcons();
      return;
    }

    if (!confirmData.confirmed) {
      loyaltyStep('Declined on the terminal, charging the full amount', 'warning');
      await loyaltyPay(0);
      return;
    }

    loyaltyStep(`Redeeming ${confirmData.discount} points · ${currency} ${confirmData.finalAmount.toFixed(2)} on the card`, 'ok');
    await loyaltyPay(confirmData.discount);
  } catch (err) {
    _loyalty.reading = false;
    $btnLoyaltyCancel.classList.add('hidden');
    loyaltyStep(`Card read failed: ${err.message}`, 'error');
    if (_loyalty.holding) {
      loyaltyStep('The terminal is still holding the card: Close to release it', 'warning');
    }
  } finally {
    // Not unconditionally enabled: a completed payment empties the cart, which
    // leaves nothing to read a card against.
    $btnLoyaltyRead.disabled = state.cart.length === 0;
    refreshIcons();
  }
}

// Points are worth one currency unit each, so the discount and the points spent
// are the same number.
async function loyaltyPay(discount) {
  const amount = Math.round((_loyalty.amount - discount) * 100) / 100;
  const extra = {
    amount,
    cardAcquisitionReference: _loyalty.cardAcquisition
  };
  if (discount > 0 && _loyalty.member) {
    extra.loyalty = {
      memberId: _loyalty.member.id,
      pointsUsed: discount,
      originalAmount: _loyalty.amount
    };
  }
  // The payment consumes the card data, so the terminal must not be released:
  // clearing this first stops the close handler from doing exactly that.
  _loyalty.holding = false;
  _loyalty.reading = false;
  $loyaltyModal.classList.add('hidden');
  await processPayment('', '', extra);
}

// ====================== User management ======================
// Rows are edited locally and only committed by Save, so adding or removing a
// member is undone by closing without saving.
let _members = [];

const MEMBER_FIELDS = [
  { key: 'displayName', label: 'Name', type: 'text', placeholder: 'Full name' },
  { key: 'email', label: 'Email', type: 'email', placeholder: 'name@example.com' },
  { key: 'points', label: 'Points', type: 'number', placeholder: '0' },
  { key: 'alias', label: 'Alias', type: 'text', placeholder: 'Card alias from Read card' }
];

function renderUserData() {
  $userdataList.innerHTML = '';
  if (_members.length === 0) {
    $userdataList.innerHTML = '<div class="empty-state">No members yet</div>';
    return;
  }

  _members.forEach((member, index) => {
    const row = document.createElement('div');
    row.className = 'userdata-row';

    const head = document.createElement('div');
    head.className = 'userdata-row-head';
    const title = document.createElement('span');
    title.className = 'userdata-row-title';
    title.textContent = member.displayName || 'New member';
    const remove = document.createElement('button');
    remove.className = 'userdata-remove';
    remove.type = 'button';
    remove.title = 'Remove this member';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      _members.splice(index, 1);
      renderUserData();
    });
    head.append(title, remove);
    row.appendChild(head);

    for (const field of MEMBER_FIELDS) {
      const wrap = document.createElement('label');
      wrap.className = 'userdata-field';
      const label = document.createElement('span');
      label.className = 'userdata-field-label';
      label.textContent = field.label;
      const input = document.createElement('input');
      input.className = 'userdata-input';
      input.type = field.type;
      input.placeholder = field.placeholder;
      if (field.type === 'number') {
        input.min = '0';
        input.step = '1';
      }
      // Assigned rather than interpolated into markup, so a name containing
      // quotes or angle brackets cannot break the row.
      input.value = member[field.key];
      input.addEventListener('input', () => {
        member[field.key] = input.value;
        if (field.key === 'displayName') title.textContent = input.value || 'New member';
      });
      wrap.append(label, input);
      row.appendChild(wrap);
    }

    $userdataList.appendChild(row);
  });
}

async function loadUserData() {
  try {
    const res = await fetch('/api/members');
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    const data = await res.json();
    _members = (data.members || []).map(m => ({ ...m }));
    renderUserData();
  } catch (err) {
    _members = [];
    $userdataList.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'empty-state';
    error.textContent = `Could not load the members: ${err.message}`;
    $userdataList.appendChild(error);
  }
}

function addMember() {
  _members.push({ displayName: '', email: '', points: 0, alias: '' });
  renderUserData();
  // Put the caret in the new row's name field, which is the only required one.
  const inputs = $userdataList.querySelectorAll('.userdata-row:last-child .userdata-input');
  if (inputs.length) inputs[0].focus();
}

async function saveMembers() {
  $btnUserdataSave.disabled = true;
  $btnUserdataSave.textContent = 'Saving...';
  try {
    const res = await fetch('/api/members', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: _members })
    });
    const data = await res.json();
    if (!res.ok) {
      // Kept longer than a success: this one has to be read to be acted on.
      showFloatingToast(data.error || 'Could not save the members', 'error', 4000);
      // Highlight the row the server rejected so the message is actionable.
      const rows = $userdataList.querySelectorAll('.userdata-row');
      rows.forEach(r => r.classList.remove('userdata-row-invalid'));
      if (Number.isInteger(data.index) && rows[data.index]) {
        rows[data.index].classList.add('userdata-row-invalid');
        rows[data.index].scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    _members = (data.members || []).map(m => ({ ...m }));
    renderUserData();
    // The rows look identical after a save, so confirm it with a popup: the
    // notification bar behind the modal would not be seen.
    showFloatingToast('Successfully saved', 'success');
  } catch (err) {
    showFloatingToast(`Could not save the members: ${err.message}`, 'error', 4000);
  } finally {
    $btnUserdataSave.disabled = false;
    $btnUserdataSave.textContent = 'Save';
  }
}

function openUserDataModal() {
  $userdataModal.classList.remove('hidden');
  loadUserData();
  refreshIcons();
}

function closeUserDataModal() {
  $userdataModal.classList.add('hidden');
  // The balance shown next to a matched member may have just been edited.
  renderLoyaltyBasket();
}

// ====================== Terminal Check ======================
async function checkTerminal(opts) {
  const silent = !!(opts && opts.silent === true);
  const list = state.config.terminals || [];
  if (list.length === 0) {
    if (!silent) showToast('No terminals to check', 'warning');
    renderTerminals();
    return;
  }

  try {
    // Sent on: `silent` only ever suppressed this client's own response entry, so a
    // background re-check still had its request broadcast to every open log.
    const res = await fetch('/api/terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ silent })
    });
    const data = await res.json();
    if (!silent) showApiResponse('Connected terminals', data);
    const onlineList = data.uniqueTerminalIds || [];
    state._terminalOnlineSet = new Set(onlineList);
    state._terminalChecked = true;

    const activePoiId = state.config.poiId;
    state.terminalOnline = onlineList.includes(activePoiId);

    const onlineCount = list.filter(t => onlineList.includes(t.poiId)).length;
    if (!silent) showToast(`${onlineCount}/${list.length} terminal(s) online`, onlineCount > 0 ? 'success' : 'warning');

    if (state.terminalOnline) {
      _terminalReady = true;
      tryRecoverPending();
    }
  } catch (err) {
    state.terminalOnline = false;
    state._terminalOnlineSet = new Set();
    if (!silent) showToast(`Terminal check failed: ${err.message}`, 'error');
  }
  renderTerminals();
}

// ====================== Add Terminals ======================
// No dialog and nothing to type: the merchant account decides which terminals
// exist, so the button asks Adyen which of them are online and takes the ones the
// list does not have yet.
async function addTerminals() {
  const original = $btnAddTerm.innerHTML;
  $btnAddTerm.disabled = true;
  $btnAddTerm.textContent = 'Checking...';

  try {
    const res = await fetch('/api/terminal/discover', { method: 'POST' });
    const data = await res.json();
    showApiResponse('Add terminals', data);

    if (!res.ok) {
      showToast(data.error || 'Could not add terminals', 'error');
      return;
    }

    state.config.terminals = data.terminals;
    renderTerminals();

    const count = data.added.length;
    if (count > 0) {
      showToast(
        `Another ${count === 1 ? 'terminal was' : `${count} terminals were`} added into the available list`,
        'success'
      );
    } else {
      showToast('No more terminal is available', 'info');
    }
  } catch (err) {
    showToast(`Could not add terminals: ${err.message}`, 'error');
  } finally {
    $btnAddTerm.disabled = false;
    $btnAddTerm.innerHTML = original;
  }
}

// ====================== Recover Pending Orders ======================
async function recoverPendingOrders() {
  // Tap to Pay (Payments app) orders use local App2App communication, not the
  // cloud websocket, so a cloud TransactionStatus is always rejected with
  // 'websocket not connected'. Their result arrives via the App Link return.
  const pendingOrders = state.orders.filter(o => o.status === 'pending' && !o.viaTapToPay);
  if (pendingOrders.length === 0) return;

  showToast(`Checking ${pendingOrders.length} pending order(s)...`, 'info');

  for (const order of pendingOrders) {
    try {
      const res = await fetch('/api/transaction-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: order.serviceId })
      });
      const data = await res.json();
      showApiResponse('Transaction status', data);

      const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
      const result = statusResp?.Response?.Result;

      if (result === 'Failure' && statusResp?.Response?.ErrorCondition === 'InProgress') {
        if (!state.isAsync) {
          // Sync mode: restore overlay so user can monitor or cancel
          showOverlay(order.amount, state.config.currency || 'EUR');
          state.pendingServiceId = order.serviceId;
          $overlayMsg.textContent = `Recovering order ${order.serviceId}...`;
        }
        showToast(`Order ${order.serviceId} still in progress on terminal`, 'warning');
      } else if (result === 'Success' || result === 'Failure') {
        showToast(`Order ${order.serviceId} resolved`, 'success');
      }
    } catch (err) {
      showToast(`Status check failed for ${order.serviceId}: ${err.message}`, 'error');
    }
  }
}

// ====================== Payment ======================
function generateServiceId() {
  // Adyen ServiceID max 10 chars
  return Math.random().toString(36).slice(2, 12);
}

const $paymethodModal = document.getElementById('paymethod-modal');
const $btnPaymethodCancel = document.getElementById('btn-paymethod-cancel');

function initiatePayment() {
  const total = cartTotal();
  if (total <= 0) return;
  $paymethodModal.classList.remove('hidden');
}

function closePaymethodModal() {
  $paymethodModal.classList.add('hidden');
}

// forceEntryMode restricts how the terminal may read the card. 'Keyed' is Manual
// Key Entry: the terminal, not this app, prompts for the card number and expiry.
// `extra` is merged over the request body, which is how the loyalty flow replaces
// the amount with the discounted one and quotes its card acquisition.
async function processPayment(allowedBrand, forceEntryMode, extra) {
  closePaymethodModal();

  const total = cartTotal();
  const items = state.cart.map(c => ({
    id: c.product.id,
    name: c.product.name,
    price: c.product.price,
    qty: c.qty
  }));

  const serviceId = generateServiceId();

  const body = {
    amount: Math.round(total * 100) / 100,
    currency: state.config.currency || 'EUR',
    items,
    useAsync: state.isAsync,
    serviceId
  };
  if (allowedBrand) body.allowedPaymentBrand = allowedBrand;
  if (forceEntryMode) body.forceEntryMode = forceEntryMode;
  if (extra) Object.assign(body, extra);

  if (state.isAsync) {
    await payAsync(body);
  } else {
    await paySync(body);
  }
}

async function paySync(body) {
  showOverlay(body.amount, body.currency);
  state.pendingServiceId = body.serviceId;
  if (!state._syncLogged) state._syncLogged = {};
  state._syncLogged[body.serviceId] = true;
  // Claims the overlay for this call, so the SSE order update -- which the server
  // sends before it replies -- leaves the outcome to the reply below.
  state._overlayOwner = body.serviceId;

  try {
    const controller = new AbortController();
    state._abortController = controller;

    const res = await fetch('/api/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await res.json();
    state.pendingServiceId = null;
    state._abortController = null;
    state._overlayOwner = null;
    showApiResponse('Payment', data.adyenResponse || data);

    if (data.order) {
      const paid = data.order.status === 'paid';
      showOverlayResult(paid, paymentOutcomeMessage(data.order));
      if (paid) clearCart();
    } else if (data.error) {
      syncTerminalStateFromError(data);
      showOverlayResult(false, data.error);
    }
  } catch (err) {
    state._abortController = null;
    state._overlayOwner = null;
    if (err.name === 'AbortError') {
      // User cancelled the fetch — allow SSE to log the response
      if (state._syncLogged) delete state._syncLogged[body.serviceId];
      showOverlayResult(false, 'Payment Cancelled');
    } else {
      showOverlayResult(false, `Error: ${err.message}`);
    }
  }
}

async function payAsync(body) {
  try {
    const res = await fetch('/api/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    // Not 'Payment': this is our own server acknowledging the submission, not the
    // terminal's answer. That arrives later over SSE and is logged as 'Payment',
    // which is the entry that actually pairs with the request.
    showApiResponse('Payment submitted', data);

    if (data.orderId) {
      showToast('Payment submitted — waiting for terminal response', 'info');
      clearCart();
    } else if (data.error) {
      syncTerminalStateFromError(data);
      showToast(`Payment error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Payment error: ${err.message}`, 'error');
  }
}

// ====================== Query Order Status (from order list) ======================
async function queryOrderStatus(serviceId, btnEl) {
  // The label carries an icon, so it is put back as markup. Assigning textContent
  // to restore it would drop the icon for good: these buttons are rendered from
  // `data-lucide` placeholders that only become an svg once per render.
  const original = btnEl.innerHTML;
  try {
    btnEl.disabled = true;
    btnEl.textContent = 'Checking...';
    // Mark before fetch to prevent SSE race condition
    if (!state._syncLogged) state._syncLogged = {};
    state._syncLogged[serviceId] = true;

    const res = await fetch('/api/transaction-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId })
    });
    const data = await res.json();
    showApiResponse('Transaction status', data);

    // A refused or timed-out call carries no TransactionStatusResponse at all, so
    // without this the failure passed silently and the button just re-enabled.
    if (!res.ok) {
      syncTerminalStateFromError(data);
      showRequestError(data, 'Status check failed');
      return;
    }

    const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
    const result = statusResp?.Response?.Result;

    // Every branch has to say something. In async mode there is no overlay, so this
    // toast is the only place an answer appears -- and the log entry it would
    // otherwise hide in arrives collapsed.
    if (result === 'Success') {
      const paymentResp = statusResp?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
      const payResult = paymentResp?.Response?.Result;
      if (payResult === 'Success') {
        showToast('Payment successful!', 'success');
      } else if (payResult) {
        const errCond = paymentResp.Response?.ErrorCondition;
        const msg = (errCond === 'Aborted' || errCond === 'Cancel') ? 'Payment cancelled' : 'Payment failed';
        showToast(msg, 'warning');
      } else {
        showToast('The terminal knows this order but reported no payment — see the API log', 'warning');
      }
    } else if (result === 'Failure') {
      const errCond = statusResp?.Response?.ErrorCondition;
      if (errCond === 'InProgress') {
        showToast('Transaction still in progress on terminal', 'info');
      } else {
        showToast(`Status: ${errCond || 'Unknown'}`, 'warning');
      }
    } else {
      showToast('No transaction status came back — see the API log', 'warning');
    }
  } catch (err) {
    showToast(`Status check failed: ${err.message}`, 'error');
  } finally {
    btnEl.disabled = false;
    btnEl.innerHTML = original;
  }
}

// ====================== Cancel Order ======================
async function cancelOrder(serviceId, btnEl) {
  const original = btnEl.innerHTML;
  try {
    btnEl.disabled = true;
    btnEl.textContent = 'Cancelling...';

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId })
    });
    const data = await res.json();
    showApiResponse(cancelTitle(data.adyenResponse), data.adyenResponse || data);
    if (!res.ok) {
      syncTerminalStateFromError(data);
      showRequestError(data, 'Cancel failed');
      return;
    }
    // Deliberately not 'Cancelled'. The terminal may be past the point of no
    // return, in which case the sale completes and its PaymentResponse -- not this
    // reply -- settles the order.
    showToast(data.accepted
      ? 'Cancelling — waiting for the terminal'
      : 'The terminal refused the cancel — check the order status', data.accepted ? 'info' : 'warning');
  } catch (err) {
    showToast(`Cancel failed: ${err.message}`, 'error');
  } finally {
    btnEl.disabled = false;
    btnEl.innerHTML = original;
  }
}

// ====================== Check Transaction Status ======================
async function checkTransactionStatus() {
  if (!state.pendingServiceId) {
    showToast('No pending transaction to check', 'warning');
    return;
  }

  const serviceId = state.pendingServiceId;

  try {
    $btnCheckStatus.disabled = true;
    $btnCheckStatus.textContent = 'Checking...';
    // Same claim paySync makes: this call resolves the order server-side, so its
    // SSE update must not race the wording chosen below.
    state._overlayOwner = serviceId;

    const res = await fetch('/api/transaction-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId })
    });
    const data = await res.json();
    showApiResponse('Transaction status', data);

    const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
    const result = statusResp?.Response?.Result;

    if (result === 'Success') {
      // Transaction completed — check repeated response
      const paymentResp = statusResp?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
      if (paymentResp) {
        // The server resolved the order from this same response and pushed it over
        // SSE, so the settled copy in state carries the status and the readable
        // reason. Reading it back keeps one vocabulary for the outcome instead of a
        // third phrasing built from the raw ErrorCondition here.
        const paid = paymentResp.Response?.Result === 'Success';
        const settled = state.orders.find(o => o.serviceId === serviceId);
        showOverlayResult(paid, settled
          ? paymentOutcomeMessage(settled)
          : (paid ? 'Payment successful' : 'Payment failed'));
        if (paid) clearCart();
        state.pendingServiceId = null;
      }
    } else if (result === 'Failure') {
      const errCond = statusResp?.Response?.ErrorCondition;
      if (errCond === 'InProgress') {
        $overlayMsg.textContent = 'Transaction still in progress on terminal...';
        showToast('Transaction still in progress', 'info');
      } else {
        $overlayMsg.textContent = `Status: ${errCond || 'Unknown'}`;
        showToast(`Transaction status: ${errCond || 'Unknown'}`, 'warning');
      }
    }
  } catch (err) {
    showToast(`Status check failed: ${err.message}`, 'error');
  } finally {
    // Only if nothing else holds it: this button is reachable while a sync payment
    // is still waiting on the same order, and that call needs its claim kept.
    if (!state._abortController) state._overlayOwner = null;
    $btnCheckStatus.disabled = false;
    $btnCheckStatus.textContent = 'Check Status';
  }
}

// ====================== Cancel Payment ======================
// How long the dialog waits for /api/cancel before offering a way out of it.
//
// An AbortRequest is answered by Adyen, and that answer has been seen to take tens
// of seconds. Nothing is wrong when it does: the abort is best-effort, the server
// repeats it while the order is pending, and only the PaymentResponse settles the
// sale. So the wait buys the cashier nothing beyond this point, and the till is
// more useful back in their hands than holding a spinner.
const CANCEL_SLOW_MS = 10000;

async function cancelPayment() {
  if (!state.pendingServiceId) {
    // If we have an abort controller, abort the fetch
    if (state._abortController) {
      state._abortController.abort();
    }
    return;
  }

  // Hands the message line over to the cancel for the rest of this payment, so the
  // terminal's display notifications cannot narrate over it.
  state._cancelling = true;

  // Not cleared on the way out of this function: the fetch below is deliberately
  // left running when the dialog is put away, and its own completion hides it.
  const slowTimer = setTimeout(() => {
    $overlayMsg.textContent = 'The terminal has not answered the cancel yet. It keeps being asked.';
    $btnDetachOverlay.classList.remove('hidden');
  }, CANCEL_SLOW_MS);

  try {
    $btnCancelPay.disabled = true;
    $btnCancelPay.textContent = 'Cancelling...';

    const cancelRes = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: state.pendingServiceId })
    });
    const cancelData = await cancelRes.json();
    showApiResponse(cancelTitle(cancelData.adyenResponse), cancelData.adyenResponse || cancelData);

    if (!cancelRes.ok) {
      syncTerminalStateFromError(cancelData);
      showToast(cancelData.error || 'Cancel failed', 'error');
      $btnCancelPay.disabled = false;
      $btnCancelPay.textContent = 'Cancel Payment';
      return;
    }

    // The in-flight /api/payment fetch used to be aborted here, which threw away
    // the one message that says what the terminal actually did. If the abort came
    // too late the shopper still pays, and the overlay had already claimed the
    // sale was cancelled. It now stays open until the PaymentResponse arrives.
    $overlayMsg.textContent = cancelData.accepted
      ? 'Cancelling — waiting for the terminal'
      : 'The terminal refused the cancel — the sale may still complete';

    // Left disabled, and named for what is still happening rather than for the one
    // message that has gone out: the server repeats the abort until the terminal
    // settles the order, so this is not finished at the point it is shown.
    $btnCancelPay.textContent = 'Cancelling…';
    showToast('Cancelling — waiting for the terminal', 'warning');
  } catch (err) {
    showToast(`Cancel failed: ${err.message}`, 'error');
    $btnCancelPay.disabled = false;
    $btnCancelPay.textContent = 'Cancel Payment';
  } finally {
    // The answer is here, so there is nothing left to walk away from.
    clearTimeout(slowTimer);
    $btnDetachOverlay.classList.add('hidden');
  }
}

// ====================== Refund ======================
let _refundOrderId = null;
const $refundAmountRow = document.getElementById('refund-amount-row');
const $refundAmountInput = document.getElementById('refund-amount-input');
const $refundTypeRadios = document.querySelectorAll('input[name="refund-type"]');

$refundTypeRadios.forEach(r => r.addEventListener('change', () => {}));

const $refundPsp = document.getElementById('refund-modal-psp');
const $refundModalAmount = document.getElementById('refund-modal-amount');
const $refundModalRefunded = document.getElementById('refund-modal-refunded');
const $refundModalRemaining = document.getElementById('refund-modal-remaining');
const $refundTypeUnref = document.getElementById('refund-type-unreferenced');

function promptRefund(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  // A Tap to Pay refund is bound to the boarded device rather than to a terminal
  // in the list, so it is checked against the installation instead.
  if (order.viaTapToPay) {
    const blocked = ttpActionBlock(order);
    if (blocked) { showToast(blocked, 'warning'); return; }
  } else if (!ensureTerminalMatch(order)) {
    return;
  }
  _refundOrderId = orderId;
  const cur = state.config.currency || 'EUR';
  const refunded = order.refundedAmount || 0;
  const remaining = order.amount - refunded;

  $refundPsp.textContent = `PSP: ${order.pspReference || '—'}`;
  $refundModalAmount.textContent = `Amount: ${cur} ${order.amount.toFixed(2)}`;
  if (refunded > 0) {
    $refundModalRefunded.textContent = `Refunded: ${cur} ${refunded.toFixed(2)}`;
    $refundModalRemaining.textContent = `Remaining: ${cur} ${remaining.toFixed(2)}`;
    $refundModalRefunded.classList.remove('hidden');
    $refundModalRemaining.classList.remove('hidden');
  } else {
    $refundModalRefunded.classList.add('hidden');
    $refundModalRemaining.classList.add('hidden');
  }

  $refundAmountInput.value = remaining.toFixed(2);
  $refundAmountInput.max = remaining;
  document.querySelector('input[name="refund-type"][value="referenced"]').checked = true;
  $refundAmountRow.classList.remove('hidden');

  // Unreferenced refunds go out over the cloud Terminal API, which cannot reach
  // the Payments app, so Tap to Pay orders are offered the referenced route only.
  const isCard = !order.paymentBrand || !order.paymentBrand.match(/duitnow|paynow|alipay|wechat|grabpay/i);
  $refundTypeUnref.style.display = isCard && !order.viaTapToPay ? '' : 'none';

  $refundModal.classList.remove('hidden');
}

const $refundResult = document.getElementById('refund-result');
const $btnRefundClose = document.getElementById('btn-refund-close');

function setRefundModalState(mode) {
  // mode: 'input' | 'processing' | 'done'
  const inputEls = [$refundAmountRow, document.querySelector('.refund-type-row')];
  $btnRefundOk.classList.toggle('hidden', mode !== 'input');
  $btnRefundCancel.classList.toggle('hidden', mode !== 'input');
  $btnRefundClose.classList.toggle('hidden', mode === 'input' || mode === 'processing');
  inputEls.forEach(el => { if (el) el.style.pointerEvents = mode === 'input' ? '' : 'none'; });
  if (mode === 'input') {
    $refundResult.classList.add('hidden');
  }
}

// A Tap to Pay refund cannot be awaited the way a cloud one is: handing over to
// the Payments app navigates this page away, and the outcome arrives as a fresh
// page load at /ttp/refund. What the refund was for is parked on the order by the
// server, because nothing in this tab survives the handover.
async function ttpStartRefund(order, amount) {
  const installationId = localStorage.getItem('ttp_installationId') || '';
  setRefundModalState('processing');
  $refundResult.className = 'refund-result processing';
  $refundResult.textContent = 'Opening the Payments app…';
  $refundResult.classList.remove('hidden');

  const fail = (msg) => {
    $refundResult.className = 'refund-result error';
    $refundResult.textContent = msg;
    setRefundModalState('done');
    _refundOrderId = null;
  };

  try {
    const res = await fetch('/api/taptopay/refund-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, amount, installationId })
    });
    const data = await res.json();
    if (!res.ok || !data.request) {
      showApiResponse('Tap to Pay — refund request', data);
      fail(data.error || 'Could not build the refund request');
      return;
    }
    window.location.href =
      `${TTP_LINK_BASE}/nexo?request=${data.request}&returnUrl=${encodeURIComponent(ttpReturnUrl('refund'))}`;
  } catch (err) {
    fail(`Refund error: ${err.message}`);
  }
}

async function executeRefund() {
  if (!_refundOrderId) return;
  const refundType = document.querySelector('input[name="refund-type"]:checked').value;

  const amount = parseFloat($refundAmountInput.value);
  if (!amount || amount <= 0) {
    showToast('Invalid refund amount', 'warning');
    return;
  }

  // The Payments app is only reachable over the App Link, never over the cloud
  // endpoint the two /api/refund routes use.
  const refundOrder = state.orders.find(o => o.id === _refundOrderId);
  if (refundOrder?.viaTapToPay) return ttpStartRefund(refundOrder, amount);

  setRefundModalState('processing');
  $refundResult.className = 'refund-result processing';
  $refundResult.textContent = 'Processing refund...';
  $refundResult.classList.remove('hidden');

  try {
    let res, data;
    const url = refundType === 'unreferenced' ? '/api/refund/unreferenced' : '/api/refund';
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: _refundOrderId, amount })
    });
    data = await res.json();
    showApiResponse('Refund', data.adyenResponse || data);

    if (data.order && (data.order.status === 'refunded' || data.order.status === 'partially_refunded')) {
      const msg = data.order.status === 'refunded'
        ? 'Refund successful'
        : `Partial refund successful (${data.order.refundedAmount?.toFixed(2)} / ${data.order.amount?.toFixed(2)})`;
      $refundResult.className = 'refund-result success';
      $refundResult.textContent = msg;
    } else {
      syncTerminalStateFromError(data);
      $refundResult.className = 'refund-result error';
      $refundResult.textContent = data.order?.status || data.error || 'Refund failed';
    }
  } catch (err) {
    $refundResult.className = 'refund-result error';
    $refundResult.textContent = `Error: ${err.message}`;
  }
  setRefundModalState('done');
  _refundOrderId = null;
}

// ====================== Overlay helpers ======================
// Tracked so a new payment cannot be closed by the previous one's timer.
let _overlayHideTimer = null;

// Set once the cashier has put the dialog away while the payment it describes is
// still running. The outcome still arrives -- the sync request and the SSE update
// both report it -- but reopening the dialog for it would put a modal back on
// screen minutes later, over whatever is being done by then. It becomes a toast
// instead. Cleared by the next payment, which owns the dialog again.
let _overlayDetached = false;

function showOverlay(amount, currency) {
  clearTimeout(_overlayHideTimer);
  _overlayDetached = false;
  state._cancelling = false;
  const cur = currency || state.config.currency || 'EUR';
  $overlaySpinner.classList.remove('hidden');
  $overlayTitle.textContent = 'Processing Payment';
  $overlayMsg.textContent = 'Please complete the payment on the terminal...';
  $overlayAmount.textContent = `${cur} ${amount.toFixed(2)}`;
  $overlayResult.classList.add('hidden');
  $btnCheckStatus.classList.remove('hidden');
  $btnCheckStatus.disabled = false;
  $btnCheckStatus.textContent = 'Check Status';
  $btnCancelPay.classList.remove('hidden');
  $btnCancelPay.disabled = false;
  $btnCancelPay.textContent = 'Cancel Payment';
  $btnDetachOverlay.classList.add('hidden');
  $btnCloseOverlay.classList.add('hidden');
  $overlay.classList.remove('hidden');
}

// Waiting on an answer for a payment that is already over. Tap to Pay comes back
// this way: the browser reloads after the Payments app is done, so there is no
// amount left to show and nothing to cancel. That makes showOverlay wrong here --
// it is built around a payment still running on a terminal.
function showOverlayWorking(message) {
  clearTimeout(_overlayHideTimer);
  _overlayDetached = false;
  $overlaySpinner.classList.remove('hidden');
  $overlayTitle.textContent = 'Payment Result';
  $overlayMsg.textContent = message;
  $overlayAmount.textContent = '';
  $overlayResult.classList.add('hidden');
  $btnCheckStatus.classList.add('hidden');
  $btnCancelPay.classList.add('hidden');
  $btnDetachOverlay.classList.add('hidden');
  $btnCloseOverlay.classList.add('hidden');
  $overlay.classList.remove('hidden');
}

function showOverlayResult(success, message) {
  clearTimeout(_overlayHideTimer);
  // Put away while this was still running, so it is reported without being pushed
  // back in front of whatever replaced it.
  if (_overlayDetached) {
    showToast(message, success ? 'success' : 'warning');
    return;
  }
  $overlaySpinner.classList.add('hidden');
  $overlayTitle.textContent = success ? 'Payment Complete' : 'Payment Not Completed';
  $overlayMsg.textContent = '';
  $overlayResult.textContent = message;
  $overlayResult.className = `overlay-result ${success ? 'success' : 'failure'}`;
  $overlayResult.classList.remove('hidden');
  $btnCheckStatus.classList.add('hidden');
  $btnCancelPay.classList.add('hidden');
  $btnDetachOverlay.classList.add('hidden');
  $btnCloseOverlay.classList.remove('hidden');
  // Every other caller reaches here from showOverlay, which has already revealed
  // the dialog. The Tap to Pay return has not, so this cannot assume it is visible.
  $overlay.classList.remove('hidden');

  // A success has nothing left to read, so it clears itself and hands the till
  // back. A failure stays up until it is dismissed, because the reason on screen
  // is the only thing telling the cashier what to do next.
  if (success) _overlayHideTimer = setTimeout(hideOverlay, 2500);
}

function hideOverlay() {
  clearTimeout(_overlayHideTimer);
  $overlay.classList.add('hidden');
}

// Puts the dialog away while the payment behind it is still live. The cancel
// request is deliberately left in flight: the server needs its answer to keep
// repeating the abort, and the order list updates over SSE either way. The result
// arrives as a toast once it lands.
function detachOverlay() {
  _overlayDetached = true;
  hideOverlay();
  showToast('Still cancelling in the background — the order list will show the result', 'info');
}

// ====================== API Response Display ======================
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast('Copied to clipboard', 'success');
  } catch (err) {
    showToast(`Copy failed: ${err.message}`, 'error');
  }
}

// Receipt content dwarfs everything else in a payload: dozens of line objects in a
// response, and a base64 logo in a print request. The log summarises it so the
// result, amounts and AdditionalResponse stay in view. Only the log is affected —
// the response stored on the order is untouched, so printing still works from it.
function summariseReceipts(key, value) {
  if (key === 'PaymentReceipt' && Array.isArray(value)) {
    const lines = value.reduce((n, r) => n + (r?.OutputContent?.OutputText?.length || 0), 0);
    const kinds = value.map(r => r?.DocumentQualifier).filter(Boolean).join(', ');
    return `[omitted from the log: ${kinds || `${value.length} receipts`} — ${lines} lines]`;
  }
  // A print request carries the rendered receipt as OutputText. Short ones are kept:
  // the loyalty confirmation prompt is four entries and is worth reading.
  if (key === 'OutputText' && Array.isArray(value) && value.length > LOG_MAX_OUTPUT_LINES) {
    return `[omitted from the log: ${value.length} lines]`;
  }
  // The receipt logo travels as base64-encoded XHTML, which is unreadable and can
  // run to hundreds of kilobytes.
  if (key === 'OutputXHTML' && typeof value === 'string' && value.length > 200) {
    return `[omitted from the log: ${value.length} chars of base64 XHTML]`;
  }
  return value;
}

// Inlined rather than `data-lucide` placeholders: entries arrive several times per
// payment, and lucide.createIcons() rescans the whole document on every call.
const LOG_CHEVRON_SVG = '<svg class="log-entry-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const LOG_COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

// Adyen answers an AbortRequest with the plain text 'ok' rather than a
// SaleToPOIResponse, which arrives here as { raw: 'ok', status: 200 } because there
// was no JSON to parse. That is an acknowledgement that the abort message was
// taken, and specifically not a statement that the payment stopped -- the
// PaymentResponse decides that, later. The title says only what the reply says.
function cancelTitle(adyenResponse) {
  return adyenResponse?.raw === 'ok' ? 'Cancel received' : 'Cancel';
}

function showApiResponse(label, data, direction = 'response') {
  const time = new Date().toLocaleTimeString();
  const json = JSON.stringify(data, summariseReceipts, 2);

  // Remove empty placeholder
  const empty = $apiResponse.querySelector('.log-empty');
  if (empty) empty.remove();

  const isRequest = direction === 'request';

  const entry = document.createElement('div');
  // Collapsed on arrival. Entries land unprompted, several per payment, and an
  // expanded payload is long enough to push whatever was being read off screen.
  entry.className = `log-entry log-entry-${isRequest ? 'request' : 'response'} is-collapsed`;

  const header = document.createElement('div');
  header.className = 'log-entry-header';
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  header.setAttribute('aria-expanded', 'false');
  header.title = 'Show payload';
  header.insertAdjacentHTML('beforeend', LOG_CHEVRON_SVG);

  // Three letters, not an arrow: ↑ and ↓ are mirror images that differ on a single
  // axis, so at this size the direction had to be worked out rather than read.
  const tag = document.createElement('span');
  tag.className = 'log-entry-tag';
  tag.textContent = isRequest ? 'REQ' : 'RES';
  tag.title = isRequest ? 'Request' : 'Response';

  const title = document.createElement('span');
  title.className = 'log-entry-title';
  title.textContent = label;
  // The header truncates rather than wraps, so keep the full label reachable.
  title.title = label;

  // Out of the title and right-aligned: it is the same width on every row, so it
  // costs the label nothing once it stops sharing the same text node.
  const timeEl = document.createElement('span');
  timeEl.className = 'log-entry-time';
  timeEl.textContent = time;

  // Copying used to be a double-click on the payload, which nothing advertised and
  // which fought with selecting a single field out of the JSON.
  const copyBtn = document.createElement('button');
  copyBtn.className = 'log-entry-copy';
  copyBtn.type = 'button';
  copyBtn.title = 'Copy JSON';
  copyBtn.setAttribute('aria-label', 'Copy JSON');
  copyBtn.innerHTML = LOG_COPY_SVG;
  copyBtn.addEventListener('click', (e) => {
    // The button sits inside the disclosure control, so its click must not also
    // open the entry.
    e.stopPropagation();
    copyToClipboard(json);
  });

  header.append(tag, title, timeEl, copyBtn);

  const toggle = () => {
    const collapsed = entry.classList.toggle('is-collapsed');
    header.setAttribute('aria-expanded', String(!collapsed));
    header.title = collapsed ? 'Show payload' : 'Hide payload';
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  const body = document.createElement('pre');
  body.className = 'log-entry-body';
  body.textContent = json;

  entry.appendChild(header);
  entry.appendChild(body);

  $apiResponse.insertBefore(entry, $apiResponse.firstChild);

  // Now that requests are logged alongside responses the panel fills about twice
  // as fast, and a receipt print alone adds three entries. Drop the oldest beyond
  // a cap so a long shift cannot grow the DOM without bound.
  const entries = $apiResponse.querySelectorAll('.log-entry');
  for (let i = LOG_MAX_ENTRIES; i < entries.length; i++) entries[i].remove();
}

// ====================== Clear Orders ======================
async function clearOrders() {
  if (state.orders.length === 0) return;
  try {
    await fetch('/api/orders', { method: 'DELETE' });
    state.orders = [];
    renderOrders();
    showToast('Orders cleared', 'info');
  } catch (err) {
    showToast(`Failed to clear: ${err.message}`, 'error');
  }
}

// ====================== Toast ======================
// A short-lived popup for things that happen inside a modal, where the inline
// notification bar is covered by the overlay.
function showFloatingToast(msg, type = 'info', duration = 2000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    // Removed on the animation end rather than a second timer, so the node cannot
    // be left behind if the animation is skipped.
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// `content` is either a string or a list of nodes, for the callers that need part
// of the message emphasised. The idle class is restored rather than the bar being
// hidden, so the layout does not shift as messages come and go.
function showBanner(content, type = 'info', duration = 5000) {
  const bar = document.getElementById('notification-bar');
  if (Array.isArray(content)) bar.replaceChildren(...content);
  else bar.textContent = content;
  bar.className = `notification-bar notification-${type}`;
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => {
    bar.textContent = '\u00A0';
    bar.className = 'notification-bar notification-idle';
  }, duration);
}

function showToast(msg, type = 'info', duration = 5000) {
  showBanner(msg, type, duration);
}

// A timeout names a wait the reader has just sat through and asks them to retry, so
// it is held a second longer than an error that is over and done with.
function showRequestError(data, fallback) {
  const timedOut = data && data.code === 'ADYEN_TIMEOUT';
  showToast((data && data.error) || fallback, 'error', timedOut ? 6000 : 5000);
}

// ====================== Event Binding ======================
function bindEvents() {
  // Product clicks
  $productGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (card) addToCart(card.dataset.id);
  });

  $btnClearCart.addEventListener('click', clearCart);
  $btnPay.addEventListener('click', initiatePayment);
  $btnCheckTerm.addEventListener('click', checkTerminal);
  $btnAddTerm.addEventListener('click', addTerminals);
  $btnPaymethodCancel.addEventListener('click', closePaymethodModal);
  $paymethodModal.querySelectorAll('.paymethod-btn').forEach(btn => {
    btn.addEventListener('click', () => processPayment(btn.dataset.brand || '', btn.dataset.entryMode || ''));
  });
  $btnClearDisplay.addEventListener('click', clearTerminalDisplay);
  $btnReceiptOpen.addEventListener('click', openReceiptModal);
  $btnReceiptClose.addEventListener('click', closeReceiptModal);
  $btnLogoUpload.addEventListener('click', () => $inputLogoFile.click());
  $btnLogoReset.addEventListener('click', resetReceiptLogo);
  $btnQrSave.addEventListener('click', saveQrUrl);
  $btnQrReset.addEventListener('click', resetQrUrl);
  $inputQrUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveQrUrl(); });
  $inputLogoFile.addEventListener('change', async (e) => {
    await uploadReceiptLogo(e.target.files[0]);
    // Clear the value so picking the same file again still fires a change event.
    e.target.value = '';
  });
  $btnLoyaltyOpen.addEventListener('click', openLoyaltyModal);
  $btnLoyaltyClose.addEventListener('click', closeLoyaltyModal);
  $btnLoyaltyRead.addEventListener('click', loyaltyReadCard);
  $btnLoyaltyCancel.addEventListener('click', loyaltyAbortRead);
  $btnLoyaltyPay.addEventListener('click', () => loyaltyPay(0));
  $btnLoyaltyCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($loyaltyAlias.value);
      showToast('Alias copied', 'success');
    } catch {
      // Clipboard access needs a secure context, so fall back to selecting it.
      $loyaltyAlias.select();
      showToast('Press Cmd/Ctrl+C to copy the alias', 'info');
    }
  });
  $btnUserdataOpen.addEventListener('click', openUserDataModal);
  $btnUserdataClose.addEventListener('click', closeUserDataModal);
  $btnUserdataAdd.addEventListener('click', addMember);
  $btnUserdataSave.addEventListener('click', saveMembers);
  $btnClearOrders.addEventListener('click', clearOrders);
  $orderSearch.addEventListener('input', () => renderOrders());

  // Delegated, because the list is rebuilt from scratch on every order update: a
  // listener bound to each card would be thrown away seconds later. The actions row
  // is excluded as a whole rather than just its buttons, because a disabled button
  // passes its click to the wrapper that carries the tooltip.
  $orderList.addEventListener('click', (e) => {
    if (e.target.closest('.order-card-actions')) return;
    const card = e.target.closest('.order-card');
    if (card) openOrderDetail(card.dataset.orderId);
  });
  $btnOrderDetailClose.addEventListener('click', closeOrderDetail);
  // The backdrop is part of the overlay element, so a click that lands on it and
  // not on the dialog inside means "dismiss".
  $orderDetailModal.addEventListener('click', (e) => {
    if (e.target === $orderDetailModal) closeOrderDetail();
  });
  $btnClearResp.addEventListener('click', () => { $apiResponse.innerHTML = '<span class="log-empty">No response yet</span>'; });
  $btnToggleLog.addEventListener('click', () => {
    $rightCol.classList.toggle('hidden');
    $btnToggleLog.classList.toggle('btn-primary');
    $btnToggleLog.classList.toggle('btn-outline');
  });

  $toggleAsync.addEventListener('change', (e) => {
    state.isAsync = e.target.checked;
    localStorage.setItem('posAsyncMode', state.isAsync);
    const displayEl = document.getElementById('terminal-display');
    displayEl.style.display = state.isAsync ? '' : 'none';
    if (!state.isAsync) {
      clearTerminalDisplay();
    }
    showToast(state.isAsync ? 'Switched to Async mode' : 'Switched to Sync mode', 'info');
  });

  $btnLogout.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Mobile: Orders overlay toggle
  const $ordersToggle = document.getElementById('btn-orders-toggle');
  const $ordersClose = document.getElementById('btn-orders-close');
  const $orderPanel = document.getElementById('order-panel');
  if ($ordersToggle && $orderPanel) {
    $ordersToggle.addEventListener('click', () => $orderPanel.classList.add('open'));
  }
  if ($ordersClose && $orderPanel) {
    $ordersClose.addEventListener('click', () => $orderPanel.classList.remove('open'));
  }

  // Overlay
  $btnCheckStatus.addEventListener('click', checkTransactionStatus);
  $btnCancelPay.addEventListener('click', cancelPayment);
  $btnDetachOverlay.addEventListener('click', detachOverlay);
  $btnCloseOverlay.addEventListener('click', hideOverlay);

  // Refund modal
  $btnRefundOk.addEventListener('click', executeRefund);
  $btnRefundCancel.addEventListener('click', () => {
    setRefundModalState('input');
    $refundModal.classList.add('hidden');
    _refundOrderId = null;
  });
  $btnRefundClose.addEventListener('click', () => {
    setRefundModalState('input');
    $refundModal.classList.add('hidden');
  });
}

// ====================== Tap to Pay (Android Payments app) ======================
const TTP_LINK_BASE = 'https://www.adyen.com/test';
const TTP = {};

function ttpB64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ttpReturnUrl(step) {
  return window.location.origin + '/ttp/' + step;
}

function initTapToPay() {
  TTP.modal        = document.getElementById('ttp-modal');
  TTP.openBtn      = document.getElementById('btn-ttp-open');
  TTP.closeBtn     = document.getElementById('btn-ttp-close');
  TTP.storeInput   = document.getElementById('ttp-store-id');
  TTP.status       = document.getElementById('ttp-status');
  TTP.statusText   = document.getElementById('ttp-status-text');
  TTP.installation = document.getElementById('ttp-installation');
  TTP.btnBoard     = document.getElementById('btn-ttp-board');
  TTP.btnPay       = document.getElementById('btn-ttp-pay');
  TTP.btnRevoke    = document.getElementById('btn-ttp-revoke');
  TTP.hint         = document.getElementById('ttp-hint');
  TTP.amount       = document.getElementById('ttp-amount');
  TTP.message      = document.getElementById('ttp-message');
  if (!TTP.storeInput) return;

  const savedStore = localStorage.getItem('ttp_storeId');
  const defaultStore = (state.config.tapToPay && state.config.tapToPay.defaultStoreId) || '';
  TTP.storeInput.value = savedStore || defaultStore;
  TTP.storeInput.addEventListener('change', () => {
    localStorage.setItem('ttp_storeId', TTP.storeInput.value.trim());
  });

  TTP.openBtn.addEventListener('click', openTtpModal);
  TTP.closeBtn.addEventListener('click', closeTtpModal);
  TTP.modal.addEventListener('click', (e) => { if (e.target === TTP.modal) closeTtpModal(); });
  TTP.btnBoard.addEventListener('click', ttpStartBoarding);
  TTP.btnPay.addEventListener('click', ttpStartPayment);
  TTP.btnRevoke.addEventListener('click', ttpRevoke);

  renderTtpStatus();
}

// The Adyen Payments app exists only on Android, and the App Link handover it
// relies on cannot work on any other platform, so Tap to Pay is blocked there.
function isAndroidDevice() {
  const uaData = navigator.userAgentData;
  if (uaData && typeof uaData.platform === 'string' && uaData.platform) {
    return /android/i.test(uaData.platform);
  }
  return /android/i.test(navigator.userAgent);
}

function openTtpModal() {
  ttpMessage('');
  renderTtpStatus();
  if (!isAndroidDevice()) {
    ttpMessage(
      'Not supported on this device.\n\n' +
      'Tap to Pay requires an Android device with the Adyen Payments app installed. ' +
      'Open this page on an Android phone or tablet to board and take payments.',
      'error'
    );
    showToast('Tap to Pay is only supported on Android', 'warning');
  }
  TTP.modal.classList.remove('hidden');
}

function closeTtpModal() {
  TTP.modal.classList.add('hidden');
}

// `mono` is for raw payloads rather than sentences: the class list is rebuilt from
// scratch here, so the modifier has to be applied in the same place.
function ttpMessage(msg, type = 'info', mono = false) {
  if (!TTP.message) return;
  if (!msg) { TTP.message.classList.add('hidden'); TTP.message.textContent = ''; return; }
  TTP.message.textContent = msg;
  TTP.message.className = `ttp-message ttp-message-${type}${mono ? ' ttp-message-mono' : ''}`;
}

function renderTtpStatus() {
  if (!TTP.status) return;
  const installationId = localStorage.getItem('ttp_installationId') || '';
  if (installationId) {
    TTP.status.className = 'ttp-status ttp-status-boarded';
    TTP.statusText.textContent = 'Boarded';
    TTP.installation.classList.remove('hidden');
    TTP.installation.textContent = 'Installation ID: ' + installationId;
    TTP.btnBoard.textContent = 'Re-board this device';
    TTP.btnPay.classList.remove('hidden');
    TTP.btnRevoke.classList.remove('hidden');

    // Show the amount that will be charged (current cart total)
    const cur = state.config.currency || 'EUR';
    const total = cartTotal();
    if (total > 0) {
      TTP.amount.classList.remove('hidden');
      TTP.amount.textContent = `Amount to charge: ${cur} ${total.toFixed(2)}`;
      TTP.btnPay.disabled = false;
      TTP.btnPay.textContent = 'Pay with Tap to Pay';
    } else {
      // The disabled button underneath already reads "Pay (cart empty)". A sentence
      // above it saying the same thing was the line carrying the duplication.
      TTP.amount.classList.add('hidden');
      TTP.btnPay.disabled = true;
      TTP.btnPay.textContent = 'Pay (cart empty)';
    }
  } else {
    TTP.status.className = 'ttp-status ttp-status-unboarded';
    TTP.statusText.textContent = 'Not boarded';
    TTP.installation.classList.add('hidden');
    TTP.amount.classList.add('hidden');
    TTP.btnBoard.textContent = 'Board this device';
    TTP.btnPay.classList.add('hidden');
    TTP.btnRevoke.classList.add('hidden');
  }

  // Boarding and paying both hand over to the Android Payments app, so they are
  // disabled on every other platform. Revoking is a plain Management API call,
  // so it stays available to clean up an installation from any device.
  if (!isAndroidDevice()) {
    TTP.btnBoard.disabled = true;
    TTP.btnPay.disabled = true;
  } else {
    TTP.btnBoard.disabled = false;
  }
}

function ttpStartBoarding() {
  if (!isAndroidDevice()) {
    ttpMessage('Not supported on this device — Tap to Pay requires Android.', 'error');
    return;
  }
  const store = TTP.storeInput.value.trim();
  if (!store) { showToast('Please enter a Store ID first', 'warning'); return; }
  localStorage.setItem('ttp_storeId', store);
  const link = `${TTP_LINK_BASE}/boarded?returnUrl=${encodeURIComponent(ttpReturnUrl('check'))}`;
  window.location.href = link;
}

async function ttpStartPayment() {
  if (!isAndroidDevice()) {
    ttpMessage('Not supported on this device — Tap to Pay requires Android.', 'error');
    return;
  }
  const installationId = localStorage.getItem('ttp_installationId') || '';
  if (!installationId) { ttpMessage('Board the device first', 'error'); return; }
  const total = cartTotal();
  if (total <= 0) { ttpMessage('Nothing to charge.', 'error'); return; }
  const items = state.cart.map(c => ({ id: c.product.id, name: c.product.name, price: c.product.price, qty: c.qty }));
  try {
    ttpMessage('Preparing Tap to Pay request...', 'info');
    const res = await fetch('/api/taptopay/payment-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(total * 100) / 100,
        currency: state.config.currency || 'EUR',
        installationId,
        items
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showApiResponse('Tap to Pay — payment request', data);
      ttpMessage(`Error: ${data.error || 'request failed'}`, 'error');
      return;
    }
    ttpMessage('Opening Payments app...', 'info');
    const link = `${TTP_LINK_BASE}/nexo?request=${data.request}&returnUrl=${encodeURIComponent(ttpReturnUrl('pay'))}`;
    window.location.href = link;
  } catch (err) {
    ttpMessage(`Error: ${err.message}`, 'error');
  }
}

// Look up the real server-side state of an installationId at Adyen.
async function ttpLookupInstance(installationId) {
  const store = (TTP.storeInput && TTP.storeInput.value.trim()) || localStorage.getItem('ttp_storeId') || '';
  const res = await fetch(`/api/taptopay/instances?storeId=${encodeURIComponent(store)}`);
  const data = await res.json();
  showApiResponse('Tap to Pay — app instances', data);
  if (!res.ok) throw new Error(data.error || 'could not list app instances');
  const list = data.paymentsApps || data.data || (Array.isArray(data) ? data : []);
  const match = Array.isArray(list)
    ? list.find(i => i && (i.id === installationId || i.installationId === installationId))
    : null;
  return { match, status: (match && match.status) || '' };
}

async function ttpRevoke() {
  const installationId = localStorage.getItem('ttp_installationId') || '';
  if (!installationId) return;
  ttpMessage('Revoking this app instance at Adyen...', 'info');
  try {
    const res = await fetch('/api/taptopay/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId })
    });
    const data = await res.json();
    showApiResponse('Tap to Pay — revoke', data);
    if (!res.ok) {
      ttpMessage(`Revoke failed: ${data.error || 'request failed'}`, 'error');
      showToast(`Revoke failed: ${data.error || ''}`, 'error');
      return;
    }

    // Verify the real state instead of assuming the revoke worked
    let verdict;
    try {
      const { match, status } = await ttpLookupInstance(installationId);
      const st = String(status).toLowerCase();
      if (!match) {
        verdict = `✓ Revoked. Adyen no longer lists this instance for the store.`;
      } else if (st.includes('revoke') || st.includes('inactive')) {
        verdict = `✓ Revoked. Adyen reports status "${status}".`;
      } else {
        verdict = `⚠ Adyen still lists this instance as "${status}". The revoke may not have applied.`;
      }
    } catch (e) {
      verdict = `Revoke accepted, but could not verify state: ${e.message}`;
    }

    localStorage.removeItem('ttp_installationId');
    renderTtpStatus();
    ttpMessage(
      `${verdict}\n\ninstallationId: ${installationId}\n\n` +
      `Note: the Payments app on the device keeps its own local state, so it can still ` +
      `display "boarded" until it next contacts Adyen. A revoked instance cannot transact — ` +
      `you must board the device again.`,
      verdict.startsWith('⚠') ? 'error' : 'info'
    );
    showToast('Revoke completed — see dialog for verified state', 'info');
  } catch (err) {
    ttpMessage(`Revoke error: ${err.message}`, 'error');
    showToast(`Revoke error: ${err.message}`, 'error');
  }
}

// Handles App Link returns at /ttp/check, /ttp/board, /ttp/pay, /ttp/refund.
// Returns true if this page load was an App Link return.
async function handleTtpReturn() {
  const m = window.location.pathname.match(/^\/ttp\/(check|board|pay|refund)$/);
  if (!m) return false;
  const step = m[1];
  const params = new URLSearchParams(window.location.search);
  const all = {}; params.forEach((v, k) => { all[k] = v; });
  const clean = () => history.replaceState({}, '', '/');

  // A transaction short response returns two Base64URL params, `response` and
  // `securityTrailer`. They are read raw from the query string, restoring any '+'
  // that URL decoding turned into a space, so the ciphertext reaches the backend
  // uncorrupted. Payments and refunds come back the same way.
  const rawFrom = (name) => {
    const q = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return q ? decodeURIComponent(q[1]).replace(/ /g, '+') : '';
  };

  if (step === 'check') {
    const boarded = params.get('boarded') === 'true';
    const installationId = params.get('installationId') || '';
    const boardingRequestToken = params.get('boardingRequestToken') || '';
    if (boarded && installationId) {
      localStorage.setItem('ttp_installationId', installationId);
      openTtpModal();
      ttpMessage('Device already boarded.', 'info');
      showToast('Device already boarded', 'success');
      clean(); return true;
    }
    if (!boardingRequestToken) {
      showApiResponse('Tap to Pay — boarding result', all);
      openTtpModal();
      ttpMessage('Boarding check returned no token. See API log.', 'error');
      showToast('Boarding check returned no token', 'error');
      clean(); return true;
    }
    try {
      const store = localStorage.getItem('ttp_storeId') || '';
      const res = await fetch('/api/taptopay/boarding-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardingRequestToken, storeId: store })
      });
      const data = await res.json();
      if (!res.ok || !data.boardingToken) {
        showApiResponse('Tap to Pay — boarding token', data);
        openTtpModal();
        ttpMessage(`Boarding failed: ${data.error || 'no token'}`, 'error');
        showToast(`Boarding failed: ${data.error || 'no token'}`, 'error');
        clean(); return true;
      }
      const link = `${TTP_LINK_BASE}/board?boardingToken=${ttpB64Url(data.boardingToken)}&returnUrl=${encodeURIComponent(ttpReturnUrl('board'))}`;
      window.location.href = link;
      return true; // redirecting to finish boarding
    } catch (err) {
      openTtpModal();
      ttpMessage(`Boarding error: ${err.message}`, 'error');
      showToast(`Boarding error: ${err.message}`, 'error');
      clean(); return true;
    }
  }

  if (step === 'board') {
    const boarded = params.get('boarded') === 'true';
    const installationId = params.get('installationId') || '';
    const error = params.get('error') || '';
    openTtpModal();
    if (boarded && installationId) {
      localStorage.setItem('ttp_installationId', installationId);
      renderTtpStatus();
      ttpMessage('Device boarded successfully.', 'info');
      showToast('Device boarded successfully', 'success');
    } else {
      showApiResponse('Tap to Pay — boarding result', all);
      ttpMessage(`Boarding failed: ${error || 'unknown error'}`, 'error');
      showToast(`Boarding failed: ${error || 'unknown error'}`, 'error');
    }
    clean(); return true;
  }

  if (step === 'refund') {
    const encrypted = rawFrom('response');
    const securityTrailer = rawFrom('securityTrailer');
    showApiResponse('Tap to Pay — refund link', {
      appLink: window.location.href,
      params: all
    });
    clean();
    if (!encrypted) {
      // The Payments app refused the request and sent back a reason instead of a
      // result. The server is still told, so it can release the refund parked on
      // the order — otherwise that order would swallow the next refund's result.
      const appError = params.get('error') || '';
      closeTtpModal();
      showOverlayWorking('Reading the refund result...');
      try {
        const res = await fetch('/api/taptopay/refund-result', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: appError || 'The Payments app returned no result' })
        });
        showApiResponse('Tap to Pay — refund result', await res.json());
      } catch { /* reporting the refusal matters more than logging it */ }
      showOverlayResult(false, appError
        ? `Refund refused: ${appError}`
        : 'The Payments app returned no refund result');
      return true;
    }
    closeTtpModal();
    showOverlayWorking('Reading the refund result...');
    try {
      const res = await fetch('/api/taptopay/refund-result', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: encrypted, securityTrailer })
      });
      const data = await res.json();
      showApiResponse('Tap to Pay — refund result', data);
      if (!res.ok) {
        showOverlayResult(false, `Could not read the response: ${data.error || 'error'}`);
        return true;
      }
      if (data.result === 'Success') {
        const o = data.order;
        showOverlayResult(true, o && o.status === 'partially_refunded'
          ? `Partial refund successful (${(o.refundedAmount || 0).toFixed(2)} / ${(o.amount || 0).toFixed(2)})`
          : 'Refund successful');
      } else {
        showOverlayResult(false, `Refund ${data.result || 'failed'}${data.errorCondition ? ` (${data.errorCondition})` : ''}`);
      }
    } catch (err) {
      showOverlayResult(false, `Could not read the response: ${err.message}`);
    }
    return true;
  }

  if (step === 'pay') {
    const encrypted = rawFrom('response');
    const securityTrailer = rawFrom('securityTrailer');
    // Log the raw incoming App Link before we wipe the URL.
    showApiResponse('Tap to Pay — payment link', {
      appLink: window.location.href,
      pathAndQuery: window.location.pathname + window.location.search,
      params: all
    });
    clean();
    if (encrypted) {
      // A Tap to Pay payment ends in the same dialog every other payment ends in.
      // It used to report into the middle of the boarding dialog, which is where
      // the payment was started from but not where a result belongs -- and it left
      // that dialog sitting open behind the answer.
      closeTtpModal();
      showOverlayWorking('Reading the payment result...');
      try {
        const res = await fetch('/api/taptopay/payment-result', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response: encrypted, securityTrailer })
        });
        const data = await res.json();
        showApiResponse('Tap to Pay — payment result', data);
        if (!res.ok) {
          showOverlayResult(false, `Could not read the response: ${data.error || 'error'}`);
          return true;
        }
        if (data.result === 'Success') {
          showOverlayResult(true, data.order
            ? paymentOutcomeMessage(data.order)
            : 'Payment successful');
        } else {
          showOverlayResult(false, `Payment ${data.result || 'failed'}${data.errorCondition ? ` (${data.errorCondition})` : ''}`);
        }
      } catch (err) {
        showOverlayResult(false, `Could not read the response: ${err.message}`);
      }
      return true;
    }
    // Nothing decryptable came back, so there is no outcome to report -- only the
    // raw return to look at. That is a diagnosis, not a payment result, so it stays
    // in the Tap to Pay dialog rather than borrowing the payment one.
    openTtpModal();
    showApiResponse('Tap to Pay — payment result', all);
    const detail = Object.keys(all).length ? JSON.stringify(all, null, 2) : '(no parameters returned)';
    ttpMessage(`Returned from Payments app:\n\n${detail}`, 'info', true);
    showToast('Tap to Pay returned — see the dialog', 'info');
    return true;
  }
  return false;
}

// ====================== PWA: register service worker ======================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
