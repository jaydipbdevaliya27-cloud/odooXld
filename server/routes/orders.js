/**
 * @file server/routes/orders.js
 * @description Shop and bar order routes.
 * POST /api/orders              – create order with items (delegated to orderService)
 * GET  /api/orders              – list orders (filter by dept/status/date)
 * GET  /api/orders/:id          – order detail with line items
 * POST /api/orders/:id/complete – mark order completed, record payment
 * POST /api/orders/:id/cancel   – cancel order, restore stock
 */

const express      = require('express');
const orderService = require('../services/orderService');
const db           = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/orders ─────────────────────────────────────────────────────────
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const order = await orderService.createOrder({
      ...req.body,
      created_by_user_id: req.session.user.id
    });
    res.status(201).json(order);
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

// ── GET /api/orders ──────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { dept, status, date } = req.query;
    let sql = `SELECT o.*, u.full_name AS member_name
                 FROM orders o
                 LEFT JOIN users u ON o.user_id = u.id
                WHERE 1=1`;
    const params = [];
    if (dept)   { sql += ' AND o.department = ?'; params.push(dept); }
    if (status) { sql += ' AND o.status = ?';     params.push(status); }
    if (date)   { sql += ' AND DATE(o.created_at) = ?'; params.push(date); }
    sql += ' ORDER BY o.created_at DESC LIMIT 100';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [orders] = await db.query(
      `SELECT o.*, u.full_name AS member_name
         FROM orders o LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name, p.sku
         FROM order_items oi JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?`,
      [req.params.id]
    );
    res.json({ ...orders[0], items });
  } catch (err) { next(err); }
});

// ── POST /api/orders/:id/complete ────────────────────────────────────────────
router.post('/:id/complete', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const result = await orderService.completeOrder(req.params.id, req.body.payment_method);
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/orders/:id/cancel ──────────────────────────────────────────────
router.post('/:id/cancel', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const result = await orderService.cancelOrder(req.params.id);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
