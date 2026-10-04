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
      where += ' AND (o.user_id = ? OR o.member_id = ? OR o.member_id IN (SELECT id FROM members WHERE user_id = ?))';
      params.push(user.id, user.member_id || 0, user.id);
    }

    if (q && q.trim()) {
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
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
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

    // Populate order items and calculate live kitchen status for bar/cafeteria orders
    if (rows.length > 0) {
      const orderIds = rows.map(r => r.id);
      const [allItems] = await db.query(
        `SELECT oi.*, p.name AS product_name, p.image_url, p.sku
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id IN (?)`,
        [orderIds]
      );

      const itemMap = {};
      allItems.forEach(it => {
        if (!itemMap[it.order_id]) itemMap[it.order_id] = [];
        itemMap[it.order_id].push(it);
      });

      rows.forEach(r => {
        r.items = itemMap[r.id] || [];

        // Build human readable items summary
        r.items_summary = r.items.map(i => `${i.product_name} (x${i.quantity})`).join(', ') || 'No items';

        // Calculate kitchen_summary for bar/cafeteria orders
        if (r.department === 'bar') {
          const kStatuses = r.items.map(i => i.kitchen_status || 'new');
          if (r.status === 'cancelled') {
            r.kitchen_summary = 'cancelled';
          } else if (kStatuses.length === 0) {
            r.kitchen_summary = r.status === 'completed' ? 'served' : 'preparing';
          } else if (kStatuses.every(s => s === 'served')) {
            r.kitchen_summary = 'served';
          } else if (kStatuses.every(s => s === 'ready' || s === 'served')) {
            r.kitchen_summary = 'ready';
          } else if (kStatuses.some(s => s === 'preparing')) {
            r.kitchen_summary = 'preparing';
          } else {
            r.kitchen_summary = kStatuses[0] || 'new';
          }
        } else {
          r.kitchen_summary = null;
        }
      });
    }

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
    const orderId = parseInt(req.params.id, 10);
    if (isNaN(orderId)) return next();

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
      [orderId]
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
        effectiveMemberId = user.member_id || null;
        if (!effectiveMemberId) {
          const [mRows] = await db.query('SELECT id FROM members WHERE user_id = ?', [user.id]);
          if (mRows.length) effectiveMemberId = mRows[0].id;
        }
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

      res.status(201).json({ data: result, ...result });
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
    const orderId = parseInt(req.params.id, 10);

    const allowed = ['placed', 'packed', 'ready_for_pickup', 'out_for_delivery', 'collected', 'delivered', 'cancelled'];
    if (!allowed.includes(fulfilment_status)) {
      return res.status(400).json({ error: `Invalid fulfilment status: ${fulfilment_status}` });
    }

    if (fulfilment_status === 'cancelled') {
      await orderService.updateOrderStatus(orderId, 'cancelled', req.session.user.id);
      return res.json({ ok: true, fulfilment_status: 'cancelled', status: 'cancelled' });
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
              COALESCE(u.full_name, o.guest_name) AS customer_name,
              TIMESTAMPDIFF(MINUTE, oi.created_at, NOW()) AS elapsed_minutes
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
             LEFT JOIN users u ON o.user_id = u.id
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

// ── Dynamic Dining Tables API ──────────────────────────────────────────────
router.get('/tables', requireLogin, async (req, res, next) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS dining_tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        table_number VARCHAR(50) NOT NULL UNIQUE,
        capacity INT DEFAULT 4,
        section VARCHAR(50) DEFAULT 'Main Dining',
        status ENUM('available', 'occupied', 'reserved', 'maintenance') DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [tables] = await db.query('SELECT * FROM dining_tables ORDER BY id ASC');
    
    // Fetch active bar orders with table_no placed today
    const [activeOrders] = await db.query(
      `SELECT o.id, o.order_code, o.table_no, o.status, o.total, o.created_at,
              COALESCE(u.full_name, ordMemberUser.full_name, o.guest_name, 'Member') AS customer_name,
              COALESCE(u.email, ordMemberUser.email) AS customer_email,
              COALESCE(u.phone, ordMemberUser.phone, o.guest_phone) AS customer_phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       LEFT JOIN members ordMember ON o.member_id = ordMember.id
       LEFT JOIN users ordMemberUser ON ordMember.user_id = ordMemberUser.id
       WHERE o.department = 'bar'
         AND o.table_no IS NOT NULL
         AND o.status IN ('open', 'placed', 'cooking', 'in_progress', 'served', 'ready')
         AND DATE(o.created_at) = CURDATE()
       ORDER BY o.created_at DESC`
    );

    // Fetch active bar tabs
    const [activeTabs] = await db.query(
      `SELECT t.id, t.tab_name, t.opened_at,
              COALESCE(u.full_name, tabUser.full_name, t.guest_name, 'Guest') AS customer_name,
              COALESCE(SUM(o.total), 0) AS tab_total
       FROM tabs t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN members tabMember ON t.member_id = tabMember.id
       LEFT JOIN users tabUser ON tabMember.user_id = tabUser.id
       LEFT JOIN orders o ON t.id = o.tab_id AND o.status != 'cancelled'
       WHERE t.status = 'open'
       GROUP BY t.id`
    );

    const mappedTables = tables.map(tbl => {
      const tNum = tbl.table_number.trim();
      const order = activeOrders.find(o => o.table_no && (o.table_no.trim().toLowerCase() === tNum.toLowerCase() || o.table_no.trim() === tNum.replace(/[^0-9]/g, '')));
      const tab = activeTabs.find(t => t.tab_name && (t.tab_name.trim().toLowerCase() === tNum.toLowerCase() || t.tab_name.includes(tNum)));

      const isOccupied = Boolean(order || tab || tbl.status === 'occupied' || tbl.status === 'reserved');
      const lockedByName = (order && order.customer_name) || (tab && tab.customer_name) || (tbl.status === 'reserved' ? 'Reserved' : null);
      const lockedOrderCode = (order && order.order_code) || (tab && tab.tab_name) || null;
      const lockedOrderId = (order && order.id) || (tab && tab.id) || null;
      const lockedOrderTotal = (order && order.total) || (tab && tab.tab_total) || 0;
      const lockedOrderTime = (order && order.created_at) || (tab && tab.opened_at) || null;

      return {
        id: tbl.id,
        table_number: tbl.table_number,
        capacity: tbl.capacity,
        section: tbl.section,
        status: isOccupied ? 'occupied' : tbl.status,
        is_occupied: isOccupied,
        locked_by_name: lockedByName,
        locked_order_code: lockedOrderCode,
        locked_order_id: lockedOrderId,
        locked_order_total: Number(lockedOrderTotal),
        locked_order_time: lockedOrderTime
      };
    });

    res.json({ data: mappedTables });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/tables (Add New Dining Table)
router.post('/tables', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { table_number, capacity = 4, section = 'Main Dining' } = req.body;
    if (!table_number || !table_number.trim()) {
      return res.status(400).json({ error: 'Table number/name is required.' });
    }

    const tNum = table_number.trim();
    const cap = Math.max(1, parseInt(capacity, 10) || 4);
    const sec = section.trim() || 'Main Dining';

    const [existing] = await db.query('SELECT id FROM dining_tables WHERE LOWER(table_number) = LOWER(?)', [tNum]);
    if (existing.length) {
      return res.status(409).json({ error: `Table "${tNum}" already exists.` });
    }

    const [result] = await db.query(
      'INSERT INTO dining_tables (table_number, capacity, section, status) VALUES (?, ?, ?, "available")',
      [tNum, cap, sec]
    );

    const [created] = await db.query('SELECT * FROM dining_tables WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, table: created[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/orders/tables/:id (Delete Dining Table)
router.delete('/tables/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await db.query('SELECT * FROM dining_tables WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Dining table not found.' });

    await db.query('DELETE FROM dining_tables WHERE id = ?', [id]);
    res.json({ ok: true, message: `Table "${rows[0].table_number}" deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// POST /api/orders/tables/:id/release (Release / Free Occupied Table)
router.post('/tables/:id/release', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await db.query('SELECT * FROM dining_tables WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Dining table not found.' });

    const tNum = rows[0].table_number;

    await db.query(
      `UPDATE orders SET status = 'completed', closed_at = NOW()
       WHERE department = 'bar' AND table_no = ? AND status IN ('open', 'placed', 'cooking', 'in_progress', 'served', 'ready')`,
      [tNum]
    );

    await db.query(
      `UPDATE tabs SET status = 'settled', closed_at = NOW() WHERE status = 'open' AND tab_name = ?`,
      [tNum]
    );

    await db.query('UPDATE dining_tables SET status = "available" WHERE id = ?', [id]);

    res.json({ ok: true, message: `Table "${tNum}" has been released and is now available.` });
  } catch (err) {
    next(err);
  }
});

// ── Bar Tabs API ────────────────────────────────────────────────────────────
router.get('/tabs/active', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT t.*, COALESCE(u.full_name, tabUser.full_name, t.guest_name) AS customer_name,
              COALESCE(SUM(o.total), 0) AS tab_total,
              COUNT(o.id) AS order_count
       FROM tabs t
       LEFT JOIN users u ON t.user_id = u.id
        LEFT JOIN members tabMember ON t.member_id = tabMember.id
        LEFT JOIN users tabUser ON tabMember.user_id = tabUser.id
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
      let resolvedUserId = user_id || null;
      if (!resolvedUserId && member_id) {
        const [memberRows] = await db.query('SELECT user_id FROM members WHERE id = ?', [member_id]);
        if (!memberRows.length) return res.status(404).json({ error: 'Member not found.' });
        resolvedUserId = memberRows[0].user_id;
      }
      const [r] = await db.query(
        `INSERT INTO tabs (tab_name, user_id, member_id, guest_name, guest_phone, status, opened_by, notes)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        [tab_name.trim(), resolvedUserId, member_id || null, guest_name || null, guest_phone || null, req.session.user.id, notes || null]
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

// ── DELETE /api/orders/:id ──────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const force = req.query.force === 'true';

    if (force && req.session.user.role === 'owner') {
      await db.transaction(async (conn) => {
        const [orders] = await conn.query('SELECT status FROM orders WHERE id = ?', [orderId]);
        if (orders.length && orders[0].status !== 'cancelled') {
          const [items] = await conn.query(
            'SELECT oi.*, p.track_stock FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
            [orderId]
          );
          for (const item of items) {
            if (item.track_stock) {
              await conn.query('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?', [item.quantity, item.product_id]);
            }
          }
        }
        await conn.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
        await conn.query('DELETE FROM payments WHERE source IN ("shop", "bar") AND reference_id = ?', [orderId]);
        await conn.query('DELETE FROM orders WHERE id = ?', [orderId]);
      });
      return res.json({ ok: true, message: 'Order permanently deleted' });
    }

    // Default: cancel order and restore stock
    await orderService.updateOrderStatus(orderId, 'cancelled', req.session.user.id);
    res.json({ ok: true, message: 'Order cancelled and stock restored' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
