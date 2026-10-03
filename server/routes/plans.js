/**
 * @file server/routes/plans.js
 * @description Membership plan CRUD (owner only for write, public for read).
 * GET  /api/plans          – list all active plans (public – shown on landing page)
 * GET  /api/plans/:id      – single plan detail
 * POST /api/plans          – create plan (owner)
 * PUT  /api/plans/:id      – update plan (owner)
 * DELETE /api/plans/:id    – soft-delete plan (owner)
 */

const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/plans ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const showAll = req.query.all === '1';   // owner can request inactive plans too
    const sql = showAll
      ? 'SELECT * FROM plans ORDER BY annual_fee'
      : 'SELECT * FROM plans WHERE is_active = 1 ORDER BY annual_fee';
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/plans/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/plans ─────────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const {
      code, name, description, annual_fee, duration_months,
      court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day
    } = req.body;
    if (!code || !name || annual_fee == null) return res.status(400).json({ error: 'code, name, annual_fee required' });

    const [result] = await db.query(
      `INSERT INTO plans
         (code, name, description, annual_fee, duration_months,
          court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [code, name, description || null, annual_fee, duration_months || 12,
       court_discount_pct || 0, shop_discount_pct || 0, bar_discount_pct || 0, max_bookings_per_day || 2]
    );
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PUT /api/plans/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const {
      code, name, description, annual_fee, duration_months,
      court_discount_pct, shop_discount_pct, bar_discount_pct,
      max_bookings_per_day, is_active
    } = req.body;

    await db.query(
      `UPDATE plans SET
         code=?, name=?, description=?, annual_fee=?, duration_months=?,
         court_discount_pct=?, shop_discount_pct=?, bar_discount_pct=?,
         max_bookings_per_day=?, is_active=?
       WHERE id=?`,
      [code, name, description || null, annual_fee, duration_months,
       court_discount_pct, shop_discount_pct, bar_discount_pct,
       max_bookings_per_day, is_active ?? 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/plans/:id  (soft delete) ────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query('UPDATE plans SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Plan deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
