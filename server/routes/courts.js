/**
 * @file server/routes/courts.js
 * @description Court CRUD and slot-availability endpoint using cc_courts.
 */

const express = require('express');
const db      = require('../db');
const cfg     = require('../config');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/courts ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM cc_courts WHERE is_active = 1 ORDER BY sport, name'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/courts/all ─────────────────────────────────────────────────────
router.get('/all', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM cc_courts ORDER BY sport, name');
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/courts/:id/slots?date=YYYY-MM-DD ───────────────────────────────
router.get('/:id/slots', requireLogin, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

    const openH  = cfg.OPENING_HOUR || 6;
    const closeH = cfg.CLOSING_HOUR || 22;

    const slots = [];
    for (let h = openH; h < closeH; h++) {
      const startDt = `${String(h).padStart(2,'0')}:00:00`;
      const endDt   = `${String(h+1).padStart(2,'0')}:00:00`;
      slots.push({ start_time: startDt, end_time: endDt });
    }

    const [booked] = await db.query(
      `SELECT start_time, end_time FROM cc_bookings
        WHERE court_id = ? AND booking_date = ? AND status != 'cancelled'`,
      [req.params.id, date]
    );

    const result = slots.map(s => {
      const isBooked = booked.some(b => b.start_time.slice(0,5) <= s.start_time.slice(0,5) && b.end_time.slice(0,5) > s.start_time.slice(0,5));
      return {
        ...s,
        available: !isBooked
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/courts ────────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { name, sport, surface_type, base_price_per_hour, is_active } = req.body;
    if (!name || !sport) return res.status(400).json({ error: 'name and sport required' });

    const [result] = await db.query(
      'INSERT INTO cc_courts (name, sport, surface_type, base_price_per_hour, is_active) VALUES (?,?,?,?,?)',
      [name, sport, surface_type || null, base_price_per_hour || 500, is_active ?? 1]
    );
    const [rows] = await db.query('SELECT * FROM cc_courts WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PUT /api/courts/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { name, sport, surface_type, base_price_per_hour, is_active } = req.body;
    await db.query(
      'UPDATE cc_courts SET name=?, sport=?, surface_type=?, base_price_per_hour=?, is_active=? WHERE id=?',
      [name, sport, surface_type || null, base_price_per_hour, is_active ?? 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM cc_courts WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/courts/:id ───────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query('UPDATE cc_courts SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ message: 'Court deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
