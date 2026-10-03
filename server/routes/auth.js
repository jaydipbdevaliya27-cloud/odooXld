/**
 * @file server/routes/auth.js
 * @description Login, logout, and current-user routes.
 * POST /api/auth/login   – validates credentials, creates session
 * POST /api/auth/logout  – destroys session
 * GET  /api/auth/me      – returns session user (used by all pages on load)
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Fetch the user by email
    const [rows] = await db.query(
      'SELECT id, email, password_hash, role, full_name, is_active FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ error: 'Account disabled' });

    // Compare hashed password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Store minimal user info in session (never store password_hash)
    req.session.user = {
      id:        user.id,
      email:     user.email,
      full_name: user.full_name,
      role:      user.role
    };

    res.json({ user: req.session.user });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out' });
  });
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────
// Every page calls this on load to know who is logged in and what role they have
router.get('/me', requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

module.exports = router;
