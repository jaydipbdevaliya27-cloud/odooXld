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
<<<<<<< HEAD
    const { dept, category, low_stock } = req.query;
    let sql    = 'SELECT * FROM products WHERE is_active = 1';
    const params = [];
    if (dept)      { sql += ' AND department = ?'; params.push(dept); }
    if (category)  { sql += ' AND category = ?';   params.push(category); }
    if (low_stock === 'true' || low_stock === '1') {
      sql += ' AND stock_qty <= reorder_level';
    }
=======
    const { dept, category } = req.query;
    let sql = 'SELECT * FROM products WHERE is_active = 1';
    const params = [];
    if (dept) { sql += ' AND department = ?'; params.push(dept); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
>>>>>>> 21a7256ffd137fc9e912ceb7804c3a2463e19c18
    sql += ' ORDER BY department, category, name';
    const [rows] = await db.query(sql, params);
    
    // Parse images array and add low_stock flag
    const formatted = rows.map(r => {
      let images = [];
      if (r.image_url) {
        try {
          if (r.image_url.startsWith('[') && r.image_url.endsWith(']')) {
            images = JSON.parse(r.image_url);
          } else if (r.image_url.includes(',')) {
            images = r.image_url.split(',').map(u => u.trim()).filter(Boolean);
          } else {
            images = [r.image_url];
          }
        } catch {
          images = [r.image_url];
        }
      }
      return {
        ...r,
        images,
        is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false
      };
    });

    res.json(formatted);
  } catch (err) { next(err); }
});

// ── GET /api/products/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    const r = rows[0];
    let images = [];
    if (r.image_url) {
      try {
        if (r.image_url.startsWith('[') && r.image_url.endsWith(']')) {
          images = JSON.parse(r.image_url);
        } else if (r.image_url.includes(',')) {
          images = r.image_url.split(',').map(u => u.trim()).filter(Boolean);
        } else {
          images = [r.image_url];
        }
      } catch {
        images = [r.image_url];
      }
    }
    res.json({
      ...r,
      images,
      is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false
    });
  } catch (err) { next(err); }
});

// ── POST /api/products ───────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
<<<<<<< HEAD
    let { sku, name, department, category, price, cost_price,
          track_stock, stock_qty, reorder_level, image_url, images, description } = req.body;
=======
    const { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, description } = req.body;
>>>>>>> 21a7256ffd137fc9e912ceb7804c3a2463e19c18
    if (!sku || !name || !department || !category || price == null) {
      return res.status(400).json({ error: 'sku, name, department, category, price required' });
    }

    // Support multiple images array
    if (Array.isArray(images) && images.length > 0) {
      image_url = JSON.stringify(images);
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
<<<<<<< HEAD
    let { sku, name, department, category, price, cost_price,
          track_stock, stock_qty, reorder_level, image_url, images, description, is_active } = req.body;

    if (Array.isArray(images) && images.length > 0) {
      image_url = JSON.stringify(images);
    }

=======
    const { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, description, is_active } = req.body;
>>>>>>> 21a7256ffd137fc9e912ceb7804c3a2463e19c18
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
