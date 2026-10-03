-- ==========================================================================
-- The Champions Club Management System - Consolidated Production Schema
-- Clean, idempotent, non-prefixed tables
-- ==========================================================================

CREATE DATABASE IF NOT EXISTS champions_club;
USE champions_club;

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    role                ENUM('visitor','member','staff','owner') NOT NULL DEFAULT 'member',
    full_name           VARCHAR(255) NOT NULL,
    phone               VARCHAR(50),
    assigned_area       ENUM('shop','bar','booking','general') NOT NULL DEFAULT 'general',
    must_change_password TINYINT(1)  NOT NULL DEFAULT 0,
    is_active           TINYINT(1)   NOT NULL DEFAULT 1,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_role  (role),
    INDEX idx_users_area  (assigned_area)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. PLANS
CREATE TABLE IF NOT EXISTS plans (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    code                 VARCHAR(50)    NOT NULL UNIQUE,
    name                 VARCHAR(100)   NOT NULL,
    description          TEXT,
    annual_fee           DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    duration_months      INT            NOT NULL DEFAULT 12,
    court_discount_pct   DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    shop_discount_pct    DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    bar_discount_pct     DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
    max_bookings_per_day INT            NOT NULL DEFAULT 2,
    is_junior            TINYINT(1)     NOT NULL DEFAULT 0,
    is_active            TINYINT(1)     NOT NULL DEFAULT 1,
    created_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_plans_active (is_active)
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

-- 4. MEMBER GUARDIANS (for under-18 junior members)
CREATE TABLE IF NOT EXISTS member_guardians (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    member_id      INT NOT NULL,
    guardian_name  VARCHAR(255) NOT NULL,
    relationship   VARCHAR(100) NOT NULL,
    phone          VARCHAR(50)  NOT NULL,
    consent_given  TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    INDEX idx_guardian_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. MEMBER CHECK-INS
CREATE TABLE IF NOT EXISTS member_checkins (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    member_id      INT NOT NULL,
    checked_in_by  INT NULL,
    method         ENUM('code','qr','phone','manual') NOT NULL DEFAULT 'code',
    checkin_time   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes          VARCHAR(255),
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (checked_in_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_checkins_member (member_id),
    INDEX idx_checkins_time   (checkin_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. MEMBERSHIP HISTORY
CREATE TABLE IF NOT EXISTS membership_history (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    member_id   INT NOT NULL,
    plan_id     INT NOT NULL,
    action      ENUM('joined','renewed','plan_changed','suspended','reactivated') NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    notes       TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id)   REFERENCES plans(id)   ON UPDATE CASCADE,
    INDEX idx_history_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. COURTS
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

-- 8. COURT BLOCKS / MAINTENANCE
CREATE TABLE IF NOT EXISTS court_blocks (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    court_id    INT NOT NULL,
    block_date  DATE NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    reason      VARCHAR(255) NOT NULL,
    created_by  INT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (court_id)   REFERENCES courts(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE SET NULL,
    INDEX idx_court_blocks (court_id, block_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. SOCIAL SESSIONS (e.g. Friday Night Social Play)
CREATE TABLE IF NOT EXISTS social_sessions (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    title            VARCHAR(255) NOT NULL,
    court_id         INT NOT NULL,
    session_date     DATE NOT NULL,
    start_time       TIME NOT NULL,
    end_time         TIME NOT NULL,
    capacity         INT NOT NULL DEFAULT 16,
    price_per_person DECIMAL(10,2) NOT NULL DEFAULT 150.00,
    notes            TEXT,
    is_active        TINYINT(1) NOT NULL DEFAULT 1,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE,
    INDEX idx_social_sessions_date (session_date, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. SOCIAL SESSION REGISTRATIONS
CREATE TABLE IF NOT EXISTS social_session_registrations (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    session_id     INT NOT NULL,
    user_id        INT NULL,
    guest_name     VARCHAR(255) NULL,
    guest_phone    VARCHAR(50)  NULL,
    status         ENUM('registered','cancelled') NOT NULL DEFAULT 'registered',
    payment_status ENUM('paid','pending') NOT NULL DEFAULT 'paid',
    amount_paid    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    registered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES social_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)           ON DELETE SET NULL,
    INDEX idx_social_reg_session (session_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. BOOKINGS
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
    source               ENUM('member_portal','front_desk','phone','walk_in') NOT NULL DEFAULT 'member_portal',
    status               ENUM('confirmed','cancelled','completed','no_show') NOT NULL DEFAULT 'confirmed',
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
    INDEX idx_bookings_member_date  (member_id, booking_date),
    INDEX idx_bookings_status       (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. BOOKING SLOTS (Unique 30-minute slot units prevent double bookings atomically)
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

-- 13. BOOKING PARTICIPANTS
CREATE TABLE IF NOT EXISTS booking_participants (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    booking_id        INT NOT NULL,
    participant_name  VARCHAR(255) NOT NULL,
    participant_phone VARCHAR(50)  NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking_part (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. PRODUCTS
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
    INDEX idx_products_category (category),
    INDEX idx_products_sku      (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. PRODUCT VARIANTS
CREATE TABLE IF NOT EXISTS product_variants (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    product_id     INT          NOT NULL,
    variant_name   VARCHAR(100) NOT NULL,
    sku_suffix     VARCHAR(50)  NOT NULL,
    price_modifier DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_qty      INT          NOT NULL DEFAULT 0,
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uk_product_variant_sku (product_id, sku_suffix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. STOCK MOVEMENTS LEDGER
CREATE TABLE IF NOT EXISTS stock_movements (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    product_id     INT NOT NULL,
    movement_type  ENUM('sale','return','adjustment','restock','cancel','reservation') NOT NULL,
    quantity       INT NOT NULL,
    previous_stock INT NOT NULL,
    new_stock      INT NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id   INT NULL,
    notes          VARCHAR(255) NULL,
    created_by     INT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)    ON DELETE SET NULL,
    INDEX idx_stock_prod (product_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email          VARCHAR(255),
    phone          VARCHAR(50),
    address        TEXT,
    is_active      TINYINT(1) NOT NULL DEFAULT 1,
    created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. PURCHASE ORDERS
CREATE TABLE IF NOT EXISTS purchase_orders (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    po_number     VARCHAR(50) NOT NULL UNIQUE,
    supplier_id   INT NOT NULL,
    status        ENUM('draft','ordered','received','cancelled') NOT NULL DEFAULT 'draft',
    total_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    expected_date DATE NULL,
    received_date DATE NULL,
    notes         TEXT,
    created_by    INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (created_by)  REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_po_supplier (supplier_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 19. PURCHASE ORDER ITEMS
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    po_id             INT NOT NULL,
    product_id        INT NOT NULL,
    quantity          INT NOT NULL,
    unit_cost         DECIMAL(10,2) NOT NULL,
    received_quantity INT NOT NULL DEFAULT 0,
    FOREIGN KEY (po_id)      REFERENCES purchase_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 20. SERVICE JOBS (Racket Stringing & Repair)
CREATE TABLE IF NOT EXISTS service_jobs (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    job_code      VARCHAR(50) NOT NULL UNIQUE,
    member_id     INT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    racket_model  VARCHAR(255) NOT NULL,
    service_type  ENUM('stringing','grip_replacement','repair','customization') NOT NULL DEFAULT 'stringing',
    string_type   VARCHAR(100),
    tension       VARCHAR(50),
    price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status        ENUM('received','in_progress','ready','delivered','cancelled') NOT NULL DEFAULT 'received',
    notes         TEXT,
    received_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ready_at      DATETIME NULL,
    delivered_at  DATETIME NULL,
    created_by    INT NULL,
    FOREIGN KEY (member_id)  REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_service_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 21. BAR TABS
CREATE TABLE IF NOT EXISTS tabs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    tab_name    VARCHAR(100) NOT NULL,
    user_id     INT NULL,
    member_id   INT NULL,
    guest_name  VARCHAR(255) NULL,
    guest_phone VARCHAR(50) NULL,
    status      ENUM('open','settled','written_off') NOT NULL DEFAULT 'open',
    opened_by   INT NULL,
    closed_by   INT NULL,
    opened_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at   DATETIME NULL,
    notes       VARCHAR(255) NULL,
    FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (opened_by) REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (closed_by) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_tabs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 22. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    order_code        VARCHAR(50)  NOT NULL UNIQUE,
    department        ENUM('shop','bar') NOT NULL,
    channel           ENUM('table','counter','online') NOT NULL,
    table_no          VARCHAR(50)  NULL,
    tab_id            INT          NULL,
    user_id           INT          NULL,
    member_id         INT          NULL,
    guest_name        VARCHAR(255) NULL,
    guest_phone       VARCHAR(50)  NULL,
    delivery_address  TEXT         NULL,
    delivery_fee      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    courier_notes     VARCHAR(255) NULL,
    fulfilment_status ENUM('placed','packed','ready_for_pickup','out_for_delivery','collected','delivered','cancelled') NOT NULL DEFAULT 'placed',
    subtotal          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount_pct      DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
    discount_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status            ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
    created_by_user_id INT         NULL,
    closed_at         DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)            REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (member_id)          REFERENCES members(id) ON DELETE SET NULL,
    FOREIGN KEY (tab_id)             REFERENCES tabs(id)    ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)   ON DELETE SET NULL,
    INDEX idx_orders_dept_status (department, status),
    INDEX idx_orders_member      (member_id),
    INDEX idx_orders_tab         (tab_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 23. ORDER ITEMS
CREATE TABLE IF NOT EXISTS order_items (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    order_id       INT           NOT NULL,
    product_id     INT           NOT NULL,
    variant_id     INT           NULL,
    quantity       INT           NOT NULL DEFAULT 1,
    unit_price     DECIMAL(10,2) NOT NULL,
    line_total     DECIMAL(10,2) NOT NULL,
    kitchen_status ENUM('new','preparing','ready','served','cancelled') NOT NULL DEFAULT 'new',
    notes          VARCHAR(255)  NULL,
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
    INDEX idx_order_items_order   (order_id),
    INDEX idx_order_items_kitchen (kitchen_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 24. DAILY CLOSINGS (Z-Report)
CREATE TABLE IF NOT EXISTS daily_closings (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    closing_date    DATE NOT NULL,
    department      ENUM('bar','shop','all') NOT NULL DEFAULT 'all',
    opening_float   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    cash_collected  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    counted_cash    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    cash_variance   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_revenue   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    card_revenue    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    upi_revenue     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    online_revenue  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    closed_by       INT NULL,
    notes           TEXT,
    closed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uk_daily_closing (closing_date, department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 25. SHIFTS
CREATE TABLE IF NOT EXISTS shifts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time   TIME NOT NULL,
    is_active  TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 26. SHIFT ASSIGNMENTS / CLOCK IN-OUT
CREATE TABLE IF NOT EXISTS shift_assignments (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    shift_id        INT NOT NULL,
    user_id         INT NOT NULL,
    assignment_date DATE NOT NULL,
    clock_in        DATETIME NULL,
    clock_out       DATETIME NULL,
    notes           VARCHAR(255) NULL,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
    INDEX idx_shift_assign (user_id, assignment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 27. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    payment_code  VARCHAR(50)  NOT NULL UNIQUE,
    source        ENUM('membership','court','shop','bar','service','social') NOT NULL,
    reference_id  INT          NOT NULL,
    user_id       INT          NULL,
    amount        DECIMAL(10,2) NOT NULL,
    method        ENUM('cash','card','upi','online') NOT NULL,
    status        ENUM('paid','refunded','failed') NOT NULL DEFAULT 'paid',
    refund_of_id  INT          NULL,
    notes         VARCHAR(255) NULL,
    paid_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    refunded_at   DATETIME     NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)      REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (refund_of_id) REFERENCES payments(id) ON DELETE SET NULL,
    INDEX idx_payments_source  (source, status),
    INDEX idx_payments_paid_at (paid_at),
    INDEX idx_payments_method  (method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 28. EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    expense_code VARCHAR(50) NOT NULL UNIQUE,
    category     ENUM('utilities','maintenance','equipment','salaries','supplies','other') NOT NULL,
    vendor       VARCHAR(255) NOT NULL,
    amount       DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    payment_mode ENUM('cash','bank_transfer','upi','card','cheque') NOT NULL,
    receipt_url  VARCHAR(500) NULL,
    notes        TEXT,
    created_by   INT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_expenses_date (expense_date, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 29. INVOICES (GST Compliant)
CREATE TABLE IF NOT EXISTS invoices (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    invoice_type   ENUM('membership','corporate','booking_bulk','general') NOT NULL DEFAULT 'membership',
    user_id        INT NULL,
    client_name    VARCHAR(255) NOT NULL,
    client_gstin   VARCHAR(50) NULL,
    client_address TEXT NULL,
    invoice_date   DATE NOT NULL,
    due_date       DATE NOT NULL,
    subtotal       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    cgst_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    sgst_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    igst_amount    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_amount   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status         ENUM('draft','sent','paid','overdue','cancelled') NOT NULL DEFAULT 'draft',
    notes          TEXT,
    created_by     INT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_invoices_date (invoice_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 30. INVOICE ITEMS
CREATE TABLE IF NOT EXISTS invoice_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id   INT NOT NULL,
    description  VARCHAR(255) NOT NULL,
    hsn_sac      VARCHAR(50) NULL,
    quantity     INT NOT NULL DEFAULT 1,
    unit_price   DECIMAL(10,2) NOT NULL,
    tax_rate_pct DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    line_total   DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 31. LEADS (CRM)
CREATE TABLE IF NOT EXISTS leads (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255) NULL,
    phone               VARCHAR(50)  NULL,
    interested_plan_id  INT          NULL,
    message             TEXT,
    source              ENUM('website','walk_in','referral','social','phone') NOT NULL DEFAULT 'website',
    interest            ENUM('membership','court_rental','events','coaching','other') NOT NULL DEFAULT 'membership',
    status              ENUM('new','contacted','quoted','trial_booked','converted','lost') NOT NULL DEFAULT 'new',
    notes               TEXT,
    assigned_to_user_id INT          NULL,
    converted_member_id INT          NULL,
    follow_up_date      DATE         NULL,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (interested_plan_id)  REFERENCES plans(id)   ON DELETE SET NULL,
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)   ON DELETE SET NULL,
    FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL,
    INDEX idx_leads_status (status),
    INDEX idx_leads_followup (follow_up_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 32. LEAD FOLLOW-UPS
CREATE TABLE IF NOT EXISTS lead_followups (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    lead_id      INT NOT NULL,
    due_date     DATE NOT NULL,
    note         VARCHAR(255) NOT NULL,
    status       ENUM('pending','completed') NOT NULL DEFAULT 'pending',
    completed_at DATETIME NULL,
    created_by   INT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id)    REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_lead_followup_due (due_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 33. LEAD QUOTES
CREATE TABLE IF NOT EXISTS lead_quotes (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    quote_number     VARCHAR(50) NOT NULL UNIQUE,
    lead_id          INT NOT NULL,
    plan_id          INT NOT NULL,
    quoted_fee       DECIMAL(10,2) NOT NULL,
    discount_offered DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    validity_date    DATE NOT NULL,
    notes            TEXT,
    status           ENUM('sent','accepted','rejected','expired') NOT NULL DEFAULT 'sent',
    created_by       INT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id)    REFERENCES leads(id)  ON DELETE CASCADE,
    FOREIGN KEY (plan_id)    REFERENCES plans(id)  ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 34. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NULL,
    role_target ENUM('owner','staff','member','all') NOT NULL DEFAULT 'all',
    type        ENUM('membership_expiring','membership_expired','new_lead','low_stock','booking_cancelled','order_placed','followup_due','general') NOT NULL,
    title       VARCHAR(255) NOT NULL,
    message     TEXT NOT NULL,
    link        VARCHAR(255) NULL,
    is_read     TINYINT(1)   NOT NULL DEFAULT 0,
    read_at     DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notif_target (role_target, is_read),
    INDEX idx_notif_user   (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 35. SETTINGS
CREATE TABLE IF NOT EXISTS settings (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    setting_key   VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description   VARCHAR(255) NULL,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
