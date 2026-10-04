/**
 * @file server/routes/payments.js
 * @description Centralized Payment Ledger API.
 * Supports multi-source transaction search, refunds, and CSV export with sanitization.
 */

const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_RhVYKPOupv38C4';
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || 'YfX6poJ2kdF26aKSAIg2Ljd8';

let razorpay = null;
try {
  razorpay = new Razorpay({
    key_id: razorpayKeyId,
    key_secret: razorpayKeySecret
  });
} catch (e) {
  console.warn('[WARN] Razorpay initialization warning:', e.message);
}

// ── GET /api/payments/razorpay/config ──────────────────────────────────────
router.get('/razorpay/config', (req, res) => {
  res.json({
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_RhVYKPOupv38C4'
  });
});

// ── POST /api/payments/razorpay/create-order ───────────────────────────────
router.post('/razorpay/create-order', requireLogin, async (req, res, next) => {
  try {
    const { amount, receipt, notes = {} } = req.body;
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required (greater than 0)' });
    }

    const amountInPaise = Math.round(numAmount * 100);
    const receiptId = receipt || `rcpt_${Date.now().toString().slice(-8)}`;

    if (!razorpay) {
      razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_RhVYKPOupv38C4',
        key_secret: process.env.RAZORPAY_KEY_SECRET || 'YfX6poJ2kdF26aKSAIg2Ljd8'
      });
    }

    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        user_id: String(req.session.user ? req.session.user.id : ''),
        ...notes
      }
    });

    res.json({
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_RhVYKPOupv38C4',
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt
    });
  } catch (err) {
    console.error('[RAZORPAY ERROR]', err);
    res.status(500).json({ error: err.message || 'Failed to create Razorpay order' });
  }
});

// ── POST /api/payments/razorpay/verify ─────────────────────────────────────
router.post('/razorpay/verify', requireLogin, async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      source = 'general',
      reference_id = null,
      amount = 0,
      notes = ''
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing Razorpay verification parameters' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET || 'YfX6poJ2kdF26aKSAIg2Ljd8';
    const generated_signature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature. Transaction verification failed.', code: 'PAYMENT_VERIFICATION_FAILED' });
    }

    const paymentCode = `PAY-RZP-${Date.now()}`;
    const paidAmount = Number(amount) || 0;
    const userId = req.session.user ? req.session.user.id : null;

    const [result] = await db.query(
      `INSERT INTO payments (
        payment_code, source, reference_id, user_id, amount, method,
        status, notes, paid_at
      ) VALUES (?, ?, ?, ?, ?, 'razorpay', 'paid', ?, NOW())`,
      [
        paymentCode,
        source,
        reference_id,
        userId,
        paidAmount,
        `Razorpay ID: ${razorpay_payment_id}. Order: ${razorpay_order_id}. ${notes}`.trim()
      ]
    );

    res.json({
      ok: true,
      verified: true,
      paymentId: result.insertId,
      paymentCode,
      razorpay_payment_id
    });
  } catch (err) {
    next(err);
  }
});

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

    if (q && q.trim()) {
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

// ── DELETE /api/payments/:id ────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const [rows] = await db.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
    if (!rows.length) return res.status(404).json({ error: 'Payment record not found', code: 'NOT_FOUND' });

    await db.query('DELETE FROM payments WHERE id = ? OR refund_of_id = ?', [paymentId, paymentId]);
    res.json({ ok: true, message: 'Payment record deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
