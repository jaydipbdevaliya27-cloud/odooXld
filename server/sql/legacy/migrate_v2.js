/**
 * migrate_v2.js - Creates all missing tables and seeds full data
 * Run: node server/scripts/migrate_v2.js
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

  // ── Create missing core tables ─────────────────────────────────────────────
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_plans (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      code                VARCHAR(50)   NOT NULL UNIQUE,
      name                VARCHAR(100)  NOT NULL,
      description         TEXT,
      annual_fee          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      duration_months     INT           NOT NULL DEFAULT 12,
      court_discount_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
      shop_discount_pct   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
      bar_discount_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
      max_bookings_per_day INT          NOT NULL DEFAULT 2,
      is_active           TINYINT(1)   NOT NULL DEFAULT 1,
      created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_plans table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_members (
      id                      INT AUTO_INCREMENT PRIMARY KEY,
      user_id                 INT          NOT NULL,
      member_code             VARCHAR(50)  NOT NULL UNIQUE,
      plan_id                 INT          NOT NULL,
      date_of_birth           DATE,
      join_date               DATE         NOT NULL,
      expiry_date             DATE         NOT NULL,
      status                  ENUM('active','expired','suspended') NOT NULL DEFAULT 'active',
      emergency_contact_name  VARCHAR(255),
      emergency_contact_phone VARCHAR(50),
      notes                   TEXT,
      created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_m_user (user_id),
      INDEX idx_m_status_expiry (status, expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_members table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_courts (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      name                VARCHAR(100) NOT NULL,
      sport               ENUM('tennis','cricket','badminton','pickleball') NOT NULL,
      surface_type        VARCHAR(50),
      base_price_per_hour DECIMAL(10,2) NOT NULL DEFAULT 500.00,
      is_active           TINYINT(1)   NOT NULL DEFAULT 1,
      created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_courts table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_bookings (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      booking_code         VARCHAR(50)  NOT NULL UNIQUE,
      court_id             INT          NOT NULL,
      user_id              INT          NULL,
      member_id            INT          NULL,
      guest_name           VARCHAR(255) NULL,
      guest_phone          VARCHAR(50)  NULL,
      booking_date         DATE         NOT NULL,
      start_time           TIME         NOT NULL,
      end_time             TIME         NOT NULL,
      base_price           DECIMAL(10,2) NOT NULL DEFAULT 0,
      discount_pct         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
      price_charged        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status               ENUM('confirmed','cancelled','completed') NOT NULL DEFAULT 'confirmed',
      booked_by_user_id    INT          NOT NULL,
      payment_method       ENUM('cash','card','upi','online') NULL,
      cancelled_at         DATETIME     NULL,
      cancellation_reason  VARCHAR(255) NULL,
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bk_date         (booking_date),
      INDEX idx_bk_court_date   (court_id, booking_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_bookings table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_products (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      sku           VARCHAR(50)  NOT NULL UNIQUE,
      name          VARCHAR(255) NOT NULL,
      department    ENUM('shop','bar') NOT NULL,
      category      VARCHAR(100) NOT NULL,
      price         DECIMAL(10,2) NOT NULL,
      cost_price    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      track_stock   TINYINT(1)   NOT NULL DEFAULT 1,
      stock_qty     INT          NOT NULL DEFAULT 0,
      reorder_level INT          NOT NULL DEFAULT 5,
      image_url     VARCHAR(2000) NULL,
      description   TEXT,
      is_active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_pr_dept (department, is_active),
      INDEX idx_pr_cat  (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_products table ready');

  // Product variants for size-wise inventory (Large/Medium/Small/One-size etc.)
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_product_variants (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      product_id    INT          NOT NULL,
      variant_name  VARCHAR(100) NOT NULL,
      sku_suffix    VARCHAR(50)  NOT NULL,
      price_offset  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      stock_qty     INT          NOT NULL DEFAULT 0,
      reorder_level INT          NOT NULL DEFAULT 3,
      is_active     TINYINT(1)  NOT NULL DEFAULT 1,
      created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_variant (product_id, sku_suffix),
      INDEX idx_pv_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_product_variants table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_orders (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      order_code         VARCHAR(50)  NOT NULL UNIQUE,
      department         ENUM('shop','bar') NOT NULL,
      channel            ENUM('table','counter','online') NOT NULL DEFAULT 'counter',
      table_no           VARCHAR(50)  NULL,
      user_id            INT          NULL,
      member_id          INT          NULL,
      guest_name         VARCHAR(255) NULL,
      guest_phone        VARCHAR(50)  NULL,
      delivery_address   TEXT         NULL,
      subtotal           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      discount_pct       DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
      discount_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      total              DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status             ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
      payment_method     ENUM('cash','card','upi','online') NULL,
      created_by_user_id INT          NULL,
      closed_at          DATETIME     NULL,
      created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_or_dept_status (department, status),
      INDEX idx_or_member      (member_id),
      INDEX idx_or_date        (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_orders table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_order_items (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      order_id    INT           NOT NULL,
      product_id  INT           NOT NULL,
      variant_id  INT           NULL,
      quantity    INT           NOT NULL DEFAULT 1,
      unit_price  DECIMAL(10,2) NOT NULL,
      line_total  DECIMAL(10,2) NOT NULL,
      notes       VARCHAR(255)  NULL,
      created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_oi_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_order_items table ready');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS cc_payments (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      payment_code  VARCHAR(50)  NOT NULL UNIQUE,
      source        ENUM('membership','court','shop','bar') NOT NULL,
      reference_id  INT          NOT NULL,
      user_id       INT          NULL,
      amount        DECIMAL(10,2) NOT NULL,
      method        ENUM('cash','card','upi','online') NOT NULL,
      status        ENUM('paid','refunded','failed') NOT NULL DEFAULT 'paid',
      notes         VARCHAR(255) NULL,
      paid_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      refunded_at   DATETIME     NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cp_source  (source, status),
      INDEX idx_cp_paid_at (paid_at),
      INDEX idx_cp_method  (method)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('✅ cc_payments table ready');

  // ── Seed plans ─────────────────────────────────────────────────────────────
  const planRows = await conn.execute(`SELECT COUNT(*) AS c FROM cc_plans`);
  if (planRows[0][0].c === 0) {
    await conn.execute(`
      INSERT INTO cc_plans (code,name,description,annual_fee,duration_months,court_discount_pct,shop_discount_pct,bar_discount_pct,max_bookings_per_day) VALUES
      ('BRONZE','Bronze','Entry level membership',5000.00,12,5.00,5.00,5.00,2),
      ('SILVER','Silver','Mid-tier with good discounts',10000.00,12,10.00,10.00,10.00,3),
      ('GOLD','Gold','Premium membership',20000.00,12,15.00,15.00,15.00,4),
      ('PLATINUM','Platinum','Top-tier all-inclusive',35000.00,12,20.00,20.00,20.00,5)
    `);
    console.log('✅ Seeded cc_plans');
  }

  // ── Seed courts ────────────────────────────────────────────────────────────
  const crtRows = await conn.execute(`SELECT COUNT(*) AS c FROM cc_courts`);
  if (crtRows[0][0].c === 0) {
    await conn.execute(`
      INSERT INTO cc_courts (name,sport,surface_type,base_price_per_hour) VALUES
      ('Tennis Court 1','tennis','Hard',600.00),
      ('Tennis Court 2','tennis','Clay',600.00),
      ('Cricket Net 1','cricket','Turf',800.00),
      ('Badminton Court 1','badminton','Synthetic',400.00),
      ('Badminton Court 2','badminton','Synthetic',400.00)
    `);
    console.log('✅ Seeded cc_courts');
  }

  // ── Seed products ──────────────────────────────────────────────────────────
  const prRows = await conn.execute(`SELECT COUNT(*) AS c FROM cc_products`);
  if (prRows[0][0].c === 0) {
    await conn.execute(`
      INSERT INTO cc_products (sku,name,department,category,price,cost_price,stock_qty,reorder_level,description) VALUES
      ('RAC-TEN-001','Wilson Pro Staff Tennis Racket','shop','Tennis Rackets',8500.00,5000.00,12,5,'Professional grade tennis racket'),
      ('RAC-TEN-002','Babolat Pure Drive Tennis Racket','shop','Tennis Rackets',9200.00,5500.00,8,5,'Tour level performance racket'),
      ('BAL-TEN-001','Penn Championship Tennis Balls (3)','shop','Tennis Balls',350.00,150.00,45,10,'Standard championship balls pack of 3'),
      ('SHO-001','Nike Court Air Zoom Tennis Shoes','shop','Sports Shoes',7800.00,4500.00,0,5,'Lightweight tennis shoes - variants available'),
      ('SHO-002','Adidas Barricade Tennis Shoes','shop','Sports Shoes',6500.00,3800.00,0,5,'Durable court shoes - variants available'),
      ('BAG-001','Champion Sports Bag','shop','Sports Bags',2200.00,1200.00,20,8,'Spacious sports bag with racket holder'),
      ('GRI-001','Overgrip Tape Pack (3)','shop','Accessories',180.00,60.00,60,20,'Non-slip overgrip tape'),
      ('STR-001','Racket Stringing Service','shop','Services',500.00,200.00,99,0,'Professional stringing service'),
      ('RAC-BAD-001','Yonex Astrox 88 Badminton Racket','shop','Badminton Rackets',7200.00,4200.00,4,5,'Professional badminton racket'),
      ('BAR-WAT-001','Mineral Water 500ml','bar','Beverages',40.00,15.00,100,20,'Chilled mineral water'),
      ('BAR-JUI-001','Fresh Orange Juice','bar','Beverages',120.00,50.00,50,10,'Freshly squeezed orange juice'),
      ('BAR-CHA-001','Masala Chai','bar','Hot Drinks',60.00,20.00,80,15,'Traditional Indian spiced tea'),
      ('BAR-SAN-001','Grilled Veg Sandwich','bar','Snacks',180.00,70.00,30,10,'Toasted sandwich with veggies'),
      ('BAR-PAN-001','Paneer Wrap','bar','Snacks',220.00,90.00,25,8,'Cottage cheese wrap'),
      ('BAR-ENE-001','Sports Energy Drink','bar','Beverages',150.00,60.00,40,10,'Electrolyte replenishment drink')
    `);
    console.log('✅ Seeded cc_products');

    // Add shoe size variants
    const [shoeRows] = await conn.execute(`SELECT id FROM cc_products WHERE sku IN ('SHO-001','SHO-002')`);
    for (const shoe of shoeRows) {
      await conn.execute(`
        INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES
        (?,?,?,?,?,?)
      `, [shoe.id, 'Size UK 6',  'S6',  0,    8, 3]);
      await conn.execute(`
        INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES
        (?,?,?,?,?,?)
      `, [shoe.id, 'Size UK 7',  'S7',  0,   10, 3]);
      await conn.execute(`
        INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES
        (?,?,?,?,?,?)
      `, [shoe.id, 'Size UK 8',  'S8',  0,    5, 3]);
      await conn.execute(`
        INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES
        (?,?,?,?,?,?)
      `, [shoe.id, 'Size UK 9',  'S9',  0,    3, 3]);
      await conn.execute(`
        INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES
        (?,?,?,?,?,?)
      `, [shoe.id, 'Size UK 10', 'S10', 0,    2, 3]);
    }

    // Add racket size variants
    const [racketRows] = await conn.execute(`SELECT id FROM cc_products WHERE sku IN ('RAC-TEN-001','RAC-TEN-002','RAC-BAD-001')`);
    for (const r of racketRows) {
      await conn.execute(`INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES (?,?,?,?,?,?)`, [r.id, 'Grip 3 (Small)',  'G3', 0,   4, 2]);
      await conn.execute(`INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES (?,?,?,?,?,?)`, [r.id, 'Grip 4 (Medium)', 'G4', 0,   5, 2]);
      await conn.execute(`INSERT INTO cc_product_variants (product_id,variant_name,sku_suffix,price_offset,stock_qty,reorder_level) VALUES (?,?,?,?,?,?)`, [r.id, 'Grip 5 (Large)',  'G5', 0,   3, 2]);
    }
    console.log('✅ Seeded product variants');
  }

  // ── Seed demo members ──────────────────────────────────────────────────────
  const [planList] = await conn.execute(`SELECT id, code FROM cc_plans`);
  const goldPlan = planList.find(p => p.code === 'GOLD') || planList[0];
  const silverPlan = planList.find(p => p.code === 'SILVER') || planList[0];

  const [mbrCount] = await conn.execute(`SELECT COUNT(*) AS c FROM cc_members`);
  if (mbrCount[0].c === 0) {
    const [userRow] = await conn.execute(`SELECT id FROM users WHERE email = 'member@championsclub.com' LIMIT 1`);
    if (userRow.length) {
      const today = new Date();
      const joinDate = today.toISOString().slice(0, 10);
      const expiryDate = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
      const expiryNear = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 20).toISOString().slice(0, 10);

      await conn.execute(`
        INSERT INTO cc_members (user_id,member_code,plan_id,join_date,expiry_date,status,emergency_contact_name) VALUES
        (?,?,?,?,?,'active','Emergency Contact')
      `, [userRow[0].id, 'CC-2026-001', goldPlan.id, joinDate, expiryDate]);
    }
    console.log('✅ Seeded cc_members');
  }

  // ── Seed sample bookings ───────────────────────────────────────────────────
  const [bkCount] = await conn.execute(`SELECT COUNT(*) AS c FROM cc_bookings`);
  if (bkCount[0].c === 0) {
    const [courts] = await conn.execute(`SELECT id FROM cc_courts LIMIT 3`);
    const [adminUser] = await conn.execute(`SELECT id FROM users WHERE email = 'admin@championsclub.com' LIMIT 1`);
    if (courts.length && adminUser.length) {
      const today = new Date().toISOString().slice(0, 10);
      const codes = ['BK-001', 'BK-002', 'BK-003'];
      const times = [['07:00:00','08:00:00'],['09:00:00','10:00:00'],['11:00:00','12:00:00']];
      for (let i = 0; i < Math.min(courts.length, 3); i++) {
        await conn.execute(`
          INSERT INTO cc_bookings (booking_code,court_id,user_id,booking_date,start_time,end_time,base_price,price_charged,status,booked_by_user_id,payment_method)
          VALUES (?,?,?,?,?,?,600.00,600.00,'confirmed',?,?)
        `, [codes[i], courts[i].id, adminUser[0].id, today, times[i][0], times[i][1], adminUser[0].id, 'upi']);
      }
      console.log('✅ Seeded cc_bookings');
    }
  }

  // ── Seed sample orders & payments ─────────────────────────────────────────
  const [ordCount] = await conn.execute(`SELECT COUNT(*) AS c FROM cc_orders`);
  if (ordCount[0].c === 0) {
    const [products] = await conn.execute(`SELECT id, price FROM cc_products WHERE department='shop' LIMIT 3`);
    const [barProds] = await conn.execute(`SELECT id, price FROM cc_products WHERE department='bar' LIMIT 2`);
    const [adminUser] = await conn.execute(`SELECT id FROM users WHERE email = 'admin@championsclub.com' LIMIT 1`);
    if (products.length && adminUser.length) {
      // Shop order
      await conn.execute(`
        INSERT INTO cc_orders (order_code,department,channel,subtotal,total,status,payment_method,created_by_user_id,closed_at) VALUES
        ('ORD-S-001','shop','counter',8500.00,8500.00,'completed','upi',?,NOW())
      `, [adminUser[0].id]);
      const [lastShopOrder] = await conn.execute(`SELECT LAST_INSERT_ID() as id`);
      await conn.execute(`
        INSERT INTO cc_order_items (order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,1,8500.00,8500.00)
      `, [lastShopOrder[0].id, products[0].id]);

      // Bar order
      if (barProds.length) {
        await conn.execute(`
          INSERT INTO cc_orders (order_code,department,channel,table_no,subtotal,total,status,payment_method,created_by_user_id,closed_at) VALUES
          ('ORD-B-001','bar','table','T3',340.00,340.00,'completed','cash',?,NOW())
        `, [adminUser[0].id]);
        const [lastBarOrder] = await conn.execute(`SELECT LAST_INSERT_ID() as id`);
        await conn.execute(`
          INSERT INTO cc_order_items (order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,2,120.00,240.00),(?,?,1,100.00,100.00)
        `, [lastBarOrder[0].id, barProds[0].id, lastBarOrder[0].id, barProds[0].id]);
      }

      // Payments
      const payCode = () => 'PAY-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
      await conn.execute(`
        INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at) VALUES
        (?,?,?,?,?,?,?,NOW())
      `, [payCode(), 'shop', lastShopOrder[0].id, adminUser[0].id, 8500.00, 'upi', 'paid']);
      await conn.execute(`
        INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at) VALUES
        (?,?,?,?,?,?,?,NOW())
      `, [payCode(), 'bar', 2, adminUser[0].id, 340.00, 'cash', 'paid']);
      await conn.execute(`
        INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at) VALUES
        (?,?,?,?,?,?,?,NOW())
      `, [payCode(), 'membership', 1, adminUser[0].id, 20000.00, 'upi', 'paid']);
      await conn.execute(`
        INSERT INTO cc_payments (payment_code,source,reference_id,user_id,amount,method,status,paid_at) VALUES
        (?,?,?,?,?,?,?,NOW())
      `, [payCode(), 'court', 1, adminUser[0].id, 600.00, 'card', 'paid']);

      console.log('✅ Seeded cc_orders and cc_payments');
    }
  }

  const [tables] = await conn.execute(`SHOW TABLES LIKE 'cc_%'`);
  console.log('\n📋 All cc_ tables:', tables.map(t => Object.values(t)[0]).join(', '));
  console.log('\n🎉 Migration V2 complete!');
  await conn.end();
}

run().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
