/**
 * @file server/utils/time.js
 * @description Centralized IST (Asia/Kolkata) date and time utilities.
 * Ensures consistent handling without UTC drift errors across midnight to 05:30 IST.
 */

const TIMEZONE = 'Asia/Kolkata';

/**
 * Returns a Date object representing the current moment in IST.
 */
function nowIST() {
  const now = new Date();
  const istString = now.toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(istString);
}

/**
 * Returns today's date in YYYY-MM-DD format (IST).
 * @returns {string} e.g. "2026-10-04"
 */
function todayIST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/**
 * Returns current time in HH:MM:SS format (IST).
 * @returns {string} e.g. "14:30:00"
 */
function timeIST() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);
}

/**
 * Returns current timestamp string for MySQL DATETIME (YYYY-MM-DD HH:MM:SS) in IST.
 */
function nowDateTimeIST() {
  return `${todayIST()} ${timeIST()}`;
}

/**
 * Checks whether a given slot date and start time is in the past according to IST.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:MM or HH:MM:SS
 * @param {number} [graceMinutes=0] - optional grace in minutes
 * @returns {boolean} true if slot is earlier than current IST time
 */
function isPastSlot(dateStr, timeStr, graceMinutes = 0) {
  if (!dateStr || !timeStr) return false;
  const slotNormalized = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const slotDate = new Date(`${dateStr}T${slotNormalized}+05:30`);
  const now = new Date();
  
  if (graceMinutes > 0) {
    slotDate.setMinutes(slotDate.getMinutes() + graceMinutes);
  }
  
  return slotDate.getTime() <= now.getTime();
}

/**
 * Adds minutes to an HH:MM string and returns HH:MM.
 * @param {string} timeStr - "06:00"
 * @param {number} mins - 30 or 60
 * @returns {string} e.g. "06:30"
 */
function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nextH = Math.floor(total / 60) % 24;
  const nextM = total % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
}

/**
 * Compares two time strings (HH:MM or HH:MM:SS).
 * Returns -1 if t1 < t2, 0 if equal, 1 if t1 > t2.
 */
function compareTime(t1, t2) {
  const s1 = t1.slice(0, 5);
  const s2 = t2.slice(0, 5);
  return s1.localeCompare(s2);
}

module.exports = {
  TIMEZONE,
  nowIST,
  todayIST,
  timeIST,
  nowDateTimeIST,
  isPastSlot,
  addMinutes,
  compareTime
};
