/**
 * @file server/routes/notifications.js
 * @description System Notifications & Alert Hub API.
 */

const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/notifications ──────────────────────────────────────────────────
router.get('/', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;

    const [rows] = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = ? OR role_target = ? OR role_target = 'all'
       ORDER BY created_at DESC
       LIMIT 50`,
      [user.id, user.role]
    );

    const [[{ unreadCount }]] = await db.query(
      `SELECT COUNT(*) AS unreadCount FROM notifications
       WHERE (user_id = ? OR role_target = ? OR role_target = 'all') AND is_read = 0`,
      [user.id, user.role]
    );

    res.json({
      notifications: rows,
      unreadCount: Number(unreadCount) || 0
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/notifications/:id/read ─────────────────────────────────────────
router.put('/:id/read', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    await db.query(
      `UPDATE notifications
       SET is_read = 1, read_at = NOW()
       WHERE id = ? AND (user_id = ? OR role_target = ? OR role_target = 'all')`,
      [req.params.id, user.id, user.role]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/notifications/mark-all-read ─────────────────────────────────────
router.put('/mark-all-read', requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    await db.query(
      `UPDATE notifications
       SET is_read = 1, read_at = NOW()
       WHERE (user_id = ? OR role_target = ? OR role_target = 'all') AND is_read = 0`,
      [user.id, user.role]
    );
    res.json({ ok: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
