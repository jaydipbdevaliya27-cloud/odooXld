/**
 * @file server/services/orderService.js
 * @description Core order creation and inventory management service.
 * Enforces atomic stock checking with SELECT FOR UPDATE and records stock movements.
 */

const { query, transaction } = require('../db');
const { calculateOrderTotals } = require('./pricing');

/**
 * Creates an order inside an atomic transaction with stock verification and lock.
 */
async function createOrder({
  department,
  channel = 'counter',
  tableNo = null,
  tabId = null,
  userId = null,
  memberId = null,
  guestName = null,
  guestPhone = null,
  deliveryAddress = null,
  deliveryFee = 0,
  courierNotes = null,
  items = [],
  paymentMethod = 'cash',
  createdByUserId
}) {
  if (!items || items.length === 0) {
    const err = new Error('Order must contain at least one item.');
    err.code = 'EMPTY_ORDER';
    err.status = 400;
    throw err;
  }

  return await transaction(async (conn) => {
    // 1. Fetch member discounts if member order
    let discountPct = 0;
    let effectiveMemberId = memberId;
    let effectiveUserId = userId;

    if (memberId || userId) {
      const [mRows] = await conn.query(
        `SELECT m.id, m.user_id, m.status, m.expiry_date,
                p.shop_discount_pct, p.bar_discount_pct
         FROM members m
         JOIN plans p ON m.plan_id = p.id
         WHERE m.id = ? OR m.user_id = ?`,
        [memberId || 0, userId || 0]
      );
      if (mRows.length > 0 && mRows[0].status === 'active' && new Date(mRows[0].expiry_date) >= new Date()) {
        effectiveMemberId = mRows[0].id;
        effectiveUserId = mRows[0].user_id;
        discountPct = department === 'bar' ? mRows[0].bar_discount_pct : mRows[0].shop_discount_pct;
      }
    }

    // 2. Fetch product details with SELECT FOR UPDATE to lock inventory rows
    const productIds = items.map(i => parseInt(i.product_id || i.id, 10));
    const [dbProducts] = await conn.query(
      `SELECT id, sku, name, department, price, track_stock, stock_qty, is_active
       FROM products WHERE id IN (?) FOR UPDATE`,
      [productIds]
    );

    const productMap = new Map();
    dbProducts.forEach(p => productMap.set(p.id, p));

    // 3. Verify products and stock availability
    const validatedItems = [];
    for (const item of items) {
      const pid = parseInt(item.product_id || item.id, 10);
      const prod = productMap.get(pid);

      if (!prod || !prod.is_active) {
        const err = new Error(`Product "${item.name || pid}" is inactive or unavailable.`);
        err.code = 'PRODUCT_UNAVAILABLE';
        err.status = 400;
        throw err;
      }

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      if (prod.track_stock && prod.stock_qty < qty) {
        const err = new Error(`Insufficient stock for "${prod.name}". Available: ${prod.stock_qty}, Requested: ${qty}.`);
        err.code = 'INSUFFICIENT_STOCK';
        err.status = 409;
        throw err;
      }

      validatedItems.push({
        product: prod,
        productId: prod.id,
        quantity: qty,
        unitPrice: Number(prod.price),
        lineTotal: Math.round(Number(prod.price) * qty * 100) / 100,
        notes: item.notes || null,
        variantId: item.variant_id || null
      });
    }

    // 4. Calculate subtotal, discount, and total
    const subtotal = validatedItems.reduce((acc, it) => acc + it.lineTotal, 0);
    const discountAmount = Math.round((subtotal * (discountPct / 100)) * 100) / 100;
    const total = Math.round((subtotal - discountAmount + Number(deliveryFee || 0)) * 100) / 100;

    // 5. Generate unique order code
    const orderCode = `ORD-${department.toUpperCase().slice(0, 3)}-${Date.now().toString().slice(-6)}`;
    const fulfilmentStatus = channel === 'online' ? 'placed' : 'ready_for_pickup';
    const initialStatus = tabId ? 'open' : (channel === 'online' ? 'open' : 'completed');

    // 6. Insert order header
    const [ordRes] = await conn.query(
      `INSERT INTO orders (
        order_code, department, channel, table_no, tab_id, user_id, member_id,
        guest_name, guest_phone, delivery_address, delivery_fee, courier_notes,
        fulfilment_status, subtotal, discount_pct, discount_amount, total,
        status, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderCode, department, channel, tableNo || null, tabId || null,
        effectiveUserId, effectiveMemberId, guestName || null, guestPhone || null,
        deliveryAddress || null, deliveryFee || 0, courierNotes || null,
        fulfilmentStatus, subtotal, discountPct, discountAmount, total,
        initialStatus, createdByUserId
      ]
    );
    const orderId = ordRes.insertId;

    // 7. Insert order items & deduct stock with movement ledger entry
    for (const it of validatedItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price, line_total, notes, kitchen_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, it.productId, it.variantId, it.quantity, it.unitPrice, it.lineTotal,
          it.notes, department === 'bar' ? 'new' : 'served'
        ]
      );

      if (it.product.track_stock) {
        const prevStock = it.product.stock_qty;
        const nextStock = prevStock - it.quantity;

        await conn.query('UPDATE products SET stock_qty = ? WHERE id = ?', [nextStock, it.productId]);

        await conn.query(
          `INSERT INTO stock_movements (
            product_id, movement_type, quantity, previous_stock, new_stock,
            reference_type, reference_id, notes, created_by
          ) VALUES (?, 'sale', ?, ?, ?, 'order', ?, 'Customer sale', ?)`,
          [it.productId, -it.quantity, prevStock, nextStock, orderId, createdByUserId]
        );
      }
    }

    // 8. Record payment if direct sale (not tab)
    if (!tabId && total > 0 && paymentMethod) {
      const payCode = `PAY-ORD-${Date.now()}`;
      await conn.query(
        `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 'paid', NOW())`,
        [payCode, department, orderId, effectiveUserId, total, paymentMethod]
      );
    }

    return {
      id: orderId,
      orderCode,
      order_code: orderCode,
      subtotal,
      discountPct,
      discountAmount,
      total,
      fulfilmentStatus,
      status: initialStatus
    };
  });
}

/**
 * Updates an order status (e.g. cancelled) and handles inventory stock restoration.
 */
async function updateOrderStatus(orderId, status, userId) {
  return await transaction(async (conn) => {
    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!orders.length) {
      const err = new Error('Order not found.');
      err.status = 404;
      throw err;
    }
    const order = orders[0];
    if (order.status === status) return { id: orderId, status };

    const oldStatus = order.status;
    await conn.query(
      'UPDATE orders SET status = ?, fulfilment_status = IF(? = "cancelled", "cancelled", fulfilment_status) WHERE id = ?',
      [status, status, orderId]
    );

    // If cancelling an order that was not already cancelled, restore stock
    if (status === 'cancelled' && oldStatus !== 'cancelled') {
      const [items] = await conn.query(
        'SELECT oi.*, p.track_stock, p.stock_qty FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
        [orderId]
      );
      for (const item of items) {
        if (item.track_stock) {
          const [pRows] = await conn.query('SELECT stock_qty FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
          if (pRows.length) {
            const prevStock = pRows[0].stock_qty;
            const nextStock = prevStock + item.quantity;
            await conn.query('UPDATE products SET stock_qty = ? WHERE id = ?', [nextStock, item.product_id]);
            await conn.query(
              `INSERT INTO stock_movements (
                product_id, movement_type, quantity, previous_stock, new_stock,
                reference_type, reference_id, notes, created_by
              ) VALUES (?, 'cancel', ?, ?, ?, 'order', ?, 'Order cancelled - stock restored', ?)`,
              [item.product_id, item.quantity, prevStock, nextStock, orderId, userId || null]
            );
          }
        }
      }
    }
    return { id: orderId, status };
  });
}

module.exports = {
  createOrder,
  updateOrderStatus
};