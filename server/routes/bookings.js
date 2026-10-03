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
const { todayIST } = require('../utils/time');

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
    if (q && q.trim().length >= 2) {
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
              m.member_code
       FROM bookings b
       JOIN courts c ON b.court_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       LEFT JOIN members m ON b.member_id = m.id
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

router.delete('/:id', requireLogin, handleCancellation);
router.post('/:id/cancel', requireLogin, handleCancellation);

module.exports = router;
