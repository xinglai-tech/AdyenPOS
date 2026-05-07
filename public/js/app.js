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
  usbdrive: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="30" y="20" width="40" height="60" rx="4" fill="#3b82f6" stroke="#2563eb" stroke-width="2.5"/>
    <rect x="38" y="80" width="24" height="10" rx="1" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/>
    <rect x="42" y="83" width="5" height="4" rx="1" fill="#64748b"/>
    <rect x="52" y="83" width="5" height="4" rx="1" fill="#64748b"/>
    <circle cx="50" cy="45" r="8" fill="#1d4ed8" stroke="#1e40af" stroke-width="2"/>
    <circle cx="50" cy="45" r="4" fill="#60a5fa"/>
    <rect x="38" y="60" width="24" height="3" rx="1" fill="#2563eb" opacity=".5"/>
    <circle cx="42" y="28" r="2" fill="#93c5fd"/>
  </svg>`,
  usbcable: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="38" width="22" height="14" rx="3" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/>
    <rect x="22" y="42" width="5" height="6" rx="1" fill="#64748b"/>
    <rect x="30" y="42" width="5" height="6" rx="1" fill="#64748b"/>
    <path d="M40 45C50 45 50 35 60 35S70 45 75 45" stroke="#475569" stroke-width="3" fill="none" stroke-linecap="round"/>
    <rect x="75" y="38" width="12" height="14" rx="4" fill="#1e293b" stroke="#0f172a" stroke-width="2"/>
    <rect x="78" y="42" width="6" height="6" rx="1" fill="#38bdf8"/>
    <path d="M40 55C48 55 52 65 60 65S68 55 75 55" stroke="#94a3b8" stroke-width="2" fill="none" stroke-linecap="round" stroke-dasharray="4 3"/>
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
  { id: 'usbcable', name: 'USB Cable', price: 30, color: '#f1f5f9' },
  { id: 'usbdrive', name: 'USB Drive', price: 50, color: '#dbeafe' },
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
const $terminalStatus  = document.getElementById('terminal-status');
const $terminalId      = document.getElementById('terminal-id');
const $btnSwitchTerm   = document.getElementById('btn-switch-terminal');
const $switchModal     = document.getElementById('switch-modal');
const $inputPoiId      = document.getElementById('input-poi-id');
const $switchCurrentId = document.getElementById('switch-modal-current-id');
const $switchError     = document.getElementById('switch-modal-error');
const $btnSwitchOk     = document.getElementById('btn-switch-confirm');
const $btnSwitchCancel = document.getElementById('btn-switch-cancel');
const $toggleAsync     = document.getElementById('toggle-async');
const $orderList       = document.getElementById('order-list');
const $orderCount      = document.getElementById('order-count');
const $btnClearOrders  = document.getElementById('btn-clear-orders');
const $apiResponse     = document.getElementById('api-response');
const $btnClearResp    = document.getElementById('btn-clear-response');
const $btnToggleLog    = document.getElementById('btn-toggle-log');
const $rightCol        = document.getElementById('right-col');
const $btnLogout       = document.getElementById('btn-logout');

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

// Refund modal
const $refundModal     = document.getElementById('refund-modal');
const $refundMsg       = document.getElementById('refund-modal-msg');
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
  renderProducts();
  renderCart();
  $toggleAsync.checked = state.isAsync;
  setupSSE();
  bindEvents();
  checkTerminal();
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

  es.addEventListener('init', (e) => {
    state.orders = JSON.parse(e.data);
    renderOrders();
    _sseReady = true;
    tryRecoverPending();
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
      showApiResponse('Payment Response', order.response);
    }
    // If overlay is waiting for this order's final response, close it
    if (state.pendingServiceId && order.serviceId === state.pendingServiceId && order.status !== 'pending') {
      const success = order.status === 'paid';
      const msg = success ? 'Payment successful' : `Payment ${order.status}`;
      showOverlayResult(success, msg);
      state.pendingServiceId = null;
      setTimeout(hideOverlay, 1800);
    }
  });

  es.addEventListener('eventNotification', (e) => {
    const data = JSON.parse(e.data);
    showToast(`Terminal event: ${data.EventToNotify || 'notification'}`, 'info');
  });

  es.onerror = () => {
    console.warn('SSE connection lost, reconnecting...');
  };
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
function renderOrders() {
  const cur = state.config.currency || 'EUR';
  $orderCount.textContent = state.orders.length;

  if (state.orders.length === 0) {
    $orderList.innerHTML = '<div class="empty-state">No orders yet</div>';
    return;
  }

  $orderList.innerHTML = state.orders.map(o => {
    const itemsSummary = (o.items || []).map(i => `${i.name} x${i.qty}`).join(', ');
    const time = new Date(o.createdAt).toLocaleTimeString();
    const canRefund = (o.status === 'paid' || o.status === 'refund_failed') && o.poiTransactionId;

    return `
      <div class="order-card">
        <div class="order-card-header">
          <span class="order-card-id">ServiceID: ${o.serviceId || '—'}</span>
          <span class="status status-${o.status}">${formatStatus(o.status)}</span>
        </div>
        ${o.pspReference ? `<div class="order-card-psp">PSP: ${o.pspReference}</div>` : ''}
        ${o.tenderReference ? `<div class="order-card-psp">Tender: ${o.tenderReference}</div>` : ''}
        <div class="order-card-items">${itemsSummary || 'No items'}</div>
        <div class="order-card-footer">
          <span class="order-card-amount">${cur} ${(o.amount || 0).toFixed(2)}</span>
          <span class="order-card-time">${time}</span>
        </div>
        ${o.status === 'pending' ? `<button class="btn-check-order" onclick="queryOrderStatus('${o.serviceId}', this)" ${!state.terminalOnline ? 'disabled title="Terminal offline"' : ''}>Check Status</button>` : ''}
        ${canRefund ? `<button class="btn-refund" onclick="promptRefund('${o.id}')" ${!state.terminalOnline ? 'disabled title="Terminal offline"' : ''}>↩ Refund</button>` : ''}
      </div>
    `;
  }).join('');
}

function formatStatus(s) {
  const map = {
    pending: 'Pending', paid: 'Paid', failed: 'Failed',
    cancelled: 'Cancelled', error: 'Error',
    refunded: 'Refunded', refund_failed: 'Refund Failed'
  };
  return map[s] || s;
}

// ====================== Terminal Check ======================
async function checkTerminal() {
  $terminalStatus.className = 'terminal-status checking';
  $terminalStatus.textContent = 'Checking...';
  $terminalId.textContent = '';

  try {
    const res = await fetch('/api/terminals', { method: 'POST' });
    const data = await res.json();

    showApiResponse('Connected Terminals', data);
    const terminals = data.uniqueTerminalIds || [];
    if (terminals.length > 0) {
      state.terminalOnline = true;
      $terminalStatus.className = 'terminal-status online';
      $terminalStatus.textContent = 'Online';
      $terminalId.textContent = terminals.join(', ');
      showToast(`${terminals.length} terminal(s) connected`, 'success');
      _terminalReady = true;
      tryRecoverPending();
    } else {
      state.terminalOnline = false;
      $terminalStatus.className = 'terminal-status offline';
      $terminalStatus.textContent = 'No terminals';
      showToast('No terminals found', 'warning');
    }
  } catch (err) {
    state.terminalOnline = false;
    $terminalStatus.className = 'terminal-status offline';
    $terminalStatus.textContent = 'Error';
    showToast(`Terminal check failed: ${err.message}`, 'error');
  }
  renderProducts();
  renderOrders();
}

// ====================== Switch Terminal ======================
function openSwitchModal() {
  $switchCurrentId.textContent = state.config.poiId || '—';
  $inputPoiId.value = state.config.poiId || '';
  $switchError.classList.add('hidden');
  $switchModal.classList.remove('hidden');
  setTimeout(() => $inputPoiId.focus(), 100);
}

function closeSwitchModal() {
  $switchModal.classList.add('hidden');
}

async function confirmSwitch() {
  const newPoiId = $inputPoiId.value.trim();
  if (!newPoiId) {
    $switchError.textContent = 'Please enter a Terminal ID';
    $switchError.classList.remove('hidden');
    return;
  }

  $switchError.classList.add('hidden');
  $btnSwitchOk.disabled = true;
  $btnSwitchOk.textContent = 'Connecting...';

  try {
    const res = await fetch('/api/switch-terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poiId: newPoiId })
    });
    const data = await res.json();
    showApiResponse('Switch Terminal', data);

    if (!res.ok) {
      $switchError.textContent = data.error || 'Switch failed';
      $switchError.classList.remove('hidden');
      return;
    }

    // Update local config
    state.config.poiId = data.poiId;
    state.terminalOnline = true;
    $terminalStatus.className = 'terminal-status online';
    $terminalStatus.textContent = 'Online';
    $terminalId.textContent = data.poiId;

    closeSwitchModal();
    renderProducts();
    renderOrders();
    showToast(`Switched to ${data.poiId}`, 'success');
  } catch (err) {
    $switchError.textContent = `Connection error: ${err.message}`;
    $switchError.classList.remove('hidden');
  } finally {
    $btnSwitchOk.disabled = false;
    $btnSwitchOk.textContent = 'Connect';
  }
}

// ====================== Recover Pending Orders ======================
async function recoverPendingOrders() {
  const pendingOrders = state.orders.filter(o => o.status === 'pending');
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
      showApiResponse(`TransactionStatus [${order.serviceId}]`, data);

      const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
      const result = statusResp?.Response?.Result;

      if (result === 'Failure' && statusResp?.Response?.ErrorCondition === 'InProgress') {
        // Restore payment overlay so user can monitor or cancel
        showOverlay(order.amount, state.config.currency || 'EUR');
        state.pendingServiceId = order.serviceId;
        $overlayMsg.textContent = `Recovering order ${order.serviceId}...`;
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

async function initiatePayment() {
  const total = cartTotal();
  if (total <= 0) return;

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

  if (state.isAsync) {
    // Async: send and move on
    await payAsync(body);
  } else {
    // Sync: show overlay
    await paySync(body);
  }
}

async function paySync(body) {
  showOverlay(body.amount, body.currency);
  state.pendingServiceId = body.serviceId;
  if (!state._syncLogged) state._syncLogged = {};
  state._syncLogged[body.serviceId] = true;

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
    showApiResponse('Payment (Sync)', data.adyenResponse || data);

    if (data.order) {
      if (data.order.status === 'paid') {
        showOverlayResult(true, 'Payment Successful!');
        clearCart();
      } else {
        const resp = data.adyenResponse?.SaleToPOIResponse?.PaymentResponse?.Response;
        const reason = resp?.ErrorCondition || resp?.AdditionalResponse || 'Payment declined';
        showOverlayResult(false, reason);
      }
    } else if (data.error) {
      showOverlayResult(false, data.error);
    }
  } catch (err) {
    state._abortController = null;
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
    showApiResponse('Payment (Async)', data);

    if (data.orderId) {
      showToast('Payment submitted — waiting for terminal response', 'info');
      clearCart();
    } else if (data.error) {
      showToast(`Payment error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Payment error: ${err.message}`, 'error');
  }
}

// ====================== Query Order Status (from order list) ======================
async function queryOrderStatus(serviceId, btnEl) {
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
    showApiResponse(`TransactionStatus [${serviceId}]`, data);

    const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
    const result = statusResp?.Response?.Result;

    if (result === 'Success') {
      const paymentResp = statusResp?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
      if (paymentResp) {
        const payResult = paymentResp.Response?.Result;
        if (payResult === 'Success') {
          showToast('Payment successful!', 'success');
        } else {
          const errCond = paymentResp.Response?.ErrorCondition;
          const msg = (errCond === 'Aborted' || errCond === 'Cancel') ? 'Payment cancelled' : 'Payment failed';
          showToast(msg, 'warning');
        }
      }
    } else if (result === 'Failure') {
      const errCond = statusResp?.Response?.ErrorCondition;
      if (errCond === 'InProgress') {
        showToast('Transaction still in progress on terminal', 'info');
      } else {
        showToast(`Status: ${errCond || 'Unknown'}`, 'warning');
      }
    }
  } catch (err) {
    showToast(`Status check failed: ${err.message}`, 'error');
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = 'Check Status';
  }
}

// ====================== Check Transaction Status ======================
async function checkTransactionStatus() {
  if (!state.pendingServiceId) {
    showToast('No pending transaction to check', 'warning');
    return;
  }

  try {
    $btnCheckStatus.disabled = true;
    $btnCheckStatus.textContent = 'Checking...';

    const res = await fetch('/api/transaction-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: state.pendingServiceId })
    });
    const data = await res.json();
    showApiResponse(`TransactionStatus [${state.pendingServiceId}]`, data);

    const statusResp = data?.SaleToPOIResponse?.TransactionStatusResponse;
    const result = statusResp?.Response?.Result;

    if (result === 'Success') {
      // Transaction completed — check repeated response
      const paymentResp = statusResp?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
      if (paymentResp) {
        const payResult = paymentResp.Response?.Result;
        if (payResult === 'Success') {
          showOverlayResult(true, 'Payment Successful!');
          clearCart();
        } else {
          const errCond = paymentResp.Response?.ErrorCondition;
          const msg = (errCond === 'Aborted' || errCond === 'Cancel') ? 'Payment Cancelled' : 'Payment Failed';
          showOverlayResult(false, msg);
        }
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
    $btnCheckStatus.disabled = false;
    $btnCheckStatus.textContent = 'Check Status';
  }
}

// ====================== Cancel Payment ======================
async function cancelPayment() {
  if (!state.pendingServiceId) {
    // If we have an abort controller, abort the fetch
    if (state._abortController) {
      state._abortController.abort();
    }
    return;
  }

  try {
    $btnCancelPay.disabled = true;
    $btnCancelPay.textContent = 'Cancelling...';

    const cancelRes = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: state.pendingServiceId })
    });
    const cancelData = await cancelRes.json();
    showApiResponse('Cancel (Abort)', cancelData);

    // Abort the pending sync fetch if exists
    if (state._abortController) {
      state._abortController.abort();
    } else {
      // Recovery scenario: keep overlay open, wait for original transaction response via SSE
      $overlayMsg.textContent = 'Waiting for terminal response...';
    }

    showToast('Cancel request sent', 'warning');
  } catch (err) {
    showToast(`Cancel failed: ${err.message}`, 'error');
  } finally {
    $btnCancelPay.disabled = false;
    $btnCancelPay.textContent = 'Cancel Payment';
  }
}

// ====================== Refund ======================
let _refundOrderId = null;

function promptRefund(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  _refundOrderId = orderId;
  const cur = state.config.currency || 'EUR';
  $refundMsg.textContent = `Refund order #${orderId.slice(0, 8)} for ${cur} ${order.amount.toFixed(2)}?`;
  $refundModal.classList.remove('hidden');
}

