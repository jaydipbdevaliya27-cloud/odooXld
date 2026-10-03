/**
 * @file server/scripts/test-landing.js
 * @description Verifies public landing page routing, member login, and existing dashboard access.
 */

const http = require('http');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function run() {
  console.log('====================================================');
  console.log('TESTING CHAMPIONS CLUB PUBLIC LANDING PAGE');
  console.log('====================================================\n');

  // Test 1: GET / (Root entry point)
  console.log('--- Test 1: GET http://localhost:3000/ ---');
  const resRoot = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET'
  });
  assert(resRoot.statusCode === 200, `Root / returned status 200 (got ${resRoot.statusCode})`);
  assert(!resRoot.headers.location, 'Root / does NOT redirect');
  assert(resRoot.body.includes('Elevate Your Game at Champions Club'), 'Root / serves landing page hero title');
  assert(resRoot.body.includes('Gold Tier'), 'Landing page contains Gold Tier');
  assert(resRoot.body.includes('Silver Tier'), 'Landing page contains Silver Tier');
  assert(resRoot.body.includes('Junior Tier'), 'Landing page contains Junior Tier');
  assert(resRoot.body.includes('Court A – Tennis'), 'Landing page contains Court A – Tennis');
  assert(resRoot.body.includes('Club Cafeteria & Lounge'), 'Landing page contains Cafeteria section');
  assert(resRoot.body.includes('Pro Gear & Sports Shop'), 'Landing page contains Pro Shop section');
  assert(resRoot.body.includes('/shared/login.html'), 'Landing page links to Member Login (/shared/login.html)');

  // Test 2: Assets
  console.log('\n--- Test 2: Landing Page Assets ---');
  const resCss = await makeRequest({ hostname: 'localhost', port: 3000, path: '/landing/landing.css', method: 'GET' });
  assert(resCss.statusCode === 200 && resCss.body.includes('.landing-hero'), 'landing.css is served with 200 OK');

  const resJs = await makeRequest({ hostname: 'localhost', port: 3000, path: '/landing/landing.js', method: 'GET' });
  assert(resJs.statusCode === 200 && resJs.body.includes('landingContactForm'), 'landing.js is served with 200 OK');

  // Test 3: Public Lead Inquiry via Landing Form
  console.log('\n--- Test 3: POST /api/leads (Public Landing Inquiry) ---');
  const leadPayload = JSON.stringify({
    name: 'Test Visitor',
    email: 'visitor@example.com',
    phone: '9876543210',
    interested_plan_id: 2,
    message: 'Interested in Gold membership and tennis court booking.'
  });
  const resLead = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/leads',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(leadPayload)
    }
  }, leadPayload);
  assert(resLead.statusCode === 201, `POST /api/leads returned 201 Created (got ${resLead.statusCode})`);
  assert(resLead.body.includes('Thank you!'), 'Lead submission received confirmation message');

  // Test 4: Member Login via /shared/login.html
  console.log('\n--- Test 4: Member Login Flow ---');
  const resLoginPage = await makeRequest({ hostname: 'localhost', port: 3000, path: '/shared/login.html', method: 'GET' });
  assert(resLoginPage.statusCode === 200, 'Login page /shared/login.html is directly accessible');

  const loginPayload = JSON.stringify({
    email: 'ravi@example.com',
    password: 'Member@123'
  });
  const resLogin = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload)
    }
  }, loginPayload);
  assert(resLogin.statusCode === 200, `Login returned 200 OK (got ${resLogin.statusCode})`);
  assert(resLogin.body.includes('"role":"member"'), 'Logged in user has role member');

  const cookieHeader = resLogin.headers['set-cookie'];
  assert(cookieHeader && cookieHeader.length > 0, 'Received session cookie on login');
  const sessionCookie = cookieHeader[0].split(';')[0];

  // Test 5: Member Dashboard, Membership, and Booking access
  console.log('\n--- Test 5: Authenticated Member Pages & APIs ---');
  const resMe = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/me',
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });
  assert(resMe.statusCode === 200 && resMe.body.includes('ravi@example.com'), 'Session authenticated as Ravi Member');

  const resMemberDash = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/member/dashboard.html',
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });
  assert(resMemberDash.statusCode === 200, 'Member dashboard /member/dashboard.html accessible with 200 OK');

  const resMemberPlans = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/member/membership.html',
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });
  assert(resMemberPlans.statusCode === 200, 'Membership page /member/membership.html accessible with 200 OK');

  const resMemberBook = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/member/book.html',
    method: 'GET',
    headers: { 'Cookie': sessionCookie }
  });
  assert(resMemberBook.statusCode === 200, 'Court booking page /member/book.html accessible with 200 OK');

  console.log('\n====================================================');
  console.log('ALL LANDING PAGE TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

run().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
