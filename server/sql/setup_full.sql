-- Champions Club - Full Setup Script
-- Run via PowerShell: Get-Content "server\sql\setup_full.sql" | mysql -u root -pUmesh@2005 -h 127.0.0.1 --port 3307

CREATE DATABASE IF NOT EXISTS champions_club;
USE champions_club;

-- 1. USERS (with assigned_area built-in from the start)
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('visitor','member','staff','owner') NOT NULL DEFAULT 'member',
    full_name     VARCHAR(255) NOT NULL,
    phone         VARCHAR(50),
    assigned_area VARCHAR(50) NOT NULL DEFAULT 'shop',
    is_active     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_role  (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add assigned_area if table existed without it (safe for MySQL 8.0)
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'champions_club'
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'assigned_area'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE users ADD COLUMN assigned_area VARCHAR(50) NOT NULL DEFAULT ''shop''',
    'SELECT ''assigned_area already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. PLANS
CREATE TABLE IF NOT EXISTS plans (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    code                VARCHAR(50)    NOT NULL UNIQUE,
    name                VARCHAR(100)   NOT NULL,
    description         TEXT,
    annual_fee          DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    duration_months     INT            NOT NULL DEFAULT 12,
    court_discount_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    shop_discount_pct   DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    bar_discount_pct    DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    max_bookings_per_day INT           NOT NULL DEFAULT 2,
    is_active           TINYINT(1)    NOT NULL DEFAULT 1,
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. MEMBERS
CREATE TABLE IF NOT EXISTS members (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    user_id                 INT          NOT NULL UNIQUE,
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
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
    FOREIGN KEY (plan_id)  REFERENCES plans(id)  ON UPDATE CASCADE,
    INDEX idx_members_code          (member_code),
    INDEX idx_members_status_expiry (status, expiry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. COURTS
CREATE TABLE IF NOT EXISTS courts (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    sport               ENUM('tennis','cricket','badminton','pickleball') NOT NULL,
    surface_type        VARCHAR(50),
    base_price_per_hour DECIMAL(10,2) NOT NULL DEFAULT 500.00,
    is_active           TINYINT(1)   NOT NULL DEFAULT 1,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_courts_sport (sport, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. BOOKINGS
CREATE TABLE IF NOT EXISTS bookings (
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
    base_price           DECIMAL(10,2) NOT NULL,
    discount_pct         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    price_charged        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status               ENUM('confirmed','cancelled','completed') NOT NULL DEFAULT 'confirmed',
    booked_by_user_id    INT          NOT NULL,
    cancelled_at         DATETIME     NULL,
    cancellation_reason  VARCHAR(255) NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (court_id)          REFERENCES courts(id),
    FOREIGN KEY (user_id)           REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (member_id)         REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (booked_by_user_id) REFERENCES users(id),
    INDEX idx_bookings_date         (booking_date),
    INDEX idx_bookings_member_date  (member_id, booking_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. BOOKING_SLOTS
CREATE TABLE IF NOT EXISTS booking_slots (
    id         INT      AUTO_INCREMENT PRIMARY KEY,
    booking_id INT      NOT NULL,
    court_id   INT      NOT NULL,
    slot_date  DATE     NOT NULL,
    slot_start DATETIME NOT NULL,
    slot_end   DATETIME NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (court_id)   REFERENCES courts(id)   ON DELETE CASCADE,
    UNIQUE KEY uk_court_slot (court_id, slot_start),
    INDEX idx_slot_date (slot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
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
    image_url     VARCHAR(500) NULL,
    description   TEXT,
    is_active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_stock_positive CHECK (stock_qty >= 0),
    INDEX idx_products_dept     (department, is_active),
    INDEX idx_products_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. ORDERS (with payment_method)
CREATE TABLE IF NOT EXISTS orders (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    order_code        VARCHAR(50)  NOT NULL UNIQUE,
    department        ENUM('shop','bar') NOT NULL,
    channel           ENUM('table','counter','online') NOT NULL,
    table_no          VARCHAR(50)  NULL,
    user_id           INT          NULL,
    member_id         INT          NULL,
    guest_name        VARCHAR(255) NULL,
    guest_phone       VARCHAR(50)  NULL,
    delivery_address  TEXT         NULL,
    subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    discount_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status            ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
    payment_method    ENUM('cash','card','upi','online') NULL,
    created_by_user_id INT          NULL,
    closed_at         DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)            REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (member_id)          REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_orders_dept_status (department, status),
    INDEX idx_orders_member      (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. ORDER_ITEMS
CREATE TABLE IF NOT EXISTS order_items (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    order_id   INT           NOT NULL,
    product_id INT           NOT NULL,
    quantity   INT           NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL,
    notes      VARCHAR(255)  NULL,
    created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    INDEX idx_order_items_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
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
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_payments_source  (source, status),
    INDEX idx_payments_paid_at (paid_at),
    INDEX idx_payments_method  (method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. LEADS
CREATE TABLE IF NOT EXISTS leads (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NULL,
    phone               VARCHAR(50)  NULL,
    interested_plan_id  INT          NULL,
    message             TEXT,
    status              ENUM('new','contacted','quoted','converted','lost') NOT NULL DEFAULT 'new',
    notes               TEXT,
    assigned_to_user_id INT          NULL,
    converted_member_id INT          NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (interested_plan_id)  REFERENCES plans(id)   ON DELETE SET NULL,
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL,
    INDEX idx_leads_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================================
-- SEED DATA
-- All demo user passwords = Champions@123
-- bcrypt hash: $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi
-- ==========================================================================

INSERT IGNORE INTO users (email, password_hash, role, full_name, phone, assigned_area, is_active) VALUES
('admin@championsclub.com',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'owner', 'Club Administrator',          '+91 98765 11111', 'all',     1),
('owner@championsclub.com',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'owner', 'Marcus Sterling (Owner)',      '+91 98765 11112', 'all',     1),
('shop@championsclub.com',    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', 'Alex Carter (Shop Staff)',     '+91 98765 43210', 'shop',    1),
('bar@championsclub.com',     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', 'Elena Rostova (Bar & Cafe)',   '+91 98765 43211', 'bar',     1),
('booking@championsclub.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'staff', 'David Chen (Court Booking)',   '+91 98765 43212', 'booking', 1),
('member@championsclub.com',  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p4UKiyE9MsrR0YqHAOhCIi', 'member','Ravi Verma (Gold Member)',     '+91 94000 01111', 'member',  1);

-- Seed membership plans
INSERT IGNORE INTO plans (code, name, description, annual_fee, duration_months, court_discount_pct, shop_discount_pct, bar_discount_pct, max_bookings_per_day) VALUES
('BRONZE',   'Bronze',   'Entry level membership',        5000.00,  12, 5.00,  5.00,  5.00,  2),
('SILVER',   'Silver',   'Mid-tier with good discounts',  10000.00, 12, 10.00, 10.00, 10.00, 3),
('GOLD',     'Gold',     'Premium membership',            20000.00, 12, 15.00, 15.00, 15.00, 4),
('PLATINUM', 'Platinum', 'Top-tier all-inclusive',        35000.00, 12, 20.00, 20.00, 20.00, 5);

-- Seed courts
INSERT IGNORE INTO courts (name, sport, surface_type, base_price_per_hour) VALUES
('Tennis Court 1',    'tennis',    'Hard',       600.00),
('Tennis Court 2',    'tennis',    'Clay',       600.00),
('Cricket Net 1',     'cricket',   'Turf',       800.00),
('Badminton Court 1', 'badminton', 'Synthetic',  400.00),
('Badminton Court 2', 'badminton', 'Synthetic',  400.00);

-- Seed shop products
INSERT IGNORE INTO products (sku, name, department, category, price, cost_price, stock_qty, reorder_level, description) VALUES
('RAC-TEN-001', 'Wilson Pro Staff Tennis Racket',     'shop', 'Tennis Rackets',    8500.00, 5000.00, 12, 5,  'Professional grade tennis racket'),
('RAC-TEN-002', 'Babolat Pure Drive Tennis Racket',   'shop', 'Tennis Rackets',    9200.00, 5500.00, 8,  5,  'Tour level performance racket'),
('BAL-TEN-001', 'Penn Championship Tennis Balls (3)', 'shop', 'Tennis Balls',       350.00,  150.00, 45, 10, 'Standard championship balls pack of 3'),
('SHO-TEN-001', 'Nike Court Air Zoom Tennis Shoes',   'shop', 'Sports Shoes',      7800.00, 4500.00, 15, 5,  'Lightweight tennis shoes'),
('SHO-TEN-002', 'Adidas Barricade Tennis Shoes',      'shop', 'Sports Shoes',      6500.00, 3800.00, 3,  5,  'Durable court shoes'),
('BAG-001',     'Champion Sports Bag',                'shop', 'Sports Bags',        2200.00, 1200.00, 20, 8,  'Spacious sports bag with racket holder'),
('GRI-001',     'Overgrip Tape Pack (3)',              'shop', 'Accessories',         180.00,   60.00, 60, 20, 'Non-slip overgrip tape'),
('STR-001',     'Racket Stringing Service',            'shop', 'Services',            500.00,  200.00, 99, 0,  'Professional stringing service'),
('RAC-BAD-001', 'Yonex Astrox 88 Badminton Racket',  'shop', 'Badminton Rackets',  7200.00, 4200.00, 4,  5,  'Professional badminton racket');

-- Seed bar products
INSERT IGNORE INTO products (sku, name, department, category, price, cost_price, stock_qty, reorder_level, description) VALUES
('BAR-WAT-001', 'Mineral Water 500ml',  'bar', 'Beverages',  40.00,  15.00, 100, 20, 'Chilled mineral water'),
('BAR-JUI-001', 'Fresh Orange Juice',   'bar', 'Beverages', 120.00,  50.00, 50,  10, 'Freshly squeezed orange juice'),
('BAR-CHA-001', 'Masala Chai',          'bar', 'Hot Drinks', 60.00,  20.00, 80,  15, 'Traditional Indian spiced tea'),
('BAR-SAN-001', 'Grilled Veg Sandwich', 'bar', 'Snacks',    180.00,  70.00, 30,  10, 'Toasted sandwich with veggies'),
('BAR-PAN-001', 'Paneer Wrap',          'bar', 'Snacks',    220.00,  90.00, 25,   8, 'Cottage cheese wrap'),
('BAR-ENE-001', 'Sports Energy Drink',  'bar', 'Beverages', 150.00,  60.00, 40,  10, 'Electrolyte replenishment drink');

SELECT 'Setup complete!' AS status;
