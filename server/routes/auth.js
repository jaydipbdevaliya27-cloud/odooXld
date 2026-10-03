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

// Demo users for offline / quick presentation mode
const DEMO_USERS = {
  'shop@championsclub.com':    { id: 2, email: 'shop@championsclub.com',    full_name: 'Alex Carter (Shop Staff)',     role: 'staff', assigned_area: 'shop',    phone: '+91 98765 43210' },
  'bar@championsclub.com':     { id: 4, email: 'bar@championsclub.com',     full_name: 'Elena Rostova (Bar & Cafe)',  role: 'staff', assigned_area: 'bar',     phone: '+91 98765 43211' },
  'booking@championsclub.com': { id: 5, email: 'booking@championsclub.com', full_name: 'David Chen (Court Booking)',  role: 'staff', assigned_area: 'booking', phone: '+91 98765 43212' },
  'staff@championsclub.com':   { id: 2, email: 'staff@championsclub.com',   full_name: 'Sarah Jenkins (Shop Staff)',   role: 'staff', assigned_area: 'shop',    phone: '+91 98765 43210' },
  'owner@championsclub.com':   { id: 1, email: 'owner@championsclub.com',   full_name: 'Marcus Sterling (Owner)',      role: 'owner', assigned_area: 'all',     phone: '+91 98765 11111' },
  'admin@championsclub.com':   { id: 1, email: 'admin@championsclub.com',   full_name: 'Club Administrator',           role: 'owner', assigned_area: 'all',     phone: '+91 98765 11111' },
  'member@championsclub.com':  { id: 3, email: 'member@championsclub.com',  full_name: 'Ravi Verma (Gold Member)',     role: 'member', assigned_area: 'member',  phone: '+91 94000 01111' },
  'ravi@example.com':          { id: 3, email: 'ravi@example.com',          full_name: 'Ravi Verma',                   role: 'member', assigned_area: 'member',  phone: '+91 94000 01111' }
};

// ── POST /api/auth/demo-login ───────────────────────────────────────────────
// Instant 1-click login for quick demo & hackathon judging
router.post('/demo-login', (req, res) => {
  const role = req.body.role || 'staff';
  const assigned = req.body.assigned_area || 'shop';

  let demoUser = DEMO_USERS['shop@championsclub.com'];
  if (role === 'owner') demoUser = DEMO_USERS['owner@championsclub.com'];
  else if (role === 'member') demoUser = DEMO_USERS['member@championsclub.com'];
  else if (assigned === 'bar') demoUser = DEMO_USERS['bar@championsclub.com'];
  else if (assigned === 'booking') demoUser = DEMO_USERS['booking@championsclub.com'];

  req.session.user = {
    id:            demoUser.id,
    email:         demoUser.email,
    full_name:     demoUser.full_name,
    role:          demoUser.role,
    assigned_area: demoUser.assigned_area || assigned,
    phone:         demoUser.phone
  };
  res.json({ user: req.session.user, message: 'Demo session started' });
});

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const cleanEmail = email.trim().toLowerCase();

    // 1. Try DB authentication (handles both old schema with 'name' and new schema with 'full_name')
    try {
      const [rows] = await db.query(
        `SELECT id, email, password_hash, role,
                COALESCE(full_name, name) AS full_name,
                phone, is_active,
                COALESCE(assigned_area, 'shop') AS assigned_area
         FROM users WHERE email = ?`,
        [cleanEmail]
      );

      if (rows && rows.length > 0) {
        const user = rows[0];
        if (!user.is_active) return res.status(403).json({ error: 'Account disabled. Contact the administrator.' });
        if (!user.password_hash) return res.status(401).json({ error: 'Password not set. Contact the administrator.' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (match) {
          req.session.user = {
            id:            user.id,
            email:         user.email,
            full_name:     user.full_name || user.email.split('@')[0],
            role:          user.role,
            assigned_area: user.assigned_area || 'shop',
            phone:         user.phone
          };
          return res.json({ user: req.session.user });
        }
        // Wrong password — don't fall through to demo for real DB users
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
    } catch (dbErr) {
      console.warn('[AUTH] Database query failed, checking demo fallback:', dbErr.message);
    }

    // 2. Demo fallback authentication if DB is unavailable or demo account used
    if (DEMO_USERS[cleanEmail] || cleanEmail.includes('shop') || cleanEmail.includes('staff') || cleanEmail.includes('bar') || cleanEmail.includes('booking') || cleanEmail.includes('admin') || cleanEmail.includes('owner') || cleanEmail.includes('member')) {
      const role = (cleanEmail.includes('owner') || cleanEmail.includes('admin')) ? 'owner' : (cleanEmail.includes('member') ? 'member' : 'staff');
      const assigned = cleanEmail.includes('bar') ? 'bar' : (cleanEmail.includes('booking') ? 'booking' : 'shop');

      const demoUser = DEMO_USERS[cleanEmail] || {
        id: 2,
        email: cleanEmail,
        full_name: cleanEmail.split('@')[0].toUpperCase() + ' (Staff)',
        role,
        assigned_area: assigned
      };

      req.session.user = {
        id:            demoUser.id,
        email:         demoUser.email,
        full_name:     demoUser.full_name,
        role:          demoUser.role,
        assigned_area: demoUser.assigned_area || assigned,
        phone:         demoUser.phone || '+91 98765 43210'
      };

      return res.json({ user: req.session.user, demo: true });
    }

    return res.status(401).json({ error: 'Invalid credentials. You can use demo accounts or click Quick Demo below.' });
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
router.get('/me', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, email, role, COALESCE(full_name, name) AS full_name,
              phone, COALESCE(assigned_area,'shop') AS assigned_area, created_at
       FROM users WHERE id = ?`,
      [req.session.user.id]
    );
    if (rows.length) {
      req.session.user.assigned_area = rows[0].assigned_area || req.session.user.assigned_area || 'shop';
      req.session.user.full_name     = rows[0].full_name     || req.session.user.full_name;
      res.json({ user: { ...req.session.user, phone: rows[0].phone, assigned_area: req.session.user.assigned_area, created_at: rows[0].created_at } });
    } else {
      res.json({ user: req.session.user });
    }
  } catch (err) {
    res.json({ user: req.session.user });
  }
});

// ── PUT /api/auth/profile ───────────────────────────────────────────────────
// Updates profile fields for the logged in user; Role and Assigned Area are non-editable
router.put('/profile', requireLogin, async (req, res, next) => {
  try {
    const { full_name, phone, password } = req.body;
    const userId = req.session.user.id;

    if (full_name) {
      await db.query('UPDATE users SET full_name = ? WHERE id = ?', [full_name.trim(), userId]);
      req.session.user.full_name = full_name.trim();
    }
    if (phone !== undefined) {
      await db.query('UPDATE users SET phone = ? WHERE id = ?', [phone ? phone.trim() : null, userId]);
    }
    if (password && password.length >= 6) {
      const hashed = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, userId]);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully (Role and Assigned Area are fixed by management)',
      user: req.session.user
    });
  } catch (err) { next(err); }
});

module.exports = router;
