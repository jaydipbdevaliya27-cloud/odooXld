/**
 * @file server/routes/members.js
 * @description Member management routes.
 * GET  /api/members            – list members (staff/owner)
 * GET  /api/members/:id        – member detail + plan info
 * POST /api/members            – enroll new member (staff/owner)
 * PUT  /api/members/:id        – update member details (staff/owner)
 * POST /api/members/:id/renew  – renew membership (staff/owner)
 */

const express       = require('express');
const memberService = require('../services/memberService');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/members/me ─────────────────────────────────────────────────────
// Any logged-in member can call this to get their own membership record + plan
router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [rows] = await require('../db').query(
      `SELECT m.*, u.full_name, u.email, u.phone,
              p.name AS plan_name, p.code AS plan_code,
              p.court_discount_pct, p.shop_discount_pct,
              p.bar_discount_pct, p.max_bookings_per_day
       FROM   members m
       JOIN   users   u ON u.id = m.user_id
       JOIN   plans   p ON p.id = m.plan_id
       WHERE  m.user_id = ?
       LIMIT  1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Membership not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /api/members ────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { search, status, plan_id, page = 1 } = req.query;
    const members = await memberService.listMembers({ search, status, plan_id, page: Number(page) });
    res.json(members);
  } catch (err) { next(err); }
});

// ── GET /api/members/:id ────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    // Members can only view their own profile
    const member = await memberService.getMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const sessionRole = req.session.user.role;
    if (sessionRole === 'member' && member.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(member);
  } catch (err) { next(err); }
});

// ── POST /api/members ───────────────────────────────────────────────────────
router.post('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const member = await memberService.enrollMember(req.body);
    res.status(201).json(member);
  } catch (err) {
    // Propagate user-facing validation messages as 400
    if (err.message && !err.status) err.status = 400;
    next(err);
  }
});

// ── PUT /api/members/:id ────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const member = await memberService.updateMember(req.params.id, req.body);
    res.json(member);
  } catch (err) { next(err); }
});

// ── POST /api/members/:id/renew ─────────────────────────────────────────────
router.post('/:id/renew', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { plan_id, payment_method } = req.body;
    const result = await memberService.renewMember(req.params.id, plan_id, payment_method);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
