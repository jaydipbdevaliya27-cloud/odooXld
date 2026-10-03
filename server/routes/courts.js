/**
 * @file server/routes/courts.js
 * @description Court management, 30-min slot generation, maintenance blocks,
 * and social play session endpoints.
 */

const express = require('express');
const db = require('../db');
const cfg = require('../config');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { isPastSlot, addMinutes, todayIST } = require('../utils/time');

const router = express.Router();

// ── GET /api/courts ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { q, sport, is_active, page, limit } = req.query;

    let where = '1=1';
    const params = [];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (name LIKE ? OR surface_type LIKE ? OR sport LIKE ?)';
      params.push(s, s, s);
    }
    if (sport) {
      where += ' AND sport = ?';
      params.push(sport);
    }
    if (is_active !== undefined) {
      where += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' ? 1 : 0);
    }

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM courts WHERE ${where}`, params);
      const [rows] = await db.query(
        `SELECT *, base_price_per_hour AS hourly_rate, surface_type AS surface FROM courts WHERE ${where} ORDER BY sport, name LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      return res.json({
        data: rows,
        meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
      });
    }

    const [rows] = await db.query(`SELECT *, base_price_per_hour AS hourly_rate, surface_type AS surface FROM courts WHERE ${where} ORDER BY sport, name`, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/courts/:id/slots ───────────────────────────────────────────────
router.get('/:id/slots', async (req, res, next) => {
  try {
    const courtId = parseInt(req.params.id, 10);
    const date = req.query.date || todayIST();

    const [courts] = await db.query('SELECT *, base_price_per_hour AS hourly_rate, surface_type AS surface FROM courts WHERE id = ?', [courtId]);
    if (!courts.length) return res.status(404).json({ error: 'Court not found' });

    // Fetch booked slots
    const [bookedSlots] = await db.query(
      `SELECT bs.slot_start, bs.slot_end
       FROM booking_slots bs
       JOIN bookings b ON bs.booking_id = b.id
       WHERE bs.court_id = ? AND bs.slot_date = ? AND b.status = 'confirmed'`,
      [courtId, date]
    );

    // Fetch maintenance blocks
    const [blocks] = await db.query(
      'SELECT start_time, end_time, reason FROM court_blocks WHERE court_id = ? AND block_date = ?',
      [courtId, date]
    );

    const bookedSet = new Set();
    bookedSlots.forEach(s => {
      const t = s.slot_start instanceof Date
        ? `${String(s.slot_start.getHours()).padStart(2, '0')}:${String(s.slot_start.getMinutes()).padStart(2, '0')}`
        : String(s.slot_start).slice(11, 16);
      bookedSet.add(t);
    });

    const openH = cfg.OPENING_HOUR || 6;
    const closeH = cfg.CLOSING_HOUR || 22;
    const slots = [];

    for (let h = openH; h < closeH; h++) {
      for (const m of [0, 30]) {
        if (h === closeH - 1 && m > 0) continue;

        const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const secondHalf = m === 0 ? `${String(h).padStart(2, '0')}:30` : `${String(h + 1).padStart(2, '0')}:00`;
        const endTime = addMinutes(startTime, 60);

        const slotPast = isPastSlot(date, startTime);
        const isBooked = bookedSet.has(startTime) || bookedSet.has(secondHalf);

        const isBlocked = blocks.some(b => {
          const bStart = b.start_time.slice(0, 5);
          const bEnd = b.end_time.slice(0, 5);
          return (startTime >= bStart && startTime < bEnd) || (secondHalf >= bStart && secondHalf < bEnd);
        });

        const slotAvailable = !slotPast && !isBooked && !isBlocked;

        slots.push({
          start_time: startTime,
          end_time: endTime,
          available: slotAvailable,
          is_available: slotAvailable,
          isPast: slotPast,
          isBooked,
          isBlocked
        });
      }
    }

    res.json({ court: courts[0], date, slots, data: slots });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/courts ────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  requireRole('owner'),
  validate({
    name: { required: true, minLength: 2, maxLength: 60, label: 'Court name' },
    sport: { required: true, enum: ['tennis', 'cricket', 'badminton', 'pickleball'], label: 'Sport' },
    base_price_per_hour: { required: true, type: 'number', min: 0, label: 'Base price per hour' }
  }),
  async (req, res, next) => {
    try {
      const { name, sport, surface_type, base_price_per_hour } = req.body;
      const [r] = await db.query(
        `INSERT INTO courts (name, sport, surface_type, base_price_per_hour, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [name.trim(), sport, surface_type ? surface_type.trim() : null, base_price_per_hour]
      );
      const [created] = await db.query('SELECT * FROM courts WHERE id = ?', [r.insertId]);
      res.status(201).json(created[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/courts/:id ─────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { name, sport, surface_type, base_price_per_hour, is_active } = req.body;
    await db.query(
      `UPDATE courts
       SET name = COALESCE(?, name),
           sport = COALESCE(?, sport),
           surface_type = COALESCE(?, surface_type),
           base_price_per_hour = COALESCE(?, base_price_per_hour),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        sport || null,
        surface_type !== undefined ? surface_type : null,
        base_price_per_hour !== undefined ? base_price_per_hour : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        req.params.id
      ]
    );
    const [updated] = await db.query('SELECT * FROM courts WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// ── Maintenance Blocks API ──────────────────────────────────────────────────
router.post(
  '/:id/blocks',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({
    block_date: { required: true, type: 'date', label: 'Block date' },
    start_time: { required: true, type: 'time', label: 'Start time' },
    end_time: { required: true, type: 'time', label: 'End time' },
    reason: { required: true, minLength: 3, label: 'Reason' }
  }),
  async (req, res, next) => {
    try {
      const courtId = parseInt(req.params.id, 10);
      const { block_date, start_time, end_time, reason } = req.body;

      // Check for future bookings in conflict
      const [conflicts] = await db.query(
        `SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.end_time
         FROM bookings b
         WHERE b.court_id = ? AND b.booking_date = ? AND b.status = 'confirmed'
           AND ((b.start_time <= ? AND b.end_time > ?) OR (b.start_time < ? AND b.end_time >= ?))`,
        [courtId, block_date, start_time, start_time, end_time, end_time]
      );

      if (conflicts.length > 0) {
        return res.status(409).json({
          error: `Cannot block court: There are ${conflicts.length} confirmed booking(s) during this period.`,
          code: 'BLOCK_CONFLICT_BOOKINGS',
          conflicts
        });
      }

      const [r] = await db.query(
        `INSERT INTO court_blocks (court_id, block_date, start_time, end_time, reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [courtId, block_date, start_time, end_time, reason.trim(), req.session.user.id]
      );

      res.status(201).json({ ok: true, blockId: r.insertId, message: 'Court maintenance block established' });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/courts/social-sessions ─────────────────────────────────────────
router.get('/social-sessions', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, c.name AS court_name,
              COUNT(r.id) AS registered_count
       FROM social_sessions s
       JOIN courts c ON s.court_id = c.id
       LEFT JOIN social_session_registrations r ON s.id = r.session_id AND r.status = 'registered'
       WHERE s.is_active = 1 AND s.session_date >= CURDATE()
       GROUP BY s.id
       ORDER BY s.session_date ASC, s.start_time ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
