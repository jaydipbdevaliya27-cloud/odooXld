/**
 * @file server/routes/payments.js
 * @description Centralized Payment Ledger API.
 * Supports multi-source transaction search, refunds, and CSV export with sanitization.
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// ── GET /api/payments ───────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const {
      q,
      source,
      method,
      status,
      from,
      to,
      page = 1,
      limit = 20
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    // Members see only their own payments
    if (user.role === 'member') {
      where += ' AND p.user_id = ?';
      params.push(user.id);
    }

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (p.payment_code LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR p.notes LIKE ?)';
      params.push(s, s, s, s);
    }
    if (source) {
      where += ' AND p.source = ?';
      params.push(source);
    }
    if (method) {
      where += ' AND p.method = ?';
      params.push(method);
    }
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (from) {
      where += ' AND p.paid_at >= ?';
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where += ' AND p.paid_at <= ?';
      params.push(`${to} 23:59:59`);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT p.*, u.full_name AS payer_name, u.email AS payer_email
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ${where}
       ORDER BY p.paid_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 },
      payments: rows,
      total
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/payments/:id/refund ───────────────────────────────────────────
router.post(
  '/:id/refund',
  requireLogin,
  requireRole('owner'),
  validate({
    amount: { required: true, type: 'number', min: 0.01, label: 'Refund amount' },
    reason: { required: true, minLength: 3, label: 'Refund reason' }
  }),
  async (req, res, next) => {
    try {
      const paymentId = parseInt(req.params.id, 10);
      const { amount, reason } = req.body;

      const result = await db.transaction(async (conn) => {
        const [rows] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [paymentId]);
        if (!rows.length) throw new Error('Payment record not found');
        const payment = rows[0];

        if (payment.status === 'failed') {
          throw new Error('Cannot refund a failed payment transaction.');
        }

        // Calculate already refunded amount
        const [priorRefunds] = await conn.query(
          'SELECT COALESCE(SUM(amount), 0) AS total_refunded FROM payments WHERE refund_of_id = ?',
          [paymentId]
        );
        const alreadyRefunded = Math.abs(Number(priorRefunds[0].total_refunded));
        const maxRefundable = Number(payment.amount) - alreadyRefunded;

        if (Number(amount) > maxRefundable) {
          const err = new Error(`Refund amount (₹${amount}) exceeds max refundable balance of ₹${maxRefundable}.`);
          err.code = 'REFUND_EXCEEDS_MAX';
          err.status = 400;
          throw err;
        }

        const refundCode = `REF-${Date.now()}`;
        const refundAmount = -Math.abs(Number(amount));

        await conn.query(
          `INSERT INTO payments (
            payment_code, source, reference_id, user_id, amount, method,
            status, refund_of_id, notes, paid_at, refunded_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'refunded', ?, ?, NOW(), NOW())`,
          [
            refundCode, payment.source, payment.reference_id, payment.user_id,
            refundAmount, payment.method, payment.id, reason.trim()
          ]
        );

        return { refundCode, refundAmount, originalPaymentId: paymentId };
      });

      res.status(201).json({ ok: true, message: 'Refund processed successfully', ...result });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  }
);

// ── GET /api/payments/export/csv ────────────────────────────────────────────
router.get('/export/csv', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { from, to, source } = req.query;
    let where = '1=1';
    const params = [];

    if (from) { where += ' AND p.paid_at >= ?'; params.push(`${from} 00:00:00`); }
    if (to) { where += ' AND p.paid_at <= ?'; params.push(`${to} 23:59:59`); }
    if (source) { where += ' AND p.source = ?'; params.push(source); }

    const [rows] = await db.query(
      `SELECT p.payment_code, p.source, p.amount, p.method, p.status, p.paid_at,
              COALESCE(u.full_name, 'Guest') AS payer_name, COALESCE(u.email, '—') AS payer_email,
              p.notes
       FROM payments p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ${where}
       ORDER BY p.paid_at DESC`,
      params
    );

    // CSV Escaping with anti-formula injection
    function escapeCsv(val) {
      if (val === null || val === undefined) return '""';
      let str = String(val);
      if (/^[=+\-@]/.test(str)) {
        str = "'" + str;
      }
      return `"${str.replace(/"/g, '""')}"`;
    }

    const headers = ['Payment Code', 'Source', 'Amount (INR)', 'Method', 'Status', 'Date', 'Payer Name', 'Payer Email', 'Notes'];
    const lines = [headers.join(',')];

    rows.forEach(r => {
      lines.push([
        escapeCsv(r.payment_code),
        escapeCsv(r.source),
        escapeCsv(r.amount),
        escapeCsv(r.method),
        escapeCsv(r.status),
        escapeCsv(r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 19).replace('T', ' ') : ''),
        escapeCsv(r.payer_name),
        escapeCsv(r.payer_email),
        escapeCsv(r.notes || '')
      ].join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=payments-export-${Date.now()}.csv`);
    res.send(lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
