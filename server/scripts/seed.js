/**
 * seed.js - Seeds the champions_club database with all required users and data
 * Run: node server/scripts/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql  = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3307'),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || 'Umesh@2005',
    database: process.env.DB_NAME     || 'champions_club',
    multipleStatements: true
  });

  console.log('✅ Connected to MySQL');

  // ── Step 1: Add missing columns to users ──────────────────────────────────
  try {
    await conn.execute(`ALTER TABLE users ADD COLUMN full_name VARCHAR(255) NULL`);
    console.log('✅ Added full_name column');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    console.log('ℹ️  full_name column already exists');
  }

  try {
    await conn.execute(`ALTER TABLE users ADD COLUMN role ENUM('visitor','member','staff','owner') NOT NULL DEFAULT 'staff'`);
    console.log('✅ Added role column');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    console.log('ℹ️  role column already exists');
  }

  try {
    await conn.execute(`ALTER TABLE users ADD COLUMN assigned_area VARCHAR(50) NOT NULL DEFAULT 'shop'`);
    console.log('✅ Added assigned_area column');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    console.log('ℹ️  assigned_area column already exists');
  }

  // ── Step 2: Backfill full_name from name for existing rows ─────────────────
  await conn.execute(`UPDATE users SET full_name = name WHERE full_name IS NULL`);
  await conn.execute(`UPDATE users SET role = 'owner' WHERE email IN ('admin@championsclub.in','admin@championsclub.com')`);
  await conn.execute(`UPDATE users SET role = 'staff' WHERE email IN ('frontdesk@championsclub.in','bar@championsclub.in','shop@championsclub.in','accounts@championsclub.in')`);
  await conn.execute(`UPDATE users SET role = 'member' WHERE email IN ('member@championsclub.in','member@championsclub.com')`);
  console.log('✅ Backfilled roles and full_name');

  // ── Step 3: Hash password ──────────────────────────────────────────────────
  const password = 'Champions@123';
  const hash     = await bcrypt.hash(password, 10);
  console.log('✅ Password hash generated');

  // ── Step 4: Upsert demo users ──────────────────────────────────────────────
  const demoUsers = [
    { name: 'Club Administrator',      full_name: 'Club Administrator',          email: 'admin@championsclub.com',   role: 'owner', assigned_area: 'all',     phone: '+91 98765 11111' },
    { name: 'Marcus Sterling',         full_name: 'Marcus Sterling (Owner)',      email: 'owner@championsclub.com',   role: 'owner', assigned_area: 'all',     phone: '+91 98765 11112' },
    { name: 'Alex Carter',             full_name: 'Alex Carter (Shop Staff)',     email: 'shop@championsclub.com',    role: 'staff', assigned_area: 'shop',    phone: '+91 98765 43210' },
    { name: 'Elena Rostova',           full_name: 'Elena Rostova (Bar Staff)',    email: 'bar@championsclub.com',     role: 'staff', assigned_area: 'bar',     phone: '+91 98765 43211' },
    { name: 'David Chen',              full_name: 'David Chen (Booking)',         email: 'booking@championsclub.com', role: 'staff', assigned_area: 'booking', phone: '+91 98765 43212' },
    { name: 'Ravi Verma',              full_name: 'Ravi Verma (Gold Member)',     email: 'member@championsclub.com',  role: 'member',assigned_area: 'member',  phone: '+91 94000 01111' },
  ];

  for (const u of demoUsers) {
    const [rows] = await conn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
    if (rows.length > 0) {
      await conn.execute(
        'UPDATE users SET name=?, full_name=?, password_hash=?, role=?, assigned_area=?, phone=?, is_active=1 WHERE email=?',
        [u.name, u.full_name, hash, u.role, u.assigned_area, u.phone, u.email]
      );
      console.log(`✅ Updated user: ${u.email}`);
    } else {
      await conn.execute(
        'INSERT INTO users (name, full_name, email, password_hash, role, phone, assigned_area, is_active) VALUES (?,?,?,?,?,?,?,1)',
        [u.name, u.full_name, u.email, hash, u.role, u.phone, u.assigned_area]
      );
      console.log(`✅ Inserted user: ${u.email}`);
    }
  }

  // ── Step 5: Show all users ─────────────────────────────────────────────────
  const [users] = await conn.execute('SELECT id, name, email, role, assigned_area, is_active FROM users ORDER BY id');
  console.log('\n📋 All users in database:');
  console.table(users);

  await conn.end();
  console.log('\n🎉 Seed complete! All demo users can now log in with password: Champions@123');
}

run().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
