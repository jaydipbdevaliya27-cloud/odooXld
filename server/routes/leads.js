/**
 * @file server/routes/leads.js
 * @description Prospective member (lead) management.
 * GET  /api/leads           – list leads (staff/owner)
 * POST /api/leads           – create lead (public – contact form)
 * PUT  /api/leads/:id       – update lead status/notes (staff/owner)
 * POST /api/leads/:id/convert – convert lead to member (staff/owner)
 */

const express       = require('express');
const db            = require('../db');
const memberService = require('../services/memberService');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/leads ───────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { status } = req.query;
    let sql = `SELECT l.*, p.name AS plan_name, u.full_name AS assigned_to
                 FROM leads l
                 LEFT JOIN plans p ON l.interested_plan_id = p.id
                 LEFT JOIN users u ON l.assigned_to_user_id = u.id
                WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND l.status = ?'; params.push(status); }
    sql += ' ORDER BY l.created_at DESC LIMIT 100';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/leads (public – website contact form) ──────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, interested_plan_id, message } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const [result] = await db.query(
      'INSERT INTO leads (name, email, phone, interested_plan_id, message) VALUES (?,?,?,?,?)',
      [name, email || null, phone || null, interested_plan_id || null, message || null]
    );
    res.status(201).json({ id: result.insertId, message: 'Thank you! We will contact you soon.' });
  } catch (err) { next(err); }
});

// ── PUT /api/leads/:id ───────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { status, notes, assigned_to_user_id } = req.body;
    await db.query(
      'UPDATE leads SET status=?, notes=?, assigned_to_user_id=? WHERE id=?',
      [status, notes || null, assigned_to_user_id || null, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/leads/:id/convert ──────────────────────────────────────────────
// Creates a user + member row from the lead data; marks lead converted
router.post('/:id/convert', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const [leads] = await db.query('SELECT * FROM leads WHERE id = ?', [req.params.id]);
    if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = leads[0];

    // enrollMember will create the user account and member record
    const member = await memberService.enrollMember({
      full_name:   lead.name,
      email:       lead.email || `lead_${lead.id}@champions.local`,
      phone:       lead.phone,
      plan_id:     req.body.plan_id || lead.interested_plan_id,
      password:    req.body.password || 'Champions@123',
      payment_method: req.body.payment_method || 'cash'
    });

    // Mark lead as converted and link the new member
    await db.query(
      "UPDATE leads SET status='converted', converted_member_id=? WHERE id=?",
      [member.id, req.params.id]
    );
    res.json({ message: 'Lead converted to member', member });
  } catch (err) {
    if (!err.status) err.status = 400;
    next(err);
  }
});

module.exports = router;
