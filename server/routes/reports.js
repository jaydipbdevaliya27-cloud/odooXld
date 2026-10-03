/**
 * @file server/routes/reports.js
 * @description Owner dashboard report endpoints.
 * All routes require 'owner' role.
 *
 * GET /api/reports/summary        – today's KPI snapshot
 * GET /api/reports/revenue?from&to – revenue by source and method
 * GET /api/reports/bookings        – booking counts by court and sport
 * GET /api/reports/expiring        – members expiring in the next 30 days
 * GET /api/reports/low-stock       – products below reorder level
 */

const express = require('express');
const db      = require('../db');
const cfg     = require('../config');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();
// All report routes require owner role
router.use(requireLogin, requireRole('owner'));

// ── GET /api/reports/summary ─────────────────────────────────────────────────
// Returns today's key numbers in one call for the dashboard cards
router.get('/summary', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [[revenueRow]] = await db.query(
      "SELECT IFNULL(SUM(amount),0) AS today_revenue FROM payments WHERE DATE(paid_at)=? AND status='paid'",
      [today]
    );
    const [[bookingsRow]] = await db.query(
      "SELECT COUNT(*) AS today_bookings FROM bookings WHERE booking_date=? AND status='confirmed'",
      [today]
    );
    const [[activeMembers]] = await db.query(
      "SELECT COUNT(*) AS active_members FROM members WHERE status='active'"
    );
    const [[expiringRow]] = await db.query(
      `SELECT COUNT(*) AS expiring_soon FROM members
        WHERE status='active' AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
      [cfg.EXPIRY_WARNING_DAYS]
    );
    const [[lowStockRow]] = await db.query(
      'SELECT COUNT(*) AS low_stock FROM products WHERE is_active=1 AND track_stock=1 AND stock_qty <= reorder_level'
    );
    const [[openOrders]] = await db.query(
      "SELECT COUNT(*) AS open_orders FROM orders WHERE status='open'"
    );

    res.json({
      today_revenue:  revenueRow.today_revenue,
      today_bookings: bookingsRow.today_bookings,
      active_members: activeMembers.active_members,
      expiring_soon:  expiringRow.expiring_soon,
      low_stock:      lowStockRow.low_stock,
      open_orders:    openOrders.open_orders
    });
  } catch (err) { next(err); }
});

// ── GET /api/reports/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD ──────────────────
router.get('/revenue', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to   = req.query.to   || from;

    // Revenue by source (membership, court, shop, bar)
    const [bySource] = await db.query(
      `SELECT source, SUM(amount) AS total, COUNT(*) AS count
         FROM payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid'
        GROUP BY source`,
      [from, to]
    );

    // Revenue by payment method
    const [byMethod] = await db.query(
      `SELECT method, SUM(amount) AS total
         FROM payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid'
        GROUP BY method`,
      [from, to]
    );

    // Daily totals for chart
    const [daily] = await db.query(
      `SELECT DATE(paid_at) AS day, SUM(amount) AS total
         FROM payments
        WHERE DATE(paid_at) BETWEEN ? AND ? AND status='paid'
        GROUP BY day ORDER BY day`,
      [from, to]
    );

    res.json({ by_source: bySource, by_method: byMethod, daily });
  } catch (err) { next(err); }
});

// ── GET /api/reports/bookings?from&to ────────────────────────────────────────
router.get('/bookings', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to   = req.query.to   || from;

    const [rows] = await db.query(
      `SELECT c.name AS court_name, c.sport, COUNT(*) AS total_bookings,
              SUM(b.price_charged) AS total_revenue
         FROM bookings b JOIN courts c ON b.court_id = c.id
        WHERE b.booking_date BETWEEN ? AND ? AND b.status != 'cancelled'
        GROUP BY c.id ORDER BY total_bookings DESC`,
      [from, to]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/reports/expiring ────────────────────────────────────────────────
router.get('/expiring', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || cfg.EXPIRY_WARNING_DAYS, 10);
    const [rows] = await db.query(
      `SELECT m.member_code, u.full_name, u.email, u.phone,
              p.name AS plan_name, m.expiry_date,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM members m
         JOIN users u ON m.user_id = u.id
         JOIN plans p ON m.plan_id = p.id
        WHERE m.status='active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        ORDER BY m.expiry_date`,
      [days]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/reports/low-stock ───────────────────────────────────────────────
router.get('/low-stock', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, sku, name, department, category, stock_qty, reorder_level
         FROM products
        WHERE is_active=1 AND track_stock=1 AND stock_qty <= reorder_level
        ORDER BY stock_qty`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
