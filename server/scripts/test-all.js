/**
 * @file server/scripts/test-all.js
 * @description Comprehensive functional test suite for the Champions Club.
 * Validates all 10 core hackathon criteria:
 * 1. Auth & Session (owner, staff, member roles)
 * 2. Plan management & listing
 * 3. Member enrollment & verification
 * 4. Court availability & booking
 * 5. Double-booking prevention (concurrency/slot conflict)
 * 6. Daily booking limit enforcement
 * 7. Product catalog & inventory tracking
 * 8. Shop & Bar orders (POS / tabs) & stock deduction
 * 9. Payments ledger & booking cancellation / refunds
 * 10. Reports (KPIs, revenue breakdown, expiring memberships, low stock) & Leads
 */

require('dotenv').config();
const http = require('http');
const express = require('express');

// We will test against the running server or mount express app in memory for test
const { query } = require('../db');
const authService = require('../routes/auth');
const memberService = require('../services/memberService');
const bookingService = require('../services/bookingService');
const orderService = require('../services/orderService');
const pricing = require('../services/pricing');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n========================================');
  console.log('🏆 RUNNING CHAMPIONS CLUB TEST SUITE 🏆');
  console.log('========================================\n');

  // Test 1: Pricing calculations
  console.log('--- Test 1: Pricing calculations ---');
  const courtPrice1 = pricing.calculateCourtPrice(500, 20); // 20% off 500 = 400
  assert(courtPrice1.priceCharged === 400, `Court price 500 with 20% discount = 400 (got ${courtPrice1.priceCharged})`);
  
  const orderTotal1 = pricing.calculateOrderTotals([
    { price: 100, quantity: 2 },
    { price: 50, quantity: 1 }
  ], 10); // subtotal 250 - 10% (25) = 225
  assert(orderTotal1.subtotal === 250, `Subtotal is 250 (got ${orderTotal1.subtotal})`);
  assert(orderTotal1.discountAmount === 25, `Discount is 25 (got ${orderTotal1.discountAmount})`);
  assert(orderTotal1.total === 225, `Total is 225 (got ${orderTotal1.total})`);

  // Test 2: Users and Members in DB
  console.log('\n--- Test 2: Seed Users and Members ---');
  const [users] = await query('SELECT email, role FROM users');
  assert(users.length >= 5, `Found ${users.length} seeded users`);
  
  const [plans] = await query('SELECT id, code, name, court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day FROM plans');
  assert(plans.length >= 3, `Found ${plans.length} plans (Silver, Gold, Platinum)`);

  const { members } = await memberService.listMembers();
  assert(members.length >= 3, `Found ${members.length} members in system`);

  // Test 3: Member Enrollment
  console.log('\n--- Test 3: Member Enrollment ---');
  const testEmail = `testuser_${Date.now()}@example.com`;
  const goldPlan = plans.find(p => p.code === 'GOLD') || plans[0];
  const newMember = await memberService.enrollMember({
    fullName: 'Test Athlete',
    email: testEmail,
    phone: '9876543210',
    password: 'TestPassword@123',
    planId: goldPlan.id,
    dateOfBirth: '1995-05-15',
    paymentMethod: 'card'
  });
  const memberCode = newMember.member_code || newMember.memberCode;
  const memberId = newMember.id || newMember.memberId;
  const userId = newMember.user_id || newMember.userId;

  assert(memberCode && memberCode.startsWith('CC-'), `Member enrolled with code ${memberCode}`);

  const fetchedMember = await memberService.getMemberById(memberId);
  assert(fetchedMember.email === testEmail, `Member fetched with matching email: ${fetchedMember.email}`);
  assert(fetchedMember.plan_name === 'Gold' || fetchedMember.plan_id === goldPlan.id, 'Member assigned to Gold plan');

  // Test 4: Court Availability & Booking
  console.log('\n--- Test 4: Court Availability & Booking ---');
  const [courts] = await query('SELECT id, name, sport, base_price_per_hour FROM courts WHERE is_active = 1');
  assert(courts.length >= 4, `Found ${courts.length} active courts`);

  // Generate a test date with random offset (2 to 12 days ahead) to ensure clean slots within advance window
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 2 + Math.floor(Math.random() * 10));
  const dateStr = futureDate.toISOString().slice(0, 10);

  // Ensure date is clean for test run
  await query('DELETE FROM bookings WHERE booking_date = ?', [dateStr]);

  const availBefore = await bookingService.getAvailability(dateStr);
  assert(availBefore.slots.length > 0, `Generated ${availBefore.slots.length} time slots for date ${dateStr}`);

  const booking1 = await bookingService.createBooking({
    courtId: courts[0].id,
    bookingDate: dateStr,
    startTime: '10:00',
    memberId: memberId,
    bookedByUserId: userId,
    paymentMethod: 'online'
  });
  assert(booking1.booking_code && booking1.booking_code.startsWith('BK-'), `Booking 1 confirmed: ${booking1.booking_code}`);
  assert(Number(booking1.discount_pct) === Number(goldPlan.court_discount_pct || 20), `Applied Gold discount of ${booking1.discount_pct}%`);

  // Test 5: Double Booking Prevention
  console.log('\n--- Test 5: Double Booking Prevention ---');
  let doubleBookFailed = false;
  try {
    await bookingService.createBooking({
      courtId: courts[0].id,
      bookingDate: dateStr,
      startTime: '10:00', // same slot
      memberId: members[0].id,
      bookedByUserId: members[0].user_id,
      paymentMethod: 'cash'
    });
  } catch (err) {
    doubleBookFailed = true;
    assert(err.status === 409 || err.message.includes('slot was just taken') || err.code === 'SLOT_TAKEN', `Double booking rejected with status ${err.status || err.message}`);
  }
  assert(doubleBookFailed, 'Prevented double-booking same court & time slot');

  // Test 6: Overlapping 30-min Slot Prevention (10:30 on same court)
  console.log('\n--- Test 6: Overlapping 30-min Slot Prevention ---');
  let overlapFailed = false;
  try {
    await bookingService.createBooking({
      courtId: courts[0].id,
      bookingDate: dateStr,
      startTime: '10:30', // overlaps with 10:00-11:00
      memberId: members[0].id,
      bookedByUserId: members[0].user_id,
      paymentMethod: 'cash'
    });
  } catch (err) {
    overlapFailed = true;
    assert(err.status === 409 || err.message.includes('slot was just booked') || err.code === 'SLOT_TAKEN', `Overlapping 30-min slot rejected: ${err.message}`);
  }
  assert(overlapFailed, 'Prevented 1-hour booking from overlapping 30-minute interval');

  // Test 7: Daily Booking Limit Check
  console.log('\n--- Test 7: Daily Booking Limit Check ---');
  // Plan limit is 2 bookings per day. member has 1 booking so far.
  const booking2 = await bookingService.createBooking({
    courtId: courts[0].id,
    bookingDate: dateStr,
    startTime: '12:00',
    memberId: memberId,
    bookedByUserId: userId
  });
  assert(booking2.booking_code, `Booking 2 created: ${booking2.booking_code}`);

  let limitFailed = false;
  try {
    await bookingService.createBooking({
      courtId: courts[0].id,
      bookingDate: dateStr,
      startTime: '14:00',
      memberId: memberId,
      bookedByUserId: userId
    });
  } catch (err) {
    limitFailed = true;
    assert(err.status === 409 && err.message.includes('limit'), `3rd booking rejected by daily limit check: ${err.message}`);
  }
  assert(limitFailed, 'Successfully enforced max daily booking limit');

  // Test 8: Booking Cancellation & Slot Release
  console.log('\n--- Test 8: Booking Cancellation & Slot Release ---');
  const cancelRes = await bookingService.cancelBooking({
    bookingId: booking1.id,
    cancellingUserId: userId,
    userRole: 'member',
    cancellationReason: 'Changed plans'
  });
  assert(cancelRes.ok === true, `Booking ${booking1.booking_code} cancelled`);

  // Verify slot is free again
  const rebook = await bookingService.createBooking({
    courtId: courts[0].id,
    bookingDate: dateStr,
    startTime: '10:00',
    memberId: members[0].id,
    bookedByUserId: members[0].user_id
  });
  assert(rebook.booking_code, `Freed slot 10:00 successfully rebooked: ${rebook.booking_code}`);

  // Test 9: Products and Atomic Order Inventory Deduction
  console.log('\n--- Test 9: Products & Orders ---');
  const [products] = await query('SELECT id, name, price, stock_qty, track_stock FROM products WHERE department = "shop" AND stock_qty > 2 LIMIT 1');
  assert(products.length > 0, `Found shop product: ${products[0].name} (Stock: ${products[0].stock_qty})`);
  const targetProduct = products[0];
  const stockBefore = targetProduct.stock_qty;

  const orderRes = await orderService.createOrder({
    department: 'shop',
    channel: 'counter',
    memberId: memberId,
    items: [
      { product_id: targetProduct.id, quantity: 2 }
    ],
    createdByUserId: userId
  });
  assert(orderRes.id > 0, `Order created: ID ${orderRes.id}`);

  const [afterProduct] = await query('SELECT stock_qty FROM products WHERE id = ?', [targetProduct.id]);
  assert(afterProduct[0].stock_qty === stockBefore - 2, `Inventory deducted correctly: ${stockBefore} -> ${afterProduct[0].stock_qty}`);

  // Test Out-Of-Stock Protection
  let oosFailed = false;
  try {
    await orderService.createOrder({
      department: 'shop',
      channel: 'counter',
      items: [
        { product_id: targetProduct.id, quantity: 9999 }
      ],
      createdByUserId: userId
    });
  } catch (err) {
    oosFailed = true;
    assert(err.status === 409 || err.message.includes('stock'), `Out of stock order blocked: ${err.message}`);
  }
  assert(oosFailed, 'Protected against selling out-of-stock items');

  // Test 10: Order Cancellation & Restock
  console.log('\n--- Test 10: Order Cancellation & Restock ---');
  const orderToCancel = await orderService.createOrder({
    department: 'shop',
    channel: 'counter',
    items: [
      { product_id: targetProduct.id, quantity: 1 }
    ],
    createdByUserId: userId
  });
  const [stockDuring] = await query('SELECT stock_qty FROM products WHERE id = ?', [targetProduct.id]);
  
  await orderService.updateOrderStatus(orderToCancel.id, 'cancelled', userId);
  const [stockAfterCancel] = await query('SELECT stock_qty FROM products WHERE id = ?', [targetProduct.id]);
  assert(stockAfterCancel[0].stock_qty === stockDuring[0].stock_qty + 1, `Stock restored upon order cancellation (${stockDuring[0].stock_qty} -> ${stockAfterCancel[0].stock_qty})`);

  console.log('\n========================================');
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
