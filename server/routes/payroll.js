/**
 * @file server/routes/payroll.js
 * @description Payroll management routes (Owner only).
 *
 * Endpoints:
 *   GET  /api/payroll              – list all payroll records
 *   POST /api/payroll/generate     – generate salary slips for a given month
 *   PUT  /api/payroll/:id/pay      – mark a payslip as paid
 *   GET  /api/payroll/staff/:uid   – history for one staff member
 */

const express = require('express');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ─── helpers ─────────────────────────────────────────────────────────────── */

/** Build YYYY-MM string from month_year field or current month */
function currentMonthYear() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Make a unique payroll code: PAY-<staffId>-<YYYYMM> */
function makeCode(staffId, monthYear) {
  return `PAY-${staffId}-${monthYear.replace('-', '')}`;
}

/* ─── GET /api/payroll ───────────────────────────────────────────────────── */
router.get('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { month } = req.query;   // optional filter: ?month=2025-09
    let sql = `
      SELECT p.*, u.full_name, u.email, u.assigned_area, u.phone
      FROM   payroll p
      JOIN   users   u ON u.id = p.staff_user_id
      ORDER  BY p.month_year DESC, u.full_name ASC
    `;
    const params = [];
    if (month) {
      sql = `
        SELECT p.*, u.full_name, u.email, u.assigned_area, u.phone
        FROM   payroll p
        JOIN   users   u ON u.id = p.staff_user_id
        WHERE  p.month_year = ?
        ORDER  BY u.full_name ASC
      `;
      params.push(month);
    }
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

/* ─── POST /api/payroll/generate ─────────────────────────────────────────── */
/**
 * Body: { month_year: "2025-09" }
 * Creates payroll records for every active staff user for that month.
 * Skips if a record already exists (idempotent).
 */
router.post('/generate', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const monthYear = req.body.month_year || currentMonthYear();

    // Fetch all active staff
    const [staff] = await db.query(
      `SELECT id, full_name, COALESCE(monthly_salary, 30000) AS monthly_salary
       FROM   users
       WHERE  role = 'staff' AND is_active = 1`
    );

    if (!staff.length) {
      return res.status(400).json({ error: 'No active staff members found.' });
    }

    const created = [];
    const skipped = [];

    for (const s of staff) {
      const code = makeCode(s.id, monthYear);

      // Skip if already generated
      const [existing] = await db.query(
        'SELECT id FROM payroll WHERE payroll_code = ?', [code]
      );
      if (existing.length) { skipped.push(s.full_name); continue; }

      const base  = Number(s.monthly_salary);
      const bonus = 0;
      const ded   = parseFloat((base * 0.08).toFixed(2));  // 8% PF/ESI
      const net   = parseFloat((base + bonus - ded).toFixed(2));

      await db.query(
        `INSERT INTO payroll
           (payroll_code, staff_user_id, month_year, base_salary, bonus, deductions, net_salary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [code, s.id, monthYear, base, bonus, ded, net]
      );
      created.push({ id: s.id, name: s.full_name, net });
    }

    res.json({
      message: `Payroll generated for ${monthYear}`,
      month_year: monthYear,
      created: created.length,
      skipped: skipped.length,
      details: created
    });
  } catch (err) { next(err); }
});

/* ─── PUT /api/payroll/:id/pay ───────────────────────────────────────────── */
/**
 * Body (optional): { payment_method: "bank_transfer", notes: "..." }
 * Marks one payslip as paid and sets paid_at to NOW().
 */
router.put('/:id/pay', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const { payment_method = 'bank_transfer', notes = null } = req.body;
    const { id } = req.params;

    const [result] = await db.query(
      `UPDATE payroll
       SET    status = 'paid', payment_method = ?, paid_at = NOW(), notes = ?
       WHERE  id = ? AND status = 'pending'`,
      [payment_method, notes, id]
    );

    if (!result.affectedRows) {
      return res.status(400).json({ error: 'Payslip not found or already paid.' });
    }

    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

/* ─── GET /api/payroll/staff/:uid ────────────────────────────────────────── */
/** Salary history for a single staff member */
router.get('/staff/:uid', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.full_name, u.assigned_area
       FROM   payroll p
       JOIN   users   u ON u.id = p.staff_user_id
       WHERE  p.staff_user_id = ?
       ORDER  BY p.month_year DESC`,
      [req.params.uid]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
