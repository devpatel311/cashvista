const API_BASE = '/api';
// Application Local State (Shared) - use global window.state for consistency
window.state = window.state || {
  token: localStorage.getItem('token') || '',
  user: null,
  transactions: [],
  budgets: [],
  accounts: [],
  dateRange: 'this-month',
  charts: {},       // Cached Chart instances
  chatHistory: []   // Conversational memory for multi-turn Gemini chat
};
var state = window.state;

// ── Currency Utilities ────────────────────────────────────────
/**
 * Static exchange-rate table relative to INR as the base.
 * 1 unit of the key currency = N INR.
 * Update these periodically or replace with a live rates API call.
 */
const FX_RATES_TO_INR = {
  INR: 1,
  USD: 84.5,
  EUR: 91.2,
  GBP: 107.3,
  AED: 23.0,
  SGD: 63.0,
  JPY: 0.55,
  AUD: 54.0,
  CAD: 62.0,
  CHF: 96.0
};

/**
 * Format a number as a currency string using the browser's Intl API.
 * Falls back to a simple symbol prefix if the currency code is unrecognised.
 *
 * @param {number} amount       - The numeric value to format.
 * @param {string} currencyCode - ISO 4217 code (e.g. 'INR', 'USD').
 * @returns {string}
 */
function formatCurrency(amount, currencyCode = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2
    }).format(amount);
  } catch (_) {
    // Fallback for unrecognised codes
    const symbols = { INR:'₹', USD:'$', EUR:'€', GBP:'£', AED:'د.إ', SGD:'S$', JPY:'¥', AUD:'A$', CAD:'C$', CHF:'Fr' };
    const sym = symbols[currencyCode] || currencyCode + ' ';
    return sym + Math.abs(amount).toFixed(2);
  }
}

/**
 * Convert an amount from one ISO currency to another using FX_RATES_TO_INR.
 * Both currencies must be present in the table; unknown codes are treated as INR.
 *
 * @param {number} amount       - Amount in the source currency.
 * @param {string} fromCurrency - ISO 4217 source code.
 * @param {string} toCurrency   - ISO 4217 target code.
 * @returns {number}
 */
var convertToBaseCurrency = function(amount, fromCurrency, toCurrency = 'INR') {
  var fromRate = FX_RATES_TO_INR[fromCurrency] || 1;
  var toRate   = FX_RATES_TO_INR[toCurrency]   || 1;
  return (amount * fromRate) / toRate;
}

/**
 * Returns the user's preferred base currency code.
 * The user profile stores the raw symbol (₹/$) for legacy reasons;
 * this resolves it back to an ISO code.
 */
function getUserBaseCurrency() {
  const sym = state.user?.currency || '₹';
  const symbolToCode = { '₹':'INR', '$':'USD', '€':'EUR', '£':'GBP' };
  return symbolToCode[sym] || 'INR';
}


