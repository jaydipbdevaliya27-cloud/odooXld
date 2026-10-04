/**
 * @file server/routes/members.js
 * @description Comprehensive Member Management API.
 * Supports search with debouncing, junior memberships with guardian details,
 * check-ins, renewal, history ledger, and status toggles.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { todayIST } = require('../utils/time');

const router = express.Router();

// ── GET /api/members/me & /me/profile ──────────────────────────────────────
router.get(['/me', '/me/profile'], requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [rows] = await db.query(
      `SELECT m.*, u.full_name, u.email, u.phone,
              p.name AS plan_name, p.code AS plan_code, p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct,
              p.court_discount_pct AS discount_court, p.shop_discount_pct AS discount_pro_shop, p.bar_discount_pct AS discount_cafe,
              p.max_bookings_per_day,
              LEAST(COALESCE(p.max_bookings_per_day, ?), ?) AS effective_max_bookings_per_day,
              (SELECT CAST(setting_value AS UNSIGNED) FROM settings WHERE setting_key = 'cancellation_cutoff_hours') AS cancellation_cutoff_hours,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_remaining
       FROM members m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = ?`,
      [config.DEFAULT_MAX_BOOKINGS_PER_DAY, config.DEFAULT_MAX_BOOKINGS_PER_DAY, userId]
    );

    if (!rows.length) {
      return res.json({
        data: {
          user_id: userId,
          full_name: req.session.user.full_name,
          email: req.session.user.email,
          status: 'non_member',
          days_remaining: 0,
          discount_pro_shop: 0,
          discount_cafe: 0,
          discount_court: 0,
          max_bookings_per_day: config.DEFAULT_MAX_BOOKINGS_PER_DAY,
          effective_max_bookings_per_day: config.DEFAULT_MAX_BOOKINGS_PER_DAY,
          cancellation_cutoff_hours: 2
        }
      });
    }

    const member = rows[0];
    res.json({ data: member, ...member });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members/me/history ─────────────────────────────────────────────
router.get('/me/history', requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const [mRows] = await db.query('SELECT id FROM members WHERE user_id = ?', [userId]);
    if (!mRows.length) return res.json({ data: [] });

    const memberId = mRows[0].id;
    const [history] = await db.query(
      `SELECT h.*, p.name AS plan_name, p.code AS plan_code
       FROM membership_history h
       LEFT JOIN plans p ON h.plan_id = p.id
       WHERE h.member_id = ?
       ORDER BY h.created_at DESC`,
      [memberId]
    );

    res.json({ data: history });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/members/me/renew ──────────────────────────────────────────────
router.post('/me/renew', requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const { plan_code, plan_id, payment_method = 'razorpay' } = req.body;

    const [mRows] = await db.query('SELECT * FROM members WHERE user_id = ?', [userId]);
    if (!mRows.length) return res.status(404).json({ error: 'Membership record not found for current user' });
    const member = mRows[0];

    let planQuery = 'SELECT * FROM plans WHERE id = ?';
    let planParam = plan_id || member.plan_id;
    if (plan_code) {
      planQuery = 'SELECT * FROM plans WHERE code = ?';
      planParam = plan_code;
    }

    const [pRows] = await db.query(planQuery, [planParam]);
    if (!pRows.length) return res.status(400).json({ error: 'Invalid membership plan specified' });
    const plan = pRows[0];

    const today = new Date(todayIST());
    const currExpiry = member.expiry_date ? new Date(member.expiry_date) : today;
    const baseDate = currExpiry > today ? currExpiry : today;
    const durationMonths = plan.duration_months || 12;
    baseDate.setMonth(baseDate.getMonth() + durationMonths);
    const newExpiry = baseDate.toISOString().slice(0, 10);

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE members SET plan_id = ?, expiry_date = ?, status = 'active' WHERE id = ?`,
        [plan.id, newExpiry, member.id]
      );

      const fee = Number(plan.membership_fee || plan.annual_fee || 0);

      await conn.query(
        `INSERT INTO membership_history (member_id, plan_id, action, start_date, end_date, amount_paid, notes)
         VALUES (?, ?, 'renewed', CURDATE(), ?, ?, ?)`,
        [member.id, plan.id, newExpiry, fee, `Online self-renewal (${plan.name})`]
      );

      if (fee > 0) {
        const payCode = `PAY-RNW-${Date.now()}`;
        const validMethods = ['cash', 'card', 'upi', 'online'];
        const normalizedMethod = (payment_method && validMethods.includes(payment_method.toLowerCase()))
          ? payment_method.toLowerCase()
          : 'online';
        await conn.query(
          `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at, notes)
           VALUES (?, 'membership', ?, ?, ?, ?, 'paid', NOW(), ?)`,
          [payCode, member.id, userId, fee, normalizedMethod, `Member plan renewal - ${plan.name}`]
        );
      }
    });

    res.json({
      ok: true,
      message: `Membership renewed successfully on ${plan.name} plan until ${newExpiry}!`,
      newExpiry,
      plan_name: plan.name
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members ─────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const {
      q,
      status,
      plan_id,
      expiring_days,
      junior,
      page = 1,
      limit = 20,
      sort = 'expiry_date',
      order = 'asc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    // Search query
    if (q && q.trim()) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ` AND (
        u.full_name LIKE ? OR
        u.email LIKE ? OR
        u.phone LIKE ? OR
        m.member_code LIKE ?
      )`;
      params.push(s, s, s, s);
    }

    if (status) {
      if (status === 'expiring') {
        where += ` AND m.status = 'active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`;
      } else if (status === 'expired') {
        where += ` AND (m.status = 'expired' OR m.expiry_date < CURDATE())`;
      } else {
        where += ' AND m.status = ?';
        params.push(status);
      }
    }

    if (plan_id) {
      where += ' AND m.plan_id = ?';
      params.push(plan_id);
    }

    if (expiring_days) {
      where += ` AND m.status = 'active' AND m.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`;
      params.push(Number(expiring_days));
    }

    if (junior === '1' || junior === 'true') {
      where += ' AND p.is_junior = 1';
    }

    // Sort column allowlist
    const allowedSorts = ['expiry_date', 'join_date', 'full_name', 'member_code', 'created_at'];
    const sortCol = allowedSorts.includes(sort) ? (sort === 'full_name' ? 'u.full_name' : `m.${sort}`) : 'm.expiry_date';
    const sortDir = order && order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    // Total count
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE ${where}`,
      params
    );

    // Member list
    const [rows] = await db.query(
      `SELECT m.*,
              p.name AS plan_name, p.code AS plan_code, p.annual_fee, p.is_junior,
              p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct,
              u.full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1
      },
      // Backward compatibility for legacy frontend tables
      members: rows,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members/profile or /api/members/me ──────────────────────────────
router.get('/profile', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*,
              p.name AS plan_name, p.code AS plan_code, p.annual_fee, p.is_junior,
              p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct, p.max_bookings_per_day,
              u.full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = ?`,
      [req.session.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Member profile not found for this user', code: 'MEMBER_NOT_FOUND' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*,
              p.name AS plan_name, p.code AS plan_code, p.annual_fee, p.is_junior,
              p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct, p.max_bookings_per_day,
              u.full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE m.user_id = ?`,
      [req.session.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Member record not found', code: 'MEMBER_NOT_FOUND' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members/:id ─────────────────────────────────────────────────────
router.get('/:id', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT m.*,
              p.name AS plan_name, p.code AS plan_code, p.annual_fee, p.is_junior,
              p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct, p.max_bookings_per_day,
              u.full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE m.id = ?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' });
    }

    const member = rows[0];
    if (req.session.user.role === 'member' && member.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }

    // Fetch guardians if junior
    const [guardians] = await db.query(
      'SELECT * FROM member_guardians WHERE member_id = ?',
      [member.id]
    );
    member.guardians = guardians;

    // Fetch history
    const [history] = await db.query(
      `SELECT h.*, p.name AS plan_name
       FROM membership_history h
       JOIN plans p ON h.plan_id = p.id
       WHERE h.member_id = ?
       ORDER BY h.created_at DESC`,
      [member.id]
    );
    member.history = history;

    // Fetch recent check-ins
    const [checkins] = await db.query(
      `SELECT c.*, u.full_name AS staff_name
       FROM member_checkins c
       LEFT JOIN users u ON c.checked_in_by = u.id
       WHERE c.member_id = ?
       ORDER BY c.checkin_time DESC LIMIT 10`,
      [member.id]
    );
    member.checkins = checkins;

    res.json(member);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/members ─────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({
    full_name: { required: true, minLength: 2, maxLength: 80, label: 'Full name' },
    email: { required: true, type: 'email', label: 'Email address' },
    phone: { required: true, type: 'phone', label: 'Phone number' }
  }),
  async (req, res, next) => {
    try {
      const {
        full_name,
        email,
        password,
        phone,
        date_of_birth,
        plan_id,
        plan_code,
        payment_method = 'upi',
        emergency_contact_name,
        emergency_contact_phone,
        notes,
        guardian_name,
        guardian_relationship,
        guardian_phone
      } = req.body;

      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone ? phone.replace(/[\s\-+]/g, '').slice(-10) : null;

      if (password && password.trim() && password.trim().length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters long.',
          code: 'VALIDATION_ERROR',
          fields: { password: 'Password must be at least 6 characters' }
        });
      }

      // Validate plan by id or code
      let planQuery = 'SELECT * FROM plans WHERE is_active = 1 AND ';
      const planParams = [];
      if (plan_id) {
        planQuery += 'id = ?';
        planParams.push(plan_id);
      } else if (plan_code) {
        planQuery += 'code = ?';
        planParams.push(plan_code.toUpperCase());
      } else {
        return res.status(400).json({
          error: 'Membership plan is required.',
          code: 'VALIDATION_ERROR',
          fields: { plan_id: 'Select a valid membership plan' }
        });
      }

      const [plans] = await db.query(planQuery, planParams);
      if (!plans.length) {
        return res.status(400).json({ error: 'Selected membership plan is invalid or inactive.' });
      }
      const plan = plans[0];

      // Age calculation if DOB is provided
      let isUnder18 = false;
      if (date_of_birth) {
        const birthDate = new Date(date_of_birth);
        const ageDifMs = Date.now() - birthDate.getTime();
        const ageDate = new Date(ageDifMs);
        const age = Math.abs(ageDate.getUTCFullYear() - 1970);
        if (age < 18) {
          isUnder18 = true;
          if (!guardian_name || !guardian_phone) {
            return res.status(400).json({
              error: 'Guardian name and guardian contact number are mandatory for members under 18.',
              code: 'GUARDIAN_REQUIRED',
              fields: {
                guardian_name: 'Guardian name is required for under-18 members',
                guardian_phone: 'Guardian phone is required for under-18 members'
              }
            });
          }
          if (!plan.is_junior) {
            return res.status(400).json({
              error: 'Members under 18 must be enrolled on the Junior Sports Plan.',
              code: 'JUNIOR_PLAN_REQUIRED',
              fields: { plan_id: 'Under-18 members must select the Junior plan' }
            });
          }
        } else if (plan.is_junior) {
          return res.status(400).json({
            error: 'The Junior Sports Plan is restricted to youth under 18 years old.',
            code: 'JUNIOR_AGE_RESTRICTION',
            fields: { plan_id: 'Junior plan is only for members under 18' }
          });
        }
      }

      // Emergency contact rule: if one is provided, require both
      if ((emergency_contact_name && !emergency_contact_phone) || (!emergency_contact_name && emergency_contact_phone)) {
        return res.status(400).json({
          error: 'Please provide both emergency contact name and phone number.',
          code: 'EMERGENCY_CONTACT_INCOMPLETE',
          fields: {
            emergency_contact_name: emergency_contact_name ? undefined : 'Emergency contact name required',
            emergency_contact_phone: emergency_contact_phone ? undefined : 'Emergency contact phone required'
          }
        });
      }

      const result = await db.transaction(async (conn) => {
        // 1. Create or find user
        let userId;
        const [existingUsers] = await conn.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);

        const hasCustomPassword = password && password.trim();
        const memberPassword = hasCustomPassword ? password.trim() : `Pass@${crypto.randomBytes(3).toString('hex')}`;
        const mustChange = hasCustomPassword ? 0 : 1;
        const hash = await bcrypt.hash(memberPassword, 10);

        if (existingUsers.length) {
          userId = existingUsers[0].id;
          if (hasCustomPassword) {
            await conn.query(
              `UPDATE users SET full_name = ?, phone = COALESCE(?, phone), password_hash = ?, must_change_password = 0, role = 'member' WHERE id = ?`,
              [full_name.trim(), cleanPhone, hash, userId]
            );
          } else {
            await conn.query(
              `UPDATE users SET full_name = ?, phone = COALESCE(?, phone), role = 'member' WHERE id = ?`,
              [full_name.trim(), cleanPhone, userId]
            );
          }
        } else {
          const [insUser] = await conn.query(
            `INSERT INTO users (email, password_hash, role, full_name, phone, must_change_password, is_active)
             VALUES (?, ?, 'member', ?, ?, ?, 1)`,
            [cleanEmail, hash, full_name.trim(), cleanPhone, mustChange]
          );
          userId = insUser.insertId;
        }

        const joinDate = todayIST();
        const expDate = new Date();
        expDate.setMonth(expDate.getMonth() + (plan.duration_months || 12));
        const expiryDate = expDate.toISOString().slice(0, 10);

        // 2. Check if member record already exists for this user
        const [existingMember] = await conn.query('SELECT id, member_code FROM members WHERE user_id = ?', [userId]);
        let memberId;

        if (existingMember.length) {
          memberId = existingMember[0].id;
          await conn.query(
            `UPDATE members
             SET plan_id = ?, date_of_birth = COALESCE(?, date_of_birth),
                 join_date = ?, expiry_date = ?, status = 'active',
                 emergency_contact_name = COALESCE(?, emergency_contact_name),
                 emergency_contact_phone = COALESCE(?, emergency_contact_phone),
                 notes = COALESCE(?, notes)
             WHERE id = ?`,
            [
              plan.id, date_of_birth || null, joinDate, expiryDate,
              emergency_contact_name || null, emergency_contact_phone || null,
              notes || null, memberId
            ]
          );
        } else {
          // Generate unique member code
          const [[{ maxId }]] = await conn.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM members');
          let memberCode = `CC-${new Date().getFullYear()}-${String(Number(maxId) + 1).padStart(3, '0')}`;

          const [dup] = await conn.query('SELECT id FROM members WHERE member_code = ?', [memberCode]);
          if (dup.length) {
            memberCode = `CC-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
          }

          const [insMember] = await conn.query(
            `INSERT INTO members (
              user_id, member_code, plan_id, date_of_birth, join_date, expiry_date,
              status, emergency_contact_name, emergency_contact_phone, notes
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
            [
              userId, memberCode, plan.id, date_of_birth || null, joinDate, expiryDate,
              emergency_contact_name || null, emergency_contact_phone || null, notes || null
            ]
          );
          memberId = insMember.insertId;
        }

        // 3. Save guardian details if under 18
        if (isUnder18 && guardian_name) {
          await conn.query(
            `INSERT INTO member_guardians (member_id, guardian_name, relationship, phone, consent_given)
             VALUES (?, ?, ?, ?, 1)`,
            [memberId, guardian_name.trim(), guardian_relationship || 'Guardian', guardian_phone.trim()]
          );
        }

        // 4. Record history
        await conn.query(
          `INSERT INTO membership_history (member_id, plan_id, action, start_date, end_date, amount_paid, notes)
           VALUES (?, ?, 'joined', ?, ?, ?, 'Enrolled via admin portal')`,
          [memberId, plan.id, joinDate, expiryDate, plan.annual_fee]
        );

        // 5. Record initial payment
        if (plan.annual_fee > 0) {
          const payCode = `PAY-MBR-${Date.now()}`;
          const validMethods = ['cash', 'card', 'upi', 'online'];
          const normalizedMethod = (payment_method && validMethods.includes(payment_method.toLowerCase()))
            ? payment_method.toLowerCase()
            : 'online';
          await conn.query(
            `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
             VALUES (?, 'membership', ?, ?, ?, ?, 'paid', NOW())`,
            [payCode, memberId, userId, plan.annual_fee, normalizedMethod]
          );
        }

        // Return full member profile
        const [mRows] = await conn.query(
          `SELECT m.*, p.name AS plan_name, u.full_name, u.email, u.phone,
                  DATEDIFF(m.expiry_date, CURDATE()) AS days_left
           FROM members m
           JOIN users u ON m.user_id = u.id
           JOIN plans p ON m.plan_id = p.id
           WHERE m.id = ?`,
          [memberId]
        );

        return mRows[0];
      });

      res.status(201).json(result);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Email or member record already exists.', code: 'DUPLICATE_ENTRY' });
      }
      next(err);
    }
  }
);

// ── PUT /api/members/:id ─────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const memberId = req.params.id;
    const {
      full_name,
      email,
      phone,
      password,
      status,
      notes,
      emergency_contact_name,
      emergency_contact_phone,
      plan_id,
      expiry_date
    } = req.body;

    const [mRows] = await db.query('SELECT * FROM members WHERE id = ?', [memberId]);
    if (!mRows.length) return res.status(404).json({ error: 'Member not found' });
    const member = mRows[0];

    // Update password if provided
    if (password && password.trim()) {
      if (password.trim().length < 6) {
        return res.status(400).json({
          error: 'Password must be at least 6 characters long.',
          code: 'VALIDATION_ERROR',
          fields: { password: 'Password must be at least 6 characters' }
        });
      }
      const hash = await bcrypt.hash(password.trim(), 10);
      await db.query(
        `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
        [hash, member.user_id]
      );
    }

    // Update user info
    if (full_name || email || phone) {
      await db.query(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone)
         WHERE id = ?`,
        [
          full_name ? full_name.trim() : null,
          email ? email.trim().toLowerCase() : null,
          phone ? phone.replace(/[\s\-+]/g, '').slice(-10) : null,
          member.user_id
        ]
      );
    }

    // Update member record
    await db.query(
      `UPDATE members
       SET status = COALESCE(?, status),
           notes = COALESCE(?, notes),
           emergency_contact_name = COALESCE(?, emergency_contact_name),
           emergency_contact_phone = COALESCE(?, emergency_contact_phone),
           plan_id = COALESCE(?, plan_id),
           expiry_date = COALESCE(?, expiry_date)
       WHERE id = ?`,
      [
        status || null,
        notes !== undefined ? notes : null,
        emergency_contact_name !== undefined ? emergency_contact_name : null,
        emergency_contact_phone !== undefined ? emergency_contact_phone : null,
        plan_id || null,
        expiry_date || null,
        memberId
      ]
    );

    const [updated] = await db.query(
      `SELECT m.*, p.name AS plan_name, u.full_name, u.email, u.phone,
              DATEDIFF(m.expiry_date, CURDATE()) AS days_left
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
       WHERE m.id = ?`,
      [memberId]
    );

    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/members/:id/renew ──────────────────────────────────────────────
router.post('/:id/renew', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const memberId = req.params.id;
    const { plan_id, payment_method = 'upi' } = req.body;

    const [mRows] = await db.query('SELECT * FROM members WHERE id = ?', [memberId]);
    if (!mRows.length) return res.status(404).json({ error: 'Member not found' });
    const member = mRows[0];

    const targetPlanId = plan_id || member.plan_id;
    const [pRows] = await db.query('SELECT * FROM plans WHERE id = ?', [targetPlanId]);
    if (!pRows.length) return res.status(400).json({ error: 'Invalid plan selected' });
    const plan = pRows[0];

    // Compute new expiry date extending from max(today, current_expiry)
    const today = new Date(todayIST());
    const currExpiry = new Date(member.expiry_date);
    const baseDate = currExpiry > today ? currExpiry : today;
    baseDate.setMonth(baseDate.getMonth() + (plan.duration_months || 12));
    const newExpiry = baseDate.toISOString().slice(0, 10);

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE members SET plan_id = ?, expiry_date = ?, status = 'active' WHERE id = ?`,
        [plan.id, newExpiry, memberId]
      );

      await conn.query(
        `INSERT INTO membership_history (member_id, plan_id, action, start_date, end_date, amount_paid, notes)
         VALUES (?, ?, 'renewed', CURDATE(), ?, ?, 'Plan renewal')`,
        [memberId, plan.id, newExpiry, plan.annual_fee]
      );

      if (plan.annual_fee > 0) {
        const payCode = `PAY-RNW-${Date.now()}`;
        const validMethods = ['cash', 'card', 'upi', 'online'];
        const normalizedMethod = (payment_method && validMethods.includes(payment_method.toLowerCase()))
          ? payment_method.toLowerCase()
          : 'online';
        await conn.query(
          `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
           VALUES (?, 'membership', ?, ?, ?, ?, 'paid', NOW())`,
          [payCode, memberId, member.user_id, plan.annual_fee, normalizedMethod]
        );
      }
    });

    res.json({ ok: true, message: 'Membership renewed successfully', newExpiry });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members/:id ───────────────────────────────────────────────────
router.get('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const memberId = req.params.id;
    const [rows] = await db.query(
      `SELECT m.*, u.full_name, u.email, u.phone, u.role, u.is_active AS user_active,
              p.code AS plan_code, p.name AS plan_name, p.description AS plan_description,
              p.annual_fee AS plan_annual_fee, p.duration_months AS plan_duration_months,
              p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct,
              p.max_bookings_per_day, p.is_junior AS plan_is_junior
       FROM members m
       JOIN users u ON m.user_id = u.id
       LEFT JOIN plans p ON m.plan_id = p.id
       WHERE m.id = ? OR m.member_code = ?`,
      [memberId, memberId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' });
    }

    const member = rows[0];

    // Fetch Guardian Info if junior
    const [guardians] = await db.query(
      `SELECT * FROM member_guardians WHERE member_id = ?`,
      [member.id]
    );

    // Fetch Recent Check-ins
    const [checkins] = await db.query(
      `SELECT mc.*, u.full_name AS staff_name
       FROM member_checkins mc
       LEFT JOIN users u ON mc.checked_in_by = u.id
       WHERE mc.member_id = ?
       ORDER BY mc.checkin_time DESC LIMIT 10`,
      [member.id]
    );

    // Fetch Membership History / Renewals
    const [history] = await db.query(
      `SELECT mh.*, p.name AS plan_name
       FROM membership_history mh
       LEFT JOIN plans p ON mh.plan_id = p.id
       WHERE mh.member_id = ?
       ORDER BY mh.created_at DESC LIMIT 10`,
      [member.id]
    );

    res.json({
      data: {
        ...member,
        guardian: guardians.length ? guardians[0] : null,
        recent_checkins: checkins,
        history: history
      },
      ...member,
      guardian: guardians.length ? guardians[0] : null,
      recent_checkins: checkins,
      history: history
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/members/:id/checkin ───────────────────────────────────────────
router.post('/:id/checkin', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const memberId = req.params.id;
    const { method = 'manual', notes } = req.body;

    const [mRows] = await db.query(
      `SELECT m.*, u.full_name
       FROM members m
       JOIN users u ON m.user_id = u.id
       WHERE m.id = ? OR m.member_code = ?`,
      [memberId, memberId]
    );

    if (!mRows.length) {
      return res.status(404).json({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' });
    }
    const member = mRows[0];

    if (member.status !== 'active') {
      return res.status(400).json({
        error: `Member status is ${member.status}. Cannot check in.`,
        code: 'MEMBER_NOT_ACTIVE'
      });
    }

    await db.query(
      `INSERT INTO member_checkins (member_id, checked_in_by, method, notes)
       VALUES (?, ?, ?, ?)`,
      [member.id, req.session.user.id, method, notes || null]
    );

    res.json({
      ok: true,
      message: `Check-in recorded for ${member.full_name} (${member.member_code})`,
      checkinTime: new Date()
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/members/:id ──────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.id, 10);
    const [mRows] = await db.query('SELECT * FROM members WHERE id = ?', [memberId]);
    if (!mRows.length) {
      return res.status(404).json({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' });
    }
    const member = mRows[0];

    await db.transaction(async (conn) => {
      await conn.query('DELETE FROM member_guardians WHERE member_id = ?', [memberId]);
      await conn.query('DELETE FROM member_checkins WHERE member_id = ?', [memberId]);
      await conn.query('DELETE FROM membership_history WHERE member_id = ?', [memberId]);
      await conn.query('DELETE FROM booking_slots WHERE booking_id IN (SELECT id FROM bookings WHERE member_id = ?)', [memberId]);
      await conn.query('DELETE FROM bookings WHERE member_id = ?', [memberId]);
      await conn.query('DELETE FROM payments WHERE user_id = ? OR (source = "membership" AND reference_id = ?)', [member.user_id, memberId]);
      await conn.query('DELETE FROM members WHERE id = ?', [memberId]);
      if (member.user_id) {
        await conn.query('DELETE FROM users WHERE id = ? AND role = "member"', [member.user_id]);
      }
    });

    res.json({ ok: true, message: 'Member account deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
