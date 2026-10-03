/**
 * @file server/scripts/seed.js
 * @description Demo data seed script.
 * Run with: npm run seed
 * Creates:  1 owner, 1 staff, 3 members, 3 plans, 4 courts, 10 products, 5 leads
 * Safe to re-run: uses INSERT IGNORE / ON DUPLICATE KEY UPDATE where possible.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db     = require('../db');

// ── helpers ──────────────────────────────────────────────────────────────────
const HASH_ROUNDS = 10;
async function hash(pw) { return bcrypt.hash(pw, HASH_ROUNDS); }

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱  Seeding Champions Club database...\n');

  // ── 1. Plans ───────────────────────────────────────────────────────────────
  console.log('  → Plans');
  await db.query(`
    INSERT INTO plans (code, name, description, annual_fee, duration_months,
                       court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day)
    VALUES
      ('SILVER',   'Silver',   'Entry-level membership with basic benefits',         12000, 12, 10, 5,  5,  2),
      ('GOLD',     'Gold',     'Popular choice with great discounts',                 24000, 12, 20, 15, 15, 3),
      ('PLATINUM', 'Platinum', 'Premium all-inclusive membership for serious players',48000, 12, 30, 25, 25, 5)
    ON DUPLICATE KEY UPDATE name=VALUES(name)
  `);

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log('  → Users');
  const ownerHash  = await hash('Owner@123');
  const staffHash  = await hash('Staff@123');
  const memberHash = await hash('Member@123');

  // Owner
  await db.query(`
    INSERT INTO users (email, password_hash, role, full_name, phone)
    VALUES ('owner@champions.club', ?, 'owner', 'Alex Owner', '9000000001')
    ON DUPLICATE KEY UPDATE role='owner'
  `, [ownerHash]);

  // Staff
  await db.query(`
    INSERT INTO users (email, password_hash, role, full_name, phone)
    VALUES ('staff@champions.club', ?, 'staff', 'Sam Staff', '9000000002')
    ON DUPLICATE KEY UPDATE role='staff'
  `, [staffHash]);

  // 3 member users
  const memberData = [
    { email: 'ravi@example.com',    name: 'Ravi Kumar',    phone: '9111111111' },
    { email: 'priya@example.com',   name: 'Priya Sharma',  phone: '9222222222' },
    { email: 'carlos@example.com',  name: 'Carlos Silva',  phone: '9333333333' }
  ];
  for (const m of memberData) {
    await db.query(`
      INSERT INTO users (email, password_hash, role, full_name, phone)
      VALUES (?, ?, 'member', ?, ?)
      ON DUPLICATE KEY UPDATE full_name=VALUES(full_name)
    `, [m.email, memberHash, m.name, m.phone]);
  }

  // ── 3. Members ─────────────────────────────────────────────────────────────
  console.log('  → Members');
  const [plans] = await db.query('SELECT id, code FROM plans');
  const planMap  = Object.fromEntries(plans.map(p => [p.code, p.id]));

  const [users] = await db.query("SELECT id, email FROM users WHERE role='member'");
  const userMap  = Object.fromEntries(users.map(u => [u.email, u.id]));

  const now = new Date();
  const joinDateStr = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
  const expiryDateStr = new Date(now.getFullYear() + 1, now.getMonth() + 10, 1).toISOString().slice(0, 10);

  const memberRecords = [
    { email: 'ravi@example.com',   code: 'CC-001', plan: 'GOLD',     join: joinDateStr, expiry: expiryDateStr },
    { email: 'priya@example.com',  code: 'CC-002', plan: 'PLATINUM', join: joinDateStr, expiry: expiryDateStr },
    { email: 'carlos@example.com', code: 'CC-003', plan: 'SILVER',   join: joinDateStr, expiry: expiryDateStr }
  ];
  for (const r of memberRecords) {
    const uid = userMap[r.email];
    const pid = planMap[r.plan];
    if (!uid || !pid) { console.warn(`    ⚠  skipping ${r.email}`); continue; }
    await db.query(`
      INSERT INTO members (user_id, member_code, plan_id, join_date, expiry_date, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE plan_id=VALUES(plan_id), expiry_date=VALUES(expiry_date), status='active'
    `, [uid, r.code, pid, r.join, r.expiry]);
  }

  // ── 4. Courts ──────────────────────────────────────────────────────────────
  console.log('  → Courts');
  const courts = [
    { name: 'Court A – Tennis',   sport: 'tennis',    surface: 'Hard',     price: 600 },
    { name: 'Court B – Tennis',   sport: 'tennis',    surface: 'Clay',     price: 500 },
    { name: 'Cricket Net 1',      sport: 'cricket',   surface: 'Turf',     price: 800 },
    { name: 'Badminton Hall 1',   sport: 'badminton', surface: 'Synthetic',price: 400 }
  ];
  for (const c of courts) {
    await db.query(`
      INSERT INTO courts (name, sport, surface_type, base_price_per_hour)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE base_price_per_hour=VALUES(base_price_per_hour)
    `, [c.name, c.sport, c.surface, c.price]);
  }

  // ── 5. Products ────────────────────────────────────────────────────────────
  console.log('  → Products');
  const products = [
    // Shop
    { sku: 'RACK-001', name: 'Pro Tennis Racket',      dept: 'shop', cat: 'Rackets',   price: 4500, cost: 2800, stock: 12 },
    { sku: 'RACK-002', name: 'Beginner Badminton Set', dept: 'shop', cat: 'Rackets',   price: 1200, cost:  700, stock:  8 },
    { sku: 'BALL-001', name: 'Tennis Balls (3 Pack)',  dept: 'shop', cat: 'Balls',     price:  350, cost:  180, stock: 50 },
    { sku: 'BALL-002', name: 'Cricket Ball (Red)',     dept: 'shop', cat: 'Balls',     price:  450, cost:  250, stock: 30 },
    { sku: 'KIT-001',  name: 'Cricket Batting Pads',  dept: 'shop', cat: 'Kits',      price: 3200, cost: 1800, stock:  6 },
    { sku: 'GEAR-001', name: 'Sports Water Bottle',   dept: 'shop', cat: 'Accessories',price: 650, cost:  300, stock: 20 },
    // Bar
    { sku: 'DRK-001',  name: 'Electrolyte Drink',     dept: 'bar',  cat: 'Drinks',    price:  120, cost:   55, stock: 100 },
    { sku: 'DRK-002',  name: 'Fresh Lime Soda',       dept: 'bar',  cat: 'Drinks',    price:   80, cost:   30, stock:  80 },
    { sku: 'SNK-001',  name: 'Protein Bar',           dept: 'bar',  cat: 'Snacks',    price:  150, cost:   80, stock:  40 },
    { sku: 'SNK-002',  name: 'Veg Sandwich',          dept: 'bar',  cat: 'Food',      price:  200, cost:   90, stock:  25 }
  ];
  for (const p of products) {
    await db.query(`
      INSERT INTO products (sku, name, department, category, price, cost_price, stock_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE price=VALUES(price), stock_qty=VALUES(stock_qty)
    `, [p.sku, p.name, p.dept, p.cat, p.price, p.cost, p.stock]);
  }

  // ── 6. Leads ───────────────────────────────────────────────────────────────
  console.log('  → Leads');
  const [firstPlan] = await db.query('SELECT id FROM plans LIMIT 1');
  const pid = firstPlan[0]?.id || null;
  const leads = [
    { name: 'Anita Patel',   email: 'anita@mail.com',  phone: '9400001111', msg: 'Interested in tennis coaching too' },
    { name: 'Ben Carter',    email: 'ben@mail.com',     phone: '9400002222', msg: 'Saw your ad – want to join with family' },
    { name: 'Divya Nair',    email: 'divya@mail.com',   phone: '9400003333', msg: 'Looking for monthly plan options' },
    { name: 'Elan Musk',     email: 'elan@mail.com',    phone: '9400004444', msg: 'Cricket practice facility inquiry' },
    { name: 'Fatima Zahra',  email: 'fatima@mail.com',  phone: '9400005555', msg: 'Best plan for a student?' }
  ];
  for (const l of leads) {
    await db.query(
      'INSERT INTO leads (name, email, phone, interested_plan_id, message) VALUES (?,?,?,?,?)',
      [l.name, l.email, l.phone, pid, l.msg]
    ).catch(() => {}); // ignore duplicates on re-seed
  }

  console.log('\n✅  Seed complete!\n');
  console.log('   Login credentials:');
  console.log('   owner@champions.club  / Owner@123  (owner)');
  console.log('   staff@champions.club  / Staff@123  (staff)');
  console.log('   ravi@example.com      / Member@123 (member)');
  console.log('   priya@example.com     / Member@123 (member)');
  console.log('   carlos@example.com    / Member@123 (member)\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
