/**
 * @file server/services/orderService.js
 * @description POS, Shop Counter, Bar Tabs, and Online Orders business rules.
 * Handles atomic inventory deductions, server-side pricing verification, and payments ledger.
 */

const { query, transaction } = require('../db');
const { calculateOrderTotals } = require('./pricing');

/**
 * Creates or updates an order or bar tab.
 * 
 * @param {object} params
 * @param {number|null} params.orderId - if updating existing open order / tab
 * @param {string} params.department - 'shop' or 'bar'
 * @param {string} params.channel - 'pos', 'bar', or 'online'
 * @param {string|null} params.tableNo - table number for bar tabs
 * @param {number|null} params.userId - customer user id
 * @param {number|null} params.memberId - customer member id
 * @param {string|null} params.guestName - customer guest name
 * @param {string|null} params.guestPhone - customer guest phone
 * @param {string|null} params.deliveryAddress - address for online orders
 * @param {Array<{ productId: number, quantity: number, notes?: string }>} params.items
 * @param {number} params.createdByUserId - staff or member who created the order
 * @returns {Promise<object>} { orderId, totals }
 */
async function saveOrder({
  orderId = null,
  department,
  channel,
  tableNo = null,
  userId = null,
  memberId = null,
  guestName = null,
  guestPhone = null,
  deliveryAddress = null,
  items = [],
  createdByUserId
}) {
  return await transaction(async (conn) => {
    // 1. Fetch Member Discount if Member ID provided
    let departmentDiscountPct = 0;
    let resolvedUserId = userId;
    let resolvedMemberId = memberId;

    if (resolvedMemberId) {
      const [mRows] = await conn.query(
        `SELECT m.*, p.shop_discount_pct, p.bar_discount_pct, u.id as user_acc_id
         FROM members m
         JOIN plans p ON m.plan_id = p.id
         JOIN users u ON m.user_id = u.id
         WHERE m.id = ? AND m.status = 'active' AND m.expiry_date >= CURDATE()`,
        [resolvedMemberId]
      );
      if (mRows.length) {
        resolvedUserId = mRows[0].user_acc_id;
        departmentDiscountPct = department === 'shop' ? mRows[0].shop_discount_pct : mRows[0].bar_discount_pct;
      }
    }

    // 2. Fetch real product prices and inventory tracking from DB (never trust client prices)
    const pids = items.map(i => Number(i.productId || i.id)).filter(id => !isNaN(id) && id > 0);
    let dbProducts = [];
    if (pids.length > 0) {
      const [pRows] = await conn.query(
        `SELECT id, name, price, stock_qty, track_stock, is_active FROM products WHERE id IN (?)`,
        [pids]
      );
      dbProducts = pRows;
    }
    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    const verifiedItems = items.map(item => {
      const pid = Number(item.productId || item.id);
      const dbp = productMap.get(pid);
      if (!dbp || !dbp.is_active) {
        const err = new Error(`Product ${pid} not found or inactive`);
        err.status = 404;
        throw err;
      }
      return {
        productId: pid,
        name: dbp.name,
        price: Number(dbp.price),
        quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
        notes: item.notes || null,
        trackStock: dbp.track_stock
      };
    });

    const totals = calculateOrderTotals(verifiedItems, departmentDiscountPct);

    // 3. Order Header Creation or Update
    let currentOrderId = orderId;
    if (!currentOrderId) {
      const prefix = department === 'bar' ? 'TAB-' : 'ORD-';
      const orderCode = prefix + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 899 + 100);
      const [insRes] = await conn.query(
        `INSERT INTO orders (
          order_code, department, channel, table_no, user_id, member_id,
          guest_name, guest_phone, delivery_address, subtotal, discount_pct,
          discount_amount, total, status, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        [
          orderCode, department, channel, tableNo || null, resolvedUserId, resolvedMemberId,
          guestName, guestPhone, deliveryAddress, totals.subtotal, totals.discountPct,
          totals.discountAmount, totals.total, createdByUserId
        ]
      );
      currentOrderId = insRes.insertId;
    } else {
      // If updating an existing open order, restore previously deducted stock before applying new items
      const [oldItems] = await conn.query(
        `SELECT oi.product_id, oi.quantity, p.track_stock
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [currentOrderId]
      );
      for (const old of oldItems) {
        if (old.track_stock) {
          await conn.query('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [old.quantity, old.product_id]);
        }
      }
      await conn.query('DELETE FROM order_items WHERE order_id = ?', [currentOrderId]);

      await conn.query(
        `UPDATE orders SET
          member_id = ?, user_id = ?, guest_name = ?, guest_phone = ?,
          delivery_address = ?, table_no = ?, subtotal = ?, discount_pct = ?,
          discount_amount = ?, total = ?
          WHERE id = ?`,
        [
          resolvedMemberId, resolvedUserId, guestName, guestPhone,
          deliveryAddress, tableNo || null, totals.subtotal, totals.discountPct,
          totals.discountAmount, totals.total, currentOrderId
        ]
      );
    }

    // 4. Deduct Stock Atomically and Insert Order Items
    for (const item of totals.items) {
      const dbp = productMap.get(item.productId);
      if (dbp && dbp.track_stock) {
        const [upRes] = await conn.query(
          `UPDATE products SET stock_qty = stock_qty - ? WHERE id = ? AND stock_qty >= ?`,
          [item.quantity, item.productId, item.quantity]
        );
        if (upRes.affectedRows === 0) {
          const err = new Error(`Not enough stock for "${dbp.name}". Current available: ${dbp.stock_qty}, requested: ${item.quantity}`);
          err.status = 409;
          throw err;
        }
      }

      await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [currentOrderId, item.productId, item.quantity, item.unitPrice, item.lineTotal, item.notes]
      );
    }

    return { orderId: currentOrderId, totals };
  });
}

