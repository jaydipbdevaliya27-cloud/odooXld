/**
 * @file server/routes/members.js
 * @description Member management routes – fully dynamic CRUD on cc_members and users tables.
 */
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const router  = express.Router();

// ── GET /api/members ─────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { search, status, plan_id, expiring_days, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = '1=1';
    const params = [];

    if (search) {
      where += ` AND (u.full_name LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR m.member_code LIKE ? OR u.phone LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (status) {
      if (status === 'expiring') {
        where += ` AND m.status='active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`;
      } else if (status === 'expired') {
        where += ` AND (m.status='expired' OR m.expiry_date < CURDATE())`;
      } else {
        where += ' AND m.status = ?';
        params.push(status);
      }
    }
    if (plan_id)      { where += ' AND m.plan_id = ?';   params.push(plan_id); }
    if (expiring_days) {
      where += ` AND m.status='active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`;
      params.push(Number(expiring_days));
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cc_members m
         JOIN users u ON m.user_id = u.id
        WHERE ${where}`, params
    );

    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, p.annual_fee, p.shop_discount_pct, p.bar_discount_pct, p.court_discount_pct,
              COALESCE(u.full_name, u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m
         JOIN users u ON m.user_id = u.id
         JOIN cc_plans p ON m.plan_id = p.id
        WHERE ${where}
        ORDER BY m.expiry_date ASC
        LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ members: rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── GET /api/members/me ──────────────────────────────────────────────────────
router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, p.annual_fee, p.shop_discount_pct, p.bar_discount_pct, p.court_discount_pct,
              p.max_bookings_per_day,
              COALESCE(u.full_name, u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m
         JOIN users u ON m.user_id = u.id
         JOIN cc_plans p ON m.plan_id = p.id
        WHERE m.user_id = ?`,
      [req.session.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member record not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /api/members/:id ─────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, p.annual_fee, p.shop_discount_pct, p.bar_discount_pct, p.court_discount_pct,
              COALESCE(u.full_name, u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m
         JOIN users u ON m.user_id = u.id
         JOIN cc_plans p ON m.plan_id = p.id
        WHERE m.id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const m = rows[0];
    if (req.session.user.role === 'member' && m.user_id !== req.session.user.id)
      return res.status(403).json({ error: 'Forbidden' });
    res.json(m);
  } catch (err) { next(err); }
});

