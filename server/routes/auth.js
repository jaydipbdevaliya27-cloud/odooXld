/**
 * @file server/routes/auth.js
 * @description Secure Authentication & Session Management.
 * Strictly verifies credentials against the users table using bcrypt.
 * No fallbacks or unauthorized bypasses.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post(
  '/login',
  validate({
    email: { required: true, type: 'email', label: 'Email address' },
    password: { required: true, minLength: 1, label: 'Password' }
  }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const cleanEmail = email.trim().toLowerCase();

      const [rows] = await db.query(
        `SELECT id, email, password_hash, role, full_name, phone, assigned_area, must_change_password, is_active
         FROM users WHERE email = ?`,
        [cleanEmail]
      );

      if (!rows || rows.length === 0) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS'
        });
      }

      const user = rows[0];

      if (!user.is_active) {
        return res.status(403).json({
          error: 'Your account is deactivated. Please contact club administration.',
          code: 'ACCOUNT_DEACTIVATED'
        });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Check if user is a member, get member details if available
      let memberInfo = null;
      if (user.role === 'member') {
        const [mRows] = await db.query(
          `SELECT m.id AS member_id, m.member_code, m.status, m.expiry_date, p.name AS plan_name
           FROM members m
           JOIN plans p ON m.plan_id = p.id
           WHERE m.user_id = ?`,
          [user.id]
        );
        if (mRows.length > 0) {
          memberInfo = mRows[0];
        }
      }

      // Establish session
      req.session.user = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        assigned_area: user.assigned_area || 'general',
        phone: user.phone,
        must_change_password: !!user.must_change_password,
        member_id: memberInfo ? memberInfo.member_id : null,
        member_code: memberInfo ? memberInfo.member_code : null
      };

      res.json({
        ok: true,
        user: req.session.user,
        message: 'Logged in successfully'
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      error: 'Not authenticated',
      code: 'UNAUTHORIZED'
    });
  }
  res.json({ user: req.session.user });
});

// ── POST /api/auth/change-password ──────────────────────────────────────────
router.post(
  '/change-password',
  requireLogin,
  validate({
    current_password: { required: true, minLength: 1, label: 'Current Password' },
    new_password: {
      required: true,
      minLength: 8,
      label: 'New Password',
      pattern: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/,
      message: 'New password must be at least 8 characters with at least one letter and one number.'
    }
  }),
  async (req, res, next) => {
    try {
      const { current_password, new_password } = req.body;
      const userId = req.session.user.id;

      const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
      if (!rows.length) return res.status(404).json({ error: 'User not found' });

      const isMatch = await bcrypt.compare(current_password, rows[0].password_hash);
      if (!isMatch) {
        return res.status(400).json({
          error: 'Current password is incorrect.',
          code: 'INCORRECT_CURRENT_PASSWORD'
        });
      }

      const newHash = await bcrypt.hash(new_password, 10);
      await db.query(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [newHash, userId]
      );

      req.session.user.must_change_password = false;
      res.json({ ok: true, message: 'Password updated successfully' });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out. Please try again.' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true, message: 'Logged out successfully' });
  });
});

module.exports = router;