async function executeRefund() {
  if (!_refundOrderId) return;
  $refundModal.classList.add('hidden');

  try {
    const res = await fetch('/api/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: _refundOrderId })
    });
    const data = await res.json();
    showApiResponse('Refund', data.adyenResponse || data);

    if (data.order && data.order.status === 'refunded') {
      showToast('Refund successful', 'success');
    } else {
      showToast(`Refund result: ${data.order?.status || data.error || 'unknown'}`, 'error');
    }
  } catch (err) {
    showToast(`Refund error: ${err.message}`, 'error');
  }
  _refundOrderId = null;
}

// ====================== Overlay helpers ======================
function showOverlay(amount, currency) {
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
  $btnCloseOverlay.classList.add('hidden');
  $overlay.classList.remove('hidden');
}

function showOverlayResult(success, message) {
  $overlaySpinner.classList.add('hidden');
  $overlayTitle.textContent = success ? 'Payment Complete' : 'Payment Not Completed';
  $overlayMsg.textContent = '';
  $overlayResult.textContent = message;
  $overlayResult.className = `overlay-result ${success ? 'success' : 'failure'}`;
  $overlayResult.classList.remove('hidden');
  $btnCheckStatus.classList.add('hidden');
  $btnCancelPay.classList.add('hidden');
  $btnCloseOverlay.classList.remove('hidden');
}

