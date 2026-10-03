/**
 * @file server/routes/payments.js
 * @description Payment ledger routes.
 * GET  /api/payments         – list payments (staff/owner) with filters
 * POST /api/payments/refund/:id – mark payment refunded (owner)
 */

const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/payments ────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { source, method, status, from, to } = req.query;
    let sql = `SELECT p.*, u.full_name AS payer_name
                 FROM payments p
                 LEFT JOIN users u ON p.user_id = u.id
                WHERE 1=1`;
    const params = [];
    if (source) { sql += ' AND p.source = ?';  params.push(source); }
    if (method) { sql += ' AND p.method = ?';  params.push(method); }
    if (status) { sql += ' AND p.status = ?';  params.push(status); }
    if (from)   { sql += ' AND DATE(p.paid_at) >= ?'; params.push(from); }
    if (to)     { sql += ' AND DATE(p.paid_at) <= ?'; params.push(to); }
    sql += ' ORDER BY p.paid_at DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/payments/refund/:id ────────────────────────────────────────────
router.post('/refund/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Payment not found' });
    if (rows[0].status === 'refunded') return res.status(400).json({ error: 'Already refunded' });

    await db.query(
      "UPDATE payments SET status='refunded', refunded_at=NOW() WHERE id=?",
      [req.params.id]
    );
    res.json({ message: 'Payment refunded' });
  } catch (err) { next(err); }
});

module.exports = router;
