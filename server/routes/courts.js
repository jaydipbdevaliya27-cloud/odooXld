/**
 * @file server/routes/courts.js
 * @description Court CRUD and slot-availability endpoint.
 * GET  /api/courts                    – list active courts
 * GET  /api/courts/:id/slots?date=    – available 30-min slots for a date
 * POST /api/courts                    – create court (owner/staff)
 * PUT  /api/courts/:id               – update court (owner/staff)
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
      'SELECT * FROM courts WHERE is_active = 1 ORDER BY sport, name'
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/courts/:id/slots?date=YYYY-MM-DD ───────────────────────────────
// Returns list of 30-min slot objects {slot_start, slot_end, available}
router.get('/:id/slots', requireLogin, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

    // Build all possible slots for the day based on config hours
    const slots = [];
    const openH  = cfg.OPENING_HOUR;
    const closeH = cfg.CLOSING_HOUR;
    const stepM  = cfg.SLOT_LENGTH_MINUTES;   // 30 minutes per slot

    for (let h = openH; h < closeH; h++) {
      for (let m = 0; m < 60; m += stepM) {
        const startDt = `${date} ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`;
        const endMin  = m + stepM;
        const endH    = endMin >= 60 ? h + 1 : h;
        const endMMin = endMin >= 60 ? endMin - 60 : endMin;
        const endDt   = `${date} ${String(endH).padStart(2,'0')}:${String(endMMin).padStart(2,'0')}:00`;
        slots.push({ slot_start: startDt, slot_end: endDt });
      }
    }

    // Fetch already-booked slots for this court + date
    const [booked] = await db.query(
      `SELECT slot_start FROM booking_slots bs
         JOIN bookings b ON bs.booking_id = b.id
       WHERE bs.court_id = ? AND bs.slot_date = ? AND b.status != 'cancelled'`,
      [req.params.id, date]
    );
    const bookedSet = new Set(booked.map(r => String(r.slot_start).slice(0, 19)));

    // Mark each slot as available or not
    const result = slots.map(s => ({
      ...s,
      available: !bookedSet.has(s.slot_start)
    }));

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/courts ────────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { name, sport, surface_type, base_price_per_hour } = req.body;
    if (!name || !sport) return res.status(400).json({ error: 'name and sport required' });

    const [result] = await db.query(
      'INSERT INTO courts (name, sport, surface_type, base_price_per_hour) VALUES (?,?,?,?)',
      [name, sport, surface_type || null, base_price_per_hour || 500]
    );
    const [rows] = await db.query('SELECT * FROM courts WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PUT /api/courts/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { name, sport, surface_type, base_price_per_hour, is_active } = req.body;
    await db.query(
      'UPDATE courts SET name=?, sport=?, surface_type=?, base_price_per_hour=?, is_active=? WHERE id=?',
      [name, sport, surface_type || null, base_price_per_hour, is_active ?? 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM courts WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