// ── GET /api/members/by-user/:userId ─────────────────────────────────────────
router.get('/by-user/:userId', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, p.annual_fee, p.shop_discount_pct, p.bar_discount_pct, p.court_discount_pct,
              p.max_bookings_per_day,
              COALESCE(u.full_name, u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m
         JOIN users u ON m.user_id = u.id
         JOIN cc_plans p ON m.plan_id = p.id
        WHERE m.user_id = ?`, [req.params.userId]
    );
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// ── POST /api/members (Insert Member) ─────────────────────────────────────────
router.post('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { full_name, email, phone, date_of_birth, plan_id, payment_method,
            password, emergency_contact_name, emergency_contact_phone, notes,
            join_date, expiry_date, status } = req.body;

    if (!full_name || !email || !plan_id)
      return res.status(400).json({ error: 'Name, email, and plan are required' });

    // Check plan exists
    const [plans] = await db.query('SELECT * FROM cc_plans WHERE id = ? AND is_active = 1', [plan_id]);
    if (!plans.length) return res.status(400).json({ error: 'Invalid plan selected' });
    const plan = plans[0];

    // Create or find user
    let userId;
    const cleanEmail = email.trim().toLowerCase();
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length) {
      userId = existing[0].id;
      await db.query(
        `UPDATE users SET full_name = ?, name = ?, phone = COALESCE(?, phone) WHERE id = ?`,
        [full_name.trim(), full_name.trim(), phone || null, userId]
      );
    } else {
      const hash = await bcrypt.hash(password || 'password123', 10);
      const [ins] = await db.query(
        `INSERT INTO users (name, full_name, email, password_hash, role, phone, assigned_area, is_active)
         VALUES (?,?,?,?,'member',?,?,1)`,
        [full_name.trim(), full_name.trim(), cleanEmail, hash, phone || null, 'member']
      );
      userId = ins.insertId;
    }

    // Check not already a member
    const [mCheck] = await db.query('SELECT id FROM cc_members WHERE user_id = ?', [userId]);
    if (mCheck.length) return res.status(409).json({ error: 'This user already has a membership record' });

    // Generate unique member code
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM cc_members');
    const memberCode = `CC-${new Date().getFullYear()}-${String(cnt + 1).padStart(3, '0')}`;

    const effectiveJoinDate = join_date || new Date().toISOString().slice(0, 10);
    const effectiveExpiryDate = expiry_date || (() => {
      const d = new Date(effectiveJoinDate);
      d.setMonth(d.getMonth() + (plan.duration_months || 12));
      return d.toISOString().slice(0, 10);
    })();

    const [ins] = await db.query(
      `INSERT INTO cc_members (user_id, member_code, plan_id, date_of_birth, join_date, expiry_date, status, emergency_contact_name, emergency_contact_phone, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [userId, memberCode, plan_id, date_of_birth || null, effectiveJoinDate, effectiveExpiryDate,
       status || 'active', emergency_contact_name || null, emergency_contact_phone || null, notes || null]
    );

    // Record payment if method provided
    if (payment_method) {
      const payCode = `PAY-MBR-${Date.now()}`;
      await db.query(
        `INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at)
         VALUES (?,?,?,?,?,?,'paid',NOW())`,
        [payCode, 'membership', ins.insertId, userId, plan.annual_fee, payment_method]
      );
    }

    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, COALESCE(u.full_name, u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m JOIN users u ON m.user_id = u.id JOIN cc_plans p ON m.plan_id = p.id
        WHERE m.id = ?`, [ins.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or member code already exists' });
    next(err);
  }
});

// ── PUT /api/members/:id (Update Member) ──────────────────────────────────────
router.put('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { full_name, email, phone, status, notes, emergency_contact_name, emergency_contact_phone,
            plan_id, join_date, expiry_date } = req.body;

    // Get current member record
    const [mRows] = await db.query('SELECT * FROM cc_members WHERE id = ?', [req.params.id]);
    if (!mRows.length) return res.status(404).json({ error: 'Member not found' });
    const current = mRows[0];

    // Update user table details if provided
    if (full_name || email || phone) {
      await db.query(
        `UPDATE users SET
           full_name = COALESCE(?, full_name),
           name = COALESCE(?, name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone)
         WHERE id = ?`,
        [full_name ? full_name.trim() : null, full_name ? full_name.trim() : null,
         email ? email.trim().toLowerCase() : null, phone || null, current.user_id]
      );
    }

    // Update member record
    await db.query(
      `UPDATE cc_members SET
         status = COALESCE(?, status),
         notes = COALESCE(?, notes),
         emergency_contact_name = COALESCE(?, emergency_contact_name),
         emergency_contact_phone = COALESCE(?, emergency_contact_phone),
         plan_id = COALESCE(?, plan_id),
         join_date = COALESCE(?, join_date),
         expiry_date = COALESCE(?, expiry_date)
       WHERE id = ?`,
      [status || null, notes !== undefined ? notes : null,
       emergency_contact_name !== undefined ? emergency_contact_name : null,
       emergency_contact_phone !== undefined ? emergency_contact_phone : null,
       plan_id || null, join_date || null, expiry_date || null, req.params.id]
    );

    const [rows] = await db.query(
      `SELECT m.*, p.name AS plan_name, COALESCE(u.full_name,u.name) AS full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
         FROM cc_members m JOIN users u ON m.user_id=u.id JOIN cc_plans p ON m.plan_id=p.id
        WHERE m.id=?`, [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── POST /api/members/:id/renew ──────────────────────────────────────────────
router.post('/:id/renew', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { plan_id, payment_method } = req.body;
    const [rows] = await db.query('SELECT * FROM cc_members WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const m = rows[0];

    const [plans] = await db.query('SELECT * FROM cc_plans WHERE id = ?', [plan_id || m.plan_id]);
    if (!plans.length) return res.status(400).json({ error: 'Invalid plan selected' });
    const plan = plans[0];

    // Extend from today or current expiry (whichever is later)
    const base = new Date(Math.max(new Date(), new Date(m.expiry_date)));
    base.setMonth(base.getMonth() + (plan.duration_months || 12));
    const newExpiry = base.toISOString().slice(0, 10);

    await db.query(
      `UPDATE cc_members SET plan_id=?, expiry_date=?, status='active' WHERE id=?`,
      [plan.id, newExpiry, m.id]
    );

    if (payment_method) {
      const payCode = `PAY-RNW-${Date.now()}`;
      await db.query(
        `INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at)
         VALUES (?,?,?,?,?,?,'paid',NOW())`,
        [payCode, 'membership', m.id, m.user_id, plan.annual_fee, payment_method]
      );
    }

    res.json({ message: 'Membership renewed successfully', new_expiry: newExpiry });
  } catch (err) { next(err); }
});

// ── DELETE /api/members/:id ──────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await db.query(`UPDATE cc_members SET status='suspended' WHERE id=?`, [req.params.id]);
    res.json({ message: 'Member deactivated/suspended successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
