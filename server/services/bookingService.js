/**
 * @file server/services/bookingService.js
 * @description Core court booking business logic.
 * Handles slot availability calculation, double-booking prevention using atomic transactions,
 * member daily limit enforcement with SELECT FOR UPDATE, slot generation, and cancellation.
 */

const { query, transaction } = require('../db');
const config = require('../config');
const { calculateCourtPrice } = require('./pricing');

/**
 * Helper to pad numbers to 2 digits (e.g. 6 -> "06")
 * @param {number|string} num
 * @returns {string}
 */
function pad(num) {
  return String(num).padStart(2, '0');
}

/**
 * Returns the current time formatted as 'HH:MM' in the configured timezone.
 * @param {Date} [now]
 * @returns {string}
 */
function getCurrentTimeStr(now = new Date()) {
  const tf = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.TIMEZONE || 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  return tf.format(now);
}

/**
 * Returns today's date in 'YYYY-MM-DD' formatted according to club timezone.
 */
function getTodayDateStr() {
  const tf = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return tf.format(new Date());
}

/**
 * Returns the maximum allowed advance booking date string ('YYYY-MM-DD').
 * Calculated as today + days in calendar days.
 */
function getMaxAdvanceDateStr(days = config.MAX_ADVANCE_BOOKING_DAYS || 14) {
  const todayStr = getTodayDateStr();
  const [y, m, d] = todayStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + Number(days)));
  const yTarget = target.getUTCFullYear();
  const mTarget = pad(target.getUTCMonth() + 1);
  const dTarget = pad(target.getUTCDate());
  return `${yTarget}-${mTarget}-${dTarget}`;
}

/**
 * Calculates availability for all courts on a given date.
 * Each court booking is 60 minutes long, constructed of two 30-minute slot units.
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string|null} sport - optional filter ('tennis' or 'cricket')
 * @param {number|null} currentUserId - logged in user's ID for highlighting 'mine'
 * @param {string|null} currentTimeOverride - optional 'HH:MM' override for testing
 * @returns {Promise<object>} { date, serverTime, courts, slots }
 */
