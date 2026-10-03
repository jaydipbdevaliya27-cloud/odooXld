/**
 * @file server/routes/orders.js
 * @description Orders routes using cc_orders / cc_order_items tables with real-time stock deduction and member discounts.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin } = require('../middleware/auth');
const router  = express.Router();

// ── GET /api/orders ───────────────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const u = req.session.user;
    const { dept, status, date, from, to, member_id, payment_method } = req.query;

    let sql = `
      SELECT o.*,
             COALESCE(u.full_name, u.name) AS member_name, u.email AS member_email, u.phone AS member_phone,
             p.name AS plan_name
        FROM cc_orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN cc_members m ON (o.member_id = m.id OR o.user_id = m.user_id)
        LEFT JOIN cc_plans p ON m.plan_id = p.id
       WHERE 1=1`;
    const params = [];

    // If logged in as member, only show their own orders
    if (u.role === 'member') {
      sql += ' AND o.user_id = ?';
      params.push(u.id);
    } else {
      if (member_id) { sql += ' AND (o.member_id = ? OR o.user_id = ?)'; params.push(member_id, member_id); }
    }

    if (dept)           { sql += ' AND o.department = ?';         params.push(dept); }
    if (status)         { sql += ' AND o.status = ?';             params.push(status); }
    if (date)           { sql += ' AND DATE(o.created_at) = ?';   params.push(date); }
    if (from)           { sql += ' AND DATE(o.created_at) >= ?';  params.push(from); }
    if (to)             { sql += ' AND DATE(o.created_at) <= ?';  params.push(to); }
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
      `SELECT o.*, COALESCE(u.full_name,u.name) AS member_name, u.email AS member_email, u.phone AS member_phone,
              p.name AS plan_name
         FROM cc_orders o
         LEFT JOIN users u ON o.user_id = u.id
         LEFT JOIN cc_members m ON (o.member_id = m.id OR o.user_id = m.user_id)
         LEFT JOIN cc_plans p ON m.plan_id = p.id
        WHERE o.id = ?`,
      [req.params.id]
    );
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });
    const order = orders[0];

    // Check permissions for member
    if (req.session.user.role === 'member' && order.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [items] = await db.query(
      `SELECT oi.*, p.name AS product_name, p.sku, p.department, p.category, p.image_url,
              pv.variant_name
         FROM cc_order_items oi
         JOIN cc_products p ON oi.product_id = p.id
         LEFT JOIN cc_product_variants pv ON oi.variant_id = pv.id
        WHERE oi.order_id = ?`,
      [req.params.id]
    );
    res.json({ ...order, items });
  } catch (err) { next(err); }
});

// ── POST /api/orders (Create Order & Deduct Inventory) ─────────────────────────
router.post('/', requireLogin, async (req, res, next) => {
  try {
    const sessionUser = req.session.user;
    let { department, channel, table_no, user_id, member_id, guest_name, guest_phone,
          delivery_address, items, payment_method } = req.body;

    if (!department) department = 'shop';
    if (!items || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'Order items are required' });

    // Set user ID if placing from member portal
    const targetUserId = user_id || (sessionUser.role === 'member' ? sessionUser.id : null);

    // If member_id not passed, look up from cc_members by user ID
    let resolvedMemberId = member_id || null;
    let discount_pct = 0;

    if (targetUserId) {
      const [mRows] = await db.query(
        `SELECT m.id AS member_id, p.${department === 'shop' ? 'shop' : 'bar'}_discount_pct AS disc_pct
           FROM cc_members m
           JOIN cc_plans p ON m.plan_id = p.id
          WHERE m.user_id = ? AND m.status = 'active'`,
        [targetUserId]
      );
      if (mRows.length) {
        resolvedMemberId = mRows[0].member_id;
        discount_pct = Number(mRows[0].disc_pct) || 0;
      }
    } else if (resolvedMemberId) {
      const [mRows] = await db.query(
        `SELECT p.${department === 'shop' ? 'shop' : 'bar'}_discount_pct AS disc_pct
           FROM cc_members m
           JOIN cc_plans p ON m.plan_id = p.id
          WHERE m.id = ? AND m.status = 'active'`,
        [resolvedMemberId]
      );
      if (mRows.length) {
        discount_pct = Number(mRows[0].disc_pct) || 0;
      }
    }

    // Verify stock and compute subtotal
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const [products] = await db.query('SELECT * FROM cc_products WHERE id=?', [item.product_id]);
      if (!products.length) return res.status(400).json({ error: `Product not found (ID: ${item.product_id})` });
      const prod = products[0];

      let price = Number(prod.price);
      let variantName = null;

      if (item.variant_id) {
        const [vr] = await db.query('SELECT * FROM cc_product_variants WHERE id=? AND product_id=?', [item.variant_id, item.product_id]);
        if (vr.length) {
          price += Number(vr[0].price_offset || 0);
          variantName = vr[0].variant_name;
          if (vr[0].stock_qty < item.quantity) {
            return res.status(400).json({ error: `Insufficient stock for ${prod.name} (${variantName}). Only ${vr[0].stock_qty} available.` });
          }
        }
      } else if (prod.track_stock && prod.stock_qty < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${prod.name}. Only ${prod.stock_qty} available.` });
      }

      const qty = parseInt(item.quantity) || 1;
      const lineTotal = parseFloat((price * qty).toFixed(2));
      subtotal += lineTotal;

      validatedItems.push({
        product_id: prod.id,
        variant_id: item.variant_id || null,
        variant_name: variantName,
        quantity: qty,
        unit_price: price,
        line_total: lineTotal,
        notes: item.notes || null
      });
    }

    const discount_amount = parseFloat((subtotal * discount_pct / 100).toFixed(2));
    const total = parseFloat(Math.max(0, subtotal - discount_amount).toFixed(2));
    const orderCode = `ORD-${department.toUpperCase().slice(0, 1)}${Date.now().toString().slice(-6)}`;

    // Create Order Record
    const [result] = await db.query(
      `INSERT INTO cc_orders (order_code, department, channel, table_no, user_id, member_id, guest_name, guest_phone,
              delivery_address, subtotal, discount_pct, discount_amount, total, status, payment_method, created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderCode, department, channel || (sessionUser.role === 'member' ? 'online' : 'counter'),
       table_no || null, targetUserId, resolvedMemberId,
       guest_name || null, guest_phone || null, delivery_address || null,
       subtotal, discount_pct, discount_amount, total,
       payment_method ? 'completed' : 'open', payment_method || null,
       sessionUser.id]
    );
    const orderId = result.insertId;

    // Insert Item Lines & Deduct Real-Time Stock
    for (const vItem of validatedItems) {
      await db.query(
        `INSERT INTO cc_order_items (order_id, product_id, variant_id, quantity, unit_price, line_total, notes)
         VALUES (?,?,?,?,?,?,?)`,
        [orderId, vItem.product_id, vItem.variant_id, vItem.quantity, vItem.unit_price, vItem.line_total, vItem.notes]
      );

      // Deduct from variant if selected
      if (vItem.variant_id) {
        await db.query('UPDATE cc_product_variants SET stock_qty = GREATEST(stock_qty - ?, 0) WHERE id = ?', [vItem.quantity, vItem.variant_id]);
      }
      // Deduct from parent product total stock
      await db.query('UPDATE cc_products SET stock_qty = GREATEST(stock_qty - ?, 0) WHERE id = ?', [vItem.quantity, vItem.product_id]);
    }

    // Record Payment transaction if method provided
    if (payment_method && total > 0) {
      const payCode = `PAY-${department.toUpperCase()}-${Date.now().toString().slice(-8)}`;
      await db.query(
        `INSERT INTO cc_payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
         VALUES (?,?,?,?,?,?,'paid',NOW())`,
        [payCode, department, orderId, targetUserId || sessionUser.id, total, payment_method]
      );
      await db.query(`UPDATE cc_orders SET closed_at = NOW() WHERE id = ?`, [orderId]);
    }

    const [createdOrders] = await db.query(
      `SELECT o.*, COALESCE(u.full_name, u.name) AS member_name, u.email AS member_email
         FROM cc_orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?`,
      [orderId]
    );

    res.status(201).json({
      ...createdOrders[0],
      items: validatedItems,
      message: 'Order created successfully and inventory adjusted.'
    });
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

// ── POST /api/orders/:id/complete ─────────────────────────────────────────────
router.post('/:id/complete', requireLogin, async (req, res, next) => {
  try {
    const { payment_method } = req.body;
    if (!payment_method) return res.status(400).json({ error: 'payment_method is required' });

    const [orders] = await db.query('SELECT * FROM cc_orders WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });
    const o = orders[0];
    if (o.status !== 'open') return res.status(400).json({ error: 'Order is already completed or cancelled' });

    await db.query(
      `UPDATE cc_orders SET status = 'completed', payment_method = ?, closed_at = NOW() WHERE id = ?`,
      [payment_method, o.id]
    );

    const payCode = `PAY-${o.department.toUpperCase()}-${Date.now().toString().slice(-8)}`;
    await db.query(
      `INSERT INTO cc_payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
       VALUES (?,?,?,?,?,?,'paid',NOW())`,
      [payCode, o.department, o.id, o.user_id, o.total, payment_method]
    );

    res.json({ message: 'Order marked as completed and payment recorded', payment_method });
  } catch (err) { next(err); }
});

// ── POST /api/orders/:id/cancel ───────────────────────────────────────────────
router.post('/:id/cancel', requireLogin, async (req, res, next) => {
  try {
    const [orders] = await db.query('SELECT * FROM cc_orders WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: 'Order not found' });
    const o = orders[0];
    if (o.status !== 'open') return res.status(400).json({ error: 'Only open orders can be cancelled' });

    await db.query(`UPDATE cc_orders SET status = 'cancelled' WHERE id = ?`, [req.params.id]);

    // Restore stock in inventory
    const [items] = await db.query('SELECT * FROM cc_order_items WHERE order_id = ?', [req.params.id]);
    for (const item of items) {
      if (item.variant_id) {
        await db.query('UPDATE cc_product_variants SET stock_qty = stock_qty + ? WHERE id = ?', [item.quantity, item.variant_id]);
      }
      await db.query('UPDATE cc_products SET stock_qty = stock_qty + ? WHERE id = ?', [item.quantity, item.product_id]);
    }

    res.json({ message: 'Order cancelled and stock restored to inventory' });
  } catch (err) { next(err); }
});

module.exports = router;
