/**
 * @file server/routes/staff.js
 * @description Staff Management routes for Owner/Admin.
 * Allows assigning roles/departments (shop, bar, booking, general),
 * creating staff members with hashed passwords, editing details, and activating/deactivating.
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// Ensure assigned_area column exists in users table
let schemaChecked = false;
async function ensureSchema() {
  if (schemaChecked) return;
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM users LIKE 'assigned_area'");
    if (!cols.length) {
      await db.query("ALTER TABLE users ADD COLUMN assigned_area VARCHAR(50) NOT NULL DEFAULT 'shop'");
      console.log('[DB] Added assigned_area column to users table.');
    }
    schemaChecked = true;
  } catch (err) {
    // If DB is offline or table structure cannot be altered, proceed gracefully
    schemaChecked = true;
  }
}

// In-memory fallback cache when MySQL is offline or initializing
let IN_MEMORY_STAFF = [
  { id: 2, email: 'shop@championsclub.com', full_name: 'Alex Carter', phone: '+91 98765 43210', role: 'staff', assigned_area: 'shop', is_active: 1, created_at: new Date().toISOString() },
  { id: 4, email: 'bar@championsclub.com', full_name: 'Elena Rostova', phone: '+91 98765 43211', role: 'staff', assigned_area: 'bar', is_active: 1, created_at: new Date().toISOString() },
  { id: 5, email: 'booking@championsclub.com', full_name: 'David Chen', phone: '+91 98765 43212', role: 'staff', assigned_area: 'booking', is_active: 1, created_at: new Date().toISOString() }
];

// ── GET /api/staff ───────────────────────────────────────────────────────────
// List all staff members (Owner only)
router.get('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await ensureSchema();
    try {
      const [rows] = await db.query(
        `SELECT id, email, COALESCE(full_name, name) AS full_name, phone, role,
                COALESCE(assigned_area,'shop') AS assigned_area,
                COALESCE(monthly_salary, 30000) AS monthly_salary,
                is_active, created_at
         FROM users
         WHERE role = 'staff'
         ORDER BY created_at DESC`
      );
      if (rows && rows.length >= 0) {
        return res.json(rows);
      }
    } catch (dbErr) {
      console.warn('[STAFF] DB query failed, using fallback list:', dbErr.message);
    }
    res.json(IN_MEMORY_STAFF);
  } catch (err) { next(err); }
});

// ── POST /api/staff ──────────────────────────────────────────────────────────
// Add a new staff member (Owner only)
router.post('/', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await ensureSchema();
    const { email, password, full_name, phone, assigned_area } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    const assigned = assigned_area || 'shop';
    const cleanEmail = email.trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      // Check existing email
      const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'A user with this email address already exists.' });
      }

      // Insert new staff member into users table
      const [result] = await db.query(
        `INSERT INTO users (full_name, email, password_hash, role, phone, assigned_area, is_active)
         VALUES (?, ?, ?, 'staff', ?, ?, 1)`,
        [full_name.trim(), cleanEmail, hashedPassword, phone ? phone.trim() : null, assigned]
      );

      const [rows] = await db.query(
        `SELECT id, email, COALESCE(full_name, name) AS full_name, phone, role,
                COALESCE(assigned_area,'shop') AS assigned_area, is_active, created_at
         FROM users WHERE id = ?`,
        [result.insertId]
      );
      return res.status(201).json(rows[0]);
    } catch (dbErr) {
      console.warn('[STAFF] DB insert failed, storing in memory:', dbErr.message);
      const newStaff = {
        id: Date.now(),
        email: cleanEmail,
        full_name: full_name.trim(),
        phone: phone ? phone.trim() : null,
        role: 'staff',
        assigned_area: assigned,
        is_active: 1,
        created_at: new Date().toISOString()
      };
      IN_MEMORY_STAFF.unshift(newStaff);
      return res.status(201).json(newStaff);
    }
  } catch (err) { next(err); }
});

// ── PUT /api/staff/:id ───────────────────────────────────────────────────────
// Update an existing staff member (Owner only)
router.put('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    await ensureSchema();
    const { email, full_name, phone, assigned_area, is_active, password, monthly_salary } = req.body;
    const staffId = req.params.id;

    try {
      if (password && password.length >= 6) {
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query(
          `UPDATE users SET
             email = COALESCE(?, email),
             full_name = COALESCE(?, full_name),
             phone = ?,
             assigned_area = COALESCE(?, assigned_area),
             is_active = COALESCE(?, is_active),
             monthly_salary = COALESCE(?, monthly_salary),
             password_hash = ?
           WHERE id = ? AND role = 'staff'`,
          [email ? email.trim().toLowerCase() : null, full_name ? full_name.trim() : null, phone ? phone.trim() : null, assigned_area || null, is_active != null ? is_active : null, monthly_salary != null ? monthly_salary : null, hashedPassword, staffId]
        );
      } else {
        await db.query(
          `UPDATE users SET
             email = COALESCE(?, email),
             full_name = COALESCE(?, full_name),
             phone = ?,
             assigned_area = COALESCE(?, assigned_area),
             is_active = COALESCE(?, is_active),
             monthly_salary = COALESCE(?, monthly_salary)
           WHERE id = ? AND role = 'staff'`,
          [email ? email.trim().toLowerCase() : null, full_name ? full_name.trim() : null, phone ? phone.trim() : null, assigned_area || null, is_active != null ? is_active : null, monthly_salary != null ? monthly_salary : null, staffId]
        );
      }

      const [rows] = await db.query(
        'SELECT id, email, full_name, phone, role, assigned_area, monthly_salary, is_active, created_at FROM users WHERE id = ?',
        [staffId]
      );
      if (rows.length) return res.json(rows[0]);
    } catch (dbErr) {
      console.warn('[STAFF] DB update failed, updating memory:', dbErr.message);
    }

    const idx = IN_MEMORY_STAFF.findIndex(s => String(s.id) === String(staffId));
    if (idx !== -1) {
      IN_MEMORY_STAFF[idx] = {
        ...IN_MEMORY_STAFF[idx],
        email: email || IN_MEMORY_STAFF[idx].email,
        full_name: full_name || IN_MEMORY_STAFF[idx].full_name,
        phone: phone !== undefined ? phone : IN_MEMORY_STAFF[idx].phone,
        assigned_area: assigned_area || IN_MEMORY_STAFF[idx].assigned_area,
        is_active: is_active != null ? is_active : IN_MEMORY_STAFF[idx].is_active
      };
      return res.json(IN_MEMORY_STAFF[idx]);
    }

    res.json({ success: true, message: 'Staff updated' });
  } catch (err) { next(err); }
});

// ── DELETE /api/staff/:id ────────────────────────────────────────────────────
// Soft-delete / deactivate staff member (Owner only)
router.delete('/:id', requireLogin, requireRole('owner'), async (req, res, next) => {
  try {
    const staffId = req.params.id;
    try {
      await db.query("UPDATE users SET is_active = 0 WHERE id = ? AND role = 'staff'", [staffId]);
    } catch (dbErr) {
      const idx = IN_MEMORY_STAFF.findIndex(s => String(s.id) === String(staffId));
      if (idx !== -1) IN_MEMORY_STAFF[idx].is_active = 0;
    }
    res.json({ message: 'Staff member deactivated successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
