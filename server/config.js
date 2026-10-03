/**
 * @file server/config.js
 * @description Centralized club operational constants and business rules.
 * All opening hours, slot durations, booking limits, and currency settings live here.
 */

module.exports = {
  // Opening & closing hours (24h format): 06:00 to 22:00
  OPENING_HOUR: 6,
  CLOSING_HOUR: 22,

  // Booking slots: 30 minutes interval, 60 minutes booking length (2 consecutive slots)
  SLOT_LENGTH_MINUTES: 30,
  BOOKING_LENGTH_MINUTES: 60,

  // Maximum advance booking days
  MAX_ADVANCE_BOOKING_DAYS: 14,

  // Default booking limit per member per calendar day
  DEFAULT_MAX_BOOKINGS_PER_DAY: 2,

  // Renewal warning alert window in days
  EXPIRY_WARNING_DAYS: 30,

  // Stock reorder alert threshold
  DEFAULT_REORDER_LEVEL: 5,

  // Currency configuration
  CURRENCY_CODE: 'INR',
  CURRENCY_SYMBOL: '₹',

  // Timezone
  TIMEZONE: 'Asia/Kolkata',

  // Bar and Cafeteria Tables (T1 to T12)
  BAR_TABLES: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']
};
