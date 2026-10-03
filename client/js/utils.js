/**
 * @file client/js/utils.js
 * @description Shared UI formatting, IST time helpers, chips, and debounce utilities.
 */

/**
 * Debounce a function call.
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Formats amount into Indian Rupees (INR) with currency symbol.
 */
function formatINR(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * Formats ISO date string to human-readable date (e.g. "04 Oct 2026").
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(d);
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * Formats date and time.
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * Formats 24h time "14:30:00" to "14:30" or 12h format.
 */
function formatTime(timeStr) {
  if (!timeStr) return '—';
  return String(timeStr).slice(0, 5);
}

/**
 * Escapes unsafe characters for safe innerHTML injection.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Returns two-letter uppercase initials for user avatars.
 */
function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Returns HTML for unified status chips.
 */
function statusChip(status) {
  const s = String(status || '').toLowerCase();
  switch (s) {
    case 'active':
    case 'confirmed':
    case 'paid':
    case 'delivered':
    case 'collected':
    case 'ready':
      return `<span class="status-chip success"><span class="dot"></span>${escapeHtml(status)}</span>`;
    case 'pending':
    case 'open':
    case 'contacted':
    case 'quoted':
    case 'preparing':
    case 'in_progress':
    case 'packed':
    case 'ready_for_pickup':
    case 'out_for_delivery':
      return `<span class="status-chip warning"><span class="dot"></span>${escapeHtml(status.replace(/_/g, ' '))}</span>`;
    case 'cancelled':
    case 'expired':
    case 'suspended':
    case 'failed':
    case 'lost':
    case 'no_show':
      return `<span class="status-chip danger"><span class="dot"></span>${escapeHtml(status.replace(/_/g, ' '))}</span>`;
    case 'completed':
    case 'converted':
    case 'settled':
    case 'served':
      return `<span class="status-chip info"><span class="dot"></span>${escapeHtml(status.replace(/_/g, ' '))}</span>`;
    case 'refunded':
      return `<span class="status-chip muted"><span class="dot"></span>Refunded</span>`;
    default:
      return `<span class="status-chip muted"><span class="dot"></span>${escapeHtml(status || '—')}</span>`;
  }
}

/**
 * Returns HTML for plan badge.
 */
function planChip(code, name) {
  const c = String(code || '').toUpperCase();
  let cls = 'silver';
  if (c.includes('PLATINUM')) cls = 'platinum';
  else if (c.includes('GOLD')) cls = 'gold';
  else if (c.includes('JUNIOR')) cls = 'junior';
  return `<span class="plan-chip ${cls}"><i class="bi bi-award"></i>${escapeHtml(name || code)}</span>`;
}

/**
 * Returns today in YYYY-MM-DD (IST).
 */
function todayIST() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/**
 * Checks if a slot time is past in IST.
 */
function isPastSlot(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const slotNormalized = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const slotDate = new Date(`${dateStr}T${slotNormalized}+05:30`);
  const now = new Date();
  return slotDate.getTime() <= now.getTime();
}

window.utils = {
  debounce,
  formatINR,
  formatDate,
  formatDateTime,
  formatTime,
  escapeHtml,
  initials,
  statusChip,
  planChip,
  todayIST,
  isPastSlot
};

// Aliases for convenience
window.escHtml = escapeHtml;
window.fmtINR = formatINR;
window.fmtDate = formatDate;
window.statusBadge = statusChip;
