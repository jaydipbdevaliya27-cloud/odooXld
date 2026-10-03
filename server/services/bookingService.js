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
 * Calculates availability for all courts on a given date.
 * Each court booking is 60 minutes long, constructed of two 30-minute slot units.
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string|null} sport - optional filter ('tennis' or 'cricket')
 * @param {number|null} currentUserId - logged in user's ID for highlighting 'mine'
 * @returns {Promise<object>} { date, courts, slots }
 */
async function getAvailability(dateStr, sport = null, currentUserId = null) {
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

  // Map of "courtId_HH:MM" -> booking_user_id
  const bookedMap = new Map();
  slotRows.forEach(s => {
    const d = new Date(s.slot_start);
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    bookedMap.set(`${s.court_id}_${h}:${m}`, s.booking_user_id);
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

      const courtStatuses = courts.map(court => {
        const k1 = slot1Key(court.id);
        const k2 = slot2Key(court.id);

        const user1 = bookedMap.get(k1);
        const user2 = bookedMap.get(k2);

        let status = 'available';
        if (user1 !== undefined || user2 !== undefined) {
          if (currentUserId && (user1 === currentUserId || user2 === currentUserId)) {
            status = 'mine';
          } else {
            status = 'booked';
          }
        }

        return {
          courtId: court.id,
          courtName: court.name,
          sport: court.sport,
          basePricePerHour: court.base_price_per_hour,
          status
        };
      });

      slots.push({
        startTime,
        endTime,
        courts: courtStatuses
      });
    }
  }

  return { date: dateStr, courts, slots };
}

/**
 * Creates a court booking inside an atomic transaction.
 * Validates court, operational hours, member daily limits, calculates pricing,
 * and inserts 30-min slot rows (which enforce uniqueness at the DB level).
 */
async function createBooking({
  courtId,
  bookingDate,
  startTime,
  userId = null,
  memberId = null,
  guestName = null,
  guestPhone = null,
  bookedByUserId,
  paymentMethod = 'cash'
}) {
  return await transaction(async (conn) => {
    // 1. Verify Court exists and is active
    const [courtRows] = await conn.query('SELECT * FROM courts WHERE id = ? AND is_active = 1', [courtId]);
    if (!courtRows.length) {
      const err = new Error('Court not found or inactive');
      err.status = 404;
      throw err;
    }
    const court = courtRows[0];

    // 2. Validate Time Interval
    const [startH, startM] = startTime.split(':').map(Number);
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

    let endH = startH + 1;
    let endM = startM;
    const formattedStartTime = `${pad(startH)}:${pad(startM)}:00`;
    const formattedEndTime = `${pad(endH)}:${pad(endM)}:00`;

    // 3. Member Validation & Daily Limit Check with SELECT FOR UPDATE
    let courtDiscountPct = 0;
    let resolvedMemberId = memberId || null;
    let resolvedUserId = userId || null;

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

      const todayStr = new Date().toISOString().slice(0, 10);
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
        [resolvedMemberId, bookingDate]
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
        bookingDate, formattedStartTime, formattedEndTime, pricing.basePrice, pricing.discountPct, pricing.priceCharged,
        bookedByUserId
      ]
    );
    const bookingId = insRes.insertId;

    // 6. Insert TWO 30-Minute Booking Slots
    const slot1Start = `${bookingDate} ${pad(startH)}:${pad(startM)}:00`;
    let slot1EndH = startH;
    let slot1EndM = startM + 30;
    if (slot1EndM === 60) {
      slot1EndH += 1;
      slot1EndM = 0;
    }
    const slot1End = `${bookingDate} ${pad(slot1EndH)}:${pad(slot1EndM)}:00`;

    const slot2Start = slot1End;
    const slot2End = `${bookingDate} ${pad(endH)}:${pad(endM)}:00`;

    try {
      await conn.query(
        `INSERT INTO booking_slots (booking_id, court_id, slot_date, slot_start, slot_end)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
        [
          bookingId, court.id, bookingDate, slot1Start, slot1End,
          bookingId, court.id, bookingDate, slot2Start, slot2End
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
      bookingId,
      bookingCode,
      courtName: court.name,
      bookingDate,
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
