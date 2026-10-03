/**
 * @file server/scripts/seed.js
 * @description Idempotent database schema creation and demo data seeding.
 * Run with: npm run db:init or npm run seed
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { todayIST } = require('../utils/time');

async function initAndSeed() {
  console.log('[INFO] Initializing The Champions Club Database...');
  const conn = await pool.getConnection();

  try {
    // 1. Drop existing tables cleanly if any to ensure fresh schema
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const [existingTables] = await conn.query('SHOW TABLES');
    for (const row of existingTables) {
      const tableName = Object.values(row)[0];
      try {
        await conn.query(`DROP TABLE IF EXISTS \`${tableName}\``);
      } catch (e) {}
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // 2. Read and execute schema.sql
    const schemaSql = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf-8');
    const statements = schemaSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await conn.query(stmt);
    }
    console.log('[OK] Database schema verified & tables created.');
    const tablesToClean = [
      'users', 'plans', 'members', 'member_guardians', 'member_checkins', 'membership_history',
      'courts', 'court_blocks', 'social_sessions', 'social_session_registrations',
      'bookings', 'booking_slots', 'booking_participants',
      'products', 'product_variants', 'stock_movements', 'suppliers', 'purchase_orders', 'purchase_order_items',
      'service_jobs', 'tabs', 'orders', 'order_items', 'daily_closings', 'shifts', 'shift_assignments',
      'payments', 'expenses', 'invoices', 'invoice_items', 'leads', 'lead_followups', 'lead_quotes',
      'notifications', 'settings'
    ];
    for (const tbl of tablesToClean) {
      try {
        await conn.query(`TRUNCATE TABLE ${tbl}`);
      } catch (e) {
        // ignore if not exists yet
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // 3. Seed Settings
    const defaultSettings = [
      ['club_name', 'The Champions Club', 'Official club establishment name'],
      ['cancellation_cutoff_hours', '2', 'Hours before start when member cancellation is permitted'],
      ['max_advance_booking_days', '14', 'Maximum days in advance a member can book'],
      ['default_max_bookings_per_day', '2', 'Global cap on bookings per member per day'],
      ['tax_rate_gst_pct', '18', 'Standard GST rate percentage for invoices'],
      ['currency_symbol', '₹', 'Club currency symbol'],
      ['currency_code', 'INR', 'Club currency code']
    ];
    for (const [k, v, d] of defaultSettings) {
      await conn.query(
        'INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
        [k, v, d]
      );
    }
    console.log('[OK] Club settings populated.');

    // 4. Seed Membership Plans
    const plansData = [
      ['PLATINUM', 'Platinum Membership', 'All-access tier with premium discounts across courts, shop & cafeteria', 25000.00, 12, 50.00, 20.00, 15.00, 4, 0],
      ['GOLD', 'Gold Membership', 'Popular tier for regular sports enthusiasts with strong discounts', 15000.00, 12, 30.00, 15.00, 10.00, 2, 0],
      ['SILVER', 'Silver Membership', 'Flexible 6-month tier for seasonal recreation', 8000.00, 6, 15.00, 10.00, 5.00, 2, 0],
      ['JUNIOR', 'Junior Sports Plan', 'Dedicated tier for youth under 18 with parental consent', 6000.00, 12, 40.00, 15.00, 10.00, 2, 1]
    ];
    const planMap = {};
    for (const [code, name, desc, fee, dur, cd, sd, bd, maxb, isj] of plansData) {
      const [r] = await conn.query(
        `INSERT INTO plans (code, name, description, annual_fee, duration_months, court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day, is_junior)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, name, desc, fee, dur, cd, sd, bd, maxb, isj]
      );
      planMap[code] = r.insertId;
    }
    console.log('[OK] Membership plans seeded.');

    // 5. Seed Users
    const pwdHash = await bcrypt.hash('password123', 10);
    const usersData = [
      ['owner@championsclub.com', pwdHash, 'owner', 'Club Owner', '9876543200', 'general', 0],
      ['staff.booking@championsclub.com', pwdHash, 'staff', 'Desk Staff - Court Booking', '9876543210', 'booking', 0],
      ['staff.shop@championsclub.com', pwdHash, 'staff', 'Shop Operations Staff', '9876543211', 'shop', 0],
      ['staff.bar@championsclub.com', pwdHash, 'staff', 'Cafeteria & Bar Staff', '9876543212', 'bar', 0],
      ['member@championsclub.com', pwdHash, 'member', 'Rahul Sharma', '9876543220', 'general', 0],
      ['priya.patel@example.com', pwdHash, 'member', 'Priya Patel', '9876543221', 'general', 0],
      ['amit.verma@example.com', pwdHash, 'member', 'Amit Verma', '9876543222', 'general', 0],
      ['aarav.mehta@example.com', pwdHash, 'member', 'Aarav Mehta', '9876543223', 'general', 0]
    ];

    const userMap = {};
    for (const [email, hash, role, name, phone, area, mustChange] of usersData) {
      const [r] = await conn.query(
        `INSERT INTO users (email, password_hash, role, full_name, phone, assigned_area, must_change_password, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [email, hash, role, name, phone, area, mustChange]
      );
      userMap[email] = r.insertId;
    }
    console.log('[OK] System users seeded.');

    // 6. Seed Members & Guardians
    const today = todayIST();
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const nextYearStr = nextYear.toISOString().slice(0, 10);

    const membersData = [
      [userMap['member@championsclub.com'], 'CC-2026-001', planMap['PLATINUM'], '1992-04-12', today, nextYearStr, 'active', 'Sneha Sharma', '9876543290', 'Regular morning tennis player'],
      [userMap['priya.patel@example.com'], 'CC-2026-002', planMap['GOLD'], '1996-08-23', today, nextYearStr, 'active', 'Ramesh Patel', '9876543291', 'Weekend badminton enthusiast'],
      [userMap['amit.verma@example.com'], 'CC-2026-003', planMap['SILVER'], '1988-11-05', today, nextYearStr, 'active', 'Sunita Verma', '9876543292', 'Evening pickleball'],
      [userMap['aarav.mehta@example.com'], 'CC-2026-004', planMap['JUNIOR'], '2010-06-15', today, nextYearStr, 'active', 'Vikram Mehta', '9876543293', 'Under-18 junior cricket trainee']
    ];

    const memberMap = {};
    for (const [uId, code, pId, dob, jd, ed, st, en, ep, nt] of membersData) {
      const [r] = await conn.query(
        `INSERT INTO members (user_id, member_code, plan_id, date_of_birth, join_date, expiry_date, status, emergency_contact_name, emergency_contact_phone, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uId, code, pId, dob, jd, ed, st, en, ep, nt]
      );
      memberMap[code] = r.insertId;

      // History log
      await conn.query(
        `INSERT INTO membership_history (member_id, plan_id, action, start_date, end_date, amount_paid, notes)
         VALUES (?, ?, 'joined', ?, ?, ?, 'Initial enrollment')`,
        [r.insertId, pId, jd, ed, 15000.00]
      );

      // Payment log
      await conn.query(
        `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method, status, paid_at)
         VALUES (?, 'membership', ?, ?, ?, 'upi', 'paid', NOW())`,
        [`PAY-MBR-${r.insertId}`, r.insertId, uId, 15000.00]
      );
    }

    // Guardian for junior member Aarav
    await conn.query(
      `INSERT INTO member_guardians (member_id, guardian_name, relationship, phone, consent_given)
       VALUES (?, 'Vikram Mehta', 'Father', '9876543293', 1)`,
      [memberMap['CC-2026-004']]
    );
    console.log('[OK] Members, guardians, and payment records created.');

    // 7. Seed Courts
    const courtsData = [
      ['Court 1 - Tennis Championship', 'tennis', 'Synthetic Hard Surface', 600.00],
      ['Court 2 - Tennis Clay', 'tennis', 'Clay Court', 700.00],
      ['Pitch 1 - Cricket Turf Arena', 'cricket', 'Natural Grass & Turf Pitch', 1200.00],
      ['Court 3 - Badminton Pro Indoor', 'badminton', 'Teak Wood Floor', 400.00],
      ['Court 4 - Pickleball Arena', 'pickleball', 'Outdoor Acrylic', 350.00]
    ];
    const courtMap = {};
    for (const [name, sport, surf, price] of courtsData) {
      const [r] = await conn.query(
        `INSERT INTO courts (name, sport, surface_type, base_price_per_hour, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [name, sport, surf, price]
      );
      courtMap[name] = r.insertId;
    }
    console.log('[OK] Courts seeded.');

    // 8. Seed Products (Shop & Bar)
    const productsData = [
      // Shop
      ['PRO-TEN-01', 'Wilson Pro Staff v14 Tennis Racket', 'shop', 'Rackets', 4500.00, 3200.00, 1, 15, 5, 'https://images.unsplash.com/photo-1617083934555-563d67f70ca7?w=500', 'Top grade precision tennis racket for intermediate and advanced players'],
      ['PRO-CRI-01', 'SS Master Kashmir Willow Cricket Bat', 'shop', 'Bats', 6200.00, 4500.00, 1, 8, 3, 'https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=500', 'Premium balanced willow bat for match play'],
      ['PRO-BAD-01', 'Yonex Astrox 88D Badminton Racket', 'shop', 'Rackets', 2800.00, 1900.00, 1, 20, 5, 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=500', 'Fast attacking badminton racket with rotational generator system'],
      ['ACC-BAL-01', 'Head Tour Tennis Ball Can (3 Balls)', 'shop', 'Accessories', 450.00, 310.00, 1, 45, 10, 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=500', 'ITF approved pressurized tournament balls'],
      ['ACC-GRP-01', 'Anti-Slip Sports Grip Band (Pack of 3)', 'shop', 'Accessories', 150.00, 80.00, 1, 60, 15, 'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=500', 'High absorption sweat-resistant racket grip band'],
      // Bar
      ['BAR-SHK-01', 'Champion Whey Protein Shake', 'bar', 'Beverages', 180.00, 90.00, 1, 50, 10, 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=500', 'Fresh post-workout banana almond whey protein shake'],
      ['BAR-SND-01', 'Grilled Veg Club Sandwich', 'bar', 'Food', 220.00, 100.00, 1, 30, 8, 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500', 'Multigrain bread, fresh lettuce, cucumbers, cheese and herb dip'],
      ['BAR-WRP-01', 'Smoked Chicken Protein Wrap', 'bar', 'Food', 280.00, 140.00, 1, 25, 8, 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=500', 'Grilled chicken breast with chipotle spread in whole wheat tortilla'],
      ['BAR-COF-01', 'Signature Cold Brew Coffee', 'bar', 'Beverages', 150.00, 60.00, 1, 40, 10, 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=500', '18-hour steeped artisanal cold brew with tonic'],
      ['BAR-JUC-01', 'Cold Pressed Valencia Orange Juice', 'bar', 'Beverages', 120.00, 50.00, 1, 35, 10, 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=500', '100% natural pure orange juice without added sugar']
    ];

    for (const [sku, name, dept, cat, price, cost, track, stock, reorder, img, desc] of productsData) {
      const [pRes] = await conn.query(
        `INSERT INTO products (sku, name, department, category, price, cost_price, track_stock, stock_qty, reorder_level, image_url, description, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [sku, name, dept, cat, price, cost, track, stock, reorder, img, desc]
      );
      // Stock movement log
      await conn.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, notes, created_by)
         VALUES (?, 'restock', ?, 0, ?, 'Initial inventory seed', ?)`,
        [pRes.insertId, stock, stock, userMap['owner@championsclub.com']]
      );
    }
    console.log('[OK] Products & initial stock movement records seeded.');

    // 9. Seed Suppliers
    const suppliersData = [
      ['Yonex India Distribution', 'Anil Kapoor', 'supply@yonexindia.com', '9822011223', 'Plot 45, Okhla Industrial Area, New Delhi'],
      ['Cosco Sports Equipments', 'Rajesh Gupta', 'sales@coscoindia.com', '9811099887', 'Sector 18, Gurugram, Haryana'],
      ['Fresh Farm Dairy & Beverages', 'Sunil Deshmukh', 'orders@freshfarm.in', '9890123456', 'Unit 12, APMC Market, Vashi, Navi Mumbai']
    ];
    for (const [name, contact, email, phone, addr] of suppliersData) {
      await conn.query(
        'INSERT INTO suppliers (name, contact_person, email, phone, address, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        [name, contact, email, phone, addr]
      );
    }
    console.log('[OK] Suppliers seeded.');

    // 10. Seed Shifts
    await conn.query(
      `INSERT INTO shifts (name, start_time, end_time, is_active) VALUES
       ('Morning Operational Shift', '06:00:00', '14:00:00', 1),
       ('Evening Operational Shift', '14:00:00', '22:00:00', 1)`
    );

    // 11. Seed Sample Leads
    const leadsData = [
      ['Vikram Singhania', 'vikram.singh@corporate.com', '9876500111', planMap['PLATINUM'], 'Looking for an annual platinum membership for family and corporate court bookings.', 'website', 'membership', 'new', today],
      ['Dr. Anita Rao', 'anita.rao@apollo.org', '9876500222', planMap['GOLD'], 'Inquired about weekend morning tennis court availability and coaching.', 'walk_in', 'coaching', 'contacted', today],
      ['Rajesh Khanna', 'rajesh.khanna@tcs.com', '9876500333', planMap['SILVER'], 'Interested in cricket turf pitch corporate weekend tournament package.', 'referral', 'court_rental', 'quoted', today]
    ];
    for (const [name, email, phone, pId, msg, src, int, st, fDate] of leadsData) {
      await conn.query(
        `INSERT INTO leads (name, email, phone, interested_plan_id, message, source, interest, status, follow_up_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, email, phone, pId, msg, src, int, st, fDate]
      );
    }
    console.log('[OK] Initial CRM leads seeded.');

    // 12. Seed Notifications
    const notifsData = [
      [userMap['owner@championsclub.com'], 'owner', 'new_lead', 'New Membership Enquiry', 'Vikram Singhania submitted an enquiry for Platinum Membership.', '/owner/leads.html'],
      [userMap['owner@championsclub.com'], 'owner', 'low_stock', 'Low Stock Alert', 'SS Master Cricket Bats are running low on stock (8 units remaining).', '/owner/products.html'],
      [userMap['member@championsclub.com'], 'member', 'general', 'Welcome to Champions Club', 'Your Platinum Membership is active. Enjoy 50% discount on court bookings!', '/member/membership.html']
    ];
    for (const [uId, role, type, title, msg, link] of notifsData) {
      await conn.query(
        `INSERT INTO notifications (user_id, role_target, type, title, message, link, is_read)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [uId, role, type, title, msg, link]
      );
    }
    console.log('[OK] Initial system notifications seeded.');

    console.log('===========================================================');
    console.log('[SUCCESS] Database initialization & seeding completed!');
    console.log('===========================================================');
  } catch (err) {
    console.error('[ERROR] Database setup failed:', err);
    throw err;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  initAndSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { initAndSeed };
