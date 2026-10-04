/**
 * @file server/services/bookingService.js
 * @description Core court booking business logic.
 * Enforces atomic slot reservation, daily member limits, past slot rejection,
 * double-booking prevention with UNIQUE constraints, and IST time validation.
 */

const { query, transaction } = require('../db');
const config = require('../config');
const { calculateCourtPrice } = require('./pricing');
const { todayIST, nowIST, isPastSlot, addMinutes, timeIST } = require('../utils/time');

/**
 * Helper to check if a YYYY-MM-DD date falls on a Friday.
 */
function isFriday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.getUTCDay() === 5;
}

/**
 * Helper to pad numbers to 2 digits.
 */
function pad(num) {
  return String(num).padStart(2, '0');
}

/**
 * Auto-completes any confirmed booking whose end date-time has passed in IST.
 */
async function autoCompleteBookings() {
  try {
    const today = todayIST();
    const currTime = timeIST();
    await query(
      `UPDATE bookings
       SET status = 'completed'
       WHERE status = 'confirmed'
         AND (booking_date < ? OR (booking_date = ? AND end_time <= ?))`,
      [today, today, currTime]
    );
  } catch (err) {
    console.error('[WARN] Auto-complete bookings error:', err.message);
  }
}

/**
 * Calculates availability for all courts on a given date.
 * Returns 30-minute start slots across opening hours.
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string|null} sport - optional sport filter
 * @param {number|null} currentUserId - logged in user's ID
 * @returns {Promise<object>} { date, courts, slots }
 */
async function getAvailability(dateStr, sport = null, currentUserId = null) {
  await autoCompleteBookings();

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

  // Fetch court blocks on this date
  const [blocks] = await query(
    'SELECT court_id, start_time, end_time, reason FROM court_blocks WHERE block_date = ?',
    [dateStr]
  );

  // Map of booked slots: "courtId_HH:MM" -> booking_user_id
  const bookedMap = new Map();
  slotRows.forEach(s => {
    const d = new Date(s.slot_start);
    // Parse HH:MM from slot_start
    const timeParts = s.slot_start instanceof Date 
      ? `${pad(s.slot_start.getHours())}:${pad(s.slot_start.getMinutes())}`
      : String(s.slot_start).slice(11, 16);
    bookedMap.set(`${s.court_id}_${timeParts}`, s.booking_user_id);
  });

  // Build 30-minute start time slots (from OPENING_HOUR to CLOSING_HOUR - 1)
  const slots = [];
  for (let h = config.OPENING_HOUR; h < config.CLOSING_HOUR; h++) {
    for (const m of [0, 30]) {
      // Don't generate slot if 60-min session would exceed CLOSING_HOUR
      if (h === config.CLOSING_HOUR - 1 && m > 0) continue;

      const timeLabel = `${pad(h)}:${pad(m)}`;
      const secondHalf = m === 0 ? `${pad(h)}:30` : `${pad(h + 1)}:00`;
      const endTimeLabel = addMinutes(timeLabel, 60);

      const slotInPast = isPastSlot(dateStr, timeLabel);

      const courtStatus = {};
      courts.forEach(court => {
        const key1 = `${court.id}_${timeLabel}`;
        const key2 = `${court.id}_${secondHalf}`;

        // Check maintenance blocks
        const isBlocked = blocks.some(b => {
          if (b.court_id !== court.id) return false;
          const bStart = b.start_time.slice(0, 5);
          const bEnd = b.end_time.slice(0, 5);
          return (timeLabel >= bStart && timeLabel < bEnd) || (secondHalf >= bStart && secondHalf < bEnd);
        });

        if (isBlocked) {
          courtStatus[court.id] = {
            available: false,
            isPast: slotInPast,
            isBlocked: true,
            isMine: false,
            reason: 'Maintenance Block'
          };
          return;
        }

        const isFri = isFriday(dateStr);
        const booked1 = bookedMap.has(key1);
        const booked2 = bookedMap.has(key2);

        if (booked1 || booked2) {
          const bookedUser = bookedMap.get(key1) || bookedMap.get(key2);
          const isMine = !!(currentUserId && bookedUser === currentUserId);
          if (isFri) {
            // On Friday, multiple bookings are allowed on the same time slot
            courtStatus[court.id] = {
              available: !slotInPast,
              isPast: slotInPast,
              isBlocked: false,
              isMine,
              isFridayMulti: true,
              reason: isMine ? 'Your Booking (Friday Open Session)' : (slotInPast ? 'Time has passed' : 'Available (Friday Open Session)')
            };
          } else {
            courtStatus[court.id] = {
              available: false,
              isPast: slotInPast,
              isBlocked: false,
              isMine,
              isFridayMulti: false,
              reason: isMine ? 'Your Booking' : 'Booked'
            };
          }
        } else {
          courtStatus[court.id] = {
            available: !slotInPast,
            isPast: slotInPast,
            isBlocked: false,
            isMine: false,
            isFridayMulti: isFri,
            reason: slotInPast ? 'Time has passed' : 'Available'
          };
        }
      });

      slots.push({
        time: timeLabel,
        endTime: endTimeLabel,
        isPast: slotInPast,
        courtStatus
      });
    }
  }

  return { date: dateStr, courts, slots };
}

