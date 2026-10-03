/**
 * @file server/routes/orders.js
 * @description Orders routes using cc_orders / cc_order_items tables.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

// ── GET /api/orders ───────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { dept, status, date, from, to, member_id, payment_method } = req.query;
    let sql = `
      SELECT o.*,
             COALESCE(u.full_name, u.name) AS member_name, u.email AS member_email, u.phone AS member_phone
        FROM cc_orders o
        LEFT JOIN users u ON o.user_id = u.id
       WHERE 1=1`;
    const params = [];
    if (dept)           { sql += ' AND o.department = ?';         params.push(dept); }
    if (status)         { sql += ' AND o.status = ?';             params.push(status); }
    if (date)           { sql += ' AND DATE(o.created_at) = ?';   params.push(date); }
    if (from)           { sql += ' AND DATE(o.created_at) >= ?';  params.push(from); }
    if (to)             { sql += ' AND DATE(o.created_at) <= ?';  params.push(to); }
    if (member_id)      { sql += ' AND o.member_id = ?';          params.push(member_id); }
    if (payment_method) { sql += ' AND o.payment_method = ?';     params.push(payment_method); }
    sql += ' ORDER BY o.created_at DESC LIMIT 200';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/orders/:id ───────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [orders] = await db.query(
      `SELECT o.*, COALESCE(u.full_name,u.name) AS member_name, u.email AS member_email, u.phone AS member_phone
         FROM cc_orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name, p.sku, p.department, p.category,
              pv.variant_name
         FROM cc_order_items oi
         JOIN cc_products p ON oi.product_id = p.id
         LEFT JOIN cc_product_variants pv ON oi.variant_id = pv.id
        WHERE oi.order_id = ?`,
      [req.params.id]
    );
    res.json({ ...orders[0], items });
  } catch (err) { next(err); }
});

// ── POST /api/orders ──────────────────────────────────────────────────────────
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const { department, channel, table_no, user_id, member_id, guest_name, guest_phone,
            delivery_address, items, payment_method } = req.body;
    if (!department || !items || !items.length)
      return res.status(400).json({ error: 'department and items are required' });

    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      const [products] = await db.query('SELECT price FROM cc_products WHERE id=?', [item.product_id]);
      if (!products.length) return res.status(400).json({ error: `Product ${item.product_id} not found` });
      let price = Number(products[0].price);
      if (item.variant_id) {
        const [vr] = await db.query('SELECT price_offset FROM cc_product_variants WHERE id=?', [item.variant_id]);
        if (vr.length) price += Number(vr[0].price_offset);
      }
      item._price = price;
      subtotal += price * item.quantity;
    }

    // Get member discount
    let discount_pct = 0;
    if (member_id) {
      const [mRows] = await db.query(
        `SELECT p.${department === 'shop' ? 'shop' : 'bar'}_discount_pct AS disc
           FROM cc_members m JOIN cc_plans p ON m.plan_id=p.id
          WHERE m.id=? AND m.status='active'`, [member_id]
      );
      if (mRows.length) discount_pct = Number(mRows[0].disc);
    }

    const discount_amount = parseFloat((subtotal * discount_pct / 100).toFixed(2));
    const total = parseFloat((subtotal - discount_amount).toFixed(2));
    const orderCode = `ORD-${department.toUpperCase().slice(0,1)}-${Date.now()}`;

    const [result] = await db.query(
      `INSERT INTO cc_orders (order_code,department,channel,table_no,user_id,member_id,guest_name,guest_phone,
              delivery_address,subtotal,discount_pct,discount_amount,total,status,payment_method,created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderCode, department, channel || 'counter', table_no || null, user_id || null, member_id || null,
       guest_name || null, guest_phone || null, delivery_address || null,
       subtotal, discount_pct, discount_amount, total,
       payment_method ? 'completed' : 'open', payment_method || null,
       req.session.user.id]
    );
    const orderId = result.insertId;

    for (const item of items) {
      const lineTotal = parseFloat((item._price * item.quantity).toFixed(2));
      await db.query(
        `INSERT INTO cc_order_items (order_id,product_id,variant_id,quantity,unit_price,line_total,notes)
         VALUES (?,?,?,?,?,?,?)`,
        [orderId, item.product_id, item.variant_id || null, item.quantity, item._price, lineTotal, item.notes || null]
      );
      // Deduct stock
      if (item.variant_id) {
        await db.query('UPDATE cc_product_variants SET stock_qty=GREATEST(stock_qty-?,0) WHERE id=?', [item.quantity, item.variant_id]);
      } else {
        await db.query('UPDATE cc_products SET stock_qty=GREATEST(stock_qty-?,0) WHERE id=?', [item.quantity, item.product_id]);
      }
    }

    if (payment_method) {
      const payCode = `PAY-${department.toUpperCase()}-${Date.now()}`;
      await db.query(
        `INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at)
         VALUES (?,?,?,?,?,?,'paid',NOW())`,
        [payCode, department, orderId, user_id || req.session.user.id, total, payment_method]
      );
      await db.query(`UPDATE cc_orders SET closed_at=NOW() WHERE id=?`, [orderId]);
    }

    const [rows] = await db.query(`SELECT * FROM cc_orders WHERE id=?`, [orderId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

// ── POST /api/orders/:id/complete ─────────────────────────────────────────────
router.post('/:id/complete', requireLogin, requireRole('staff','owner'), async (req, res, next) => {
  try {
    const { payment_method } = req.body;
    if (!payment_method) return res.status(400).json({ error: 'payment_method required' });

    const [orders] = await db.query('SELECT * FROM cc_orders WHERE id=?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });
    const o = orders[0];
    if (o.status !== 'open') return res.status(400).json({ error: 'Order already closed' });

    await db.query(
      `UPDATE cc_orders SET status='completed', payment_method=?, closed_at=NOW() WHERE id=?`,
      [payment_method, o.id]
    );

    const payCode = `PAY-${o.department.toUpperCase()}-${Date.now()}`;
    await db.query(
      `INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at)
       VALUES (?,?,?,?,?,?,'paid',NOW())`,
      [payCode, o.department, o.id, o.user_id, o.total, payment_method]
    );

    res.json({ message: 'Order completed', payment_method });
  } catch (err) { next(err); }
});

// ── POST /api/orders/:id/cancel ───────────────────────────────────────────────
router.post('/:id/cancel', requireLogin, requireRole('staff','owner'), async (req, res, next) => {
  try {
    const [orders] = await db.query('SELECT * FROM cc_orders WHERE id=?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });
    if (orders[0].status !== 'open') return res.status(400).json({ error: 'Only open orders can be cancelled' });

    await db.query(`UPDATE cc_orders SET status='cancelled' WHERE id=?`, [req.params.id]);

    // Restore stock
    const [items] = await db.query('SELECT * FROM cc_order_items WHERE order_id=?', [req.params.id]);
    for (const item of items) {
      if (item.variant_id) {
        await db.query('UPDATE cc_product_variants SET stock_qty=stock_qty+? WHERE id=?', [item.quantity, item.variant_id]);
      } else {
        await db.query('UPDATE cc_products SET stock_qty=stock_qty+? WHERE id=?', [item.quantity, item.product_id]);
      }
    }
    res.json({ message: 'Order cancelled, stock restored' });
  } catch (err) { next(err); }
});

module.exports = router;
