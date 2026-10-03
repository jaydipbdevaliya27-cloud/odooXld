/**
 * @file server/routes/reports.js
 * @description Owner dashboard report endpoints using cc_ tables.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();
router.use(requireLogin, requireRole('owner'));

// ── GET /api/reports/summary ──────────────────────────────────────────────────
router.get('/summary', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [[rev]]   = await db.query(`SELECT IFNULL(SUM(amount),0) AS v FROM cc_payments WHERE DATE(paid_at)=? AND status='paid'`, [today]);
    const [[bks]]   = await db.query(`SELECT COUNT(*) AS v FROM cc_bookings WHERE booking_date=? AND status='confirmed'`, [today]);
    const [[mem]]   = await db.query(`SELECT COUNT(*) AS v FROM cc_members WHERE status='active'`);
    const [[exp]]   = await db.query(`SELECT COUNT(*) AS v FROM cc_members WHERE status='active' AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 30 DAY)`);
    const [[ls]]    = await db.query(`SELECT COUNT(*) AS v FROM cc_products WHERE is_active=1 AND track_stock=1 AND stock_qty<=reorder_level`);
    const [[ord]]   = await db.query(`SELECT COUNT(*) AS v FROM cc_orders WHERE status='open'`);
    const [[todayOrd]] = await db.query(`SELECT COUNT(*) AS v FROM cc_orders WHERE DATE(created_at)=?`, [today]);
    const [[todayRev]] = await db.query(`SELECT IFNULL(SUM(amount),0) AS v FROM cc_payments WHERE DATE(paid_at)=? AND status='paid' AND source='shop'`, [today]);
    const [[barRev]]   = await db.query(`SELECT IFNULL(SUM(amount),0) AS v FROM cc_payments WHERE DATE(paid_at)=? AND status='paid' AND source='bar'`, [today]);

    res.json({
      today_revenue:  rev.v,
      today_bookings: bks.v,
      active_members: mem.v,
      expiring_soon:  exp.v,
      low_stock:      ls.v,
      open_orders:    ord.v,
      today_orders:   todayOrd.v,
      shop_revenue:   todayRev.v,
      bar_revenue:    barRev.v
    });
  } catch (err) { next(err); }
});

// ── GET /api/reports/revenue ──────────────────────────────────────────────────
router.get('/revenue', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to   = req.query.to   || from;
    const [bySource] = await db.query(
      `SELECT source, SUM(amount) AS total, COUNT(*) AS count FROM cc_payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid' GROUP BY source`, [from, to]
    );
    const [byMethod] = await db.query(
      `SELECT method, SUM(amount) AS total FROM cc_payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid' GROUP BY method`, [from, to]
    );
    const [daily] = await db.query(
      `SELECT DATE(paid_at) AS day, SUM(amount) AS total FROM cc_payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid' GROUP BY day ORDER BY day`, [from, to]
    );
    res.json({ by_source: bySource, by_method: byMethod, daily });
  } catch (err) { next(err); }
});

// ── GET /api/reports/expiring ─────────────────────────────────────────────────
router.get('/expiring', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || 30, 10);
    const [rows] = await db.query(
      `SELECT m.id, m.member_code, COALESCE(u.full_name,u.name) AS full_name, u.email, u.phone,
              p.name AS plan_name, m.expiry_date, m.status,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m JOIN users u ON m.user_id=u.id JOIN cc_plans p ON m.plan_id=p.id
        WHERE m.status='active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL ? DAY)
        ORDER BY m.expiry_date`, [days]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/reports/low-stock ────────────────────────────────────────────────
router.get('/low-stock', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id,sku,name,department,category,stock_qty,reorder_level
         FROM cc_products WHERE is_active=1 AND track_stock=1 AND stock_qty<=reorder_level
         ORDER BY stock_qty`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
