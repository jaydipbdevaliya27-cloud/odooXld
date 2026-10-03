/**
 * @file server/server.js
 * @description Express Application Entry Point.
 * Sets up security middleware (Helmet, Rate Limiting), session authentication,
 * protected static routing, all API routers, background jobs, and error handling.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// ── Route modules ──────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const memberRoutes = require('./routes/members');
const courtRoutes = require('./routes/courts');
const bookingRoutes = require('./routes/bookings');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const planRoutes = require('./routes/plans');
const staffRoutes = require('./routes/staff');
const leadRoutes = require('./routes/leads');
const notificationRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');

const { protectStaticPages } = require('./middleware/auth');
const { startScheduler } = require('./services/expiryJob');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Production safety check
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'champions_secret_change_me')) {
  console.error('[FATAL] Cannot start in production with default SESSION_SECRET. Set a strong secret in .env.');
  process.exit(1);
}

// ── Security Middleware ─────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // Allows CDN resources (Bootstrap, Google Fonts, Chart.js, Unsplash)
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { error: 'Too many requests from this IP. Please try again later.', code: 'RATE_LIMITED' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.', code: 'LOGIN_RATE_LIMITED' }
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Search rate limit exceeded. Please slow down.', code: 'SEARCH_RATE_LIMITED' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/search', searchLimiter);

// ── Session Authentication ──────────────────────────────────────────────────
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'champions_club_secret_session_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    }
  })
);

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/courts', courtRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// ── Protected Static Pages ──────────────────────────────────────────────────
app.use(protectStaticPages);

// ── Serve Static Client Assets ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'client')));

// Public root fallback to landing page index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Fallback catch-all for unknown client paths
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'shared', 'login.html'));
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'An unexpected server error occurred.',
    code: err.code || 'SERVER_ERROR',
    fields: err.fields || undefined
  });
});

// ── Start Scheduler & Server ────────────────────────────────────────────────
startScheduler();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[OK] Champions Club running at http://localhost:${PORT}`);
  });
}

module.exports = app;