// Helper: Header Auth configuration
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${state.token}`
  };
}

// Session Checker
// On the login page we never redirect based on a stored token alone —
// that token may be expired.  The redirect-to-dashboard only happens
// AFTER a successful live API call (done inside checkAuthAsync on dashboard).
function checkAuth() {
  const token = localStorage.getItem('token') || '';
  // Sync global state
  window.state = window.state || {};
  window.state.token = token;
  const isLoginPage = window.location.pathname.endsWith('login.html');
  // Guard non-auth pages: if no token and not on login page, redirect to login
  if (!token && !isLoginPage) {
    window.location.href = 'login.html';
    return false;
  }
  // On the login page: never redirect away based solely on a cached token.
  // An expired token would cause a fetch-failure loop. The login form handles
  // fresh auth; let the page render normally.
  if (isLoginPage) {
    return false; // don't run the DOMContentLoaded boot block on login.html
  }
  return true;
}

// Fetch user settings and details
async function fetchUserData() {
  const res = await fetch(`${API_BASE}/user/profile`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error('Authentication check failed.');
  state.user = await res.json();
  
  // Update user info in navbar if present
  const nameEl = document.getElementById('nav-user-name');
  const initialsEl = document.getElementById('nav-user-initials');
  
  if (nameEl) nameEl.innerText = state.user.username;
  if (initialsEl) {
    initialsEl.innerText = state.user.username
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }
  
  renderNotifications();
}

// Fetch transaction/budget/account lists
async function fetchFinancialData() {
  const [txRes, budgetRes, accRes] = await Promise.all([
    fetch(`${API_BASE}/transactions`, { headers: getAuthHeaders() }),
    fetch(`${API_BASE}/budgets`, { headers: getAuthHeaders() }),
    fetch(`${API_BASE}/accounts`, { headers: getAuthHeaders() })
  ]);

  if (txRes.ok) state.transactions = await txRes.json();
  if (budgetRes.ok) state.budgets = await budgetRes.json();
  if (accRes.ok) state.accounts = await accRes.json();
  
  populateQuickTransferDropdowns();
}

// Logout session
function handleLogout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// Mobile navigation toggle
function initMobileMenu() {
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.querySelector('aside');
  if (mobileBtn && sidebar) {
    mobileBtn.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      sidebar.classList.toggle('fixed');
      sidebar.classList.toggle('z-40');
      sidebar.classList.toggle('h-screen');
    });
  }
}

// ----------------------------------------------------
// NOTIFICATIONS DRAWER
// ----------------------------------------------------
function toggleNotificationDrawer() {
  const drawer = document.getElementById('notif-panel');
  if (drawer) drawer.classList.toggle('hidden');
}

function renderNotifications() {
  const notifs = (state.user && state.user.notifications) || [];
  const badge = document.getElementById('notif-badge');
  const container = document.getElementById('notif-list');
  if (!container) return;
  
  const unreadCount = notifs.filter(n => !n.read).length;
  if (badge) {
    if (unreadCount > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
  }

  if (notifs.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">No active alerts or reminders.</div>`;
    return;
  }

  container.innerHTML = notifs.map(n => {
    let iconColor = 'text-info bg-blue-50';
    let icon = 'bell';
    if (n.type === 'warning') { iconColor = 'text-warning bg-amber-50'; icon = 'alert-triangle'; }
    if (n.type === 'danger') { iconColor = 'text-danger bg-red-50'; icon = 'alert-circle'; }

    return `
      <div class="p-3.5 hover:bg-slate-50 transition flex gap-3 ${n.read ? 'opacity-60' : ''}">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconColor}">
          <i data-lucide="${icon}" class="w-4 h-4"></i>
        </div>
        <div class="flex-grow min-w-0">
          <div class="font-bold text-xs text-slate-800 flex justify-between">
            <span>${n.title}</span>
            <span class="text-[9px] text-slate-400 font-normal">${new Date(n.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5 leading-snug">${n.message}</p>
        </div>
      </div>
    `;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function markAllNotificationsRead() {
  const notifs = ((state.user && state.user.notifications) || []).map(n => ({ ...n, read: true }));
  try {
    const response = await fetch(`${API_BASE}/user/profile`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ notifications: notifs })
    });
    if (response.ok) {
      state.user.notifications = notifs;
      renderNotifications();
    }
  } catch (err) {
    console.error(err);
  }
}

// ----------------------------------------------------
// SIDEBAR QUICK TRANSFER SHORTCUT
// ----------------------------------------------------
function populateQuickTransferDropdowns() {
  const fromSel = document.getElementById('quick-transfer-from');
  const toSel = document.getElementById('quick-transfer-to');
  if (!fromSel || !toSel) return;

  const opts = state.accounts.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  fromSel.innerHTML = opts;
  toSel.innerHTML = opts;
  
  if (state.accounts.length > 1) {
    toSel.selectedIndex = 1;
  }
}

async function handleQuickTransfer(e) {
  if (e) e.preventDefault();
  const fromAccount = document.getElementById('quick-transfer-from').value;
  const toAccount = document.getElementById('quick-transfer-to').value;
  const amountInput = document.getElementById('quick-transfer-amount');
  const amount = Number(amountInput.value);

  if (!amount || amount <= 0) {
    alert('Please enter a valid transfer amount.');
    return;
  }
  if (fromAccount === toAccount) {
    alert('Source and target accounts must be different.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/accounts/transfer`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fromAccount, toAccount, amount, description: 'Quick Transfer shortcut' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transfer failed.');

    alert('Transfer processed successfully.');
    amountInput.value = '';
    
    await fetchFinancialData();
    // Reload active page calculations if hook exists
    if (typeof initPage === 'function') {
      await initPage();
    }
  } catch (err) {
    alert(err.message);
  }
}

// ----------------------------------------------------
// FLOATING AI CHATBOT LOGIC
// ----------------------------------------------------
function toggleChatbot() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    setTimeout(() => {
      panel.classList.remove('scale-95', 'opacity-0');
    }, 10);
  } else {
    panel.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
      panel.classList.add('hidden');
    }, 300);
    // Clear conversational memory when the panel is closed
    state.chatHistory = [];
  }
}

async function sendQuickPrompt(promptText) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = promptText;
    handleSendChat(new Event('submit'));
  }
}

