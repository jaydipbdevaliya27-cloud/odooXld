/**
 * @file server/routes/staff.js
 * @description Staff Management, Operational Area Assignment, Shifts, Roster, and Payroll/Payslips API.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// ── GET /api/staff ──────────────────────────────────────────────────────────
router.get('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { q, area, is_active, page, limit } = req.query;

    let where = "role IN ('staff', 'owner')";
    const params = [];

    if (q && q.trim().length >= 2) {
      const s = `%${q.trim().replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      params.push(s, s, s);
    }
    if (area) {
      where += ' AND assigned_area = ?';
      params.push(area);
    }
    if (is_active !== undefined) {
      where += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' ? 1 : 0);
    }

    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (pageNum - 1) * limitNum;

      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);
      const [rows] = await db.query(
        `SELECT id, email, role, full_name, phone, assigned_area, is_active, created_at
         FROM users WHERE ${where} ORDER BY role ASC, full_name ASC LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      );

      return res.json({
        data: rows,
        meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) || 1 }
      });
    }

    const [rows] = await db.query(
      `SELECT id, email, role, full_name, phone, assigned_area, is_active, created_at
       FROM users WHERE ${where} ORDER BY role ASC, full_name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/staff ─────────────────────────────────────────────────────────
router.post(
  '/',
  requireLogin,
  requireRole('owner'),
  validate({
    full_name: { required: true, minLength: 2, label: 'Staff full name' },
    email: { required: true, type: 'email', label: 'Staff email' },
    password: { required: true, minLength: 6, label: 'Password' },
    assigned_area: { required: true, enum: ['shop', 'bar', 'booking', 'general'], label: 'Assigned area' }
  }),
  async (req, res, next) => {
    try {
      const { full_name, email, password, phone, assigned_area = 'general', role = 'staff' } = req.body;
      const cleanEmail = email.trim().toLowerCase();

      const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existing.length) {
        return res.status(409).json({ error: 'A user with this email address already exists.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const [r] = await db.query(
        `INSERT INTO users (email, password_hash, role, full_name, phone, assigned_area, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [cleanEmail, hash, role, full_name.trim(), phone ? phone.trim() : null, assigned_area]
      );

      res.status(201).json({ id: r.insertId, email: cleanEmail, full_name, assigned_area });
    } catch (err) {
      next(err);
    }
  }
);

// ── Shifts & Roster API ─────────────────────────────────────────────────────
router.get('/shifts', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM shifts WHERE is_active = 1 ORDER BY start_time');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/roster', requireLogin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    let where = '1=1';
    const params = [];

    if (from) { where += ' AND sa.assignment_date >= ?'; params.push(from); }
    if (to) { where += ' AND sa.assignment_date <= ?'; params.push(to); }

    const [rows] = await db.query(
      `SELECT sa.*, s.name AS shift_name, s.start_time, s.end_time,
              u.full_name AS staff_name, u.assigned_area
       FROM shift_assignments sa
       JOIN shifts s ON sa.shift_id = s.id
       JOIN users u ON sa.user_id = u.id
       WHERE ${where}
       ORDER BY sa.assignment_date ASC, s.start_time ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/roster',
  requireLogin,
  requireRole('owner'),
  validate({
    shift_id: { required: true, type: 'integer', label: 'Shift' },
    user_id: { required: true, type: 'integer', label: 'Staff member' },
    assignment_date: { required: true, type: 'date', label: 'Date' }
  }),
  async (req, res, next) => {
    try {
      const { shift_id, user_id, assignment_date, notes } = req.body;
      const [r] = await db.query(
        `INSERT INTO shift_assignments (shift_id, user_id, assignment_date, notes)
         VALUES (?, ?, ?, ?)`,
        [shift_id, user_id, assignment_date, notes || null]
      );
      res.status(201).json({ id: r.insertId, message: 'Shift assigned successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// ── PAYROLL & PAYSLIP APIS (Must precede /:id) ──────────────────────────────

// GET /api/staff/payroll/summary
router.get('/payroll/summary', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [[summary]] = await db.query(`
      SELECT 
        COUNT(*) AS total_payslips,
        IFNULL(SUM(gross_salary), 0) AS total_gross_paid,
        IFNULL(SUM(net_salary), 0) AS total_net_paid,
        IFNULL(SUM(CASE WHEN payment_status = 'paid' THEN net_salary ELSE 0 END), 0) AS total_disbursed,
        IFNULL(SUM(CASE WHEN payment_status != 'paid' THEN net_salary ELSE 0 END), 0) AS total_pending,
        IFNULL(AVG(net_salary), 0) AS avg_salary,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) AS paid_count,
        COUNT(CASE WHEN payment_status != 'paid' THEN 1 END) AS pending_count
      FROM payroll_payslips
    `);
    res.json({
      total_payslips: Number(summary.total_payslips || 0),
      total_disbursed: Number(summary.total_disbursed || 0),
      total_pending: Number(summary.total_pending || 0),
      avg_salary: Number(summary.avg_salary || 0),
      paid_count: Number(summary.paid_count || 0),
      pending_count: Number(summary.pending_count || 0)
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/staff/payroll/payslips
router.get('/payroll/payslips', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { search, q, month, year, area, status, page = 1, limit = 15 } = req.query;
    const searchTerm = (search || q || '').trim();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
    const offset = (pageNum - 1) * limitNum;

    let where = '1=1';
    const params = [];

    if (searchTerm) {
      const s = `%${searchTerm.replace(/[%_]/g, '\\$&')}%`;
      where += ' AND (payslip_code LIKE ? OR staff_name LIKE ? OR staff_email LIKE ? OR payment_reference LIKE ?)';
      params.push(s, s, s, s);
    }
    if (month && month !== 'all') {
      where += ' AND pay_period_month = ?';
      params.push(month);
    }
    if (year && year !== 'all') {
      where += ' AND pay_period_year = ?';
      params.push(parseInt(year, 10));
    }
    if (area && area !== 'all') {
      where += ' AND assigned_area = ?';
      params.push(area);
    }
    if (status && status !== 'all') {
      where += ' AND payment_status = ?';
      params.push(status);
    }

    const [[{ total, totalGross, totalNet }]] = await db.query(
      `SELECT COUNT(*) AS total,
              IFNULL(SUM(gross_salary), 0) AS totalGross,
              IFNULL(SUM(net_salary), 0) AS totalNet
       FROM payroll_payslips
       WHERE ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT * FROM payroll_payslips
       WHERE ${where}
       ORDER BY pay_period_year DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    res.json({
      payslips: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: Number(total || 0),
        pages: Math.ceil(total / limitNum) || 1,
        totalGross: Number(totalGross || 0),
        totalNet: Number(totalNet || 0)
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/staff/payroll/payslips/:id
router.get('/payroll/payslips/:id', requireLogin, requireRole('owner', 'staff'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll_payslips WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Payslip not found' });
    const slip = rows[0];

    // Staff can only view their own payslip
    if (req.session.user.role === 'staff' && slip.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(slip);
  } catch (err) {
    next(err);
  }
});

// POST /api/staff/payroll/payslips (Create & Pay Salary Slip)
router.post('/payroll/payslips', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const {
      user_id,
      staff_name,
      staff_email,
      assigned_area,
      pay_period_month,
      pay_period_year,
      base_salary,
      hra_allowance = 0,
      transport_allowance = 0,
      performance_bonus = 0,
      overtime_hours = 0,
      overtime_rate = 0,
      overtime_pay = 0,
      provident_fund = 0,
      professional_tax = 200,
      income_tax_tds = 0,
      leave_days = 0,
      unpaid_leave_deduction = 0,
      payment_method = 'bank_transfer',
      payment_status = 'paid',
      payment_reference,
      notes
    } = req.body;

    if (!user_id || !pay_period_month || !pay_period_year || !base_salary) {
      return res.status(400).json({ error: 'Staff member, month, year, and base salary are required.' });
    }

    const [userRows] = await db.query('SELECT id, full_name, email, assigned_area FROM users WHERE id = ?', [user_id]);
    const staff = userRows.length ? userRows[0] : { id: user_id, full_name: staff_name || 'Staff Member', email: staff_email || '', assigned_area: assigned_area || 'general' };

    const base = Number(base_salary) || 0;
    const hra = Number(hra_allowance) || 0;
    const transport = Number(transport_allowance) || 0;
    const bonus = Number(performance_bonus) || 0;
    const otPay = overtime_pay ? Number(overtime_pay) : (Number(overtime_hours || 0) * Number(overtime_rate || 0));
    const gross = Math.round((base + hra + transport + bonus + otPay) * 100) / 100;

    const pf = Number(provident_fund) || 0;
    const pt = Number(professional_tax) || 0;
    const tds = Number(income_tax_tds) || 0;
    const leaveDed = unpaid_leave_deduction ? Number(unpaid_leave_deduction) : (leave_days > 0 ? Math.round(((base / 30) * Number(leave_days)) * 100) / 100 : 0);
    const deductions = Math.round((pf + pt + tds + leaveDed) * 100) / 100;

    const net = Math.max(0, Math.round((gross - deductions) * 100) / 100);

    // Generate unique payslip code
    const monthNum = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(String(pay_period_month).toLowerCase()) + 1;
    const mStr = String(monthNum > 0 ? monthNum : 1).padStart(2, '0');
    const payslipCode = `PAY-${pay_period_year}${mStr}-${String(staff.id).padStart(3, '0')}`;

    const payRef = payment_reference || (payment_status === 'paid' ? `UTR${pay_period_year}${Date.now().toString().slice(-6)}` : null);
    const paidAt = payment_status === 'paid' ? new Date() : null;

    const [result] = await db.query(
      `INSERT INTO payroll_payslips (
        payslip_code, user_id, staff_name, staff_email, assigned_area,
        pay_period_month, pay_period_year, base_salary, hra_allowance, transport_allowance,
        performance_bonus, overtime_pay, overtime_hours, gross_salary, provident_fund,
        professional_tax, income_tax_tds, unpaid_leave_deduction, leave_days,
        total_deductions, net_salary, payment_method, payment_status, payment_reference, paid_at,
        created_by_user_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payslipCode, staff.id, staff.full_name, staff.email, staff.assigned_area || 'general',
        pay_period_month, pay_period_year, base, hra, transport,
        bonus, otPay, Number(overtime_hours) || 0, gross, pf,
        pt, tds, leaveDed, Number(leave_days) || 0,
        deductions, net, payment_method, payment_status, payRef, paidAt,
        req.session.user.id, notes || null
      ]
    );

    const [created] = await db.query('SELECT * FROM payroll_payslips WHERE id = ?', [result.insertId]);

    res.status(201).json(created[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/staff/payroll/payslips/:id
router.delete('/payroll/payslips/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll_payslips WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Payslip not found' });
    await db.query('DELETE FROM payroll_payslips WHERE id = ?', [req.params.id]);
    res.json({ message: 'Payslip removed successfully' });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/staff/:id ──────────────────────────────────────────────────────
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { full_name, email, phone, assigned_area, is_active, password } = req.body;

    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [staffId]);
    if (!rows.length) return res.status(404).json({ error: 'Staff user not found' });

    // Cannot deactivate yourself
    if (staffId === req.session.user.id && is_active === 0) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    let pwdUpdate = '';
    const params = [
      full_name ? full_name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      phone !== undefined ? (phone ? phone.trim() : null) : null,
      assigned_area || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null
    ];

    if (password && password.trim().length >= 6) {
      const hash = await bcrypt.hash(password.trim(), 10);
      pwdUpdate = ', password_hash = ?';
      params.push(hash);
    }

    params.push(staffId);

    await db.query(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           assigned_area = COALESCE(?, assigned_area),
           is_active = COALESCE(?, is_active)
           ${pwdUpdate}
       WHERE id = ?`,
      params
    );

    const [updated] = await db.query(
      'SELECT id, email, role, full_name, phone, assigned_area, is_active FROM users WHERE id = ?',
      [staffId]
    );
    res.json(updated[0]);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/staff/:id ───────────────────────────────────────────────────
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [staffId]);
    if (!rows.length) return res.status(404).json({ error: 'Staff user not found', code: 'NOT_FOUND' });

    if (staffId === req.session.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.', code: 'CANNOT_DELETE_SELF' });
    }

    await db.transaction(async (conn) => {
      await conn.query('DELETE FROM shift_assignments WHERE user_id = ?', [staffId]);
      await conn.query('DELETE FROM users WHERE id = ?', [staffId]);
    });

    res.json({ message: 'Staff member deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
