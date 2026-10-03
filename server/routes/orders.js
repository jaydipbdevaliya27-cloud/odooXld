/**
 * @file server/routes/orders.js
 * @description Order management routes for Shop POS, Bar POS, online orders,
 * kitchen display board, bar tabs, and daily closings.
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const orderService = require('../services/orderService');
const { todayIST } = require('../utils/time');

const router = express.Router();

// ── GET /api/orders ─────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const {
      q,
      department,
      channel,
      status,
      fulfilment_status,
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

    // Role restriction: members only see their own orders
    if (user.role === 'member') {
      where += ' AND (o.user_id = ? OR o.member_id = ?)';
      params.push(user.id, user.member_id || 0);
    }

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (o.order_code LIKE ? OR u.full_name LIKE ? OR o.guest_name LIKE ? OR o.table_no LIKE ?)';
      params.push(s, s, s, s);
    }
    if (department) {
      where += ' AND o.department = ?';
      params.push(department);
    }
    if (channel) {
      where += ' AND o.channel = ?';
      params.push(channel);
    }
    if (status) {
      where += ' AND o.status = ?';
      params.push(status);
    }
    if (fulfilment_status) {
      where += ' AND o.fulfilment_status = ?';
      params.push(fulfilment_status);
    }
    if (from) {
      where += ' AND o.created_at >= ?';
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where += ' AND o.created_at <= ?';
      params.push(`${to} 23:59:59`);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT o.*,
              COALESCE(u.full_name, o.guest_name) AS customer_name,
              u.email AS customer_email,
              COALESCE(u.phone, o.guest_phone) AS customer_phone,
              m.member_code,
              t.tab_name
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN members m ON o.member_id = m.id
       LEFT JOIN tabs t ON o.tab_id = t.id
       WHERE ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/orders/:id ─────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*,
              COALESCE(u.full_name, o.guest_name) AS customer_name,
              u.email AS customer_email,
              COALESCE(u.phone, o.guest_phone) AS customer_phone,
              m.member_code
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN members m ON o.member_id = m.id
       WHERE o.id = ?`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const order = rows[0];

    if (req.session.user.role === 'member' && order.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name, p.sku, p.image_url
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [order.id]
    );
    order.items = items;

    res.json(order);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/orders ────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  validate({
    department: { required: true, enum: ['shop', 'bar'], label: 'Department' },
    items: { required: true, label: 'Order items' }
  }),
  async (req, res, next) => {
    try {
      const user = req.session.user;
      const {
        department,
        channel = 'counter',
        table_no,
        tab_id,
        member_id,
        user_id,
        guest_name,
        guest_phone,
        delivery_address,
        delivery_fee = 0,
        courier_notes,
        items,
        payment_method = 'cash'
      } = req.body;

      let effectiveUserId = null;
      let effectiveMemberId = null;

      if (user.role === 'member') {
        effectiveUserId = user.id;
        effectiveMemberId = user.member_id;
      } else {
        effectiveUserId = user_id || null;
        effectiveMemberId = member_id || null;
      }

      const result = await orderService.createOrder({
        department,
        channel,
        tableNo: table_no,
        tabId: tab_id ? parseInt(tab_id, 10) : null,
        userId: effectiveUserId,
        memberId: effectiveMemberId,
        guestName: guest_name,
        guestPhone: guest_phone,
        deliveryAddress: delivery_address,
        deliveryFee: Number(delivery_fee) || 0,
        courierNotes: courier_notes,
        items,
        paymentMethod: payment_method,
        createdByUserId: user.id
      });

      res.status(201).json(result);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
      next(err);
    }
  }
);

// ── PUT /api/orders/:id/fulfilment ──────────────────────────────────────────
router.put('/:id/fulfilment', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { fulfilment_status } = req.body;
    const orderId = req.params.id;

    const allowed = ['placed', 'packed', 'ready_for_pickup', 'out_for_delivery', 'collected', 'delivered', 'cancelled'];
    if (!allowed.includes(fulfilment_status)) {
      return res.status(400).json({ error: `Invalid fulfilment status: ${fulfilment_status}` });
    }

    let extraUpdate = '';
    if (fulfilment_status === 'collected' || fulfilment_status === 'delivered') {
      extraUpdate = ", status = 'completed', closed_at = NOW()";
    }

    await db.query(
      `UPDATE orders SET fulfilment_status = ? ${extraUpdate} WHERE id = ?`,
      [fulfilment_status, orderId]
    );

    res.json({ ok: true, fulfilment_status });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/orders/:id/status ──────────────────────────────────────────────
router.put('/:id/status', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const orderId = parseInt(req.params.id, 10);

    const allowed = ['open', 'completed', 'cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid order status: ${status}` });
    }

    const result = await orderService.updateOrderStatus(orderId, status, req.session.user.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ── Kitchen Display Board API ───────────────────────────────────────────────
router.get('/kitchen/live', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT oi.*, p.name AS product_name, o.order_code, o.table_no, o.created_at AS order_time,
              TIMESTAMPDIFF(MINUTE, oi.created_at, NOW()) AS elapsed_minutes
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE o.department = 'bar' AND oi.kitchen_status IN ('new', 'preparing', 'ready')
       ORDER BY oi.created_at ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.put('/kitchen/:itemId/status', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const itemId = req.params.itemId;

    if (!['new', 'preparing', 'ready', 'served', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid kitchen item status.' });
    }

    await db.query('UPDATE order_items SET kitchen_status = ? WHERE id = ?', [status, itemId]);
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// ── Bar Tabs API ────────────────────────────────────────────────────────────
router.get('/tabs/active', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, COALESCE(u.full_name, t.guest_name) AS customer_name,
              COALESCE(SUM(o.total), 0) AS tab_total,
              COUNT(o.id) AS order_count
       FROM tabs t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN orders o ON t.id = o.tab_id AND o.status != 'cancelled'
       WHERE t.status = 'open'
       GROUP BY t.id
       ORDER BY t.opened_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/tabs/open',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({ tab_name: { required: true, minLength: 2, label: 'Tab name' } }),
  async (req, res, next) => {
    try {
      const { tab_name, user_id, member_id, guest_name, guest_phone, notes } = req.body;
      const [r] = await db.query(
        `INSERT INTO tabs (tab_name, user_id, member_id, guest_name, guest_phone, status, opened_by, notes)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        [tab_name.trim(), user_id || null, member_id || null, guest_name || null, guest_phone || null, req.session.user.id, notes || null]
      );
      res.status(201).json({ id: r.insertId, tab_name, status: 'open' });
    } catch (err) {
      next(err);
    }
  }
);

router.post('/tabs/:tabId/settle', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const tabId = parseInt(req.params.tabId, 10);
    const { payment_method = 'upi' } = req.body;

    const result = await db.transaction(async (conn) => {
      const [tabs] = await conn.query('SELECT * FROM tabs WHERE id = ? FOR UPDATE', [tabId]);
      if (!tabs.length || tabs[0].status !== 'open') throw new Error('Tab not found or already settled');
      const tab = tabs[0];

      const [orders] = await conn.query(
        'SELECT id, total FROM orders WHERE tab_id = ? AND status = "open"',
        [tabId]
      );

      const tabTotal = orders.reduce((acc, o) => acc + Number(o.total), 0);

      // Mark orders completed
      await conn.query('UPDATE orders SET status = "completed", closed_at = NOW() WHERE tab_id = ?', [tabId]);

      // Record payment
      if (tabTotal > 0) {
        const payCode = `PAY-TAB-${Date.now()}`;
        await conn.query(
          `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
           VALUES (?, 'bar', ?, ?, ?, ?, 'paid', NOW())`,
          [payCode, tabId, tab.user_id, tabTotal, payment_method]
        );
      }

      // Close tab
      await conn.query('UPDATE tabs SET status = "settled", closed_by = ?, closed_at = NOW() WHERE id = ?', [
        req.session.user.id,
        tabId
      ]);

      return { tabId, tabTotal, payment_method };
    });

    res.json({ ok: true, message: 'Tab settled and closed successfully', ...result });
  } catch (err) {
    next(err);
  }
});

// ── Daily Closing Z-Report ──────────────────────────────────────────────────
router.get('/daily-closing/today', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const today = todayIST();
    const dept = req.query.department || 'bar';

    const [payments] = await db.query(
      `SELECT method, SUM(amount) AS total
       FROM payments
       WHERE source = ? AND DATE(paid_at) = ? AND status = 'paid'
       GROUP BY method`,
      [dept, today]
    );

    const breakdown = { cash: 0, card: 0, upi: 0, online: 0, total: 0 };
    payments.forEach(p => {
      breakdown[p.method] = Number(p.total) || 0;
      breakdown.total += Number(p.total) || 0;
    });

    const [existing] = await db.query(
      'SELECT * FROM daily_closings WHERE closing_date = ? AND department = ?',
      [today, dept]
    );

    res.json({
      date: today,
      department: dept,
      breakdown,
      isClosed: existing.length > 0,
      closingRecord: existing[0] || null
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/daily-closing',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({
    opening_float: { required: true, type: 'number', min: 0, label: 'Opening float' },
    counted_cash: { required: true, type: 'number', min: 0, label: 'Counted cash' }
  }),
  async (req, res, next) => {
    try {
      const today = todayIST();
      const { opening_float, counted_cash, department = 'bar', notes } = req.body;

      const [payments] = await db.query(
        `SELECT method, SUM(amount) AS total
         FROM payments
         WHERE source = ? AND DATE(paid_at) = ? AND status = 'paid'
         GROUP BY method`,
        [department, today]
      );

      const breakdown = { cash: 0, card: 0, upi: 0, online: 0, total: 0 };
      payments.forEach(p => {
        breakdown[p.method] = Number(p.total) || 0;
        breakdown.total += Number(p.total) || 0;
      });

      const cashVariance = Number(counted_cash) - (Number(opening_float) + breakdown.cash);

      const [r] = await db.query(
        `INSERT INTO daily_closings (
          closing_date, department, opening_float, cash_collected, counted_cash,
          cash_variance, total_revenue, card_revenue, upi_revenue, online_revenue,
          closed_by, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          opening_float = VALUES(opening_float),
          cash_collected = VALUES(cash_collected),
          counted_cash = VALUES(counted_cash),
          cash_variance = VALUES(cash_variance),
          total_revenue = VALUES(total_revenue),
          closed_by = VALUES(closed_by),
          notes = VALUES(notes),
          closed_at = NOW()`,
        [
          today, department, opening_float, breakdown.cash, counted_cash,
          cashVariance, breakdown.total, breakdown.card, breakdown.upi, breakdown.online,
          req.session.user.id, notes || null
        ]
      );

      res.status(201).json({
        ok: true,
        message: 'Daily closing Z-report submitted successfully.',
        closingDate: today,
        breakdown,
        cashVariance
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
