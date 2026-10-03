/**
 * @file server/routes/payments.js
 * @description Payments routes using cc_payments – earnings by source, method, date range.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

// ── GET /api/payments ─────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { source, method, status, from, to, page = 1, limit = 100 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = '1=1';
    const params = [];
    if (source) { where += ' AND p.source = ?';          params.push(source); }
    if (method) { where += ' AND p.method = ?';          params.push(method); }
    if (status) { where += ' AND p.status = ?';          params.push(status); }
    if (from)   { where += ' AND DATE(p.paid_at) >= ?';  params.push(from); }
    if (to)     { where += ' AND DATE(p.paid_at) <= ?';  params.push(to); }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM cc_payments p WHERE ${where}`, params);
    const [rows] = await db.query(
      `SELECT p.*, COALESCE(u.full_name,u.name) AS payer_name, u.email AS payer_email
         FROM cc_payments p LEFT JOIN users u ON p.user_id = u.id
        WHERE ${where}
        ORDER BY p.paid_at DESC
        LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    res.json({ payments: rows, total, page: Number(page) });
  } catch (err) { next(err); }
});

// ── GET /api/payments/summary ─────────────────────────────────────────────────
// Returns earnings breakdown by source + method for dashboard
router.get('/summary', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { from, to, period } = req.query;
    let dateFilter = '';
    const params = [];

    if (from && to) {
      dateFilter = 'AND DATE(paid_at) BETWEEN ? AND ?';
      params.push(from, to);
    } else if (period === 'today') {
      dateFilter = 'AND DATE(paid_at) = CURDATE()';
    } else if (period === 'week') {
      dateFilter = 'AND DATE(paid_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (period === 'month') {
      dateFilter = 'AND DATE(paid_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
    } else {
      dateFilter = 'AND DATE(paid_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    }

    // By source
    const [bySource] = await db.query(
      `SELECT source, SUM(amount) AS total, COUNT(*) AS count
         FROM cc_payments WHERE status='paid' ${dateFilter}
         GROUP BY source ORDER BY total DESC`, params
    );

    // By method
    const [byMethod] = await db.query(
      `SELECT method, SUM(amount) AS total, COUNT(*) AS count
         FROM cc_payments WHERE status='paid' ${dateFilter}
         GROUP BY method ORDER BY total DESC`, params
    );

    // Daily trend
    const [daily] = await db.query(
      `SELECT DATE(paid_at) AS day, SUM(amount) AS total, source
         FROM cc_payments WHERE status='paid' ${dateFilter}
         GROUP BY day, source ORDER BY day`, params
    );

    // Grand total
    const [[{ grand_total }]] = await db.query(
      `SELECT IFNULL(SUM(amount),0) AS grand_total FROM cc_payments WHERE status='paid' ${dateFilter}`, params
    );

    // Refunds
    const [[{ refunds }]] = await db.query(
      `SELECT IFNULL(SUM(amount),0) AS refunds FROM cc_payments WHERE status='refunded' ${dateFilter}`, params
    );

    res.json({ by_source: bySource, by_method: byMethod, daily, grand_total, refunds });
  } catch (err) { next(err); }
});

// ── POST /api/payments/refund/:id ─────────────────────────────────────────────
router.post('/refund/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM cc_payments WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Payment not found' });
    if (rows[0].status === 'refunded') return res.status(400).json({ error: 'Already refunded' });
    await db.query(`UPDATE cc_payments SET status='refunded', refunded_at=NOW() WHERE id=?`, [req.params.id]);
    res.json({ message: 'Payment refunded' });
  } catch (err) { next(err); }
});

module.exports = router;
