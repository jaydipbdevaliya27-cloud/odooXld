/**
 * @file server/server.js
 * @description Express application entry point.
 * Mounts middleware, all route modules, and serves the static client files.
 */

require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const path     = require('path');

// ── Route modules ──────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const memberRoutes   = require('./routes/members');
const courtRoutes    = require('./routes/courts');
const bookingRoutes  = require('./routes/bookings');
const productRoutes  = require('./routes/products');
const orderRoutes    = require('./routes/orders');
const paymentRoutes  = require('./routes/payments');
const leadRoutes     = require('./routes/leads');
const reportRoutes   = require('./routes/reports');
const planRoutes     = require('./routes/plans');
const staffRoutes    = require('./routes/staff');
const payrollRoutes  = require('./routes/payroll');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Core middleware ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'champions_secret_change_me',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000   // 8 hours
  }
}));

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/staff',    staffRoutes);
app.use('/api/members',  memberRoutes);
app.use('/api/courts',   courtRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/leads',    leadRoutes);
app.use('/api/reports',  reportRoutes);
app.use('/api/plans',    planRoutes);
app.use('/api/payroll',  payrollRoutes);

// ── Static files (HTML/CSS/JS pages) ───────────────────────────────────────
// Serve the client/ folder at the web root
app.use(express.static(path.join(__dirname, '..', 'client')));

// SPA-style catch-all: for any unknown GET, serve the login page
// (deep links are handled by each page's own JS)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'shared', 'login.html'));
});

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Champions Club running at http://localhost:${PORT}`);
});
