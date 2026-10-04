/**
 * @file server/routes/products.js
 * @description Product + variant routes using products / product_variants.
 */
const express = require('express');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router = express.Router();

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
    const department = req.query.dept || req.query.department;
    const category = req.query.category;
    const search = req.query.search || req.query.q;
    const low_stock = req.query.low_stock;
    const stock = req.query.stock;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;

    const includeInactive = req.query.include_inactive === 'true' || req.query.status === 'all';
    const statusFilter = req.query.status;

    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (statusFilter === 'inactive') {
      sql += ' AND is_active = 0';
    } else if (statusFilter === 'active') {
      sql += ' AND is_active = 1';
    } else if (!includeInactive) {
      sql += ' AND is_active = 1';
    }

    if (department) { sql += ' AND department = ?'; params.push(department); }
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (search && search.trim().length) {
      sql += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ? OR description LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }
    if (low_stock === 'true' || low_stock === '1' || stock === 'low') {
      sql += ' AND track_stock = 1 AND stock_qty <= reorder_level AND stock_qty > 0';
    } else if (stock === 'out') {
      sql += ' AND track_stock = 1 AND stock_qty = 0';
    } else if (stock === 'ok') {
      sql += ' AND (track_stock = 0 OR stock_qty > reorder_level)';
    }

    sql += ' ORDER BY department, category, name';
    const [rows] = await db.query(sql, params);

    // Attach variants
    const ids = rows.map(r => r.id);
    let variantMap = {};
    if (ids.length) {
      const [vars] = await db.query(`SELECT * FROM product_variants WHERE product_id IN (?) AND is_active=1 ORDER BY product_id, variant_name`, [ids]);
      for (const v of vars) {
        if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
        variantMap[v.product_id].push(v);
      }
    }

    const formatted = rows.map(r => ({
      ...r,
      stock_quantity: r.stock_qty,
      images: parseImages(r.image_url),
      is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false,
      variants: variantMap[r.id] || []
    }));

    res.json({
      data: formatted,
      meta: {
        page,
        limit,
        total: formatted.length,
        totalPages: Math.ceil(formatted.length / limit) || 1
      }
    });
  } catch (err) { next(err); }
});

router.get('/services/jobs', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT sj.*, u.full_name AS member_name,
              sj.tension AS tension_lbs, sj.price AS fee
       FROM service_jobs sj
       LEFT JOIN members m ON sj.member_id = m.id
       LEFT JOIN users u ON m.user_id = u.id
       WHERE sj.status NOT IN ('delivered', 'cancelled')
       ORDER BY sj.received_at DESC`
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/services/jobs', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { member_id, racket_model, string_type, tension_lbs, fee } = req.body;
    if (!racket_model || !String(racket_model).trim()) {
      return res.status(400).json({ error: 'Racket model is required.' });
    }

    let customerName = 'Walk-in Customer';
    let customerPhone = '0000000000';
    if (member_id) {
      const [members] = await db.query(
        `SELECT u.full_name, u.phone
         FROM members m JOIN users u ON m.user_id = u.id
         WHERE m.id = ?`,
        [member_id]
      );
      if (!members.length) return res.status(404).json({ error: 'Member not found.' });
      customerName = members[0].full_name;
      customerPhone = members[0].phone || customerPhone;
    }

    const jobCode = `JOB-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const [result] = await db.query(
      `INSERT INTO service_jobs (
        job_code, member_id, customer_name, customer_phone, racket_model,
        service_type, string_type, tension, price, status, created_by
      ) VALUES (?, ?, ?, ?, ?, 'stringing', ?, ?, ?, 'received', ?)`,
      [
        jobCode, member_id || null, customerName, customerPhone, String(racket_model).trim(),
        string_type || null, tension_lbs != null ? String(tension_lbs) : null,
        Number(fee) || 0, req.session.user.id
      ]
    );

    res.status(201).json({ data: { id: result.insertId, job_code: jobCode } });
  } catch (err) {
    next(err);
  }
});