async function getAvailability(dateStr, sport = null, currentUserId = null, currentTimeOverride = null) {
  // Validate 14-day advance booking window
  const todayStr = getTodayDateStr();
  const maxAdvanceStr = getMaxAdvanceDateStr(config.MAX_ADVANCE_BOOKING_DAYS || 14);
  const currentTimeStr = currentTimeOverride || getCurrentTimeStr();

  const cleanDate = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    const err = new Error('Invalid date format. Expected YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  if (cleanDate < todayStr) {
    const err = new Error('Cannot check availability for past dates.');
    err.status = 400;
    throw err;
  }
  if (cleanDate > maxAdvanceStr) {
    const err = new Error(`Bookings can only be made up to ${config.MAX_ADVANCE_BOOKING_DAYS || 14} days in advance.`);
    err.status = 400;
    throw err;
  }

  let courtSql = 'SELECT id, name, sport, surface_type, base_price_per_hour FROM courts WHERE is_active = 1';
  const courtParams = [];
  if (sport) {
    courtSql += ' AND sport = ?';
    courtParams.push(sport);
  }
  courtSql += ' ORDER BY sport, id';
  const [courts] = await query(courtSql, courtParams);

  // Fetch all booked 30-minute slots on this date from confirmed bookings
  const [slotRows] = await query(
    `SELECT bs.court_id, bs.slot_start, bs.slot_end, bs.booking_id, b.user_id as booking_user_id
     FROM booking_slots bs
     JOIN bookings b ON bs.booking_id = b.id
     WHERE bs.slot_date = ? AND b.status = 'confirmed'`,
    [dateStr]
  );

  // Fetch all confirmed booking headers on this date to know exact 1-hour sessions
  const [confirmedBookings] = await query(
    `SELECT id, court_id, booking_code, start_time, end_time, user_id
     FROM bookings
     WHERE booking_date = ? AND status = 'confirmed'`,
    [dateStr]
  );

  // Map of "courtId_HH:MM" -> confirmed booking header
  const exactBookingMap = new Map();
  confirmedBookings.forEach(b => {
    const sTime = String(b.start_time).slice(0, 5); // '18:30'
    exactBookingMap.set(`${b.court_id}_${sTime}`, b);
  });

  // Set of occupied 30-minute intervals: "courtId_HH:MM"
  const bookedSlotSet = new Set();
  slotRows.forEach(s => {
    let h, m;
    if (s.slot_start instanceof Date) {
      h = pad(s.slot_start.getHours());
      m = pad(s.slot_start.getMinutes());
    } else {
      const parts = String(s.slot_start).split(' ')[1] || String(s.slot_start);
      const timeParts = parts.split(':');
      h = pad(timeParts[0]);
      m = pad(timeParts[1]);
    }
    bookedSlotSet.add(`${s.court_id}_${h}:${m}`);
  });

  // Build list of 60-minute start time slots (every 30 min from OPENING_HOUR to CLOSING_HOUR - 1)
  const slots = [];
  for (let h = config.OPENING_HOUR; h < config.CLOSING_HOUR; h++) {
    for (const m of [0, 30]) {
      // Last booking starts 1 hour before closing (e.g., 21:00 if closing is 22:00)
      if (h === config.CLOSING_HOUR - 1 && m > 0) continue;

      const startTime = `${pad(h)}:${pad(m)}`;
      let endH = h + 1;
      let endM = m;
      const endTime = `${pad(endH)}:${pad(endM)}`;

      // The 60-min booking spans two 30-min slots: (h:m) and (s2H:s2M)
      const s1H = h;
      const s1M = m;
      const s2H = (m === 30 ? h + 1 : h);
      const s2M = (m === 30 ? 0 : 30);

      const slot1Key = (courtId) => `${courtId}_${pad(s1H)}:${pad(s1M)}`;
      const slot2Key = (courtId) => `${courtId}_${pad(s2H)}:${pad(s2M)}`;

      const isPastSlot = (cleanDate === todayStr && startTime < currentTimeStr);

      const courtStatuses = courts.map(court => {
        const k1 = slot1Key(court.id);
        const k2 = slot2Key(court.id);

        const exact = exactBookingMap.get(`${court.id}_${startTime}`);

        let status = 'available';
        let bookingCode = null;

        if (exact) {
          bookingCode = exact.booking_code;
          if (currentUserId && exact.user_id === currentUserId) {
            status = 'mine';
          } else {
            status = 'booked';
          }
        } else if (isPastSlot) {
          // Same-day past slot whose start time has already passed
          status = 'past';
        } else if (bookedSlotSet.has(k1) || bookedSlotSet.has(k2)) {
          // One of the 30-min halves is booked by an adjacent session -> overlaps!
          status = 'unavailable';
        }

        return {
          courtId: court.id,
          courtName: court.name,
          sport: court.sport,
          basePricePerHour: court.base_price_per_hour,
          status,
          bookingCode
        };
      });

      slots.push({
        startTime,
        endTime,
        courts: courtStatuses
      });
    }
  }

  return { date: cleanDate, serverTime: currentTimeStr, courts, slots };
}

/**
 * Creates a court booking inside an atomic transaction.
 * Validates court, operational hours, member daily limits, calculates pricing,
 * and inserts 30-min slot rows (which enforce uniqueness at the DB level).
 */
