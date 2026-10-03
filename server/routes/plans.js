/**
 * @file server/routes/plans.js - Membership plans CRUD using cc_plans
 */
const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT * FROM cc_plans WHERE is_active=1 ORDER BY annual_fee`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(`SELECT * FROM cc_plans WHERE id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Plan not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { code, name, description, annual_fee, duration_months,
            court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day } = req.body;
    const [r] = await db.query(
      `INSERT INTO cc_plans (code,name,description,annual_fee,duration_months,court_discount_pct,shop_discount_pct,bar_discount_pct,max_bookings_per_day)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [code,name,description||null,annual_fee,duration_months||12,court_discount_pct||0,shop_discount_pct||0,bar_discount_pct||0,max_bookings_per_day||2]
    );
    const [rows] = await db.query(`SELECT * FROM cc_plans WHERE id=?`, [r.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { name, description, annual_fee, duration_months,
            court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day } = req.body;
    await db.query(
      `UPDATE cc_plans SET name=?,description=?,annual_fee=?,duration_months=?,
              court_discount_pct=?,shop_discount_pct=?,bar_discount_pct=?,max_bookings_per_day=?
        WHERE id=?`,
      [name,description||null,annual_fee,duration_months||12,court_discount_pct||0,shop_discount_pct||0,bar_discount_pct||0,max_bookings_per_day||2,req.params.id]
    );
    const [rows] = await db.query(`SELECT * FROM cc_plans WHERE id=?`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query(`UPDATE cc_plans SET is_active=0 WHERE id=?`, [req.params.id]);
    res.json({ message: 'Plan deactivated' });
  } catch (err) { next(err); }
});

module.exports = router;
