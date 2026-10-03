/**
 * @file server/routes/products.js
 * @description Product catalogue routes (shop and bar).
 * GET    /api/products             – list products (filter by ?dept=shop|bar)
 * GET    /api/products/:id         – single product
 * POST   /api/products             – create product (owner/staff)
 * PUT    /api/products/:id         – update product including stock (owner/staff)
 * DELETE /api/products/:id         – soft-delete product (owner)
 */

const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/products ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { dept, category } = req.query;
    let sql = 'SELECT * FROM products WHERE is_active = 1';
    const params = [];
    if (dept) { sql += ' AND department = ?'; params.push(dept); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    sql += ' ORDER BY department, category, name';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/products/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/products ───────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, description } = req.body;
    if (!sku || !name || !department || !category || price == null) {
      return res.status(400).json({ error: 'sku, name, department, category, price required' });
    }
    const [result] = await db.query(
      `INSERT INTO products
         (sku, name, department, category, price, cost_price,
          track_stock, stock_qty, reorder_level, image_url, description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [sku, name, department, category, price, cost_price || 0,
        track_stock ?? 1, stock_qty || 0, reorder_level || 5, image_url || null, description || null]
    );
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id ────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, description, is_active } = req.body;
    await db.query(
      `UPDATE products SET
         sku=?, name=?, department=?, category=?, price=?, cost_price=?,
         track_stock=?, stock_qty=?, reorder_level=?, image_url=?, description=?, is_active=?
       WHERE id=?`,
      [sku, name, department, category, price, cost_price || 0,
        track_stock ?? 1, stock_qty || 0, reorder_level ?? 5, image_url || null, description || null,
        is_active ?? 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/products/:id (soft-delete) ───────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Product deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
