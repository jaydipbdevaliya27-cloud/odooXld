-- ==========================================================================
-- The Champions Club Management System - Database Schema
-- 11 Tables: users, plans, members, courts, bookings, booking_slots,
--            products, orders, order_items, payments, leads
-- Run once: mysql -u root -p < server/sql/schema.sql
-- ==========================================================================

CREATE DATABASE IF NOT EXISTS champions_club;
USE champions_club;

-- 1. USERS  (one row per human: member, staff, or owner)
CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('visitor','member','staff','owner') NOT NULL DEFAULT 'member',
    full_name     VARCHAR(255) NOT NULL,
    phone         VARCHAR(50),
    is_active     TINYINT(1)  NOT NULL DEFAULT 1,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_role  (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. PLANS  (membership tiers; discounts stored as percentages)
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

-- 3. MEMBERS  (extends users for paid members)
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

-- 5. BOOKINGS  (one row per booking session)
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

-- 6. BOOKING_SLOTS  (one row per 30-min slot; UNIQUE key prevents double-booking)
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

-- 7. PRODUCTS  (shop gear and bar food/drinks)
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

-- 8. ORDERS  (shop or bar sale header)
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

-- 9. ORDER_ITEMS  (line items for each order)
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

-- 10. PAYMENTS  (central payment ledger for all revenue streams)
CREATE TABLE IF NOT EXISTS payments (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    payment_code  VARCHAR(50)  NOT NULL UNIQUE,
    source        ENUM('membership','court','shop','bar') NOT NULL,
    reference_id  INT          NOT NULL,   -- FK to the relevant table (not enforced at DB level for flexibility)
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

-- 11. LEADS  (prospective members; staff follow up and convert)
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