/**
 * Closes and pays an open order or bar tab.
 * 
 * @param {number} orderId
 * @param {string} paymentMethod - 'cash', 'card', 'upi', etc.
 * @param {number} paidByUserId
 * @returns {Promise<object>}
 */
async function payOrder(orderId, paymentMethod, paidByUserId) {
  return await transaction(async (conn) => {
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orders.length) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }
    const order = orders[0];
    if (order.status !== 'open') {
      const err = new Error(`Order already closed or cancelled (current status: ${order.status})`);
      err.status = 400;
      throw err;
    }

    const paymentCode = 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 899 + 100);
    await conn.query(
      `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'paid', ?)`,
      [
        paymentCode, order.department, order.id, order.user_id,
        order.total, paymentMethod, `Order ${order.order_code} paid via ${paymentMethod}`
      ]
    );

    await conn.query(
      `UPDATE orders SET status = 'completed', closed_at = NOW() WHERE id = ?`,
      [order.id]
    );

    return { success: true, orderId: order.id, orderCode: order.order_code };
  });
}

/**
 * Cancels an order, returns items to stock, and refunds payment.
 * 
 * @param {number} orderId
 * @returns {Promise<object>}
 */
async function cancelOrder(orderId) {
  return await transaction(async (conn) => {
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!orders.length) {
      const err = new Error('Order not found');
      err.status = 404;
      throw err;
    }
    const order = orders[0];

    if (order.status === 'cancelled') {
      const err = new Error('Order is already cancelled');
      err.status = 400;
      throw err;
    }

    // Restock items for stock-tracked products
    const [items] = await conn.query(
      `SELECT oi.product_id, oi.quantity, p.track_stock
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       WHERE oi.order_id = ?`,
      [orderId]
    );
    for (const item of items) {
      if (item.track_stock) {
        await conn.query('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [item.quantity, item.product_id]);
      }
    }

    await conn.query(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [orderId]);

    await conn.query(
      `UPDATE payments SET status = 'refunded', refunded_at = NOW()
       WHERE reference_id = ? AND source IN ('shop', 'bar')`,
      [orderId]
    );

    return { success: true, orderId: order.id, status: 'cancelled' };
  });
}

module.exports = {
  saveOrder,
  payOrder,
  cancelOrder
};