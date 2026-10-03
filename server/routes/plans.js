/**
 * @file server/routes/plans.js
 * @description Membership Plans CRUD API.
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// ── GET /api/plans ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { all } = req.query;
    let sql = 'SELECT * FROM plans';
    if (!all) sql += ' WHERE is_active = 1';
    sql += ' ORDER BY annual_fee ASC';

    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/plans/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/plans ─────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  requireRole('owner'),
  validate({
    code: { required: true, minLength: 2, maxLength: 20, label: 'Plan code' },
    name: { required: true, minLength: 2, maxLength: 100, label: 'Plan name' },
    annual_fee: { required: true, type: 'number', min: 0, label: 'Annual fee' }
  }),
  async (req, res, next) => {
    try {
      const {
        code,
        name,
        description,
        annual_fee,
        duration_months = 12,
        court_discount_pct = 0,
        shop_discount_pct = 0,
        bar_discount_pct = 0,
        max_bookings_per_day = 2,
        is_junior = 0
      } = req.body;

      const cleanCode = code.trim().toUpperCase();

      const [r] = await db.query(
        `INSERT INTO plans (
          code, name, description, annual_fee, duration_months,
          court_discount_pct, shop_discount_pct, bar_discount_pct,
          max_bookings_per_day, is_junior, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          cleanCode, name.trim(), description || null, annual_fee, duration_months,
          court_discount_pct, shop_discount_pct, bar_discount_pct,
          max_bookings_per_day, is_junior ? 1 : 0
        ]
      );

      const [created] = await db.query('SELECT * FROM plans WHERE id = ?', [r.insertId]);
      res.status(201).json(created[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Plan with this code already exists.', code: 'DUPLICATE_CODE' });
      }
      next(err);
    }
  }
);

// ── PUT /api/plans/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const {
      name,
      description,
      annual_fee,
      duration_months,
      court_discount_pct,
      shop_discount_pct,
      bar_discount_pct,
      max_bookings_per_day,
      is_junior,
      is_active
    } = req.body;

    await db.query(
      `UPDATE plans
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           annual_fee = COALESCE(?, annual_fee),
           duration_months = COALESCE(?, duration_months),
           court_discount_pct = COALESCE(?, court_discount_pct),
           shop_discount_pct = COALESCE(?, shop_discount_pct),
           bar_discount_pct = COALESCE(?, bar_discount_pct),
           max_bookings_per_day = COALESCE(?, max_bookings_per_day),
           is_junior = COALESCE(?, is_junior),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        description !== undefined ? description : null,
        annual_fee !== undefined ? annual_fee : null,
        duration_months !== undefined ? duration_months : null,
        court_discount_pct !== undefined ? court_discount_pct : null,
        shop_discount_pct !== undefined ? shop_discount_pct : null,
        bar_discount_pct !== undefined ? bar_discount_pct : null,
        max_bookings_per_day !== undefined ? max_bookings_per_day : null,
        is_junior !== undefined ? (is_junior ? 1 : 0) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        req.params.id
      ]
    );

    const [updated] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