/**
 * Creates a court booking inside an atomic transaction.
 * 
 * @param {object} params
 * @param {number} params.courtId
 * @param {string} params.bookingDate - 'YYYY-MM-DD'
 * @param {string} params.startTime - 'HH:MM'
 * @param {number|null} [params.memberId]
 * @param {number|null} [params.userId]
 * @param {string|null} [params.guestName]
 * @param {string|null} [params.guestPhone]
 * @param {number} params.bookedByUserId
 * @param {string} [params.source='member_portal']
 * @param {string} [params.paymentMethod='online']
 * @param {Array<string>} [params.participants=[]]
 * @returns {Promise<object>} Created booking
 */
async function createBooking({
  courtId,
  bookingDate,
  startTime,
  memberId = null,
  userId = null,
  guestName = null,
  guestPhone = null,
  bookedByUserId,
  source = 'member_portal',
  paymentMethod = 'online',
  participants = []
}) {
  await autoCompleteBookings();

  // 1. Validate past slot
  if (isPastSlot(bookingDate, startTime)) {
    const err = new Error('Cannot book a time slot in the past.');
    err.code = 'SLOT_IN_PAST';
    err.status = 400;
    throw err;
  }

  // 2. Validate advance booking limit
  const today = todayIST();
  const diffDays = Math.ceil((new Date(bookingDate) - new Date(today)) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const err = new Error('Cannot book a date in the past.');
    err.code = 'SLOT_IN_PAST';
    err.status = 400;
    throw err;
  }
  if (diffDays > config.MAX_ADVANCE_BOOKING_DAYS) {
    const err = new Error(`Bookings are only permitted up to ${config.MAX_ADVANCE_BOOKING_DAYS} days in advance.`);
    err.code = 'ADVANCE_LIMIT_EXCEEDED';
    err.status = 400;
    throw err;
  }

  // 3. Time grid verification (60 minutes length)
  const [startH, startM] = startTime.split(':').map(Number);
  if (isNaN(startH) || (startM !== 0 && startM !== 30)) {
    const err = new Error('Bookings must start on the hour or half-hour.');
    err.code = 'INVALID_TIME_GRID';
    err.status = 400;
    throw err;
  }
  if (startH < config.OPENING_HOUR || (startH >= config.CLOSING_HOUR - 1 && startM > 0) || startH >= config.CLOSING_HOUR) {
    const err = new Error(`Club hours are ${config.OPENING_HOUR}:00 to ${config.CLOSING_HOUR}:00.`);
    err.code = 'OUTSIDE_OPERATING_HOURS';
    err.status = 400;
    throw err;
  }

  const endTime = addMinutes(startTime, config.BOOKING_LENGTH_MINUTES);
  const secondSlotTime = addMinutes(startTime, config.SLOT_LENGTH_MINUTES);

  // 4. Guest vs Member validation
  if (!memberId && !guestName) {
    const err = new Error('Booking must have either an active member or a guest name.');
    err.code = 'MISSING_BOOKER';
    err.status = 400;
    throw err;
  }

  return await transaction(async (conn) => {
    // Check court existence and active state
    const [courts] = await conn.query('SELECT * FROM courts WHERE id = ? FOR UPDATE', [courtId]);
    if (!courts.length || !courts[0].is_active) {
      const err = new Error('The selected court is unavailable or inactive.');
      err.code = 'COURT_INACTIVE';
      err.status = 400;
      throw err;
    }
    const court = courts[0];

    // Check maintenance blocks
    const [blocks] = await conn.query(
      `SELECT * FROM court_blocks
       WHERE court_id = ? AND block_date = ?
         AND ((start_time <= ? AND end_time > ?) OR (start_time < ? AND end_time >= ?))`,
      [courtId, bookingDate, startTime, startTime, endTime, endTime]
    );
    if (blocks.length > 0) {
      const err = new Error(`Court is blocked for maintenance: ${blocks[0].reason}`);
      err.code = 'COURT_BLOCKED';
      err.status = 409;
      throw err;
    }

    let discountPct = 0;
    let effectiveMemberId = memberId;
    let effectiveUserId = userId;

    if (memberId || userId) {
      let memberQuery = 'SELECT m.*, p.name AS plan_name, p.court_discount_pct, p.max_bookings_per_day FROM members m JOIN plans p ON m.plan_id = p.id WHERE ';
      const memberParams = [];
      if (memberId) {
        memberQuery += 'm.id = ?';
        memberParams.push(memberId);
      } else {
        memberQuery += 'm.user_id = ?';
        memberParams.push(userId);
      }
      memberQuery += ' FOR UPDATE';

      const [mRows] = await conn.query(memberQuery, memberParams);
      if (!mRows.length) {
        const err = new Error('Member profile not found.');
        err.code = 'MEMBER_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const member = mRows[0];
      effectiveMemberId = member.id;
      effectiveUserId = member.user_id;

      // Verify active membership status
      if (member.status !== 'active') {
        const err = new Error(`Member is currently ${member.status}. Renew membership to book at member rates.`);
        err.code = 'MEMBER_INACTIVE';
        err.status = 400;
        throw err;
      }
      if (new Date(member.expiry_date) < new Date(today)) {
        const err = new Error('Membership has expired. Please renew your plan.');
        err.code = 'MEMBER_EXPIRED';
        err.status = 400;
        throw err;
      }

      // Check daily booking limit (excluding cancelled)
      const [bCount] = await conn.query(
        `SELECT COUNT(*) as total FROM bookings
         WHERE member_id = ? AND booking_date = ? AND status = 'confirmed'`,
        [effectiveMemberId, bookingDate]
      );

      const maxLimit = Math.min(member.max_bookings_per_day || 2, config.DEFAULT_MAX_BOOKINGS_PER_DAY);
      if (bCount[0].total >= maxLimit) {
        const err = new Error(`You have already booked ${bCount[0].total} session(s) on this date (daily limit is ${maxLimit}).`);
        err.code = 'DAILY_LIMIT_REACHED';
        err.status = 409;
        throw err;
      }

      discountPct = member.court_discount_pct;
    }

    // Pricing calculation
    const pricing = calculateCourtPrice(court.base_price_per_hour, discountPct);

    // Generate unique booking code
    const bookingCode = `BK-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    // Insert booking
    const [bRes] = await conn.query(
      `INSERT INTO bookings (
        booking_code, court_id, user_id, member_id, guest_name, guest_phone,
        booking_date, start_time, end_time, base_price, discount_pct, price_charged,
        source, status, booked_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
      [
        bookingCode, courtId, effectiveUserId, effectiveMemberId,
        guestName || null, guestPhone || null,
        bookingDate, startTime, endTime, pricing.basePrice, pricing.discountPct, pricing.priceCharged,
        source, bookedByUserId
      ]
    );
    const bookingId = bRes.insertId;

    // Slot datetime timestamps for atomic slot reservation
    const slot1Start = `${bookingDate} ${startTime}:00`;
    const slot1End   = `${bookingDate} ${secondSlotTime}:00`;
    const slot2Start = `${bookingDate} ${secondSlotTime}:00`;
    const slot2End   = `${bookingDate} ${endTime}:00`;

    // 5. On non-Friday days, strictly prevent double-booking on same court & time slot
    const fridayBooking = isFriday(bookingDate);
    if (!fridayBooking) {
      const [existingSlots] = await conn.query(
        `SELECT bs.id FROM booking_slots bs
         JOIN bookings b ON bs.booking_id = b.id
         WHERE bs.court_id = ? AND bs.slot_date = ?
           AND b.status = 'confirmed'
           AND (bs.slot_start = ? OR bs.slot_start = ?)
         FOR UPDATE`,
        [courtId, bookingDate, slot1Start, slot2Start]
      );
      if (existingSlots.length > 0) {
        const err = new Error('The selected court and time slot was just booked by another player.');
        err.code = 'SLOT_TAKEN';
        err.status = 409;
        throw err;
      }
    }

    try {
      await conn.query(
        `INSERT INTO booking_slots (booking_id, court_id, slot_date, slot_start, slot_end)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
        [
          bookingId, courtId, bookingDate, slot1Start, slot1End,
          bookingId, courtId, bookingDate, slot2Start, slot2End
        ]
      );
    } catch (slotErr) {
      if (slotErr.code === 'ER_DUP_ENTRY') {
        const err = new Error('The selected court and time slot was just booked by another player.');
        err.code = 'SLOT_TAKEN';
        err.status = 409;
        throw err;
      }
      throw slotErr;
    }

    // Record extra participants if any
    if (Array.isArray(participants) && participants.length > 0) {
      for (const p of participants.slice(0, 4)) {
        if (p && p.trim()) {
          await conn.query(
            'INSERT INTO booking_participants (booking_id, participant_name) VALUES (?, ?)',
            [bookingId, p.trim()]
          );
        }
      }
    }

    // Record payment ledger row
    if (pricing.priceCharged > 0) {
      const payCode = `PAY-BK-${Date.now()}`;
      await conn.query(
        `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
         VALUES (?, 'court', ?, ?, ?, ?, 'paid', NOW())`,
        [payCode, bookingId, effectiveUserId, pricing.priceCharged, paymentMethod]
      );
    }

    // Fetch and return full created booking record
    const [fullRows] = await conn.query(
      `SELECT b.*, c.name as court_name, c.sport,
              COALESCE(u.full_name, b.guest_name) AS player_name,
              COALESCE(u.email, '—') AS player_email,
              COALESCE(u.phone, b.guest_phone, '—') AS player_phone,
              m.member_code
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
       WHERE b.id = ?`,
      [bookingId]
    );

    return fullRows[0];
  });
}

/**
 * Cancels a booking, validates authorization & cancellation cutoff window,
 * frees the booking_slots, and logs a negative refund entry in payments.
 */
async function cancelBooking({
  bookingId,
  cancellingUserId,
  userRole,
  cancellationReason = 'User cancelled'
}) {
  await autoCompleteBookings();

  return await transaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ? FOR UPDATE', [bookingId]);
    if (!rows.length) {
      const err = new Error('Booking record not found.');
      err.code = 'BOOKING_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const booking = rows[0];

    if (booking.status === 'cancelled') {
      const err = new Error('This booking is already cancelled.');
      err.code = 'BOOKING_ALREADY_CANCELLED';
      err.status = 409;
      throw err;
    }

    if (booking.status === 'completed') {
      const err = new Error('Completed bookings cannot be cancelled.');
      err.code = 'BOOKING_COMPLETED';
      err.status = 409;
      throw err;
    }

    // Check if booking already started or passed
    if (isPastSlot(booking.booking_date, booking.start_time)) {
      const err = new Error('Cannot cancel a booking that has already started or passed.');
      err.code = 'BOOKING_STARTED';
      err.status = 409;
      throw err;
    }

    // Member authorization check
    if (userRole === 'member') {
      if (booking.user_id !== cancellingUserId) {
        const err = new Error('You can only cancel your own bookings.');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }

      // Check cancellation cutoff window (default 2 hours)
      const [setRows] = await conn.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'cancellation_cutoff_hours'"
      );
      const cutoffHours = setRows.length ? Number(setRows[0].setting_value) || 2 : 2;

      const slotDate = new Date(`${booking.booking_date}T${booking.start_time}:00+05:30`);
      const now = new Date();
      const hoursUntilSlot = (slotDate.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilSlot < cutoffHours) {
        const err = new Error(`Bookings cannot be cancelled within ${cutoffHours} hours of the start time.`);
        err.code = 'CANCELLATION_CUTOFF_EXCEEDED';
        err.status = 409;
        throw err;
      }
    }

    // Update status
    await conn.query(
      `UPDATE bookings
       SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = ?
       WHERE id = ?`,
      [cancellationReason, bookingId]
    );

    // Free the unique slots
    await conn.query('DELETE FROM booking_slots WHERE booking_id = ?', [bookingId]);

    // Record refund in payments ledger if paid
    const [payRows] = await conn.query(
      `SELECT * FROM payments WHERE source = 'court' AND reference_id = ? AND status = 'paid'`,
      [bookingId]
    );

    if (payRows.length > 0) {
      const originalPay = payRows[0];
      const refundCode = `REF-${Date.now()}`;
      await conn.query(
        `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, refund_of_id, notes, paid_at, refunded_at)
         VALUES (?, 'court', ?, ?, ?, ?, 'refunded', ?, 'Cancellation refund', NOW(), NOW())`,
        [refundCode, bookingId, originalPay.user_id, -Math.abs(Number(originalPay.amount)), originalPay.method, originalPay.id]
      );
    }

    return { ok: true, bookingId, message: 'Booking cancelled successfully and slot released.' };
  });
}

module.exports = {
  getAvailability,
  createBooking,
  cancelBooking,
  autoCompleteBookings
};
