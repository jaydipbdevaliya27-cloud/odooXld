/**
 * @file server/routes/leads.js
 * @description CRM Leads Pipeline, Public Enquiry Intake, Follow-ups,
 * and 1-Click Conversion to Active Member.
 */

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { todayIST } = require('../utils/time');

const router = express.Router();

// ── POST /api/leads (Public Form & Admin Create) ────────────────────────────
router.post(
  '/',
  validate({
    name: { required: true, minLength: 2, maxLength: 80, label: 'Name' },
    email: { type: 'email', label: 'Email address' },
    phone: { required: true, type: 'phone', label: 'Mobile number' }
  }),
  async (req, res, next) => {
    try {
      const {
        name,
        email,
        phone,
        interested_plan_id,
        message,
        source = 'website',
        interest = 'membership',
        follow_up_date
      } = req.body;

      const [r] = await db.query(
        `INSERT INTO leads (
          name, email, phone, interested_plan_id, message,
          source, interest, status, follow_up_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
        [
          name.trim(),
          email ? email.trim().toLowerCase() : null,
          phone ? phone.replace(/[\s\-+]/g, '').slice(-10) : null,
          interested_plan_id || null,
          message || null,
          source,
          interest,
          follow_up_date || todayIST()
        ]
      );
      const leadId = r.insertId;

      // Create notification for staff & owner
      await db.query(
        `INSERT INTO notifications (role_target, type, title, message, link)
         VALUES ('owner', 'new_lead', 'New Membership Enquiry', ?, '/owner/leads.html')`,
        [`${name.trim()} submitted a new enquiry for ${interest}. Phone: ${phone}`]
      );

      res.status(201).json({
        ok: true,
        leadId,
        message: 'Thank you! Your enquiry has been received. Our team will contact you shortly.'
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/leads ──────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const {
      q,
      status,
      interest,
      source,
      assigned_to,
      page = 1,
      limit = 20
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.message LIKE ?)';
      params.push(s, s, s, s);
    }
    if (status) {
      where += ' AND l.status = ?';
      params.push(status);
    }
    if (interest) {
      where += ' AND l.interest = ?';
      params.push(interest);
    }
    if (source) {
      where += ' AND l.source = ?';
      params.push(source);
    }
    if (assigned_to) {
      where += ' AND l.assigned_to_user_id = ?';
      params.push(assigned_to);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM leads l WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT l.*, p.name AS plan_name, u.full_name AS assigned_staff_name
       FROM leads l
       LEFT JOIN plans p ON l.interested_plan_id = p.id
       LEFT JOIN users u ON l.assigned_to_user_id = u.id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      data: rows,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/leads/:id ──────────────────────────────────────────────────────
router.get('/stats', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const [[stats]] = await db.query(
      `SELECT COUNT(*) AS total_leads,
              SUM(CASE WHEN status IN ('new', 'contacted')
                    AND (follow_up_date IS NULL OR follow_up_date <= CURDATE())
                  THEN 1 ELSE 0 END) AS followups_due,
              SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) AS active_quotes,
              SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
       FROM leads`
    );
    res.json({
      total_leads: Number(stats.total_leads) || 0,
      followups_due: Number(stats.followups_due) || 0,
      active_quotes: Number(stats.active_quotes) || 0,
      converted: Number(stats.converted) || 0
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT l.*, p.name AS plan_name, u.full_name AS assigned_staff_name
       FROM leads l
       LEFT JOIN plans p ON l.interested_plan_id = p.id
       LEFT JOIN users u ON l.assigned_to_user_id = u.id
       WHERE l.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = rows[0];

    const [followups] = await db.query(
      `SELECT f.*, u.full_name AS staff_name
       FROM lead_followups f
       LEFT JOIN users u ON f.created_by = u.id
       WHERE f.lead_id = ?
       ORDER BY f.due_date ASC`,
      [lead.id]
    );
    lead.followups = followups;

    res.json(lead);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/leads/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('staff', 'owner'), async (req, res, next) => {
  try {
    const { status, notes, assigned_to_user_id, interested_plan_id, follow_up_date } = req.body;

    await db.query(
      `UPDATE leads
       SET status = COALESCE(?, status),
           notes = COALESCE(?, notes),
           assigned_to_user_id = COALESCE(?, assigned_to_user_id),
           interested_plan_id = COALESCE(?, interested_plan_id),
           follow_up_date = COALESCE(?, follow_up_date)
       WHERE id = ?`,
      [
        status || null,
        notes !== undefined ? notes : null,
        assigned_to_user_id !== undefined ? assigned_to_user_id : null,
        interested_plan_id !== undefined ? interested_plan_id : null,
        follow_up_date !== undefined ? follow_up_date : null,
        req.params.id
      ]
    );

    res.json({ ok: true, message: 'Lead updated successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/leads/:id/followups ───────────────────────────────────────────
router.post(
  '/:id/followups',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({
    due_date: { required: true, type: 'date', label: 'Due date' },
    note: { required: true, minLength: 2, label: 'Task description' }
  }),
  async (req, res, next) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const { due_date, note } = req.body;

      const [r] = await db.query(
        `INSERT INTO lead_followups (lead_id, due_date, note, status, created_by)
         VALUES (?, ?, ?, 'pending', ?)`,
        [leadId, due_date, note.trim(), req.session.user.id]
      );

      res.status(201).json({ id: r.insertId, message: 'Follow-up task scheduled' });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/leads/:id/convert ─────────────────────────────────────────────
router.post(
  '/:id/convert',
  requireLogin,
  requireRole('staff', 'owner'),
  validate({ plan_id: { required: true, type: 'integer', label: 'Membership Plan' } }),
  async (req, res, next) => {
    try {
      const leadId = parseInt(req.params.id, 10);
      const { plan_id, payment_method = 'upi' } = req.body;

      const result = await db.transaction(async (conn) => {
        const [leads] = await conn.query('SELECT * FROM leads WHERE id = ? FOR UPDATE', [leadId]);
        if (!leads.length) throw new Error('Lead not found');
        const lead = leads[0];

        if (lead.status === 'converted') {
          throw new Error('This lead is already converted to a member.');
        }

        const [plans] = await conn.query('SELECT * FROM plans WHERE id = ?', [plan_id]);
        if (!plans.length) throw new Error('Invalid plan');
        const plan = plans[0];

        // 1. Create or link user
        let userId;
        const email = lead.email || `lead${lead.id}@championsclub.in`;
        const [users] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);

        if (users.length) {
          userId = users[0].id;
          await conn.query('UPDATE users SET role = "member", phone = COALESCE(?, phone) WHERE id = ?', [lead.phone, userId]);
        } else {
          const tempPwd = `Pass@${crypto.randomBytes(3).toString('hex')}`;
          const hash = await bcrypt.hash(tempPwd, 10);
          const [insUser] = await conn.query(
            `INSERT INTO users (email, password_hash, role, full_name, phone, must_change_password, is_active)
             VALUES (?, ?, 'member', ?, ?, 1, 1)`,
            [email, hash, lead.name, lead.phone]
          );
          userId = insUser.insertId;
        }

        // 2. Create member
        const [[{ maxId }]] = await conn.query('SELECT COALESCE(MAX(id), 0) AS maxId FROM members');
        const memberCode = `CC-${new Date().getFullYear()}-${String(Number(maxId) + 1).padStart(3, '0')}`;
        const joinDate = todayIST();
        const expDate = new Date();
        expDate.setMonth(expDate.getMonth() + (plan.duration_months || 12));
        const expiryDate = expDate.toISOString().slice(0, 10);

        const [insMember] = await conn.query(
          `INSERT INTO members (user_id, member_code, plan_id, join_date, expiry_date, status, notes)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
          [userId, memberCode, plan.id, joinDate, expiryDate, `Converted from Lead #${leadId}`]
        );
        const memberId = insMember.insertId;

        // 3. Record history & payment
        await conn.query(
          `INSERT INTO membership_history (member_id, plan_id, action, start_date, end_date, amount_paid, notes)
           VALUES (?, ?, 'joined', ?, ?, ?, 'Converted from CRM lead')`,
          [memberId, plan.id, joinDate, expiryDate, plan.annual_fee]
        );

        if (plan.annual_fee > 0) {
          const payCode = `PAY-CONV-${Date.now()}`;
          await conn.query(
            `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
             VALUES (?, 'membership', ?, ?, ?, ?, 'paid', NOW())`,
            [payCode, memberId, userId, plan.annual_fee, payment_method]
          );
        }

        // 4. Update lead status
        await conn.query(
          'UPDATE leads SET status = "converted", converted_member_id = ? WHERE id = ?',
          [memberId, leadId]
        );

        return { leadId, memberId, memberCode, full_name: lead.name, plan_name: plan.name };
      });

      res.status(201).json({ ok: true, message: 'Lead successfully converted to active club member!', ...result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
