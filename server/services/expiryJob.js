/**
 * @file server/services/expiryJob.js
 * @description Background cron job and startup tasks for membership auto-expiry,
 * expiry reminder notifications, and booking auto-completion.
 */

const cron = require('node-cron');
const db = require('../db');
const { todayIST } = require('../utils/time');
const { autoCompleteBookings } = require('./bookingService');

async function runDailyTasks() {
  console.log('[TASK] Running daily membership & booking maintenance tasks...');
  const today = todayIST();

  try {
    // 1. Mark expired memberships
    const [expRes] = await db.query(
      `UPDATE members
       SET status = 'expired'
       WHERE status = 'active' AND expiry_date < ?`,
      [today]
    );
    if (expRes.affectedRows > 0) {
      console.log(`[INFO] Auto-expired ${expRes.affectedRows} overdue membership(s).`);
    }

    // 2. Generate expiry reminder notifications for 14, 7, and 1 days
    for (const days of [14, 7, 1]) {
      const [membersExpiring] = await db.query(
        `SELECT m.id, m.member_code, m.expiry_date, u.id AS user_id, u.full_name
         FROM members m
         JOIN users u ON m.user_id = u.id
         WHERE m.status = 'active'
           AND m.expiry_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
        [days]
      );

      for (const m of membersExpiring) {
        // Check if notification already sent for this threshold
        const [existing] = await db.query(
          `SELECT id FROM notifications
           WHERE user_id = ? AND type = 'membership_expiring'
             AND DATE(created_at) = CURDATE()`,
          [m.user_id]
        );

        if (!existing.length) {
          await db.query(
            `INSERT INTO notifications (user_id, role_target, type, title, message, link)
             VALUES (?, 'member', 'membership_expiring', ?, ?, '/member/membership.html')`,
            [
              m.user_id,
              `Membership Renewal Notice (${days}d left)`,
              `Dear ${m.full_name}, your membership plan expires on ${m.expiry_date}. Please renew online to retain your discounts and court privileges.`
            ]
          );
        }
      }
    }

    // 3. Auto-complete past bookings
    await autoCompleteBookings();
    console.log('[OK] Daily maintenance tasks completed.');
  } catch (err) {
    console.error('[WARN] Error running daily tasks:', err.message);
  }
}

function startScheduler() {
  // Run once immediately on startup
  runDailyTasks();

  // Run every night at 00:05 IST
  cron.schedule('5 0 * * *', () => {
    runDailyTasks();
  }, {
    timezone: 'Asia/Kolkata'
  });

  // Run booking auto-completion every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    autoCompleteBookings();
  });
}

module.exports = {
  runDailyTasks,
  startScheduler
};
