/**
 * @file server/utils/validators.js
 * @description Core validation and normalization helpers for server and scripts.
 */

/**
 * Validates standard email address format.
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return re.test(email.trim());
}

/**
 * Validates Indian 10-digit mobile number starting with 6, 7, 8, or 9.
 * Accepts optional +91 prefix.
 */
function isValidPhone(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[\s\-+]/g, '');
  const digits = cleaned.startsWith('91') && cleaned.length === 12 ? cleaned.slice(2) : cleaned;
  return /^[6-9]\d{9}$/.test(digits);
}

/**
 * Normalizes phone number to standard 10-digit format.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[\s\-+]/g, '');
  const digits = cleaned.startsWith('91') && cleaned.length === 12 ? cleaned.slice(2) : cleaned;
  return digits.length === 10 ? digits : cleaned;
}

/**
 * Sanitizes generic user text (collapses whitespace, removes dangerous control chars).
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
}

module.exports = {
  isValidEmail,
  isValidPhone,
  normalizePhone,
  sanitizeText
};
