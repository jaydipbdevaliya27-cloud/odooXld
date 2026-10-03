/**
 * @file server/routes/search.js
 * @description Global Unified Search API.
 * Performs debounced, role-filtered search across members, bookings, products, orders, and leads.
 */

const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const q = req.query.q ? req.query.q.trim() : '';

    if (!q || q.length < 2) {
      return res.json({ members: [], bookings: [], products: [], orders: [], leads: [] });
    }

    const s = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const results = {
      members: [],
      bookings: [],
      products: [],
      orders: [],
      leads: []
    };

    // 1. Products (all users can search)
    const [products] = await db.query(
      `SELECT id, name, sku, department, category, price, stock_qty
       FROM products
       WHERE is_active = 1 AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)
       LIMIT 5`,
      [s, s, s]
    );
    results.products = products;

    // 2. Bookings (role-scoped)
    if (user.role === 'member') {
      const [bookings] = await db.query(
        `SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.status, c.name AS court_name
         FROM bookings b
         JOIN courts c ON b.court_id = c.id
         WHERE (b.user_id = ? OR b.booked_by_user_id = ?) AND (b.booking_code LIKE ? OR c.name LIKE ?)
         ORDER BY b.booking_date DESC LIMIT 5`,
        [user.id, user.id, s, s]
      );
      results.bookings = bookings;
    } else {
      const [bookings] = await db.query(
        `SELECT b.id, b.booking_code, b.booking_date, b.start_time, b.status, c.name AS court_name,
                COALESCE(u.full_name, b.guest_name) AS player_name
         FROM bookings b
         JOIN courts c ON b.court_id = c.id
         LEFT JOIN users u ON b.user_id = u.id
         WHERE b.booking_code LIKE ? OR c.name LIKE ? OR u.full_name LIKE ? OR b.guest_name LIKE ?
         ORDER BY b.booking_date DESC LIMIT 5`,
        [s, s, s, s]
      );
      results.bookings = bookings;
    }

    // 3. Orders (role-scoped)
    if (user.role === 'member') {
      const [orders] = await db.query(
        `SELECT id, order_code, department, total, status, created_at
         FROM orders
         WHERE (user_id = ? OR member_id = ?) AND order_code LIKE ?
         ORDER BY created_at DESC LIMIT 5`,
        [user.id, user.member_id || 0, s]
      );
      results.orders = orders;
    } else {
      const [orders] = await db.query(
        `SELECT o.id, o.order_code, o.department, o.total, o.status, o.created_at,
                COALESCE(u.full_name, o.guest_name) AS customer_name
         FROM orders o
         LEFT JOIN users u ON o.user_id = u.id
         WHERE o.order_code LIKE ? OR u.full_name LIKE ? OR o.guest_name LIKE ?
         ORDER BY o.created_at DESC LIMIT 5`,
        [s, s, s]
      );
      results.orders = orders;
    }

    // 4. Members (staff and owner only)
    if (user.role === 'owner' || user.role === 'staff') {
      const [members] = await db.query(
        `SELECT m.id, m.member_code, m.status, m.expiry_date,
                u.full_name, u.email, u.phone, p.name AS plan_name
         FROM members m
         JOIN users u ON m.user_id = u.id
         JOIN plans p ON m.plan_id = p.id
         WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR m.member_code LIKE ?
         LIMIT 5`,
        [s, s, s, s]
      );
      results.members = members;

      // 5. Leads (staff and owner only)
      const [leads] = await db.query(
        `SELECT l.id, l.name, l.email, l.phone, l.status, l.interest
         FROM leads l
         WHERE l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?
         LIMIT 5`,
        [s, s, s]
      );
      results.leads = leads;
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
