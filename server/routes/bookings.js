/**
 * @file server/routes/bookings.js
 * @description Court booking routes using cc_bookings / cc_courts.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

// ── GET /api/bookings ─────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const u = req.session.user;

    if (u.role === 'member') {
      const [rows] = await db.query(
        `SELECT b.*, c.name AS court_name, c.sport, c.surface_type
           FROM cc_bookings b JOIN cc_courts c ON b.court_id = c.id
          WHERE b.user_id = ? ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 50`,
        [u.id]
      );
      return res.json(rows);
    }

    const { date, court_id, status, from, to, sport } = req.query;
    let where = '1=1';
    const params = [];
    if (date)     { where += ' AND b.booking_date = ?';                    params.push(date); }
    if (from)     { where += ' AND b.booking_date >= ?';                   params.push(from); }
    if (to)       { where += ' AND b.booking_date <= ?';                   params.push(to); }
    if (court_id) { where += ' AND b.court_id = ?';                        params.push(court_id); }
    if (status)   { where += ' AND b.status = ?';                          params.push(status); }
    if (sport)    { where += ' AND c.sport = ?';                           params.push(sport); }

    const [rows] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport, c.surface_type, c.base_price_per_hour,
              COALESCE(u.full_name,u.name) AS member_name, u.email AS member_email, u.phone AS member_phone
         FROM cc_bookings b
         JOIN cc_courts c ON b.court_id = c.id
         LEFT JOIN users u ON b.user_id = u.id
        WHERE ${where}
        ORDER BY b.booking_date DESC, b.start_time DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/bookings/schedule/:date ─────────────────────────────────────────
// Returns all courts with their time-slot bookings for a given date
router.get('/schedule/:date', requireLogin, requireRole('staff','owner'), async (req, res, next) => {
  try {
    const date = req.params.date;
    const [courts] = await db.query(`SELECT * FROM cc_courts WHERE is_active=1 ORDER BY sport, name`);
    const [bookings] = await db.query(
      `SELECT b.*, COALESCE(u.full_name,u.name) AS member_name, u.phone AS member_phone
         FROM cc_bookings b LEFT JOIN users u ON b.user_id=u.id
        WHERE b.booking_date=? AND b.status != 'cancelled'
        ORDER BY b.start_time`, [date]
    );

    // Group bookings by court
    const courtMap = {};
    for (const c of courts) {
      courtMap[c.id] = { ...c, slots: [] };
    }
    for (const b of bookings) {
      if (courtMap[b.court_id]) courtMap[b.court_id].slots.push(b);
    }

    res.json(Object.values(courtMap));
  } catch (err) { next(err); }
});

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport, c.surface_type,
              COALESCE(u.full_name,u.name) AS member_name, u.email AS member_email
         FROM cc_bookings b JOIN cc_courts c ON b.court_id=c.id
         LEFT JOIN users u ON b.user_id=u.id
        WHERE b.id=?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];
    if (req.session.user.role === 'member' && b.user_id !== req.session.user.id)
      return res.status(403).json({ error: 'Forbidden' });
    res.json(b);
  } catch (err) { next(err); }
});

// ── POST /api/bookings ────────────────────────────────────────────────────────
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const { court_id, booking_date, start_time, end_time,
            user_id, guest_name, guest_phone, payment_method } = req.body;
    if (!court_id || !booking_date || !start_time || !end_time)
      return res.status(400).json({ error: 'court_id, booking_date, start_time, end_time required' });

    // Check availability
    const [conflicts] = await db.query(
      `SELECT id FROM cc_bookings WHERE court_id=? AND booking_date=? AND status!='cancelled'
         AND start_time < ? AND end_time > ?`,
      [court_id, booking_date, end_time, start_time]
    );
    if (conflicts.length) return res.status(409).json({ error: 'Time slot already booked' });

    const [courts] = await db.query('SELECT * FROM cc_courts WHERE id=?', [court_id]);
    if (!courts.length) return res.status(404).json({ error: 'Court not found' });
    const court = courts[0];

    // Calculate hours
    const [sh, sm] = start_time.split(':').map(Number);
    const [eh, em] = end_time.split(':').map(Number);
    const hours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    const basePrice = parseFloat((court.base_price_per_hour * hours).toFixed(2));

    // Get member discount
    let discount_pct = 0;
    let memberId = null;
    if (user_id) {
      const [mRows] = await db.query(
        `SELECT m.id, p.court_discount_pct FROM cc_members m JOIN cc_plans p ON m.plan_id=p.id
          WHERE m.user_id=? AND m.status='active'`, [user_id]
      );
      if (mRows.length) { discount_pct = Number(mRows[0].court_discount_pct); memberId = mRows[0].id; }
    }

    const priceCharged = parseFloat((basePrice * (1 - discount_pct / 100)).toFixed(2));
    const bookingCode = `BK-${Date.now()}`;

    const [result] = await db.query(
      `INSERT INTO cc_bookings (booking_code,court_id,user_id,member_id,guest_name,guest_phone,
              booking_date,start_time,end_time,base_price,discount_pct,price_charged,status,booked_by_user_id,payment_method)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'confirmed',?,?)`,
      [bookingCode, court_id, user_id || null, memberId, guest_name || null, guest_phone || null,
       booking_date, start_time, end_time, basePrice, discount_pct, priceCharged,
       req.session.user.id, payment_method || null]
    );

    if (payment_method) {
      const payCode = `PAY-CRT-${Date.now()}`;
      await db.query(
        `INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at)
         VALUES (?,?,?,?,?,?,'paid',NOW())`,
        [payCode, 'court', result.insertId, user_id || req.session.user.id, priceCharged, payment_method]
      );
    }

    const [rows] = await db.query(
      `SELECT b.*, c.name AS court_name, c.sport FROM cc_bookings b JOIN cc_courts c ON b.court_id=c.id WHERE b.id=?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

// ── POST /api/bookings/:id/cancel ─────────────────────────────────────────────
router.post('/:id/cancel', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM cc_bookings WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    const b = rows[0];
    const u = req.session.user;
    if (u.role === 'member' && b.booked_by_user_id !== u.id)
      return res.status(403).json({ error: 'Forbidden' });
    await db.query(
      `UPDATE cc_bookings SET status='cancelled', cancelled_at=NOW(), cancellation_reason=? WHERE id=?`,
      [req.body.reason || null, req.params.id]
    );
    res.json({ message: 'Booking cancelled' });
  } catch (err) { next(err); }
});

// ── GET /api/bookings/courts/list ─────────────────────────────────────────────
router.get('/courts/list', async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT * FROM cc_courts WHERE is_active=1 ORDER BY sport, name`);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
