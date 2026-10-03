// ============================================================
// Cashvista – Authentication JS (login + register)
// ============================================================

// Base API URL: relative path to avoid localhost connection refused errors
// Avoid redeclaring constants across multiple loaded scripts
window.API_BASE = window.API_BASE || '/api';
window.state = window.state || { token: localStorage.getItem('token') || '' };

// ── Already-logged-in check (live token validation) ──────────
// If a token exists in localStorage, verify it against the API.
// Only redirect to dashboard if the token is still valid; otherwise
// clear the stale token so the login form renders cleanly.
(async () => {
  const savedToken = localStorage.getItem('token');
  if (savedToken) {
    try {
      const res = await fetch('/api/user/profile', {
        headers: { 'Authorization': 'Bearer ' + savedToken }
      });
      if (res.ok) {
        // Token is still valid → go straight to dashboard
        window.location.href = '/dashboard.html';
      } else if (res.status === 401) {
        // Token expired or invalid → clear it, let the form render
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.state.token = '';
      }
    } catch (_) {
      // Network error → don't redirect, just let the form render
    }
  }
})();

// ── Validation constants ────────────────────────────────────
var EMAIL_REGEX    = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
var PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!\%*?&]{8,}$/;

// Typo domain map → suggested correction
var EMAIL_TYPO_MAP = {
  'gmail.in':   'gmail.com',   'gmal.com':    'gmail.com',
  'gmial.com':  'gmail.com',   'gmil.com':    'gmail.com',
  'gnail.com':  'gmail.com',   'yahooo.com':  'yahoo.com',
  'yaho.com':   'yahoo.com',   'hotmial.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com', 'outlok.com':  'outlook.com',
  'otlook.com': 'outlook.com', 'gamil.com':   'gmail.com',
};

// ── Form toggle ─────────────────────────────────────────────
function toggleAuthForm(form) {
  document.getElementById('auth-error').classList.add('hidden');
  clearAllFieldErrors();

  if (form === 'register') {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('login-toggle-text').classList.add('hidden');
    document.getElementById('register-toggle-text').classList.remove('hidden');
  } else {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-toggle-text').classList.remove('hidden');
    document.getElementById('register-toggle-text').classList.add('hidden');
    resetPasswordStrength();
  }
}

// ── Inline error helpers ─────────────────────────────────────
function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('span').textContent = message;
  el.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function clearAllFieldErrors() {
  ['err-username', 'err-email', 'err-password', 'err-confirm'].forEach(clearFieldError);
  const sug = document.getElementById('email-suggestion');
  if (sug) sug.classList.add('hidden');
}

function markField(inputId, isError) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.classList.toggle('border-red-400', isError);
  el.classList.toggle('border-slate-200', !isError);
}

// ── Email live validation ────────────────────────────────────
function validateEmailLive(value) {
  const sug = document.getElementById('email-suggestion');
  if (!sug) return;

  if (!value) { sug.classList.add('hidden'); return; }

  const domain = value.split('@')[1]?.toLowerCase();
  if (domain && EMAIL_TYPO_MAP[domain]) {
    const corrected = value.split('@')[0] + '@' + EMAIL_TYPO_MAP[domain];
    sug.querySelector('span').textContent =
      `Did you mean ${corrected}? Click to fix.`;
    sug.classList.remove('hidden');
    sug.onclick = () => {
      document.getElementById('register-email').value = corrected;
      sug.classList.add('hidden');
      if (window.lucide) lucide.createIcons();
    };
  } else {
    sug.classList.add('hidden');
    sug.onclick = null;
  }
}

// ── Password strength meter ──────────────────────────────────
const STRENGTH_LEVELS = [
  { label: 'Too Weak',  color: '#FF5C5C', bars: 1 },
  { label: 'Weak',      color: '#F59E0B', bars: 2 },
  { label: 'Good',      color: '#3B82F6', bars: 3 },
  { label: 'Strong 🔒', color: '#00D9A3', bars: 4 },
];

function updatePasswordStrength(value) {
  const meter = document.getElementById('strength-meter');
  if (!meter) return;

  if (!value) { resetPasswordStrength(); return; }
  meter.classList.remove('hidden');

  const checks = {
    length:  value.length >= 8,
    upper:   /[A-Z]/.test(value),
    lower:   /[a-z]/.test(value),
    digit:   /\d/.test(value),
    special: /[@$!%*?&]/.test(value),
  };

  Object.entries(checks).forEach(([key, passed]) => {
    const li  = document.getElementById(`req-${key}`);
    if (!li) return;
    const dot = li.querySelector('.req-dot');
    li.style.color       = passed ? '#00B989' : '#94a3b8';
    dot.textContent   = passed ? '✓' : '○';
    dot.style.color   = passed ? '#00D9A3' : '#94a3b8';
    dot.style.fontWeight = passed ? '700' : '400';
  });

  const score = Object.values(checks).filter(Boolean).length - 1;
  const level = STRENGTH_LEVELS[Math.max(0, Math.min(score, 3))];

  for (let i = 1; i <= 4; i++) {
    const bar = document.getElementById(`str-bar-${i}`);
    if (!bar) continue;
    bar.style.backgroundColor = i <= level.bars ? level.color : '#e2e8f0';
  }

  const lbl = document.getElementById('strength-label');
  if (lbl) {
    lbl.textContent = level.label;
    lbl.style.color = level.color;
  }
}

