/**
 * @file server/scripts/seed.js
 * @description Demo data seed script for Champions Club.
 * Run with: npm run seed
 * Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE.
 *
 * Creates:
 *   - 1 owner, 3 staff (shop / bar / booking desk), 3 members
 *   - Plans: Silver, Gold, Junior (replaces Platinum per spec)
 *   - 4 courts, 10 shop + 6 bar products
 *   - 5 demo leads
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db     = require('../db');

const HASH_ROUNDS = 10;
async function hash(pw) { return bcrypt.hash(pw, HASH_ROUNDS); }

// ── Helper: safe ALTER TABLE ADD COLUMN ─────────────────────────────────────
async function addColumnIfMissing(table, column, definition) {
  const [cols] = await db.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!cols[0].cnt) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  [schema] Added ${table}.${column}`);
  }
}

async function seed() {
  console.log('🌱  Seeding Champions Club database…\n');

  // ── 0. Ensure extra columns exist (idempotent migration) ─────────────────
  await addColumnIfMissing('users', 'monthly_salary', 'DECIMAL(10,2) NOT NULL DEFAULT 30000.00');
  await addColumnIfMissing('users', 'assigned_area',  "VARCHAR(50) NOT NULL DEFAULT 'shop'");

  // Ensure payroll table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      payroll_code   VARCHAR(50)   NOT NULL UNIQUE,
      staff_user_id  INT           NOT NULL,
      month_year     VARCHAR(20)   NOT NULL,
      base_salary    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      bonus          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      deductions     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      net_salary     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status         ENUM('pending','paid') NOT NULL DEFAULT 'pending',
      payment_method ENUM('bank_transfer','cash','upi','cheque') NOT NULL DEFAULT 'bank_transfer',
      paid_at        DATETIME      NULL,
      notes          VARCHAR(255)  NULL,
      created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_payroll_staff (staff_user_id),
      INDEX idx_payroll_month (month_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── 1. Plans (Silver / Gold / Junior) ─────────────────────────────────────
  console.log('  → Plans');
  await db.query(`
    INSERT INTO plans (code, name, description, annual_fee, duration_months,
                       court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day)
    VALUES
      ('SILVER', 'Silver', 'Entry-level membership with basic benefits',      12000, 12, 10, 5,  5,  2),
      ('GOLD',   'Gold',   'Popular choice with great discounts',             24000, 12, 20, 15, 15, 3),
      ('JUNIOR', 'Junior', 'Budget membership for students & young players',   6000, 12,  5, 5,  5,  1)
    ON DUPLICATE KEY UPDATE name=VALUES(name), description=VALUES(description),
      annual_fee=VALUES(annual_fee), court_discount_pct=VALUES(court_discount_pct),
      shop_discount_pct=VALUES(shop_discount_pct), bar_discount_pct=VALUES(bar_discount_pct),
      max_bookings_per_day=VALUES(max_bookings_per_day)
  `);

  // Remove old Platinum plan if it exists (rename to Junior)
  await db.query(`UPDATE plans SET name='Junior', code='JUNIOR' WHERE code='PLATINUM'`).catch(() => {});

  // ── 2. Users ───────────────────────────────────────────────────────────────
  console.log('  → Users');
  const ownerHash  = await hash('Owner@123');
  const staffHash  = await hash('Staff@123');
  const memberHash = await hash('Member@123');

  const usersToSeed = [
    // Owners
    { email: 'owner@champions.club',   hash: ownerHash,  role: 'owner',  name: 'Alex Owner',               phone: '9000000001', area: 'all',     salary: 0 },
    // Staff
    { email: 'staff@champions.club',   hash: staffHash,  role: 'staff',  name: 'Sam Staff (Booking Desk)', phone: '9000000002', area: 'booking', salary: 35000 },
    { email: 'shop@champions.club',    hash: staffHash,  role: 'staff',  name: 'Rita Sharma (Shop)',        phone: '9000000003', area: 'shop',    salary: 28000 },
    { email: 'bar@champions.club',     hash: staffHash,  role: 'staff',  name: 'Karan Mehta (Bar & Cafe)', phone: '9000000004', area: 'bar',     salary: 25000 },
    // Members
    { email: 'ravi@example.com',       hash: memberHash, role: 'member', name: 'Ravi Kumar',                phone: '9111111111', area: 'member',  salary: 0 },
    { email: 'priya@example.com',      hash: memberHash, role: 'member', name: 'Priya Sharma',              phone: '9222222222', area: 'member',  salary: 0 },
    { email: 'carlos@example.com',     hash: memberHash, role: 'member', name: 'Carlos Silva',              phone: '9333333333', area: 'member',  salary: 0 },
  ];

  for (const u of usersToSeed) {
    await db.query(`
      INSERT INTO users (email, password_hash, role, full_name, phone, assigned_area, monthly_salary, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        role=VALUES(role), full_name=VALUES(full_name),
        assigned_area=VALUES(assigned_area), monthly_salary=VALUES(monthly_salary),
        is_active=1
    `, [u.email, u.hash, u.role, u.name, u.phone, u.area, u.salary]);
  }

  // ── 3. Members ─────────────────────────────────────────────────────────────
  console.log('  → Members');
  const [plans] = await db.query('SELECT id, code FROM plans');
  const planMap  = Object.fromEntries(plans.map(p => [p.code, p.id]));
  const [users]  = await db.query("SELECT id, email FROM users WHERE role='member'");
  const userMap  = Object.fromEntries(users.map(u => [u.email, u.id]));

  // Active memberships: join 2 months ago, expire 10 months from now
  const now         = new Date();
  const joinDate    = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
  const expiryDate  = new Date(now.getFullYear() + 1, now.getMonth() - 2, 1).toISOString().slice(0, 10);

  const memberRecords = [
    { email: 'ravi@example.com',   code: 'CC-0001', plan: 'GOLD' },
    { email: 'priya@example.com',  code: 'CC-0002', plan: 'SILVER' },
    { email: 'carlos@example.com', code: 'CC-0003', plan: 'JUNIOR' },
  ];
  for (const r of memberRecords) {
    const uid = userMap[r.email];
    const pid = planMap[r.plan];
    if (!uid || !pid) { console.warn(`  ⚠  skipping ${r.email}`); continue; }
    await db.query(`
      INSERT INTO members (user_id, member_code, plan_id, join_date, expiry_date, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE plan_id=VALUES(plan_id), expiry_date=VALUES(expiry_date), status='active'
    `, [uid, r.code, pid, joinDate, expiryDate]);
  }

  // ── 4. Courts ──────────────────────────────────────────────────────────────
  console.log('  → Courts');
  const courts = [
    { name: 'Court A – Tennis (Hard)',   sport: 'tennis',    surface: 'Hard',      price: 600 },
    { name: 'Court B – Tennis (Clay)',   sport: 'tennis',    surface: 'Clay',      price: 500 },
    { name: 'Cricket Net 1',             sport: 'cricket',   surface: 'Turf',      price: 800 },
    { name: 'Badminton Hall 1',          sport: 'badminton', surface: 'Synthetic', price: 400 },
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
    { sku: 'RACK-001', name: 'Pro Tennis Racket',       dept: 'shop', cat: 'Rackets',     price: 4500, cost: 2800, stock: 12, reorder: 3 },
    { sku: 'RACK-002', name: 'Beginner Badminton Set',  dept: 'shop', cat: 'Rackets',     price: 1200, cost:  700, stock:  8, reorder: 2 },
    { sku: 'BALL-001', name: 'Tennis Balls (3 Pack)',   dept: 'shop', cat: 'Balls',       price:  350, cost:  180, stock: 50, reorder: 10 },
    { sku: 'BALL-002', name: 'Cricket Ball (Red)',      dept: 'shop', cat: 'Balls',       price:  450, cost:  250, stock: 30, reorder:  8 },
    { sku: 'KIT-001',  name: 'Cricket Batting Pads',   dept: 'shop', cat: 'Kits',        price: 3200, cost: 1800, stock:  6, reorder:  2 },
    { sku: 'GEAR-001', name: 'Sports Water Bottle',    dept: 'shop', cat: 'Accessories', price:  650, cost:  300, stock: 20, reorder:  5 },
    { sku: 'SHOE-001', name: 'Tennis Shoes (Unisex)',  dept: 'shop', cat: 'Footwear',    price: 3800, cost: 2000, stock:  4, reorder:  3 },
    // Bar
    { sku: 'DRK-001',  name: 'Electrolyte Drink',      dept: 'bar',  cat: 'Drinks',      price:  120, cost:   55, stock: 100, reorder: 20 },
    { sku: 'DRK-002',  name: 'Fresh Lime Soda',        dept: 'bar',  cat: 'Drinks',      price:   80, cost:   30, stock:  80, reorder: 15 },
    { sku: 'SNK-001',  name: 'Protein Bar',            dept: 'bar',  cat: 'Snacks',      price:  150, cost:   80, stock:  40, reorder: 10 },
    { sku: 'SNK-002',  name: 'Veg Sandwich',           dept: 'bar',  cat: 'Food',        price:  200, cost:   90, stock:  25, reorder:  5 },
    { sku: 'HOT-001',  name: 'Masala Chai',            dept: 'bar',  cat: 'Hot Drinks',  price:   60, cost:   20, stock:  99, reorder: 20 },
    { sku: 'HOT-002',  name: 'Fresh Orange Juice',     dept: 'bar',  cat: 'Drinks',      price:  120, cost:   50, stock:  50, reorder: 10 },
  ];
  for (const p of products) {
    await db.query(`
      INSERT INTO products (sku, name, department, category, price, cost_price, stock_qty, reorder_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE price=VALUES(price), stock_qty=VALUES(stock_qty), reorder_level=VALUES(reorder_level)
    `, [p.sku, p.name, p.dept, p.cat, p.price, p.cost, p.stock, p.reorder]);
  }

  // ── 6. Leads ───────────────────────────────────────────────────────────────
  console.log('  → Leads');
  const [firstPlan] = await db.query('SELECT id FROM plans LIMIT 1');
  const firstPlanId = firstPlan[0]?.id || null;
  const leads = [
    { name: 'Anita Patel',  email: 'anita@mail.com',  phone: '9400001111', msg: 'Interested in tennis coaching too' },
    { name: 'Ben Carter',   email: 'ben@mail.com',     phone: '9400002222', msg: 'Saw your ad – want to join with family' },
    { name: 'Divya Nair',   email: 'divya@mail.com',   phone: '9400003333', msg: 'Looking for Junior plan options' },
    { name: 'Elan Singh',   email: 'elan@mail.com',    phone: '9400004444', msg: 'Cricket practice facility inquiry' },
    { name: 'Fatima Zahra', email: 'fatima@mail.com',  phone: '9400005555', msg: 'Best plan for a student?' },
  ];
  for (const l of leads) {
    await db.query(
      'INSERT IGNORE INTO leads (name, email, phone, interested_plan_id, message) VALUES (?,?,?,?,?)',
      [l.name, l.email, l.phone, firstPlanId, l.msg]
    );
  }

  // ── 7. Sample Payroll Records ───────────────────────────────────────────────
  console.log('  → Payroll records');
  const [staffRows] = await db.query("SELECT id, full_name, monthly_salary FROM users WHERE role='staff'");
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const monthYear = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

  for (const s of staffRows) {
    const base   = Number(s.monthly_salary) || 30000;
    const bonus  = 0;
    const ded    = Math.round(base * 0.08); // 8% PF/ESI
    const net    = base + bonus - ded;
    const code   = `PAY-${s.id}-${monthYear.replace('-', '')}`;
    await db.query(`
      INSERT IGNORE INTO payroll (payroll_code, staff_user_id, month_year, base_salary, bonus, deductions, net_salary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'paid')
    `, [code, s.id, monthYear, base, bonus, ded, net]);
  }

  console.log('\n✅  Seed complete!\n');
  console.log('   Login credentials:');
  console.log('   owner@champions.club  / Owner@123   (owner)');
  console.log('   staff@champions.club  / Staff@123   (booking desk)');
  console.log('   shop@champions.club   / Staff@123   (shop staff)');
  console.log('   bar@champions.club    / Staff@123   (bar staff)');
  console.log('   ravi@example.com      / Member@123  (Gold member)');
  console.log('   priya@example.com     / Member@123  (Silver member)');
  console.log('   carlos@example.com    / Member@123  (Junior member)\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