async function handleSendChat(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;

  input.value = '';
  
  const chatBody = document.getElementById('chat-messages');
  if (!chatBody) return;

  chatBody.innerHTML += `
    <div class="flex items-start gap-2 justify-end">
      <div class="bg-primary-600 text-white rounded-2xl rounded-tr-none p-3 shadow-sm max-w-[80%] leading-relaxed">
        ${question}
      </div>
      <div class="w-7 h-7 bg-primary-700 text-white rounded-lg flex items-center justify-center font-bold text-xs shrink-0">
        ${(state.user && state.user.username ? state.user.username[0] : 'U').toUpperCase()}
      </div>
    </div>
  `;
  chatBody.scrollTop = chatBody.scrollHeight;

  const loaderId = `loader-${Date.now()}`;
  chatBody.innerHTML += `
    <div id="${loaderId}" class="flex items-start gap-2">
      <div class="w-7 h-7 bg-slate-800 text-white rounded-lg flex items-center justify-center shrink-0">
        <i data-lucide="sparkles" class="w-4 h-4"></i>
      </div>
      <div class="bg-white border border-slate-100 rounded-2xl rounded-tl-none p-3 text-slate-500 shadow-sm flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
        <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
        <span class="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
      </div>
    </div>
  `;
  chatBody.scrollTop = chatBody.scrollHeight;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const response = await fetch(`${API_BASE}/chatbot/ask`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        question,
        history: state.chatHistory  // Send full conversation history for multi-turn context
      })
    });
    const data = await response.json();
    
    document.getElementById(loaderId).remove();
    const formattedAnswer = formatAnswerMarkdown(data.answer);

    // Update conversational memory with this exchange
    state.chatHistory.push({ role: 'user',  parts: question });
    state.chatHistory.push({ role: 'model', parts: data.answer || '' });
    // Keep history to last 10 turns to avoid token bloat
    if (state.chatHistory.length > 20) state.chatHistory.splice(0, 2);

    chatBody.innerHTML += `
      <div class="flex items-start gap-2">
        <div class="w-7 h-7 bg-slate-800 text-white rounded-lg flex items-center justify-center shrink-0">
          <i data-lucide="sparkles" class="w-4 h-4"></i>
        </div>
        <div class="bg-white border border-slate-100 rounded-2xl rounded-tl-none p-3 text-slate-700 shadow-sm max-w-[80%] leading-relaxed">
          ${formattedAnswer}
        </div>
      </div>
    `;
    chatBody.scrollTop = chatBody.scrollHeight;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    document.getElementById(loaderId).remove();
    chatBody.innerHTML += `
      <div class="flex items-start gap-2">
        <div class="w-7 h-7 bg-red-50 text-danger rounded-lg flex items-center justify-center shrink-0">
          <i data-lucide="alert-circle" class="w-4 h-4"></i>
        </div>
        <div class="bg-red-50 text-danger border border-red-100 rounded-2xl rounded-tl-none p-3 shadow-sm max-w-[80%]">
          Sorry, I encountered a communication error. Please ensure the backend is running.
        </div>
      </div>
    `;
    chatBody.scrollTop = chatBody.scrollHeight;
  }
}

function formatAnswerMarkdown(text) {
  if (!text) return '';
  let formatted = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>')
    .replace(/\n/g, '<br>')
    .replace(/<br>\s*-\s*/g, '<br>• ');
  return formatted;
}

// ----------------------------------------------------
// CUSTOM CONFIRMATION MODAL
// ----------------------------------------------------
function customConfirm() {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const cancelBtn = document.getElementById('confirm-cancel-btn');
    const okBtn = document.getElementById('confirm-ok-btn');
    
    if (!modal) {
      resolve(confirm('Are you sure you want to delete this record?'));
      return;
    }
    
    modal.classList.remove('hidden');
    if (typeof lucide !== 'undefined') lucide.createIcons();

    function cleanup(result) {
      modal.classList.add('hidden');
      cancelBtn.removeEventListener('click', onCancel);
      okBtn.removeEventListener('click', onOk);
      resolve(result);
    }

    function onCancel() { cleanup(false); }
    function onOk() { cleanup(true); }

    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
  });
}

// ----------------------------------------------------
// PAGE ROUTER AUTO-BOOT
// ----------------------------------------------------
if (checkAuth()) {
  window.addEventListener('DOMContentLoaded', async () => {
    initMobileMenu();

    if (state.token) {
      try {
        await fetchUserData();
        await fetchFinancialData();
        if (typeof initPage === 'function') {
          await initPage();
        }
      } catch (err) {
        console.error('App init failed:', err);
        // Only force-logout on genuine authentication errors (401/403).
        // Network errors or page-specific init failures should NOT log the
        // user out — that creates an infinite login.html redirect loop.
        const msg = (err && err.message) || '';
        if (msg.includes('Authentication check failed') || msg.includes('401') || msg.includes('403')) {
          handleLogout();
        }
      }
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
}
