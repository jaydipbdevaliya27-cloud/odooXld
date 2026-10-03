/**
 * @file server/routes/staff.js
 * @description Staff Management, Operational Area Assignment, Shifts, and Roster API.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// ── GET /api/staff ──────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { q, area, is_active, page, limit } = req.query;

    let where = "role IN ('staff', 'owner')";
    const params = [];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      params.push(s, s, s);
    }
    if (area) {
      where += ' AND assigned_area = ?';
      params.push(area);
    }
    if (is_active !== undefined) {
      where += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' ? 1 : 0);
    }

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);
      const [rows] = await db.query(
        `SELECT id, email, role, full_name, phone, assigned_area, is_active, created_at
         FROM users WHERE ${where} ORDER BY role ASC, full_name ASC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      return res.json({
        data: rows,
        meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
      });
    }

    const [rows] = await db.query(
      `SELECT id, email, role, full_name, phone, assigned_area, is_active, created_at
       FROM users WHERE ${where} ORDER BY role ASC, full_name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/staff ─────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  requireRole('owner'),
  validate({
    full_name: { required: true, minLength: 2, label: 'Staff full name' },
    email: { required: true, type: 'email', label: 'Staff email' },
    password: { required: true, minLength: 8, label: 'Password' },
    assigned_area: { required: true, enum: ['shop', 'bar', 'booking', 'general'], label: 'Assigned area' }
  }),
  async (req, res, next) => {
    try {
      const { full_name, email, password, phone, assigned_area = 'general', role = 'staff' } = req.body;
      const cleanEmail = email.trim().toLowerCase();

      const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existing.length) {
        return res.status(409).json({ error: 'A user with this email address already exists.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const [r] = await db.query(
        `INSERT INTO users (email, password_hash, role, full_name, phone, assigned_area, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [cleanEmail, hash, role, full_name.trim(), phone ? phone.trim() : null, assigned_area]
      );

      res.status(201).json({ id: r.insertId, email: cleanEmail, full_name, assigned_area });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/staff/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { full_name, email, phone, assigned_area, is_active, password } = req.body;

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [staffId]);
    if (!rows.length) return res.status(404).json({ error: 'Staff user not found' });
    const user = rows[0];

    // Cannot deactivate yourself or remove last active owner
    if (staffId === req.session.user.id && is_active === 0) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    let pwdUpdate = '';
    const params = [
      full_name ? full_name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      phone !== undefined ? (phone ? phone.trim() : null) : null,
      assigned_area || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null
    ];

    if (password && password.trim().length >= 8) {
      const hash = await bcrypt.hash(password.trim(), 10);
      pwdUpdate = ', password_hash = ?';
      params.push(hash);
    }

    params.push(staffId);

    await db.query(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           assigned_area = COALESCE(?, assigned_area),
           is_active = COALESCE(?, is_active)
           ${pwdUpdate}
       WHERE id = ?`,
      params
    );

    const [updated] = await db.query(
      'SELECT id, email, role, full_name, phone, assigned_area, is_active FROM users WHERE id = ?',
      [staffId]
    );
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// ── Shifts & Roster API ─────────────────────────────────────────────────────
router.get('/shifts', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM shifts WHERE is_active = 1 ORDER BY start_time');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/roster', requireLogin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = '1=1';
    const params = [];

    if (from) { where += ' AND sa.assignment_date >= ?'; params.push(from); }
    if (to) { where += ' AND sa.assignment_date <= ?'; params.push(to); }

    const [rows] = await db.query(
      `SELECT sa.*, s.name AS shift_name, s.start_time, s.end_time,
              u.full_name AS staff_name, u.assigned_area
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
       JOIN users u ON sa.user_id = u.id
       WHERE ${where}
       ORDER BY sa.assignment_date ASC, s.start_time ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/roster',
  requireLogin,
  requireRole('owner'),
  validate({
    shift_id: { required: true, type: 'integer', label: 'Shift' },
    user_id: { required: true, type: 'integer', label: 'Staff member' },
    assignment_date: { required: true, type: 'date', label: 'Date' }
  }),
  async (req, res, next) => {
    try {
      const { shift_id, user_id, assignment_date, notes } = req.body;
      const [r] = await db.query(
        `INSERT INTO shift_assignments (shift_id, user_id, assignment_date, notes)
         VALUES (?, ?, ?, ?)`,
        [shift_id, user_id, assignment_date, notes || null]
      );
      res.status(201).json({ id: r.insertId, message: 'Shift assigned successfully' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
