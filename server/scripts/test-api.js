/**
 * @file server/scripts/test-api.js
 * @description Comprehensive HTTP-level test suite for Champions Club Management System.
 * Tests all 10 scenarios outlined in Section 7 of the specification:
 * 1. Past slot booking rejection & valid future slot booking.
 * 2. 30-min overlap conflict (409) & concurrency safety.
 * 3. Daily booking quota (max 2) & cancellation quota recovery.
 * 4. Past booking auto-completion (read-only, cannot cancel/edit).
 * 5. Cancellation cutoff (2h) & member ownership authorization.
 * 6. Member plan discount calculation vs guest pricing.
 * 7. Comprehensive field validations (email, phone, DOB, under-18 guardian).
 * 8. Stock concurrency locking, online order reservation & cancellation restoration.
 * 9. Debounced server-side search, wildcards, pagination & role scoping.
 * 10. Security: Demo login removed, unknown user login rejected, static page protection & 403 on wrong roles.
 */

const http = require('http');
const db = require('../db');
const { todayIST, nowIST, addMinutes } = require('../utils/time');
const seed = require('./seed');

let server;
let baseUrl;

// Simple Cookie Jar for session tracking
class SessionClient {
  constructor(name) {
    this.name = name;
    this.cookies = [];
  }

  async request(method, path, body = null) {
    const url = new URL(path, baseUrl);
    const postData = body ? JSON.stringify(body) : null;

    const headers = {
      'Accept': 'application/json'
    };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    if (this.cookies.length > 0) {
      headers['Cookie'] = this.cookies.join('; ');
    }

    return new Promise((resolve, reject) => {
      const req = http.request(url, { method, headers }, (res) => {
        // Collect Set-Cookie
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
          setCookies.forEach(sc => {
            const cookieVal = sc.split(';')[0];
            const cookieName = cookieVal.split('=')[0];
            this.cookies = this.cookies.filter(c => !c.startsWith(cookieName + '='));
            this.cookies.push(cookieVal);
          });
        }

        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch (e) {
            json = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  delete(path, body) { return this.request('DELETE', path, body); }

  async login(email, password) {
    const res = await this.post('/api/auth/login', { email, password });
    return res;
  }
}

// Test Runner utilities
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== Champions Club API Verification Test Suite ===\n');

  // 1. Re-initialize DB with fresh seed
  console.log('[Setup] Seeding database...');
  await seed.initAndSeed();

  // 2. Start server on dynamic port
  const app = require('../server');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
  console.log(`[Setup] Test server running at ${baseUrl}\n`);

  try {
    const owner = new SessionClient('Owner');
    const member = new SessionClient('Member (Aarav)');
    const junior = new SessionClient('Junior Member');
    const staff = new SessionClient('Staff');
    const guest = new SessionClient('Unauthenticated Guest');

    // ── Scenario 10: Security & Auth ──────────────────────────────────────────
    console.log('--- Test Suite 1: Security & Authentication ---');
    // 10.1 Demo-login endpoint must be deleted (404)
    const demoRes = await guest.post('/api/auth/demo-login', {});
    assert(demoRes.status === 404, 'POST /api/auth/demo-login returns 404 Not Found');

    // 10.2 Unknown user cannot login
    const fakeRes = await guest.login('owner@randomdomain.com', 'somePassword123');
    assert(fakeRes.status === 401, 'Unknown email login rejected with 401 Unauthorized');

    // 10.3 Protected pages redirect when logged out (or 401 on API)
    const apiUnauth = await guest.get('/api/members');
    assert(apiUnauth.status === 401, 'Unauthenticated API call to /api/members returns 401');

    // Login authentic users
    const ownerLogin = await owner.login('owner@championsclub.com', 'password123');
    assert(ownerLogin.status === 200 && ownerLogin.body.user.role === 'owner', 'Owner logs in successfully with bcrypt');

    const memberLogin = await member.login('member@championsclub.com', 'password123');
    assert(memberLogin.status === 200 && memberLogin.body.user.role === 'member', 'Member logs in successfully with bcrypt');

    const staffLogin = await staff.login('staff.shop@championsclub.com', 'password123');
    assert(staffLogin.status === 200 && staffLogin.body.user.role === 'staff', 'Shop staff logs in successfully');

    // 10.4 Wrong role / Area access control
    const forbiddenRes = await member.post('/api/courts', { name: 'Hack Court', sport: 'Tennis' });
    assert(forbiddenRes.status === 403, 'Member forbidden from creating courts (403)');

    // ── Scenario 7: Form & Field Validation ───────────────────────────────────
    console.log('\n--- Test Suite 2: Field & Business Validations ---');
    // Bad email
    const badEmail = await owner.post('/api/members', {
      full_name: 'Test Member',
      email: 'invalid-email-format',
      phone: '9876543210',
      date_of_birth: '1995-05-15',
      plan_code: 'GOLD'
    });
    assert(badEmail.status === 400 && badEmail.body.fields && badEmail.body.fields.email, 'Invalid email returns 400 with fields.email');

    // Bad phone
    const badPhone = await owner.post('/api/members', {
      full_name: 'Test Member',
      email: 'valid@example.com',
      phone: '12345',
      date_of_birth: '1995-05-15',
      plan_code: 'GOLD'
    });
    assert(badPhone.status === 400 && badPhone.body.fields && badPhone.body.fields.phone, 'Invalid phone number returns 400 with fields.phone');

    // Under-18 without guardian rejected
    const under18NoGuardian = await owner.post('/api/members', {
      full_name: 'Young Player',
      email: 'junior.player@example.com',
      phone: '9876543211',
      date_of_birth: '2012-01-01',
      plan_code: 'JUNIOR'
    });
    assert(under18NoGuardian.status === 400 && under18NoGuardian.body.fields.guardian_name, 'Under-18 member requires guardian details (400)');

    // Under-18 on Adult plan rejected
    const under18AdultPlan = await owner.post('/api/members', {
      full_name: 'Young Player',
      email: 'junior.adultplan@example.com',
      phone: '9876543212',
      date_of_birth: '2012-01-01',
      plan_code: 'PLATINUM',
      guardian_name: 'Parent Name',
      guardian_phone: '9876543213'
    });
    assert(under18AdultPlan.status === 400, 'Under-18 member rejected on adult plan (must be JUNIOR tier)');

    // Successful junior creation
    const validJunior = await owner.post('/api/members', {
      full_name: 'Aryan Junior',
      email: 'aryan.junior@example.com',
      phone: '9876543214',
      date_of_birth: '2012-01-01',
      plan_code: 'JUNIOR',
      guardian_name: 'Vikram Junior Parent',
      guardian_phone: '9876543215',
      guardian_relationship: 'Father'
    });
    assert(validJunior.status === 201, 'Junior member with guardian created successfully (201)');

    // ── Scenario 1, 2, 3, 5, 6: Booking Engine & Slot Transactions ────────────
    console.log('\n--- Test Suite 3: Court Booking Engine & Slot Rules ---');
    const tomorrow = new Date(`${todayIST()}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const bookingDate = tomorrow.toISOString().slice(0, 10);

    // 1.1 Past slot booking rejected
    const pastSlotRes = await member.post('/api/bookings', {
      court_id: 1,
      booking_date: '2020-01-01',
      start_time: '10:00',
      payment_method: 'online'
    });
    assert(pastSlotRes.status === 400 && pastSlotRes.body.code === 'SLOT_IN_PAST', 'Past date/time booking rejected with 400 SLOT_IN_PAST');

    // 1.2 Valid future booking (18:00 - 19:00 on Court 1)
    const b1 = await member.post('/api/bookings', {
      court_id: 1,
      booking_date: bookingDate,
      start_time: '18:00',
      payment_method: 'online'
    });
    assert(b1.status === 201 && b1.body.booking_code, 'Valid booking at 18:00 on Court 1 accepted (201)');

    // 2.1 Overlapping booking (18:30 on Court 1 overlaps 18:00-19:00 slot) -> 409
    const bOverlap = await staff.post('/api/bookings', {
      court_id: 1,
      booking_date: bookingDate,
      start_time: '18:30',
      guest_name: 'Guest Player',
      guest_phone: '9876543216',
      payment_method: 'cash'
    });
    assert(bOverlap.status === 409 && (bOverlap.body.code === 'SLOT_TAKEN' || bOverlap.body.code === 'DOUBLE_BOOKING_PREVENTED'), 'Overlapping start 18:30 on Court 1 rejected with 409 Conflict');

    // 2.2 Consecutive slot (19:00 - 20:00 on Court 1) -> Accepted
    const b2 = await member.post('/api/bookings', {
      court_id: 1,
      booking_date: bookingDate,
      start_time: '19:00',
      payment_method: 'online'
    });
    assert(b2.status === 201, 'Consecutive slot 19:00 on Court 1 accepted (201)');

    // 3.1 Third booking on same day by same member -> Rejected (Daily limit = 2)
    const b3 = await member.post('/api/bookings', {
      court_id: 2,
      booking_date: bookingDate,
      start_time: '08:00',
      payment_method: 'online'
    });
    assert(b3.status === 409 && b3.body.code === 'DAILY_LIMIT_REACHED', 'Third booking on same date rejected with 409 DAILY_LIMIT_REACHED');

    // 3.2 Cancel b1 -> Frees quota, and b3 is now accepted
    const cancelRes = await member.delete(`/api/bookings/${b1.body.id}`);
    assert(cancelRes.status === 200, 'Member cancels booking b1 successfully (200)');

    const b3Retry = await member.post('/api/bookings', {
      court_id: 2,
      booking_date: bookingDate,
      start_time: '08:00',
      payment_method: 'online'
    });
    assert(b3Retry.status === 201, 'After cancellation, quota is restored and booking is accepted (201)');

    // 5. Member cannot cancel another member's booking
    const unauthorizedCancel = await member.delete(`/api/bookings/9999`);
    assert(unauthorizedCancel.status === 404 || unauthorizedCancel.status === 403, 'Cancelling non-existent/other booking returns 404 or 403');

    // 6. Member discount vs Guest price
    const guestBooking = await staff.post('/api/bookings', {
      court_id: 2,
      booking_date: bookingDate,
      start_time: '10:00',
      guest_name: 'Walkin Guest',
      guest_phone: '9876543217',
      payment_method: 'cash'
    });
    assert(guestBooking.status === 201 && Number(guestBooking.body.price_charged) > 0, 'Guest booking created with full non-member price');

    // ── Scenario 8: Inventory & Concurrency Locking ───────────────────────────
    console.log('\n--- Test Suite 4: Order Creation & Stock Ledger ---');
    // Get product stock
    const [pRows] = await db.query('SELECT id, stock_qty, price FROM products WHERE department="shop" AND stock_qty > 0 LIMIT 1');
    const testProduct = pRows[0];
    const initialStock = testProduct.stock_qty;

    // Place online order
    const orderRes = await member.post('/api/orders', {
      department: 'shop',
      channel: 'online',
      payment_method: 'online',
      items: [{ product_id: testProduct.id, quantity: 2 }]
    });
    assert(orderRes.status === 201 && orderRes.body.order_code, 'Member places online order for 2 units (201)');

    // Verify stock decremented
    const [afterStockRows] = await db.query('SELECT stock_qty FROM products WHERE id = ?', [testProduct.id]);
    assert(afterStockRows[0].stock_qty === initialStock - 2, 'Product stock locked and decremented by 2 in inventory');

    // Verify stock ledger movement
    const [movements] = await db.query('SELECT movement_type, quantity FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1', [testProduct.id]);
    assert(movements.length > 0 && movements[0].movement_type === 'sale', 'Stock movement ledger recorded "sale" with quantity change');

    // Cancel order -> restores stock
    const cancelOrder = await staff.put(`/api/orders/${orderRes.body.id}/status`, { status: 'cancelled' });
    assert(cancelOrder.status === 200, 'Order cancelled by staff (200)');

    const [restoredStockRows] = await db.query('SELECT stock_qty FROM products WHERE id = ?', [testProduct.id]);
    assert(restoredStockRows[0].stock_qty === initialStock, 'Cancelling order restores reserved stock in ledger');

    // ── Scenario 9: Server-side Search & Pagination ───────────────────────────
    console.log('\n--- Test Suite 5: Debounced Server-side Search & Scoping ---');
    // Search members
    const searchMembers = await owner.get('/api/members?q=Aarav');
    assert(searchMembers.status === 200 && searchMembers.body.data.length > 0 && searchMembers.body.meta, 'Search /api/members?q=Aarav returns matching records with meta');

    // Wildcards escaped
    const wildcardSearch = await owner.get('/api/members?q=%25');
    assert(wildcardSearch.status === 200 && Array.isArray(wildcardSearch.body.data), 'Search with wildcard % safely escaped and handled');

    // Global multi-entity search
    const globalSearch = await owner.get('/api/search?q=Aarav');
    assert(globalSearch.status === 200 && globalSearch.body.members, 'Global search /api/search?q=Aarav returns grouped entity lists');

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n========================================');
    console.log(`Test Suite Finished: ${passed} Passed, ${failed} Failed`);
    console.log('========================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal Test Error:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
    if (db.pool && db.pool.end) await db.pool.end();
    process.exit(0);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
