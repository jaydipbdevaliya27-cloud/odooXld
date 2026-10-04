/**
 * @file server/routes/bookings.js
 * @description Court booking routes delegating core rules to bookingService.
 * Supports server-side debounced search, filtering, pagination, schedule matrix,
 * booking creation, and cancellation.
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const bookingService = require('../services/bookingService');
const { todayIST, isPastSlot, nowIST } = require('../utils/time');

const router = express.Router();

// ── GET /api/bookings ─────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const {
      q,
      date,
      from,
      to,
      court_id,
      status,
      sport,
      page = 1,
      limit = 20,
      sort = 'booking_date',
      order = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    // Role-based scoping: members only see their own bookings
    if (user.role === 'member') {
      where += ' AND (b.user_id = ? OR b.booked_by_user_id = ?)';
      params.push(user.id, user.id);
    }

    // Search query
    if (q && q.trim()) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ` AND (
        b.booking_code LIKE ? OR
        u.full_name LIKE ? OR
        u.email LIKE ? OR
        u.phone LIKE ? OR
        b.guest_name LIKE ? OR
        b.guest_phone LIKE ? OR
        c.name LIKE ? OR
        m.member_code LIKE ?
      )`;
      params.push(s, s, s, s, s, s, s, s);
    }

    if (date) {
      where += ' AND b.booking_date = ?';
      params.push(date);
    }
    if (from) {
      where += ' AND b.booking_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND b.booking_date <= ?';
      params.push(to);
    }
    if (court_id) {
      where += ' AND b.court_id = ?';
      params.push(court_id);
    }
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }
    if (sport) {
      where += ' AND c.sport = ?';
      params.push(sport);
    }

    // Sort column allowlist
    const allowedSorts = ['booking_date', 'start_time', 'price_charged', 'created_at', 'status'];
    const sortCol = allowedSorts.includes(sort) ? `b.${sort}` : 'b.booking_date';
    const sortDir = order && order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Auto complete past bookings first
    await bookingService.autoCompleteBookings();

    // Total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
       WHERE ${where}`,
      params
    );

    // List rows
    const [rows] = await db.query(
      `SELECT b.*,
              c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              COALESCE(u.full_name, b.guest_name) AS player_name,
              u.email AS player_email,
              COALESCE(u.phone, b.guest_phone) AS player_phone,
              m.member_code,
              uBooked.full_name AS booked_by_name
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
       LEFT JOIN users uBooked ON b.booked_by_user_id = uBooked.id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}, b.start_time ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/bookings/my ─────────────────────────────────────────────────────
router.get('/my', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { q, status, from, to, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '(b.user_id = ? OR b.booked_by_user_id = ?)';
    const params = [user.id, user.id];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (b.booking_code LIKE ? OR c.name LIKE ? OR c.sport LIKE ?)';
      params.push(s, s, s);
    }
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }
    if (from) {
      where += ' AND b.booking_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND b.booking_date <= ?';
      params.push(to);
    }

    await bookingService.autoCompleteBookings();

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM bookings b JOIN courts c ON b.court_id = c.id WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              b.price_charged AS price
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE ${where}
       ORDER BY b.booking_date DESC, b.start_time DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/bookings/court-matrix ──────────────────────────────────────────
router.get('/court-matrix', requireLogin, async (req, res, next) => {
  try {
    const courtId = parseInt(req.query.court_id, 10) || 1;
    const dateStr = req.query.date || todayIST();

    await bookingService.autoCompleteBookings();

    // 1. Fetch Court details
    const [courtRows] = await db.query(
      'SELECT id, name, sport, surface_type, base_price_per_hour, is_active FROM courts WHERE id = ?',
      [courtId]
    );
    if (!courtRows.length) {
      return res.status(404).json({ error: 'Court not found', code: 'COURT_NOT_FOUND' });
    }
    const court = courtRows[0];

    // 2. Fetch all courts for tabs/switcher
    const [allCourts] = await db.query(
      'SELECT id, name, sport, surface_type, base_price_per_hour FROM courts WHERE is_active = 1 ORDER BY sport, id'
    );

    // 3. Fetch Maintenance Blocks
    const [blocks] = await db.query(
      'SELECT id, start_time, end_time, reason, created_at FROM court_blocks WHERE court_id = ? AND block_date = ?',
      [courtId, dateStr]
    );

    // 4. Fetch Bookings for this court on this date
    const [bookingRows] = await db.query(
      `SELECT b.*,
              COALESCE(u.full_name, b.guest_name) AS player_name,
              u.email AS player_email,
              COALESCE(u.phone, b.guest_phone) AS player_phone,
              m.member_code,
              p.amount AS payment_amount, p.status AS payment_status, p.method AS payment_method
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
       LEFT JOIN payments p ON p.reference_id = b.id AND p.source = 'court_booking' AND p.status = 'paid'
       WHERE b.court_id = ? AND b.booking_date = ? AND b.status != 'cancelled'
       ORDER BY b.start_time ASC`,
      [courtId, dateStr]
    );

    // 5. Fetch 30-min booking slots
    const [slotRows] = await db.query(
      `SELECT bs.*, b.id AS booking_id
       FROM booking_slots bs
       JOIN bookings b ON bs.booking_id = b.id
       WHERE bs.court_id = ? AND bs.slot_date = ? AND b.status != 'cancelled'`,
      [courtId, dateStr]
    );

    const slotBookingMap = new Map();
    slotRows.forEach(s => {
      const timeParts = s.slot_start instanceof Date
        ? `${String(s.slot_start.getHours()).padStart(2, '0')}:${String(s.slot_start.getMinutes()).padStart(2, '0')}`
        : String(s.slot_start).slice(11, 16);
      const bObj = bookingRows.find(b => b.id === s.booking_id);
      if (bObj) {
        slotBookingMap.set(timeParts, bObj);
      }
    });

    // 6. Generate 30-min Matrix Slots from 06:00 to 22:00
    const matrix = [];
    let totalRevenue = 0;
    let bookedSlotsCount = 0;
    let blockedSlotsCount = 0;
    let availableSlotsCount = 0;

    const opening = 6;
    const closing = 22;

    for (let h = opening; h < closing; h++) {
      for (const m of [0, 30]) {
        const timeLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const endH = m === 30 ? h + 1 : h;
        const endM = m === 30 ? '00' : '30';
        const endTimeLabel = `${String(endH).padStart(2, '0')}:${endM}`;
        const slotInPast = isPastSlot(dateStr, timeLabel);

        // Check maintenance block
        const matchingBlock = blocks.find(b => {
          const bStart = String(b.start_time).slice(0, 5);
          const bEnd = String(b.end_time).slice(0, 5);
          return timeLabel >= bStart && timeLabel < bEnd;
        });

        // Check booking
        const matchingBooking = slotBookingMap.get(timeLabel) || bookingRows.find(b => {
          const bStart = String(b.start_time).slice(0, 5);
          const bEnd = String(b.end_time).slice(0, 5);
          return timeLabel >= bStart && timeLabel < bEnd;
        });

        let status = 'available';
        if (matchingBlock) {
          status = 'blocked';
          blockedSlotsCount++;
        } else if (matchingBooking) {
          status = matchingBooking.status === 'completed' ? 'completed' : 'booked';
          bookedSlotsCount++;
        } else if (slotInPast) {
          status = 'past';
        } else {
          availableSlotsCount++;
        }

        matrix.push({
          time_slot: `${timeLabel} – ${endTimeLabel}`,
          start_time: timeLabel,
          end_time: endTimeLabel,
          is_past: slotInPast,
          status,
          booking: matchingBooking ? {
            id: matchingBooking.id,
            booking_code: matchingBooking.booking_code,
            player_name: matchingBooking.player_name,
            player_phone: matchingBooking.player_phone,
            player_email: matchingBooking.player_email,
            member_code: matchingBooking.member_code,
            price_charged: Number(matchingBooking.price_charged),
            base_price: Number(matchingBooking.base_price),
            discount_pct: Number(matchingBooking.discount_pct || 0),
            source: matchingBooking.source,
            status: matchingBooking.status,
            start_time: matchingBooking.start_time,
            end_time: matchingBooking.end_time
          } : null,
          block: matchingBlock ? {
            id: matchingBlock.id,
            reason: matchingBlock.reason,
            start_time: matchingBlock.start_time,
            end_time: matchingBlock.end_time
          } : null
        });
      }
    }

    bookingRows.forEach(b => {
      totalRevenue += Number(b.price_charged || 0);
    });

    const totalSlots = matrix.length;
    const occupancyRate = totalSlots > 0 ? Math.round(((bookedSlotsCount + blockedSlotsCount) / totalSlots) * 100) : 0;

    res.json({
      court,
      allCourts,
      date: dateStr,
      summary: {
        total_slots: totalSlots,
        booked_slots: bookedSlotsCount,
        blocked_slots: blockedSlotsCount,
        available_slots: availableSlotsCount,
        occupancy_rate: occupancyRate,
        revenue_today: totalRevenue,
        bookings_count: bookingRows.length
      },
      matrix
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/bookings/availability ──────────────────────────────────────────
router.get('/availability', requireLogin, async (req, res, next) => {
  try {
    const date = req.query.date || todayIST();
    const sport = req.query.sport || null;
    const currentUserId = req.session.user.id;

    const result = await bookingService.getAvailability(date, sport, currentUserId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/bookings/:id ───────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*,
              c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              COALESCE(u.full_name, b.guest_name) AS player_name,
              u.email AS player_email,
              COALESCE(u.phone, b.guest_phone) AS player_phone,
              m.member_code,
              uBooked.full_name AS booked_by_name
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
       LEFT JOIN users uBooked ON b.booked_by_user_id = uBooked.id
       WHERE b.id = ?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Booking not found', code: 'BOOKING_NOT_FOUND' });
    }

    const booking = rows[0];
    if (req.session.user.role === 'member' && booking.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }

    // Get participants
    const [participants] = await db.query(
      'SELECT participant_name, participant_phone FROM booking_participants WHERE booking_id = ?',
      [booking.id]
    );
    booking.participants = participants;

    // Get payments
    const [payments] = await db.query(
      `SELECT id, payment_code, amount, method, status, paid_at, notes
       FROM payments
       WHERE (source IN ('court', 'court_booking') AND reference_id = ?)
          OR (source = 'court_booking' AND user_id = ? AND paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
       ORDER BY id DESC LIMIT 5`,
      [booking.id, booking.user_id || 0]
    );
    booking.payments = payments;

    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/bookings ──────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  validate({
    court_id: { required: true, type: 'integer', min: 1, label: 'Court' },
    booking_date: { required: true, type: 'date', label: 'Booking date' },
    start_time: { required: true, type: 'time', label: 'Start time' }
  }),
  async (req, res, next) => {
    try {
      const user = req.session.user;
      const {
        court_id,
        booking_date,
        start_time,
        member_id,
        user_id,
        guest_name,
        guest_phone,
        payment_method = 'online',
        participants = []
      } = req.body;

      let effectiveMemberId = null;
      let effectiveUserId = null;
      let effectiveGuestName = null;
      let effectiveGuestPhone = null;

      if (user.role === 'member') {
        // Members always book for themselves
        effectiveUserId = user.id;
        const [mRows] = await db.query('SELECT id FROM members WHERE user_id = ?', [user.id]);
        effectiveMemberId = mRows.length ? mRows[0].id : null;
      } else {
        // Staff or Owner booking
        if (member_id || user_id) {
          if (member_id) {
            effectiveMemberId = member_id;
            const [mRows] = await db.query('SELECT user_id FROM members WHERE id = ?', [member_id]);
            effectiveUserId = mRows.length ? mRows[0].user_id : null;
          } else {
            effectiveUserId = user_id;
            const [mRows] = await db.query('SELECT id FROM members WHERE user_id = ?', [user_id]);
            effectiveMemberId = mRows.length ? mRows[0].id : null;
          }
        } else {
          // Walk-in guest
          if (!guest_name || guest_name.trim().length < 2) {
            return res.status(400).json({
              error: 'Guest name is required for walk-in bookings.',
              code: 'GUEST_NAME_REQUIRED',
              fields: { guest_name: 'Enter guest name (at least 2 characters)' }
            });
          }
          if (!guest_phone || !/^[6-9]\d{9}$/.test(guest_phone.replace(/[\s\-+]/g, '').slice(-10))) {
            return res.status(400).json({
              error: 'Valid 10-digit mobile number required for guest booking.',
              code: 'GUEST_PHONE_REQUIRED',
              fields: { guest_phone: 'Enter a valid 10-digit mobile number' }
            });
          }
          effectiveGuestName = guest_name.trim();
          effectiveGuestPhone = guest_phone.replace(/[\s\-+]/g, '').slice(-10);
        }
      }

      const booking = await bookingService.createBooking({
        courtId: parseInt(court_id, 10),
        bookingDate: booking_date,
        startTime: start_time.slice(0, 5),
        memberId: effectiveMemberId,
        userId: effectiveUserId,
        guestName: effectiveGuestName,
        guestPhone: effectiveGuestPhone,
        bookedByUserId: user.id,
        source: user.role === 'member' ? 'member_portal' : 'front_desk',
        paymentMethod: payment_method || 'online',
        participants
      });

      res.status(201).json(booking);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      next(err);
    }
  }
);

// ── GET /api/bookings/my ────────────────────────────────────────────────────
router.get('/my', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { q, status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '(b.user_id = ? OR b.booked_by_user_id = ?)';
    const params = [user.id, user.id];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (b.booking_code LIKE ? OR c.name LIKE ? OR c.sport LIKE ?)';
      params.push(s, s, s);
    }
    if (status) {
      where += ' AND b.status = ?';
      params.push(status);
    }

    await bookingService.autoCompleteBookings();

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT b.*,
              c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              b.price_charged AS price
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       WHERE ${where}
       ORDER BY b.booking_date DESC, b.start_time DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/bookings/:id ───────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const [rows] = await db.query(
      `SELECT b.*,
              c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              m.member_code,
              COALESCE(u.full_name, m.full_name, b.guest_name) AS player_name,
              COALESCE(u.email, m.email) AS player_email,
              COALESCE(u.phone, m.phone, b.guest_phone) AS player_phone,
              p.name AS member_plan_name,
              booker.full_name AS booked_by_name, booker.email AS booked_by_email, booker.role AS booked_by_role
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN members m ON b.member_id = m.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN plans p ON m.plan_id = p.id
       LEFT JOIN users booker ON b.booked_by_user_id = booker.id
       WHERE b.id = ?`,
      [bookingId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Booking not found', code: 'BOOKING_NOT_FOUND' });
    }

    const booking = rows[0];

    // Fetch linked payment logs
    const [payments] = await db.query(
      `SELECT * FROM payments WHERE source = 'court' AND reference_id = ? ORDER BY id DESC`,
      [bookingId]
    );

    // Fetch slot intervals
    const [slots] = await db.query(
      `SELECT * FROM booking_slots WHERE booking_id = ? ORDER BY slot_time ASC`,
      [bookingId]
    );

    res.json({
      data: {
        ...booking,
        payments,
        slots
      },
      ...booking,
      payments,
      slots
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/bookings/:id ── Staff/Owner status update ─────────────────────
router.put('/:id', requireLogin, requireRole(['staff', 'owner']), async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const { status, notes } = req.body;

    const ALLOWED_STATUSES = ['confirmed', 'completed', 'cancelled', 'no_show'];
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}`,
        code: 'INVALID_STATUS'
      });
    }

    const [existing] = await db.query('SELECT id, status FROM bookings WHERE id = ?', [bookingId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Booking not found', code: 'BOOKING_NOT_FOUND' });
    }

    const updates = [];
    const params = [];
    if (status) {
      updates.push('status = ?');
      params.push(status);
      if (status === 'cancelled') {
        updates.push('cancelled_at = NOW()');
      }
    }
    // Store staff notes in cancellation_reason (general notes field)
    if (notes !== undefined && notes !== null) {
      updates.push('cancellation_reason = ?');
      params.push((notes || '').trim().slice(0, 255) || null);
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update', code: 'NO_UPDATES' });
    }

    updates.push('updated_at = NOW()');
    params.push(bookingId);

    await db.query(`UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updated] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport FROM bookings b
       JOIN courts c ON b.court_id = c.id WHERE b.id = ?`,
      [bookingId]
    );

    res.json({ message: 'Booking updated successfully', data: updated[0] });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/bookings/:id & POST /api/bookings/:id/cancel ───────────────
const handleCancellation = async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const reason = req.body?.reason || req.body?.cancellation_reason || 'Cancelled by user';

    const result = await bookingService.cancelBooking({
      bookingId,
      cancellingUserId: req.session.user.id,
      userRole: req.session.user.role,
      cancellationReason: reason
    });

    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    next(err);
  }
};

router.delete('/:id', requireLogin, async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const force = req.query.force === 'true' || req.body?.force === true;

    if (force && req.session.user.role === 'owner') {
      await db.transaction(async (conn) => {
        await conn.query('DELETE FROM booking_slots WHERE booking_id = ?', [bookingId]);
        await conn.query('DELETE FROM booking_participants WHERE booking_id = ?', [bookingId]);
        await conn.query('DELETE FROM payments WHERE source = "court" AND reference_id = ?', [bookingId]);
        await conn.query('DELETE FROM bookings WHERE id = ?', [bookingId]);
      });
      return res.json({ ok: true, message: 'Booking permanently deleted' });
    }

    return handleCancellation(req, res, next);
  } catch (err) {
    next(err);
  }
});
router.post('/:id/cancel', requireLogin, handleCancellation);

module.exports = router;