function resetPasswordStrength() {
  const meter = document.getElementById('strength-meter');
  if (meter) meter.classList.add('hidden');
  for (let i = 1; i <= 4; i++) {
    const bar = document.getElementById(`str-bar-${i}`);
    if (bar) bar.style.backgroundColor = '#e2e8f0';
  }
  ['length', 'upper', 'lower', 'digit', 'special'].forEach(key => {
    const li = document.getElementById(`req-${key}`);
    if (!li) return;
    li.style.color = '#94a3b8';
    const dot = li.querySelector('.req-dot');
    if (dot) { dot.textContent = '○'; dot.style.color = '#94a3b8'; dot.style.fontWeight = '400'; }
  });
}

// ── Confirm password live check ──────────────────────────────
function validateConfirmLive() {
  const pw  = document.getElementById('register-password')?.value || '';
  const cfm = document.getElementById('register-confirm')?.value  || '';
  if (cfm && pw && cfm !== pw) {
    showFieldError('err-confirm', 'Passwords do not match.');
    markField('register-confirm', true);
  } else {
    clearFieldError('err-confirm');
    markField('register-confirm', false);
  }
}

// ── Password show/hide toggle ────────────────────────────────
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  const icon = btn.querySelector('i[data-lucide]');
  if (icon) {
    icon.setAttribute('data-lucide', isHidden ? 'eye-off' : 'eye');
    if (window.lucide) lucide.createIcons();
  }
}

// ── Registration form validation ─────────────────────────────
function validateRegisterForm(username, email, password, confirm) {
  clearAllFieldErrors();
  let valid = true;

  if (!username || username.trim().length < 2) {
    showFieldError('err-username', 'Username must be at least 2 characters.');
    markField('register-username', true);
    valid = false;
  } else {
    markField('register-username', false);
  }

  if (!EMAIL_REGEX.test(email)) {
    showFieldError('err-email', 'Enter a valid email address (e.g. user@gmail.com).');
    markField('register-email', true);
    valid = false;
  } else {
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain && EMAIL_TYPO_MAP[domain]) {
      showFieldError('err-email',
        `Looks like a typo — did you mean @${EMAIL_TYPO_MAP[domain]}?`);
      markField('register-email', true);
      valid = false;
    } else {
      markField('register-email', false);
    }
  }

  if (!PASSWORD_REGEX.test(password)) {
    showFieldError('err-password',
      'Password needs 8+ chars, uppercase, lowercase, a number, and a special character (@$!%*?&).');
    markField('register-password', true);
    valid = false;
  } else {
    markField('register-password', false);
  }

  if (password !== confirm) {
    showFieldError('err-confirm', 'Passwords do not match.');
    markField('register-confirm', true);
    valid = false;
  } else {
    markField('register-confirm', false);
  }

  return valid;
}

// ── Submit button loading state ──────────────────────────────
function setSubmitLoading(type, isLoading) {
  const btnId = type === 'register' ? 'btn-register' : null;
  if (!btnId) return;
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = `
      <svg style="width:16px;height:16px;animation:spin .8s linear infinite" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity=".25"/>
        <path fill="currentColor" opacity=".75" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
      Creating Account…`;
  } else {
    btn.disabled = false;
    if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
  }
}

// ── Main auth submit handler ─────────────────────────────────
async function handleAuthSubmit(e, type) {
  // Belt-and-suspenders: prevent ANY default form navigation immediately
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

  document.getElementById('auth-error').classList.add('hidden');

  // Guard: resolve API base safely
  const apiBase = window.API_BASE || '/api';

  const email    = document.getElementById(`${type}-email`).value.trim();
  const password = document.getElementById(`${type}-password`).value;
  let body = { email, password };

  if (type === 'register') {
    const username = document.getElementById('register-username').value.trim();
    const confirm  = document.getElementById('register-confirm')?.value || '';
    body.username  = username;

    if (!validateRegisterForm(username, email, password, confirm)) return false;
  }

  if (type === 'register') setSubmitLoading('register', true);

  try {
    console.log(`[Cashvista] Sending ${type} request…`);
    const response = await fetch(`${apiBase}/auth/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log(`[Cashvista] ${type} response:`, response.status, data);

    if (!response.ok) throw new Error(data.error || 'Authentication failed.');

    if (data.token) {
      window.state.token = data.token;
      window.state.user = data.user || {};
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      console.log('[Cashvista] Token stored, redirecting to dashboard…');
      window.location.href = '/dashboard.html';
    } else {
      // Fallback: perform internal login using the same credentials.
      console.log('[Cashvista] No token in response, attempting auto-login…');
      const loginResp = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const loginData = await loginResp.json();
      console.log('[Cashvista] auto-login response:', loginResp.status, loginData);
      if (!loginResp.ok) throw new Error(loginData.error || 'Login after registration failed.');
      window.state.token = loginData.token;
      window.state.user = loginData.user || {};
      localStorage.setItem('token', loginData.token);
      localStorage.setItem('user', JSON.stringify(loginData.user));
      window.location.href = '/dashboard.html';
    }

  } catch (error) {
    console.error('[Cashvista] Auth error:', error);
    document.getElementById('auth-error').classList.remove('hidden');
    document.getElementById('auth-error-msg').innerText = error.message;
    if (window.lucide) lucide.createIcons();
  } finally {
    if (type === 'register') setSubmitLoading('register', false);
  }

  return false;
}

// ── Expose auth functions globally so inline onsubmit/onclick ────
// attributes in login.html always resolve them regardless of
// whether the browser has fully evaluated this script yet.
window.handleAuthSubmit       = handleAuthSubmit;
window.toggleAuthForm         = toggleAuthForm;
window.togglePasswordVisibility = togglePasswordVisibility;
window.validateEmailLive      = validateEmailLive;
window.updatePasswordStrength = updatePasswordStrength;
window.validateConfirmLive    = validateConfirmLive;
window.clearFieldError        = clearFieldError;