router.put('/services/jobs/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['received', 'in_progress', 'ready', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid service job status.' });

    await db.query(
      `UPDATE service_jobs
       SET status = ?,
           ready_at = IF(? = 'ready', COALESCE(ready_at, NOW()), ready_at),
           delivered_at = IF(? = 'delivered', COALESCE(delivered_at, NOW()), delivered_at)
       WHERE id = ?`,
      [status, status, status, req.params.id]
    );
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/products/categories ─────────────────────────────────────────────
router.get('/categories', async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT DISTINCT category, department FROM products WHERE is_active=1 ORDER BY department, category`);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    const r = rows[0];
    const [vars] = await db.query('SELECT * FROM product_variants WHERE product_id=? AND is_active=1 ORDER BY variant_name', [r.id]);

    let movements = [];
    try {
      const [movRows] = await db.query(
        `SELECT sm.*, u.full_name AS created_by_name
         FROM stock_movements sm
         LEFT JOIN users u ON sm.created_by = u.id
         WHERE sm.product_id = ?
         ORDER BY sm.created_at DESC LIMIT 10`,
        [r.id]
      );
      movements = movRows;
    } catch (e) {}

    res.json({
      ...r,
      images: parseImages(r.image_url),
      variants: vars,
      stock_movements: movements,
      is_low_stock: r.track_stock ? (r.stock_qty <= (r.reorder_level || 5)) : false
    });
  } catch (err) { next(err); }
});

// ── POST /api/products (Create Product) ───────────────────────────────────────
router.post('/', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    let { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, images, description, variants } = req.body;
    if (!sku || !name || !department || !category || price == null)
      return res.status(400).json({ error: 'sku, name, department, category, price are required' });

    if (Array.isArray(images) && images.length > 0) image_url = JSON.stringify(images);

    // If variants are provided and stock_qty not explicitly given, sum variant stocks
    if (Array.isArray(variants) && variants.length > 0) {
      const varTotal = variants.reduce((acc, v) => acc + (parseInt(v.stock_qty) || 0), 0);
      if (varTotal > 0 && (!stock_qty || stock_qty === 0)) stock_qty = varTotal;
    }

    const [result] = await db.query(
      `INSERT INTO products (sku,name,department,category,price,cost_price,track_stock,stock_qty,reorder_level,image_url,description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [sku, name, department, category, price, cost_price || 0,
        track_stock ?? 1, stock_qty || 0, reorder_level || 5, image_url || null, description || null]
    );
    const productId = result.insertId;

    // Insert variants if provided
    if (Array.isArray(variants) && variants.length) {
      for (const v of variants) {
        if (!v.variant_name) continue;
        await db.query(
          `INSERT INTO product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES (?,?,?,?,?,?)`,
          [productId, v.variant_name, v.sku_suffix || v.variant_name.replace(/\s+/g, '').slice(0, 10),
            v.price_offset || 0, v.stock_qty || 0, v.reorder_level || 3]
        );
      }
    }

    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
    const [vars] = await db.query('SELECT * FROM product_variants WHERE product_id=? AND is_active=1', [productId]);
    res.status(201).json({ ...rows[0], variants: vars });
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id (Update Product & Variants) ─────────────────────────
router.put('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const [existing] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Product not found' });
    const current = existing[0];

    let { sku, name, department, category, price, cost_price,
      track_stock, stock_qty, reorder_level, image_url, images, description, is_active, variants } = req.body;
    if (Array.isArray(images) && images.length > 0) image_url = JSON.stringify(images);

    // If variants array is provided, sync variants
    if (Array.isArray(variants)) {
      // Deactivate existing variants not in the new list, or update / insert
      await db.query('UPDATE product_variants SET is_active=0 WHERE product_id=?', [req.params.id]);
      let varTotal = 0;
      for (const v of variants) {
        if (!v.variant_name) continue;
        varTotal += (parseInt(v.stock_qty) || 0);
        await db.query(
          `INSERT INTO product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level,is_active)
           VALUES (?,?,?,?,?,?,1)
           ON DUPLICATE KEY UPDATE variant_name=VALUES(variant_name), stock_qty=VALUES(stock_qty), reorder_level=VALUES(reorder_level), is_active=1`,
          [req.params.id, v.variant_name, v.sku_suffix || v.variant_name.replace(/\s+/g, '').slice(0, 10),
          v.price_offset || 0, v.stock_qty || 0, (v.reorder_level != null && v.reorder_level !== '') ? Number(v.reorder_level) : 3]
        );
      }
      if (variants.length > 0 && varTotal > 0) stock_qty = varTotal;
    }

    const finalSku = sku !== undefined && sku !== null ? String(sku).trim() : current.sku;
    const finalName = name !== undefined && name !== null ? String(name).trim() : current.name;
    const finalDepartment = department !== undefined && department !== null ? department : current.department;
    const finalCategory = category !== undefined && category !== null ? category : current.category;
    const finalPrice = price !== undefined && price !== null && price !== '' ? Number(price) : current.price;
    const finalCostPrice = cost_price !== undefined && cost_price !== null && cost_price !== '' ? Number(cost_price) : (current.cost_price || 0);
    const finalTrackStock = track_stock !== undefined && track_stock !== null ? (track_stock ? 1 : 0) : (current.track_stock ?? 1);
    const finalStockQty = stock_qty !== undefined && stock_qty !== null && stock_qty !== '' ? Number(stock_qty) : (current.stock_qty || 0);
    const finalReorderLevel = (reorder_level !== undefined && reorder_level !== null && reorder_level !== '')
      ? Number(reorder_level)
      : (current.reorder_level != null ? current.reorder_level : 5);
    const finalImageUrl = image_url !== undefined ? image_url : current.image_url;
    const finalDescription = description !== undefined ? description : current.description;
    const finalIsActive = is_active !== undefined && is_active !== null ? (is_active ? 1 : 0) : (current.is_active ?? 1);

    await db.query(
      `UPDATE products SET sku=?,name=?,department=?,category=?,price=?,cost_price=?,
              track_stock=?,stock_qty=?,reorder_level=?,image_url=?,description=?,is_active=?
        WHERE id=?`,
      [finalSku, finalName, finalDepartment, finalCategory, finalPrice, finalCostPrice,
        finalTrackStock, finalStockQty, finalReorderLevel, finalImageUrl || null, finalDescription || null,
        finalIsActive, req.params.id]
    );

    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    const [vars] = await db.query('SELECT * FROM product_variants WHERE product_id=? AND is_active=1', [req.params.id]);
    res.json({ ...rows[0], images: parseImages(rows[0].image_url), variants: vars });
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id/variant/:vid ────────────────────────────────────────
router.put('/:id/variant/:vid', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { stock_qty, price_offset, reorder_level, variant_name } = req.body;
    await db.query(
      `UPDATE product_variants SET
         stock_qty=COALESCE(?,stock_qty), price_offset=COALESCE(?,price_offset),
         reorder_level=COALESCE(?,reorder_level), variant_name=COALESCE(?,variant_name)
       WHERE id=? AND product_id=?`,
      [stock_qty != null ? stock_qty : null, price_offset != null ? price_offset : null,
      reorder_level != null ? reorder_level : null, variant_name || null,
      req.params.vid, req.params.id]
    );

    // Re-calculate product total stock
    const [[{ totalStock }]] = await db.query(
      `SELECT IFNULL(SUM(stock_qty), 0) AS totalStock FROM product_variants WHERE product_id=? AND is_active=1`,
      [req.params.id]
    );
    await db.query('UPDATE products SET stock_qty=? WHERE id=?', [totalStock, req.params.id]);

    const [rows] = await db.query('SELECT * FROM product_variants WHERE id=?', [req.params.vid]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/products/:id/variant ────────────────────────────────────────────
router.post('/:id/variant', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const { variant_name, sku_suffix, price_offset, stock_qty, reorder_level } = req.body;
    if (!variant_name) return res.status(400).json({ error: 'variant_name required' });
    const [result] = await db.query(
      `INSERT INTO product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level)
       VALUES (?,?,?,?,?,?)`,
      [req.params.id, variant_name, sku_suffix || variant_name.replace(/\s+/g, '').slice(0, 10),
      price_offset || 0, stock_qty || 0, reorder_level || 3]
    );

    // Re-calculate product total stock
    const [[{ totalStock }]] = await db.query(
      `SELECT IFNULL(SUM(stock_qty), 0) AS totalStock FROM product_variants WHERE product_id=? AND is_active=1`,
      [req.params.id]
    );
    await db.query('UPDATE products SET stock_qty=? WHERE id=?', [totalStock, req.params.id]);

    const [rows] = await db.query('SELECT * FROM product_variants WHERE id=?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// ── DELETE /api/products/:id ─────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const force = req.query.force === 'true';
    if (force && req.session.user.role === 'owner') {
      await db.transaction(async (conn) => {
        await conn.query('DELETE FROM stock_movements WHERE product_id = ?', [req.params.id]);
        await conn.query('DELETE FROM product_variants WHERE product_id = ?', [req.params.id]);
        await conn.query('DELETE FROM purchase_order_items WHERE product_id = ?', [req.params.id]);
        await conn.query('DELETE FROM order_items WHERE product_id = ?', [req.params.id]);
        await conn.query('DELETE FROM products WHERE id = ?', [req.params.id]);
      });
      return res.json({ ok: true, message: 'Product permanently deleted' });
    }
    await db.query('UPDATE products SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ ok: true, message: 'Product deactivated' });
  } catch (err) { next(err); }
});

// ── DELETE /api/products/:id/variant/:vid ────────────────────────────────────
router.delete('/:id/variant/:vid', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    await db.query('UPDATE product_variants SET is_active=0 WHERE id=? AND product_id=?', [req.params.vid, req.params.id]);
    res.json({ message: 'Variant removed' });
  } catch (err) { next(err); }
});

// ── PUT /api/products/:id/toggle-active ─────────────────────────────────────
router.put('/:id/toggle-active', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT id, is_active, name FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    const newActive = rows[0].is_active ? 0 : 1;
    await db.query('UPDATE products SET is_active = ? WHERE id = ?', [newActive, req.params.id]);
    res.json({ ok: true, id: parseInt(req.params.id, 10), is_active: newActive, name: rows[0].name });
  } catch (err) { next(err); }
});

module.exports = router;
