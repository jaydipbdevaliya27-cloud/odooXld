/**
 * Test script verifying:
 * 1. Single slot booking: Exactly 1 booking, exactly 2 booking_slots, adjacent slots are 'unavailable' (not 'mine').
 * 2. Overlapping booking rejection.
 * 3. Daily quota enforcement (max 2 bookings/day).
 * 4. 14-day advance limit: today and today+14 are allowed; today+15 and Nov 20 are rejected.
 */

const { query } = require('../db');
const bookingService = require('../services/bookingService');
const config = require('../config');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function run() {
  console.log('====================================================');
  console.log('VERIFYING TARGETED FIXES');
  console.log('====================================================\n');

  // 1. Fetch test member and active court
  const [courts] = await query('SELECT id, name FROM courts WHERE is_active = 1 LIMIT 1');
  const [members] = await query('SELECT m.id, m.user_id, u.full_name FROM members m JOIN users u ON m.user_id = u.id LIMIT 1');
  assert(courts.length > 0 && members.length > 0, 'Found active court and member for testing');

  const courtId = courts[0].id;
  const memberId = members[0].id;
  const userId = members[0].user_id;

  // Choose a clean test date within window: today + 4 days
  const testDateObj = new Date();
  testDateObj.setDate(testDateObj.getDate() + 4);
  const tf = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const testDate = tf.format(testDateObj);

  // Clean any existing bookings on this court and test date
  await query('DELETE bs FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id WHERE b.court_id = ? AND b.booking_date = ?', [courtId, testDate]);
  await query('DELETE FROM bookings WHERE court_id = ? AND booking_date = ?', [courtId, testDate]);

  console.log(`\n--- TEST 1: Single 1-Hour Slot Booking (18:30) on date ${testDate} ---`);
  const initialAvail = await bookingService.getAvailability(testDate, null, userId);
  const slot1800Before = initialAvail.slots.find(s => s.startTime === '18:00');
  const slot1830Before = initialAvail.slots.find(s => s.startTime === '18:30');
  const slot1900Before = initialAvail.slots.find(s => s.startTime === '19:00');
  assert(slot1800Before.courts.find(c => c.courtId === courtId).status === 'available', '18:00 slot is initially available');
  assert(slot1830Before.courts.find(c => c.courtId === courtId).status === 'available', '18:30 slot is initially available');
  assert(slot1900Before.courts.find(c => c.courtId === courtId).status === 'available', '19:00 slot is initially available');

  // Book 18:30
  const booking = await bookingService.createBooking({
    courtId,
    bookingDate: testDate,
    startTime: '18:30',
    memberId,
    bookedByUserId: userId,
    paymentMethod: 'cash'
  });
  assert(booking && booking.id, `Created booking ID ${booking.id} (${booking.bookingCode})`);

  // Verify DB records
  const [bRows] = await query('SELECT * FROM bookings WHERE id = ?', [booking.id]);
  assert(bRows.length === 1, 'Exactly ONE booking header record created');

  const [bsRows] = await query('SELECT * FROM booking_slots WHERE booking_id = ? ORDER BY slot_start ASC', [booking.id]);
  assert(bsRows.length === 2, `Exactly TWO booking_slots created (found: ${bsRows.length})`);
  console.log(`   Slot 1: ${bsRows[0].slot_start} -> ${bsRows[0].slot_end}`);
  console.log(`   Slot 2: ${bsRows[1].slot_start} -> ${bsRows[1].slot_end}`);

  // Verify availability status after booking
  const availAfter = await bookingService.getAvailability(testDate, null, userId);
  const court1800 = availAfter.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const court1830 = availAfter.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);
  const court1900 = availAfter.slots.find(s => s.startTime === '19:00').courts.find(c => c.courtId === courtId);
  const court1700 = availAfter.slots.find(s => s.startTime === '17:00').courts.find(c => c.courtId === courtId);
  const court2000 = availAfter.slots.find(s => s.startTime === '20:00').courts.find(c => c.courtId === courtId);

  assert(court1830.status === 'mine', `Booked slot 18:30 has status 'mine' (bookingCode: ${court1830.bookingCode})`);
  assert(court1800.status === 'unavailable', `Previous overlapping slot 18:00 has status 'unavailable' (NOT 'mine')`);
  assert(court1900.status === 'unavailable', `Next overlapping slot 19:00 has status 'unavailable' (NOT 'mine')`);
  assert(court1700.status === 'available', `Independent slot 17:00 remains 'available'`);
  assert(court2000.status === 'available', `Independent slot 20:00 remains 'available'`);

  console.log('\n--- TEST 2: Overlapping Booking Rejection ---');
  let overlapRejected = false;
  try {
    await bookingService.createBooking({
      courtId,
      bookingDate: testDate,
      startTime: '19:00', // overlaps second half of 18:30
      memberId,
      bookedByUserId: userId,
      paymentMethod: 'cash'
    });
  } catch (err) {
    overlapRejected = true;
    assert(err.status === 409 || err.message.includes('slot was just taken'), `Overlapping booking rejected: ${err.message}`);
  }
  assert(overlapRejected, 'Overlapping booking successfully rejected with 409');

  console.log('\n--- TEST 3: Member Daily Quota Enforcement (Max 2/day) ---');
  // Second booking on the same date at 20:00 (should succeed)
  const booking2 = await bookingService.createBooking({
    courtId,
    bookingDate: testDate,
    startTime: '20:00',
    memberId,
    bookedByUserId: userId,
    paymentMethod: 'cash'
  });
  assert(booking2 && booking2.id, `Second booking on same day succeeded (bookingCode: ${booking2.bookingCode})`);

  // Third booking on the same date at 16:00 (should fail due to 2/day limit)
  let quotaRejected = false;
  try {
    await bookingService.createBooking({
      courtId,
      bookingDate: testDate,
      startTime: '16:00',
      memberId,
      bookedByUserId: userId,
      paymentMethod: 'cash'
    });
  } catch (err) {
    quotaRejected = true;
    assert(err.status === 400 && err.message.includes('limit'), `Daily limit rejection: ${err.message}`);
  }
  assert(quotaRejected, 'Third daily booking correctly rejected by member quota check');

  console.log('\n--- TEST 4: 14-Day Advance Booking Limit Validation ---');
  const todayStr = tf.format(new Date());
  
  // Calculate today + 14 and today + 15
  const d14 = new Date();
  d14.setDate(d14.getDate() + 14);
  const date14Str = tf.format(d14);

  const d15 = new Date();
  d15.setDate(d15.getDate() + 15);
  const date15Str = tf.format(d15);

  const dateFarFuture = '2026-11-20';
  const datePast = '2026-10-02';

  console.log(`Current Date:  ${todayStr}`);
  console.log(`Day 14 (Max):  ${date14Str}`);
  console.log(`Day 15 (Out):  ${date15Str}`);
  console.log(`Far Future:    ${dateFarFuture}`);

  // A. Check availability on today (allowed)
  const availToday = await bookingService.getAvailability(todayStr, null, userId);
  assert(availToday.slots.length > 0, `Availability allowed for today (${todayStr})`);

  // B. Check availability on today + 14 (allowed boundary)
  const avail14 = await bookingService.getAvailability(date14Str, null, userId);
  assert(avail14.slots.length > 0, `Availability allowed for day 14 inclusive (${date14Str})`);

  // C. Check availability on today + 15 (rejected)
  let avail15Rejected = false;
  try {
    await bookingService.getAvailability(date15Str, null, userId);
  } catch (err) {
    avail15Rejected = true;
    assert(err.status === 400 && err.message.includes('14 days in advance'), `Availability rejected for day 15 (${date15Str}): ${err.message}`);
  }
  assert(avail15Rejected, 'Availability correctly rejected for day 15');

  // D. Check availability on Nov 20 (rejected)
  let availFarRejected = false;
  try {
    await bookingService.getAvailability(dateFarFuture, null, userId);
  } catch (err) {
    availFarRejected = true;
    assert(err.status === 400 && err.message.includes('14 days in advance'), `Availability rejected for far future (${dateFarFuture}): ${err.message}`);
  }
  assert(availFarRejected, 'Availability correctly rejected for Nov 20');

  // E. Create booking on day 14 (allowed)
  // Clean court on date14Str
  await query('DELETE bs FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id WHERE b.court_id = ? AND b.booking_date = ?', [courtId, date14Str]);
  await query('DELETE FROM bookings WHERE court_id = ? AND booking_date = ?', [courtId, date14Str]);

  const bookingDay14 = await bookingService.createBooking({
    courtId,
    bookingDate: date14Str,
    startTime: '11:00',
    memberId,
    bookedByUserId: userId,
    paymentMethod: 'cash'
  });
  assert(bookingDay14 && bookingDay14.id, `Booking allowed on day 14 (${date14Str})`);

  // F. Create booking on day 15 (rejected)
  let book15Rejected = false;
  try {
    await bookingService.createBooking({
      courtId,
      bookingDate: date15Str,
      startTime: '11:00',
      memberId,
      bookedByUserId: userId,
      paymentMethod: 'cash'
    });
  } catch (err) {
    book15Rejected = true;
    assert(err.status === 400 && err.message.includes('14 days in advance'), `Booking rejected for day 15 (${date15Str}): ${err.message}`);
  }
  assert(book15Rejected, 'Booking creation rejected for day 15');

  // G. Create booking on Nov 20 (rejected)
  let bookFarRejected = false;
  try {
    await bookingService.createBooking({
      courtId,
      bookingDate: dateFarFuture,
      startTime: '11:00',
      memberId,
      bookedByUserId: userId,
      paymentMethod: 'cash'
    });
  } catch (err) {
    bookFarRejected = true;
    assert(err.status === 400 && err.message.includes('14 days in advance'), `Booking rejected for Nov 20 (${dateFarFuture}): ${err.message}`);
  }
  assert(bookFarRejected, 'Booking creation rejected for Nov 20');

  console.log('\n--- TEST 5: Same-Day Past Slots Disabled (Time Boundaries & Backend Safety) ---');

  // Clean court bookings on today and tomorrow for testing clean slots
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const dateTomorrow = tf.format(dTomorrow);

  const dYesterday = new Date();
  dYesterday.setDate(dYesterday.getDate() - 1);
  const dateYesterday = tf.format(dYesterday);

  await query('DELETE bs FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id WHERE b.court_id = ? AND b.booking_date IN (?, ?)', [courtId, todayStr, dateTomorrow]);
  await query('DELETE FROM bookings WHERE court_id = ? AND booking_date IN (?, ?)', [courtId, todayStr, dateTomorrow]);

  // A. Mock current time = 18:00 today
  console.log('\n  Case A: Mock current time = 18:00 today');
  const availAt1800 = await bookingService.getAvailability(todayStr, null, userId, '18:00');
  const slot1700_1800 = availAt1800.slots.find(s => s.startTime === '17:00').courts.find(c => c.courtId === courtId);
  const slot1730_1800 = availAt1800.slots.find(s => s.startTime === '17:30').courts.find(c => c.courtId === courtId);
  const slot1800_1800 = availAt1800.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const slot1830_1800 = availAt1800.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);
  const slot1900_1800 = availAt1800.slots.find(s => s.startTime === '19:00').courts.find(c => c.courtId === courtId);

  assert(slot1700_1800.status === 'past', `At 18:00: 17:00 slot is disabled (status: '${slot1700_1800.status}')`);
  assert(slot1730_1800.status === 'past', `At 18:00: 17:30 slot is disabled (status: '${slot1730_1800.status}')`);
  assert(slot1800_1800.status === 'available', `At 18:00: 18:00 slot is available (status: '${slot1800_1800.status}')`);
  assert(slot1830_1800.status === 'available', `At 18:00: 18:30 slot is available (status: '${slot1830_1800.status}')`);
  assert(slot1900_1800.status === 'available', `At 18:00: 19:00 slot is available (status: '${slot1900_1800.status}')`);

  // B. Mock current time = 18:01 today
  console.log('\n  Case B: Mock current time = 18:01 today');
  const availAt1801 = await bookingService.getAvailability(todayStr, null, userId, '18:01');
  const slot1800_1801 = availAt1801.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const slot1830_1801 = availAt1801.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);
  const slot1900_1801 = availAt1801.slots.find(s => s.startTime === '19:00').courts.find(c => c.courtId === courtId);

  assert(slot1800_1801.status === 'past', `At 18:01: 18:00 slot is now disabled (status: '${slot1800_1801.status}')`);
  assert(slot1830_1801.status === 'available', `At 18:01: 18:30 slot remains available (status: '${slot1830_1801.status}')`);
  assert(slot1900_1801.status === 'available', `At 18:01: 19:00 slot remains available (status: '${slot1900_1801.status}')`);

  // C. Mock current time = 18:29 today
  console.log('\n  Case C: Mock current time = 18:29 today');
  const availAt1829 = await bookingService.getAvailability(todayStr, null, userId, '18:29');
  const slot1800_1829 = availAt1829.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const slot1830_1829 = availAt1829.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);

  assert(slot1800_1829.status === 'past', `At 18:29: 18:00 slot is disabled (status: '${slot1800_1829.status}')`);
  assert(slot1830_1829.status === 'available', `At 18:29: 18:30 slot remains available (status: '${slot1830_1829.status}')`);

  // D. Mock current time = 18:30 today
  console.log('\n  Case D: Mock current time = 18:30 today');
  const availAt1830 = await bookingService.getAvailability(todayStr, null, userId, '18:30');
  const slot1800_1830 = availAt1830.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const slot1830_1830 = availAt1830.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);

  assert(slot1800_1830.status === 'past', `At 18:30: 18:00 slot is disabled (status: '${slot1800_1830.status}')`);
  assert(slot1830_1830.status === 'available', `At 18:30: 18:30 slot is available (status: '${slot1830_1830.status}')`);

  // E. Future date: Tomorrow (normal availability, time-of-day check does NOT apply)
  console.log('\n  Case E: Tomorrow date');
  const availTomorrow = await bookingService.getAvailability(dateTomorrow, null, userId, '18:00');
  const tmrw1000 = availTomorrow.slots.find(s => s.startTime === '10:00').courts.find(c => c.courtId === courtId);
  const tmrw1800 = availTomorrow.slots.find(s => s.startTime === '18:00').courts.find(c => c.courtId === courtId);
  const tmrw1830 = availTomorrow.slots.find(s => s.startTime === '18:30').courts.find(c => c.courtId === courtId);

  assert(tmrw1000.status === 'available', `Tomorrow 10:00 is available (not affected by current time 18:00)`);
  assert(tmrw1800.status === 'available', `Tomorrow 18:00 is available`);
  assert(tmrw1830.status === 'available', `Tomorrow 18:30 is available`);

  // F. Past date: Yesterday (entire date rejected)
  console.log('\n  Case F: Yesterday date');
  let yestRejected = false;
  try {
    await bookingService.getAvailability(dateYesterday, null, userId);
  } catch (err) {
    yestRejected = true;
    assert(err.status === 400 && err.message.includes('past dates'), `Yesterday availability rejected: ${err.message}`);
  }
  assert(yestRejected, 'Past date (yesterday) correctly rejected');

  // G. Backend safety: Direct POST booking attempt for same-day past slot
  console.log('\n  Case G: Backend safety on direct POST request');
  let postPastRejected = false;
  try {
    await bookingService.createBooking({
      courtId,
      bookingDate: todayStr,
      startTime: '18:00',
      currentTimeOverride: '18:05', // current time is 18:05
      memberId,
      bookedByUserId: userId,
      paymentMethod: 'cash'
    });
  } catch (err) {
    postPastRejected = true;
    assert(err.status === 400 && err.message.includes('already started'), `Direct booking for past slot rejected: ${err.message}`);
  }
  assert(postPastRejected, 'Direct booking request for past same-day slot blocked by backend with 400');

  // H. Backend safety: Valid same-day slot at 18:30 succeeds when current time is 18:05
  const validSameDay = await bookingService.createBooking({
    courtId,
    bookingDate: todayStr,
    startTime: '18:30',
    currentTimeOverride: '18:05',
    memberId,
    bookedByUserId: userId,
    paymentMethod: 'cash'
  });
  assert(validSameDay && validSameDay.id, `Valid same-day slot 18:30 succeeded at 18:05 (bookingCode: ${validSameDay.bookingCode})`);

  // I. Backend safety: Tomorrow morning slot succeeds even when current time is 18:05
  const validTomorrowMorning = await bookingService.createBooking({
    courtId,
    bookingDate: dateTomorrow,
    startTime: '09:00',
    currentTimeOverride: '18:05',
    memberId,
    bookedByUserId: userId,
    paymentMethod: 'cash'
  });
  assert(validTomorrowMorning && validTomorrowMorning.id, `Tomorrow 09:00 booking succeeded (bookingCode: ${validTomorrowMorning.bookingCode})`);

  console.log('\n====================================================');
  console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
  console.log('====================================================');

  process.exit(0);
}

run().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
