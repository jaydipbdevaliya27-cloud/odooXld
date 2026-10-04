const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('../db');
const bookingService = require('../services/bookingService');
const { todayIST } = require('../utils/time');

async function insertDirectBookings() {
  console.log('Inserting rich direct bookings via bookingService.createBooking...');

  const today = todayIST(); // 2026-10-04
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const day2 = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  const day3 = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);

  const [members] = await db.query(`
    SELECT m.id AS member_id, m.user_id, m.member_code, u.full_name, u.email, u.phone
    FROM members m
    JOIN users u ON m.user_id = u.id
    WHERE m.status = 'active'
    LIMIT 6
  `);

  const bookingsToCreate = [
    // Today - Court 1 Tennis
    { court_id: 1, booking_date: today, start_time: '14:00', memberIdx: 0, source: 'member_portal' },
    { court_id: 1, booking_date: today, start_time: '16:00', memberIdx: 1, source: 'member_portal' },
    { court_id: 1, booking_date: today, start_time: '18:00', guest_name: 'Rohit Kulkarni', guest_phone: '9820011223', source: 'front_desk' },
    { court_id: 1, booking_date: today, start_time: '20:00', memberIdx: 2, source: 'member_portal' },

    // Today - Court 2 Tennis Clay
    { court_id: 2, booking_date: today, start_time: '08:00', memberIdx: 0, source: 'member_portal' },
    { court_id: 2, booking_date: today, start_time: '10:00', guest_name: 'Ananya Deshmukh', guest_phone: '9819922334', source: 'front_desk' },
    { court_id: 2, booking_date: today, start_time: '16:30', memberIdx: 1, source: 'member_portal' },
    { court_id: 2, booking_date: today, start_time: '19:00', memberIdx: 3 || 0, source: 'member_portal' },

    // Today - Pitch 1 Cricket
    { court_id: 3, booking_date: today, start_time: '07:00', guest_name: 'Mumbai Mavericks Club', guest_phone: '9870055443', source: 'front_desk' },
    { court_id: 3, booking_date: today, start_time: '09:00', memberIdx: 1, source: 'member_portal' },
    { court_id: 3, booking_date: today, start_time: '17:00', memberIdx: 2, source: 'member_portal' },
    { court_id: 3, booking_date: today, start_time: '19:00', guest_name: 'Super Strikers XI', guest_phone: '9822233344', source: 'front_desk' },

    // Today - Court 3 Badminton Pro
    { court_id: 4, booking_date: today, start_time: '08:30', memberIdx: 1, source: 'member_portal' },
    { court_id: 4, booking_date: today, start_time: '17:30', guest_name: 'Vikram Sengupta', guest_phone: '9833344455', source: 'front_desk' },
    { court_id: 4, booking_date: today, start_time: '19:30', memberIdx: 3 || 0, source: 'member_portal' },

    // Today - Court 4 Pickleball Arena
    { court_id: 5, booking_date: today, start_time: '07:00', memberIdx: 2 || 0, source: 'member_portal' },
    { court_id: 5, booking_date: today, start_time: '09:00', memberIdx: 0, source: 'member_portal' },
    { court_id: 5, booking_date: today, start_time: '16:00', guest_name: 'Deepak Chopra', guest_phone: '9844455566', source: 'front_desk' },
    { court_id: 5, booking_date: today, start_time: '18:30', memberIdx: 1, source: 'member_portal' },

    // Tomorrow - Court 1 Tennis
    { court_id: 1, booking_date: tomorrow, start_time: '07:00', memberIdx: 0, source: 'member_portal' },
    { court_id: 1, booking_date: tomorrow, start_time: '09:00', memberIdx: 1, source: 'member_portal' },
    { court_id: 1, booking_date: tomorrow, start_time: '17:00', guest_name: 'Sanjay Kapoor', guest_phone: '9855566677', source: 'front_desk' },

    // Tomorrow - Court 2 Tennis Clay
    { court_id: 2, booking_date: tomorrow, start_time: '08:00', memberIdx: 2 || 0, source: 'member_portal' },
    { court_id: 2, booking_date: tomorrow, start_time: '18:00', memberIdx: 0, source: 'member_portal' },

    // Tomorrow - Court 4 Pickleball
    { court_id: 5, booking_date: tomorrow, start_time: '07:30', memberIdx: 1, source: 'member_portal' },
    { court_id: 5, booking_date: tomorrow, start_time: '17:30', guest_name: 'Anita Roy', guest_phone: '9877788899', source: 'front_desk' },

    // Day 2 - Pitch 1 Cricket
    { court_id: 3, booking_date: day2, start_time: '06:30', guest_name: 'Champion Knights Cricket', guest_phone: '9866677788', source: 'front_desk' },
    { court_id: 3, booking_date: day2, start_time: '18:00', memberIdx: 0, source: 'member_portal' },

    // Day 3 - Court 3 Badminton
    { court_id: 4, booking_date: day3, start_time: '07:00', memberIdx: 1, source: 'member_portal' },
    { court_id: 4, booking_date: day3, start_time: '19:00', guest_name: 'Farhan Akhtar', guest_phone: '9811122233', source: 'front_desk' }
  ];

  let successCount = 0;

  for (const b of bookingsToCreate) {
    try {
      const m = (b.memberIdx !== undefined && members[b.memberIdx]) ? members[b.memberIdx] : null;

      const [existing] = await db.query(
        `SELECT id FROM bookings WHERE court_id = ? AND booking_date = ? AND start_time LIKE ? AND status != 'cancelled'`,
        [b.court_id, b.booking_date, `${b.start_time}%`]
      );
      if (existing.length) {
        continue;
      }

      await bookingService.createBooking({
        courtId: b.court_id,
        bookingDate: b.booking_date,
        startTime: b.start_time,
        memberId: m ? m.member_id : null,
        userId: m ? m.user_id : null,
        guestName: b.guest_name || null,
        guestPhone: b.guest_phone || null,
        bookedByUserId: 1,
        source: b.source || 'member_portal',
        paymentMethod: 'upi'
      });
      successCount++;
    } catch (e) {
      console.warn(`[Skip booking court ${b.court_id} on ${b.booking_date} at ${b.start_time}]:`, e.message);
    }
  }

  // Insert Maintenance Block for Court 1 on today
  const [existingBlocks] = await db.query(
    'SELECT id FROM court_blocks WHERE block_date = ? AND court_id = ?',
    [today, 1]
  );
  if (!existingBlocks.length) {
    await db.query(
      `INSERT INTO court_blocks (court_id, block_date, start_time, end_time, reason, created_by)
       VALUES (?, ?, '12:00:00', '13:30:00', 'Surface Re-coating and Net Calibration', 1)`,
      [1, today]
    );
    console.log('✅ Added maintenance block for Court 1');
  }

  console.log(`✅ Successfully added ${successCount} fresh court bookings directly into the database!`);
  process.exit(0);
}

insertDirectBookings().catch(err => {
  console.error('Error inserting bookings:', err);
  process.exit(1);
});
