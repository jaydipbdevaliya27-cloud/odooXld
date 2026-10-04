/**
 * @file server/routes/reports.js
 * @description Owner Financial, Occupancy, P&L, and GST Analytics.
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { todayIST } = require('../utils/time');

const router = express.Router();

// ── GET /api/reports/dashboard ──────────────────────────────────────────────
router.get('/dashboard', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const today = todayIST();

    // Today's revenue (supports both 'paid' and 'completed')
    const [[{ todayRevenue }]] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS todayRevenue
       FROM payments
       WHERE DATE(paid_at) = ? AND status IN ('paid', 'completed')`,
      [today]
    );

    // Active members
    const [[{ activeMembers }]] = await db.query(
      "SELECT COUNT(*) AS activeMembers FROM members WHERE status = 'active' AND expiry_date >= CURDATE()"
    );

    // Today's bookings
    const [[{ todayBookings }]] = await db.query(
      "SELECT COUNT(*) AS todayBookings FROM bookings WHERE booking_date = ? AND status != 'cancelled'",
      [today]
    );

    // Expiring memberships in next 30 days
    const [[{ expiring30d }]] = await db.query(
      "SELECT COUNT(*) AS expiring30d FROM members WHERE status = 'active' AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)"
    );

    // Low stock items
    const [[{ lowStockCount }]] = await db.query(
      'SELECT COUNT(*) AS lowStockCount FROM products WHERE track_stock = 1 AND stock_qty <= reorder_level AND is_active = 1'
    );

    // Open orders
    const [[{ openOrders }]] = await db.query(
      "SELECT COUNT(*) AS openOrders FROM orders WHERE status IN ('open', 'placed', 'in_progress')"
    );

    // Revenue by source (last 7 days)
    const [revBySource] = await db.query(
      `SELECT source, COALESCE(SUM(amount), 0) AS total, COUNT(id) AS transactions
       FROM payments
       WHERE paid_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status IN ('paid', 'completed')
       GROUP BY source`
    );

    // Revenue by method (last 7 days)
    const [revByMethod] = await db.query(
      `SELECT method, COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE paid_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND status IN ('paid', 'completed')
       GROUP BY method`
    );

    // Expiring members list (top 10)
    const [expiringList] = await db.query(
      `SELECT m.id, m.member_code, m.expiry_date,
              u.full_name, u.email, u.phone,
              p.name AS plan_name,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE m.status = 'active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       ORDER BY m.expiry_date ASC LIMIT 10`
    );

    // 30-day revenue trend from DB
    const [dbTrend] = await db.query(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS pay_date, COALESCE(SUM(amount), 0) AS daily_total
       FROM payments
       WHERE paid_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND status IN ('paid', 'completed')
       GROUP BY DATE_FORMAT(paid_at, '%Y-%m-%d')
       ORDER BY pay_date ASC`
    );

    // Build complete 30-day continuous timeline
    const trendMap = {};
    dbTrend.forEach(t => { trendMap[t.pay_date] = Number(t.daily_total); });

    const trend30d = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      trend30d.push({
        pay_date: dateStr,
        daily_total: trendMap[dateStr] || 0
      });
    }

    res.json({
      todayRevenue: Number(todayRevenue),
      activeMembers: Number(activeMembers),
      todayBookings: Number(todayBookings),
      expiring30d: Number(expiring30d),
      lowStockCount: Number(lowStockCount),
      openOrders: Number(openOrders),
      revBySource,
      revByMethod,
      expiringList,
      trend30d
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/reports/pnl ────────────────────────────────────────────────────
router.get('/pnl', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [revenues] = await db.query(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month,
              COALESCE(SUM(amount), 0) AS total_revenue
       FROM payments
       WHERE status = 'paid'
       GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
       ORDER BY month DESC LIMIT 12`
    );

    const [expenses] = await db.query(
      `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month,
              COALESCE(SUM(amount), 0) AS total_expenses
       FROM expenses
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ORDER BY month DESC LIMIT 12`
    );

    const monthMap = {};
    revenues.forEach(r => {
      monthMap[r.month] = { month: r.month, revenue: Number(r.total_revenue), expense: 0, profit: Number(r.total_revenue) };
    });
    expenses.forEach(e => {
      if (!monthMap[e.month]) {
        monthMap[e.month] = { month: e.month, revenue: 0, expense: Number(e.total_expenses), profit: -Number(e.total_expenses) };
      } else {
        monthMap[e.month].expense = Number(e.total_expenses);
        monthMap[e.month].profit = monthMap[e.month].revenue - Number(e.total_expenses);
      }
    });

    res.json(Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
