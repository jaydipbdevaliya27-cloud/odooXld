/**
 * @file server/routes/bookings.js
 * @description Court booking routes.
 * GET  /api/bookings               – list bookings (filtered by role/member)
 * GET  /api/bookings/:id           – booking detail
 * POST /api/bookings               – create booking (runs transaction in service)
 * POST /api/bookings/:id/cancel    – cancel booking
 */

const express        = require('express');
const bookingService = require('../services/bookingService');
const db             = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/bookings/availability ──────────────────────────────────────────
// Returns 60-min slots starting every 30 mins with availability status
router.get('/availability', requireLogin, async (req, res, next) => {
  try {
    const { date, sport, currentTime } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });
    const availability = await bookingService.getAvailability(date, sport || null, req.session.user.id, currentTime || null);
    res.json(availability);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ── GET /api/bookings ────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const u = req.session.user;
    let sql, params;

    if (u.role === 'member') {
      // Members only see their own bookings
      sql = `SELECT b.*, c.name AS court_name, c.sport
               FROM bookings b JOIN courts c ON b.court_id = c.id
              WHERE b.user_id = ? ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 50`;
      params = [u.id];
    } else {
      // Staff/owner see all, with optional date filter
      const { date, court_id, status } = req.query;
      let where = '1=1';
      params = [];
      if (date)     { where += ' AND b.booking_date = ?'; params.push(date); }
      if (court_id) { where += ' AND b.court_id = ?';     params.push(court_id); }
      if (status)   { where += ' AND b.status = ?';       params.push(status); }
      sql = `SELECT b.*, c.name AS court_name, c.sport, u.full_name AS member_name
               FROM bookings b
               JOIN courts c ON b.court_id = c.id
               LEFT JOIN users u ON b.user_id = u.id
              WHERE ${where}
              ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 100`;
    }

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/bookings/:id ────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport
         FROM bookings b JOIN courts c ON b.court_id = c.id
        WHERE b.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });

    // Members can only see their own bookings
    const booking = rows[0];
    if (req.session.user.role === 'member' && booking.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(booking);
  } catch (err) { next(err); }
});

// ── POST /api/bookings ───────────────────────────────────────────────────────
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const booking = await bookingService.createBooking({
      ...req.body,
      currentTimeOverride: req.body.currentTimeOverride || req.query.currentTime || null,
      booked_by_user_id: req.session.user.id
    });
    res.status(201).json(booking);
  } catch (err) {
    if (!err.status) err.status = 400;
    res.status(err.status).json({ error: err.message });
  }
});

// ── POST /api/bookings/:id/cancel ────────────────────────────────────────────
router.post('/:id/cancel', requireLogin, async (req, res, next) => {
  try {
    const result = await bookingService.cancelBooking(
      req.params.id,
      req.session.user.id,
      req.session.user.role,
      req.body.reason || 'Cancelled by member'
    );
    res.json(result);
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

module.exports = router;