async function createBooking(params) {
  const courtId        = params.courtId || params.court_id;
  const bookingDate    = params.bookingDate || params.booking_date;
  const startTime      = params.startTime || params.start_time;
  const userId         = params.userId || params.user_id || params.bookedByUserId || params.booked_by_user_id || null;
  const memberId       = params.memberId || params.member_id || null;
  const guestName      = params.guestName || params.guest_name || null;
  const guestPhone     = params.guestPhone || params.guest_phone || null;
  const bookedByUserId = params.bookedByUserId || params.booked_by_user_id || userId;
  const paymentMethod  = params.paymentMethod || params.payment_method || 'cash';

  // Validate 14-day booking window
  const todayStr = getTodayDateStr();
  const maxAdvanceStr = getMaxAdvanceDateStr(config.MAX_ADVANCE_BOOKING_DAYS || 14);

  const cleanBookingDate = String(bookingDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanBookingDate)) {
    const err = new Error('Invalid booking date. Expected YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }

  if (cleanBookingDate < todayStr) {
    const err = new Error('Cannot book dates in the past.');
    err.status = 400;
    throw err;
  }
  if (cleanBookingDate > maxAdvanceStr) {
    const err = new Error(`Bookings can only be made up to ${config.MAX_ADVANCE_BOOKING_DAYS || 14} days in advance.`);
    err.status = 400;
    throw err;
  }

  // Validate Time Interval format and club operating hours
  const [startH, startM] = String(startTime || '').split(':').map(Number);
  if (isNaN(startH) || isNaN(startM) || (startM !== 0 && startM !== 30)) {
    const err = new Error('Invalid time format. Must be in HH:MM format on 30-minute intervals.');
    err.status = 400;
    throw err;
  }
  if (startH < config.OPENING_HOUR || startH > (config.CLOSING_HOUR - 1) || (startH === config.CLOSING_HOUR - 1 && startM > 0)) {
    const err = new Error(`Bookings must start between ${pad(config.OPENING_HOUR)}:00 and ${pad(config.CLOSING_HOUR - 1)}:00`);
    err.status = 400;
    throw err;
  }

  // Enforce rule: for today's date, cannot book a slot whose start time is before current time
  const slotStartFormatted = `${pad(startH)}:${pad(startM)}`;
  if (cleanBookingDate === todayStr) {
    const currentTimeStr = params.currentTimeOverride || getCurrentTimeStr();
    if (slotStartFormatted < currentTimeStr) {
      const err = new Error(`Cannot book a slot that has already started (${slotStartFormatted} is in the past).`);
      err.status = 400;
      throw err;
    }
  }

  return await transaction(async (conn) => {
    // 1. Verify Court exists and is active
    const [courtRows] = await conn.query('SELECT * FROM courts WHERE id = ? AND is_active = 1', [courtId]);
    if (!courtRows.length) {
      const err = new Error('Court not found or inactive');
      err.status = 404;
      throw err;
    }
    const court = courtRows[0];

    let endH = startH + 1;
    let endM = startM;
    const formattedStartTime = `${pad(startH)}:${pad(startM)}:00`;
    const formattedEndTime = `${pad(endH)}:${pad(endM)}:00`;

    // 3. Member Validation & Daily Limit Check with SELECT FOR UPDATE
    let courtDiscountPct = 0;
    let resolvedMemberId = memberId || null;
    let resolvedUserId   = userId || null;

    if (!resolvedMemberId && resolvedUserId) {
      const [mRows] = await conn.query('SELECT id FROM members WHERE user_id = ?', [resolvedUserId]);
      if (mRows.length) {
        resolvedMemberId = mRows[0].id;
      }
    }

    if (resolvedMemberId) {
      const [mRows] = await conn.query(
        `SELECT m.*, p.court_discount_pct, p.max_bookings_per_day, u.id as user_acc_id
         FROM members m
         JOIN plans p ON m.plan_id = p.id
         JOIN users u ON m.user_id = u.id
         WHERE m.id = ? FOR UPDATE`,
        [resolvedMemberId]
      );
      if (!mRows.length) {
        const err = new Error('Member not found');
        err.status = 404;
        throw err;
      }
      const member = mRows[0];
      resolvedUserId = member.user_acc_id;

      const expStr = new Date(member.expiry_date).toISOString().slice(0, 10);
      if (member.status !== 'active' || expStr < todayStr) {
        const err = new Error('Membership is expired or inactive. Please renew to book at member rate.');
        err.status = 403;
        throw err;
      }

      courtDiscountPct = Number(member.court_discount_pct) || 0;
      const maxDaily = member.max_bookings_per_day || config.DEFAULT_MAX_BOOKINGS_PER_DAY;

      const [dailyCountRows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM bookings WHERE member_id = ? AND booking_date = ? AND status = 'confirmed'`,
        [resolvedMemberId, cleanBookingDate]
      );

      if (dailyCountRows[0].cnt >= maxDaily) {
        const err = new Error(`Daily booking limit of ${maxDaily} bookings per day reached for this member.`);
        err.status = 400;
        throw err;
      }
    }

    // 4. Pricing calculation
    const pricing = calculateCourtPrice(court.base_price_per_hour, courtDiscountPct);

    // 5. Insert Booking record
    const bookingCode = 'BK-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 899 + 100);

    const [insRes] = await conn.query(
      `INSERT INTO bookings (
        booking_code, court_id, user_id, member_id, guest_name, guest_phone,
        booking_date, start_time, end_time, base_price, discount_pct, price_charged,
        status, booked_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [
        bookingCode, court.id, resolvedUserId, resolvedMemberId, guestName || null, guestPhone || null,
        cleanBookingDate, formattedStartTime, formattedEndTime, pricing.basePrice, pricing.discountPct, pricing.priceCharged,
        bookedByUserId
      ]
    );
    const bookingId = insRes.insertId;

    // 6. Insert TWO 30-Minute Booking Slots
    const slot1Start = `${cleanBookingDate} ${pad(startH)}:${pad(startM)}:00`;
    let slot1EndH = startH;
    let slot1EndM = startM + 30;
    if (slot1EndM === 60) {
      slot1EndH += 1;
      slot1EndM = 0;
    }
    const slot1End = `${cleanBookingDate} ${pad(slot1EndH)}:${pad(slot1EndM)}:00`;

    const slot2Start = slot1End;
    const slot2End = `${cleanBookingDate} ${pad(endH)}:${pad(endM)}:00`;

    try {
      await conn.query(
        `INSERT INTO booking_slots (booking_id, court_id, slot_date, slot_start, slot_end)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
        [
          bookingId, court.id, cleanBookingDate, slot1Start, slot1End,
          bookingId, court.id, cleanBookingDate, slot2Start, slot2End
        ]
      );
    } catch (dupErr) {
      if (dupErr.code === 'ER_DUP_ENTRY' || dupErr.errno === 1062) {
        const err = new Error('That slot was just taken. Please select another slot.');
        err.status = 409;
        throw err;
      }
      throw dupErr;
    }

    // 7. Payment Ledger Entry if priceCharged > 0
    if (pricing.priceCharged > 0) {
      const paymentCode = 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 899 + 100);
      await conn.query(
        `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, notes)
         VALUES (?, 'court', ?, ?, ?, ?, 'paid', ?)`,
        [paymentCode, bookingId, resolvedUserId, pricing.priceCharged, paymentMethod, `Court booking ${bookingCode}`]
      );
    }

    return {
      id: bookingId,
      bookingId,
      bookingCode,
      courtName: court.name,
      bookingDate: cleanBookingDate,
      startTime: formattedStartTime,
      endTime: formattedEndTime,
      priceCharged: pricing.priceCharged,
      discountPct: pricing.discountPct
    };
  });
}

/**
 * Cancels a booking, removes slot locks, and updates payment ledger.
 */
async function cancelBooking(bookingId, cancelledByUserId, userRole, reason = 'Cancelled by user') {
  return await transaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    if (!rows.length) {
      const err = new Error('Booking not found');
      err.status = 404;
      throw err;
    }
    const booking = rows[0];

    if (booking.status === 'cancelled') {
      const err = new Error('Booking is already cancelled');
      err.status = 400;
      throw err;
    }

    // If member, ensure they own the booking
    if (userRole === 'member' && booking.user_id !== cancelledByUserId) {
      const err = new Error('You do not have permission to cancel this booking');
      err.status = 403;
      throw err;
    }

    // Mark booking as cancelled
    await conn.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = ? WHERE id = ?`,
      [reason, bookingId]
    );

    // Free the 30-min slots
    await conn.query('DELETE FROM booking_slots WHERE booking_id = ?', [bookingId]);

    // Mark payment as refunded if applicable
    await conn.query(
      `UPDATE payments SET status = 'refunded', refunded_at = NOW(), notes = CONCAT(COALESCE(notes, ''), ' [Refunded on cancellation]')
       WHERE source = 'court' AND reference_id = ?`,
      [bookingId]
    );

    return { success: true, bookingId, status: 'cancelled' };
  });
}

module.exports = {
  getAvailability,
  createBooking,
  cancelBooking
};
