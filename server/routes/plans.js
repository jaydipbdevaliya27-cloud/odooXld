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
    const { all, q, status } = req.query;
    let sql = 'SELECT * FROM plans WHERE 1=1';
    const params = [];

    if (status === 'active') {
      sql += ' AND is_active = 1';
    } else if (status === 'inactive') {
      sql += ' AND is_active = 0';
    } else if (!all) {
      sql += ' AND is_active = 1';
    }

    if (q && q.trim()) {
      sql += ' AND (name LIKE ? OR code LIKE ? OR description LIKE ?)';
      const s = `%${q.trim()}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY annual_fee ASC';

    const [rows] = await db.query(sql, params);
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

// ── DELETE /api/plans/:id ───────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const planId = parseInt(req.params.id, 10);
    const [pRows] = await db.query('SELECT * FROM plans WHERE id = ?', [planId]);
    if (!pRows.length) return res.status(404).json({ error: 'Plan not found', code: 'NOT_FOUND' });

    // Check if any active members are assigned to this plan
    const [activeMembers] = await db.query(
      'SELECT id FROM members WHERE plan_id = ? AND status = "active"',
      [planId]
    );
    if (activeMembers.length > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: `Cannot delete plan: There are ${activeMembers.length} active member(s) enrolled on this plan. Deactivate the plan instead or reassign members.`,
        code: 'PLAN_HAS_ACTIVE_MEMBERS'
      });
    }

    const force = req.query.force === 'true';
    if (force) {
      await db.transaction(async (conn) => {
        await conn.query('DELETE FROM membership_history WHERE plan_id = ?', [planId]);
        await conn.query('DELETE FROM leads WHERE interested_plan_id = ?', [planId]);
        await conn.query('DELETE FROM plans WHERE id = ?', [planId]);
      });
      return res.json({ ok: true, message: 'Plan permanently deleted' });
    }

    // Default: deactivate plan
    await db.query('UPDATE plans SET is_active = 0 WHERE id = ?', [planId]);
    res.json({ ok: true, message: 'Plan deactivated successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
