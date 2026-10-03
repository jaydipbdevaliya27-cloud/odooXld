/**
 * @file client/js/utils.js
 * @description Shared UI utility functions used by every page.
 */

/** Show a Bootstrap toast-style alert at the top-right of the screen. */
function showAlert(message, type = 'success') {
  let bar = document.getElementById('alert-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'alert-bar';
    document.body.appendChild(bar);
  }
  const id  = 'alert-' + Date.now();
  const html = `
    <div id="${id}" class="alert alert-${type} alert-dismissible shadow-sm fade show" role="alert">
      ${escHtml(message)}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`;
  bar.insertAdjacentHTML('beforeend', html);
  // Auto-remove after 4 seconds
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.remove();
  }, 4000);
}

/** Format a number as Indian Rupees: ₹1,200.00 */
function fmtINR(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

/** Format a ISO date string as DD-Mon-YYYY */
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Return a Bootstrap badge class for a status string */
function statusBadge(status) {
  const map = {
    active: 'badge-active', expired: 'badge-expired', suspended: 'badge-suspended',
    confirmed: 'badge-confirmed', cancelled: 'badge-cancelled', completed: 'badge-completed',
    open: 'badge-open',
    paid: 'badge-active', refunded: 'badge-expired', failed: 'badge-suspended'
  };
  const cls = map[status] || 'bg-secondary text-white';
  return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

/** Escape HTML to prevent XSS in dynamically rendered strings */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/**
 * Loads the session user from /api/auth/me and stores in window.CC_USER.
 * Optionally redirects to login if not authenticated.
 * @param {boolean} redirectOnFail – if true (default), redirect to login when not logged in
 */
async function loadSession(redirectOnFail = true) {
  try {
    const data = await api.get('/api/auth/me');
    window.CC_USER = data.user;
    return data.user;
  } catch {
    if (redirectOnFail) window.location.href = '/shared/login.html';
    return null;
  }
}

/** Fill a <select> element with {value, label} option pairs. */
function fillSelect(selectEl, options, placeholder = '-- Select --') {
  selectEl.innerHTML = `<option value="">${escHtml(placeholder)}</option>`;
  options.forEach(o => {
    const opt = document.createElement('option');
    opt.value       = o.value;
    opt.textContent = o.label;
    selectEl.appendChild(opt);
  });
}