function hideOverlay() {
  $overlay.classList.add('hidden');
}

// ====================== API Response Display ======================
function showApiResponse(label, data) {
  const time = new Date().toLocaleTimeString();
  const json = JSON.stringify(data, null, 2);

  // Remove empty placeholder
  const empty = $apiResponse.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const header = document.createElement('div');
  header.className = 'log-entry-header';

  const title = document.createElement('span');
  title.className = 'log-entry-title';
  title.textContent = `${label} [${time}]`;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'log-entry-toggle';
  toggleBtn.textContent = '−';
  toggleBtn.addEventListener('click', () => {
    const body = entry.querySelector('.log-entry-body');
    const collapsed = body.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? '+' : '−';
  });

  header.appendChild(title);
  header.appendChild(toggleBtn);

  const body = document.createElement('pre');
  body.className = 'log-entry-body';
  body.textContent = json;

  entry.appendChild(header);
  entry.appendChild(body);

  $apiResponse.insertBefore(entry, $apiResponse.firstChild);
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
function showToast(msg, type = 'info', duration = 5000) {
  const bar = document.getElementById('notification-bar');
  bar.textContent = msg;
  bar.className = `notification-bar notification-${type}`;
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => {
    bar.textContent = '\u00A0';
    bar.className = 'notification-bar notification-idle';
  }, duration);
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
  $btnSwitchTerm.addEventListener('click', openSwitchModal);
  $btnSwitchOk.addEventListener('click', confirmSwitch);
  $btnSwitchCancel.addEventListener('click', closeSwitchModal);
  $inputPoiId.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmSwitch(); });
  $btnClearOrders.addEventListener('click', clearOrders);
  $btnClearResp.addEventListener('click', () => { $apiResponse.innerHTML = '<span class="log-empty">No response yet</span>'; });
  $btnToggleLog.addEventListener('click', () => {
    $rightCol.classList.toggle('hidden');
    $btnToggleLog.classList.toggle('btn-primary');
    $btnToggleLog.classList.toggle('btn-outline');
  });

  $toggleAsync.addEventListener('change', (e) => {
    state.isAsync = e.target.checked;
    localStorage.setItem('posAsyncMode', state.isAsync);
    showToast(state.isAsync ? 'Switched to Async mode' : 'Switched to Sync mode', 'info');
  });

  $btnLogout.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Overlay
  $btnCheckStatus.addEventListener('click', checkTransactionStatus);
  $btnCancelPay.addEventListener('click', cancelPayment);
  $btnCloseOverlay.addEventListener('click', hideOverlay);

  // Refund modal
  $btnRefundOk.addEventListener('click', executeRefund);
  $btnRefundCancel.addEventListener('click', () => {
    $refundModal.classList.add('hidden');
    _refundOrderId = null;
  });
}

// ====================== PWA: register service worker ======================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
