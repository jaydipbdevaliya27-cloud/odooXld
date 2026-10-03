/**
 * @file server/routes/products.js
 * @description Product + variant routes using cc_products / cc_product_variants.
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

function parseImages(image_url) {
  if (!image_url) return [];
  try {
    if (image_url.startsWith('[')) return JSON.parse(image_url);
    if (image_url.includes(',')) return image_url.split(',').map(u => u.trim()).filter(Boolean);
    return [image_url];
  } catch { return [image_url]; }
}

// ── GET /api/products ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { dept, category, low_stock, search } = req.query;
    let sql = 'SELECT * FROM cc_products WHERE is_active = 1';
    const params = [];
    if (dept)      { sql += ' AND department = ?'; params.push(dept); }
    if (category)  { sql += ' AND category = ?';   params.push(category); }
    if (search)    { sql += ' AND name LIKE ?';     params.push(`%${search}%`); }
    if (low_stock === 'true' || low_stock === '1')
      sql += ' AND track_stock=1 AND stock_qty <= reorder_level';
    sql += ' ORDER BY department, category, name';
    const [rows] = await db.query(sql, params);

    // Attach variants
    const ids = rows.map(r => r.id);
    let variantMap = {};
    if (ids.length) {
      const [vars] = await db.query(`SELECT * FROM cc_product_variants WHERE product_id IN (?) AND is_active=1 ORDER BY product_id, variant_name`, [ids]);
      for (const v of vars) {
        if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
        variantMap[v.product_id].push(v);
      }
    }

    const formatted = rows.map(r => ({
      ...r,
      images:       parseImages(r.image_url),
      is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false,
      variants:     variantMap[r.id] || []
    }));
    res.json(formatted);
  } catch (err) { next(err); }
});

// ── GET /api/products/categories ─────────────────────────────────────────────
router.get('/categories', async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT DISTINCT category, department FROM cc_products WHERE is_active=1 ORDER BY department, category`);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM cc_products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    const r = rows[0];
    const [vars] = await db.query('SELECT * FROM cc_product_variants WHERE product_id=? AND is_active=1 ORDER BY variant_name', [r.id]);
    res.json({ ...r, images: parseImages(r.image_url), variants: vars,
               is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false });
  } catch (err) { next(err); }
});

// ── POST /api/products ────────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    let { sku, name, department, category, price, cost_price,
          track_stock, stock_qty, reorder_level, image_url, images, description, variants } = req.body;
    if (!sku || !name || !department || !category || price == null)
      return res.status(400).json({ error: 'sku, name, department, category, price are required' });

    if (Array.isArray(images) && images.length > 0) image_url = JSON.stringify(images);

    const [result] = await db.query(
      `INSERT INTO cc_products (sku,name,department,category,price,cost_price,track_stock,stock_qty,reorder_level,image_url,description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [sku, name, department, category, price, cost_price || 0,
       track_stock ?? 1, stock_qty || 0, reorder_level || 5, image_url || null, description || null]
    );
    const productId = result.insertId;

    // Insert variants if provided
    if (Array.isArray(variants) && variants.length) {
      for (const v of variants) {
        await db.query(
          `INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES (?,?,?,?,?,?)`,
          [productId, v.variant_name, v.sku_suffix || v.variant_name.replace(/\s+/g,'').slice(0,10),
           v.price_offset || 0, v.stock_qty || 0, v.reorder_level || 3]
        );
      }
    }

    const [rows] = await db.query('SELECT * FROM cc_products WHERE id = ?', [productId]);
    const [vars] = await db.query('SELECT * FROM cc_product_variants WHERE product_id=? AND is_active=1', [productId]);
    res.status(201).json({ ...rows[0], variants: vars });
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id ─────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    let { sku, name, department, category, price, cost_price,
          track_stock, stock_qty, reorder_level, image_url, images, description, is_active } = req.body;
    if (Array.isArray(images) && images.length > 0) image_url = JSON.stringify(images);

    await db.query(
      `UPDATE cc_products SET sku=?,name=?,department=?,category=?,price=?,cost_price=?,
              track_stock=?,stock_qty=?,reorder_level=?,image_url=?,description=?,is_active=?
        WHERE id=?`,
      [sku, name, department, category, price, cost_price,
       track_stock ?? 1, stock_qty, reorder_level, image_url || null, description || null,
       is_active ?? 1, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM cc_products WHERE id = ?', [req.params.id]);
    const [vars] = await db.query('SELECT * FROM cc_product_variants WHERE product_id=? AND is_active=1', [req.params.id]);
    res.json({ ...rows[0], images: parseImages(rows[0].image_url), variants: vars });
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id/variant/:vid ────────────────────────────────────────
router.put('/:id/variant/:vid', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { stock_qty, price_offset, reorder_level, variant_name } = req.body;
    await db.query(
      `UPDATE cc_product_variants SET
         stock_qty=COALESCE(?,stock_qty), price_offset=COALESCE(?,price_offset),
         reorder_level=COALESCE(?,reorder_level), variant_name=COALESCE(?,variant_name)
       WHERE id=? AND product_id=?`,
      [stock_qty != null ? stock_qty : null, price_offset != null ? price_offset : null,
       reorder_level != null ? reorder_level : null, variant_name || null,
       req.params.vid, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM cc_product_variants WHERE id=?', [req.params.vid]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/products/:id/variant ────────────────────────────────────────────
router.post('/:id/variant', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { variant_name, sku_suffix, price_offset, stock_qty, reorder_level } = req.body;
    if (!variant_name) return res.status(400).json({ error: 'variant_name required' });
    const [result] = await db.query(
      `INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level)
       VALUES (?,?,?,?,?,?)`,
      [req.params.id, variant_name, sku_suffix || variant_name.replace(/\s+/g,'').slice(0,10),
       price_offset || 0, stock_qty || 0, reorder_level || 3]
    );
    const [rows] = await db.query('SELECT * FROM cc_product_variants WHERE id=?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/products/:id ─────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query('UPDATE cc_products SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ message: 'Product deactivated' });
  } catch (err) { next(err); }
});

// ── DELETE /api/products/:id/variant/:vid ────────────────────────────────────
router.delete('/:id/variant/:vid', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query('UPDATE cc_product_variants SET is_active=0 WHERE id=? AND product_id=?', [req.params.vid, req.params.id]);
    res.json({ message: 'Variant removed' });
  } catch (err) { next(err); }
});

module.exports = router;
