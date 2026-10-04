# 🏆 The Champions Club – Sports & Leisure Management ERP System

[![Node.js Version](https://img.shields.io/badge/node.js-v18%2B-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-MySQL%20%7C%20MariaDB-blue.svg)](https://www.mysql.com/)
[![Frontend](https://img.shields.io/badge/frontend-Vanilla%20JS%20%7C%20Bootstrap%205.3-purple.svg)](https://getbootstrap.com/)
[![Payments](https://img.shields.io/badge/payments-Razorpay%20Gateway%20Live-orange.svg)](https://razorpay.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

A comprehensive, enterprise-grade Sports Club Management ERP and Point-of-Sale (POS) application. Built for elite sports clubs, sports academies, and recreational resorts to manage **multi-sport court bookings (Tennis, Cricket, Badminton)**, **tiered membership lifecycles with automatic discount engines**, **Pro Shop retail inventory**, **Sports Bar & Cafeteria POS with real-time Kitchen Display System (KDS)**, **Dynamic Dining Table Reservations**, **Automated Staff Payroll & Printable Indian Payslip Generation**, **Razorpay Gateway checkout**, **CRM Lead Pipelines**, and **Executive Analytics**.

Built with a **zero-build vanilla stack**: **Node.js, Express.js, MySQL/MariaDB (`mysql2/promise`), express-session, bcryptjs, Razorpay SDK, Chart.js, Bootstrap 5.3 CDN, and Vanilla ES6 JavaScript**.

---

## 📑 Table of Contents

1. [Key Features Overview](#-key-features-overview)
2. [Portals & User Roles](#-portals--user-roles)
   - [1. Public Landing Page & Member Onboarding](#1-public-landing-page--member-onboarding)
   - [2. Club Owner & Executive Admin Dashboard](#2-club-owner--executive-admin-dashboard)
   - [3. Specialized Staff Operations Dashboards](#3-specialized-staff-operations-dashboards)
   - [4. Member Self-Service Portal](#4-member-self-service-portal)
3. [Deep-Dive: Specialized Business Engines](#-deep-dive-specialized-business-engines)
   - [Atomic Double-Booking Prevention & Live Schedule Matrix](#atomic-double-booking-prevention--live-schedule-matrix)
   - [Multi-Department POS, Bar Tabs & Table Locking](#multi-department-pos-bar-tabs--table-locking)
   - [Automated Indian Payroll & Printable Payslip Engine](#automated-indian-payroll--printable-payslip-engine)
   - [Razorpay Online Payment Gateway Integration](#razorpay-online-payment-gateway-integration)
   - [Unified Payment & Refund Ledger](#unified-payment--refund-ledger)
   - [Interactive Admin "View" Modals across All Tabs](#interactive-admin-view-modals-across-all-tabs)
4. [System Architecture & Folder Structure](#-system-architecture--folder-structure)
5. [Database Schema & Entity Relationship](#-database-schema--entity-relationship)
6. [API Endpoints Reference](#-api-endpoints-reference)
7. [Installation & Setup Guide](#-installation--setup-guide)
8. [Demo Login Credentials](#-demo-login-credentials)
9. [Automated Verification & Test Suite](#-automated-verification--test-suite)

---

## 🌟 Key Features Overview

- 🏟️ **Court & Facility Booking Engine**: 30-minute atomic timeslot generator, real-time availability matrix, automated collision prevention, maintenance blackout blocks, and instant Razorpay payment checkout.
- 💳 **Membership Tier Lifecycle**: Silver, Gold, and Platinum tiers with customizable court, pro shop, and cafeteria discount rates, daily booking limits, junior guardian KYC, and background expiry tracking.
- 🛍️ **Pro Shop Inventory & Retail POS**: Barcode/SKU management, variant matrix (sizes, grip sizes, weights), cost vs. selling profit margin metrics, stock adjustment logs, and low stock reorder alerts.
- ☕ **Sports Bar & Cafeteria with KDS & Table Locking**: Dine-in table management across dining sections, dynamic table booking & locking by member name, kitchen display board (Received -> Preparing -> Served), and take-away counter checkout.
- 💵 **Staff Directory & Indian Payroll System**: Department assignment (Court Desk, Pro Shop, Bar & Cafe, General Operations), automated salary calculation (Base, HRA, Transport, Performance Bonus, Overtime Pay, PF, PT, TDS, Leave LOP deductions, Net salary in words), and printable official payslip vouchers.
- 💳 **Razorpay Checkout & Unified Ledger**: Seamless payment integration for Memberships, Court Bookings, Shop Sales, and Cafe Orders supporting Cards, Netbanking, UPI, and Wallets (MobiKwik, Paytm, etc.) with automatic signature verification and refund tracking.
- 🎯 **CRM Lead Pipeline & Conversion**: Capture prospects from web forms or walk-ins, track stages (`New`, `Contacted`, `Quoted`, `Trial Booked`, `Converted`, `Lost`), log follow-ups, and convert leads into active members with 1-click.
- 📊 **Executive Analytics & Charts**: Real-time KPI summary tiles, 30-day revenue trends (Chart.js), revenue breakdown by department, 30-day membership expiry warning list, and inventory reorder alerts.
- 🎨 **Unified Shell UI & Rich Data Tables**: Clean responsive navigation with light/dark theme toggle, slide-out notification drawer, and rich interactive **View Modals** on every single data table.

---

## 👥 Portals & User Roles

### 1. Public Landing Page & Member Onboarding
- **URL**: `/index.html`, `/shared/contact.html`, `/shared/login.html`
- **Hero & Facilities Showcase**: Interactive cards presenting Championship Tennis Courts, Cricket Practice Nets, Badminton Arenas, Pro Shop, and Sports Bar.
- **Membership Plan Comparison**: Real-time tier benefits matrix (pricing, court discounts, merchandise perks, guest passes).
- **Public Lead Form**: Instant prospective member lead capture routing directly to the CRM pipeline.
- **Unified Login**: Role-aware authentication automatically redirecting to Owner, Staff, or Member portal based on session privileges.

---

### 2. Club Owner & Executive Admin Dashboard
- **URL**: `/owner/dashboard.html`
- **Unified Navigation Tabs**:
  1. **Executive Dashboard (`dashboard.html`)**: Live today's revenue, active members, daily scheduled bookings, 30-day expiring memberships count, low stock alert counter, 30-day revenue line chart, and revenue-by-department donut chart.
  2. **CRM Leads (`leads.html`)**: Kanban board and list view of prospect inquiries, status progression, follow-up note logging, and 1-click conversion to active members with initial plan selection.
  3. **Members Directory (`members.html`)**: Member roster with search/filters, tier badge, status toggle (Active/Suspended/Expired), and rich **View Member Profile Modal** displaying personal details, emergency contact, junior guardian information, check-in history, and plan renewal history.
  4. **Court Reservations (`bookings.html`)**: List table with payment status chips and live **Schedule Matrix** view showing slot reservations. **View Booking Modal** with booking codes, court schedules, payment logs, player details, and cancellation reasons.
  5. **Courts & Blocks (`courts.html`)**: Court configurations, base hourly pricing, surface type, maintenance blocking, and **View Court Modal** with direct link to live slot matrix.
  6. **Orders & Sales Ledger (`orders.html`)**: Complete transaction ledger across Pro Shop, Bar Counter, Table Dine-in, and Online Deliveries. **Order Details Drawer** with itemized bill, plan discount breakdown, and fulfillment status controls.
  7. **Products & Inventory (`products.html`)**: Retail and F&B catalog management, variant matrix, stock tracking, and **View Product Modal** with stock movement history and profit margin calculations.
  8. **Payments Ledger (`payments.html`)**: Financial ledger of all inflows (Memberships, Bookings, POS Sales) and refunds with **View Payment Voucher Modal**.
  9. **Membership Plans (`plans.html`)**: Tier editor (Annual fee, duration, court/shop/bar discount rates, max bookings/day, junior flag) and **View Plan Modal** showing active enrolled members.
  10. **Staff & Payroll Hub (`staff.html`)**:
      - **Tab 1 (Staff Directory)**: Staff profiles, assigned operational area, activation toggle, and **View Staff Profile Modal** with assigned workspace links, compensation summary, and recent shifts.
      - **Tab 2 (Payroll & Payslips)**: Full automated payroll disbursal engine with interactive **View & Print Payslip Voucher Modal** (PDF export ready).

---

### 3. Specialized Staff Operations Dashboards
- **URL**: `/staff/dashboard.html`, `/staff/shop-dashboard.html`, `/staff/cafeteria.html`, `/staff/bar-dashboard.html`
- **Court Booking Desk (`/staff/dashboard.html`)**:
  - Live Court Schedule Matrix across all courts and sports.
  - Member Quick Check-In via Member Code or Mobile Number.
  - Walk-in / Phone Reservation creation with instant slot booking.
- **Pro Shop Counter POS (`/staff/shop-dashboard.html`)**:
  - Quick-search product catalog with category filters and barcode search.
  - Member discount lookup: entering Member Code automatically applies their tier discount percentage to the cart.
  - Multi-payment checkout (Cash, Card, UPI, Member Account tab).
  - Quick stock restock / adjustment modal.
- **Bar & Cafeteria POS (`/staff/cafeteria.html`)**:
  - Grid menu with category tabs (Beverages, Snacks, Health Meals, Protein Shakes).
  - Table selection & Dynamic Table Locking by member name.
  - Live Cart with automatic member discount calculations.
  - Add & Edit Food Item modal with SKU generator, cost price, selling price, and reorder threshold.
  - Add New Dining Table modal (label, seating capacity, floor section).
  - Table Release modal (releases occupied tables and closes active tabs).
- **Kitchen Display System & Bar Tabs (`/staff/bar-dashboard.html`)**:
  - Real-time KDS order board categorizing orders into `Received`, `Preparing`, and `Ready / Served`.
  - Active Dine-in Table map showing occupied vs. available tables with occupant member names.

---

### 4. Member Self-Service Portal
- **URL**: `/member/dashboard.html`
- **Digital Membership Card (`dashboard.html`)**: Live member badge, member code (`CC-0001`), plan tier privileges, validity days remaining, and quick action shortcuts.
- **Online Court Booking (`book.html` & `bookings.html`)**:
  - Sport selection (Tennis, Cricket, Badminton).
  - Visual 30-minute time slot picker showing available, booked, and past slots.
  - Instant online checkout via **Razorpay Gateway** (Cards, UPI, Netbanking, Wallets) with auto-applied tier discount.
  - View upcoming and past bookings with easy 1-click cancellation.
- **Pro Shop Gear Store (`shop.html`)**:
  - Browse apparel, rackets, balls, and accessories with exclusive member tier discount pricing shown in real-time.
  - Place pickup orders.
- **Bar & Cafeteria Ordering (`cafeteria.html`)**:
  - Digital menu with dietary tags and live prices.
  - Table reservation: Select an available dining table (e.g. Table 1, Patio-3) to lock the table under the member's name.
  - Place dine-in or takeaway food and drink orders with Razorpay or Pay-at-Counter.
  - **Live Order & Kitchen History**: View real-time food & product order status (`Order Placed` ➔ `In the Kitchen / Preparing` ➔ `Served / Completed`).

---

## ⚙️ Deep-Dive: Specialized Business Engines

### Atomic Double-Booking Prevention & Live Schedule Matrix
- **Database Level Locking**: Every 60-minute booking creates two consecutive 30-minute records in `booking_slots` protected by a `UNIQUE KEY (court_id, slot_start)`.
- **Concurrency Protection**: During checkout, booking requests use `SELECT ... FOR UPDATE` inside an ACID MySQL transaction. Concurrent collisions immediately return a clean `409 Conflict`.
- **Daily Booking Quota Guard**: Daily limits (e.g. max 2 bookings/day for Silver) are verified atomically before slot acquisition.

### Multi-Department POS, Bar Tabs & Table Locking
- **Member Plan Discount Engine**: When a member code is entered at any POS counter or online store, the system looks up their active plan discount rates (`court_discount_pct`, `shop_discount_pct`, `bar_discount_pct`) and applies them line-by-line.
- **Dynamic Dining Table Locking**:
  - When a member orders food and selects an available table, the system locks that table in `dining_tables` with `is_occupied = 1`, storing the occupant member's name and active order code.
  - Staff bar dashboard visually highlights locked tables in red with occupant names and allows 1-click table release once dining is complete.

### Automated Indian Payroll & Printable Payslip Engine
- **Salary Computation Engine**:
  $$\text{Gross Salary} = \text{Base} + \text{HRA} + \text{Transport} + \text{Bonus} + (\text{Overtime Hours} \times \text{Overtime Rate})$$
  $$\text{Total Deductions} = \text{PF} + \text{PT} + \text{TDS} + \left(\frac{\text{Base}}{30} \times \text{Unpaid Leave Days}\right)$$
  $$\text{Net Salary} = \text{Gross Salary} - \text{Total Deductions}$$
- **Features**:
  - Multi-staff batch payslip generation or individual staff pay execution.
  - Converts Net Salary into standard Indian currency words (e.g., *INR Thirty-Seven Thousand Four Hundred Only*).
  - Generates unique reference codes (`PAY-202610-002-841`).
  - Printable salary voucher with club header, earnings/deductions table, bank settlement metadata, and authorized signatory blocks.

### Razorpay Online Payment Gateway Integration
- **Direct Checkout Modal**: Embedded Razorpay Standard Checkout SDK handling live and test mode transactions.
- **Supported Payment Modes**: Credit/Debit Cards, Netbanking (50+ banks), UPI (Google Pay, PhonePe, Paytm, BHIM), and Mobile Wallets (MobiKwik, Freecharge, Airtel Money).
- **Auto Prefill**: Automatically pre-populates member's name, email, and 10-digit phone number.
- **Server Verification**: Cryptographic HMAC-SHA256 signature verification route (`/api/payments/razorpay/verify`) that validates payment before creating bookings or confirming store/cafe orders.

### Unified Payment & Refund Ledger
- Central financial table (`payments`) tracks all inflows from:
  - Membership enrollments and renewals
  - Court bookings
  - Pro Shop POS sales
  - Cafeteria & Bar dine-in tabs
- Automated refund tracking links parent payments with `refund_of_id`.

### Interactive Admin "View" Modals across All Tabs
Every admin dashboard tab is equipped with a functional **View** button opening a modal with comprehensive information:
- **Members**: Personal profile, plan privileges, emergency contact, junior guardian KYC, recent check-ins, and renewal history.
- **Bookings**: Booking code, court specs, player info, slot intervals, linked payment transactions, and cancellation logs.
- **Courts**: Base rates, surface specifications, active booking counts, upcoming matches, and link to matrix view.
- **Products**: SKU, selling price, cost price, profit margin %, stock inventory, and adjustment history.
- **Plans**: Privileges, discounts, duration, fees, and list of enrolled members.
- **Payments**: Transaction voucher, settlement details, gateway references, and refund history.
- **Staff**: Staff profile, assigned operational area, dashboard link, compensation totals, recent payslips, and shift assignments.

---

## 🏗️ System Architecture & Folder Structure

```
odooXld/
├── .env.example                     # Environment template
├── package.json                     # Project manifest and scripts
├── README.md                        # Documentation
├── server/
│   ├── server.js                    # Express application entrypoint
│   ├── config.js                    # System configuration & operational parameters
│   ├── db.js                        # MySQL connection pool & transaction manager
│   ├── middleware/
│   │   ├── auth.js                  # RBAC (requireLogin, requireRole)
│   │   └── validate.js              # Request body schema validator
│   ├── routes/                      # REST API Endpoints
│   │   ├── auth.js                  # Session & authentication
│   │   ├── members.js               # Member directory, profiles, check-ins, renewals
│   │   ├── bookings.js              # Court reservations, live matrix, slot locking
│   │   ├── courts.js                # Court specs, maintenance blocks
│   │   ├── products.js              # Pro shop & bar catalog, stock adjustments
│   │   ├── orders.js                # POS orders, table bookings, dining tables API
│   │   ├── payments.js              # Unified payment ledger & Razorpay verify
│   │   ├── plans.js                 # Membership plan tiers
│   │   ├── staff.js                 # Staff roster & Indian payroll engine
│   │   ├── leads.js                 # CRM prospect pipeline & conversion
│   │   ├── reports.js               # Analytics, revenue trends, KPIs
│   │   ├── notifications.js         # User notifications
│   │   └── search.js                # Global search engine
│   ├── services/                    # Business Logic Layer
│   │   ├── bookingService.js        # Slot allocation, collision lock, cancellation
│   │   ├── memberService.js         # Member creation, renewal, discount lookup
│   │   ├── orderService.js          # Order state machine, stock deduction
│   │   ├── pricing.js               # Pure financial calculation engine
│   │   └── expiryJob.js             # Background membership expiry checker
│   ├── sql/
│   │   └── schema.sql               # Relational database schema (tables, keys, indexes)
│   ├── scripts/
│   │   ├── seed.js                  # Demo data seeder
│   │   ├── init_dining_tables.js    # Dining tables seeder
│   │   ├── setup_payroll.js         # Payroll tables setup
│   │   └── test-all.js              # 31-point automated test suite
│   └── utils/
│       ├── time.js                  # Timezone (IST) & time helper utilities
│       └── validators.js            # Input validation regex
└── client/
    ├── css/
    │   └── main.css                 # Design tokens, dark mode, glassmorphism, responsive styles
    ├── js/
    │   ├── api.js                   # Unified fetch API client
    │   ├── ui.js                    # UI notifications, modals, confirm dialogs, skeletons
    │   ├── utils.js                 # INR currency, date formatters, debounced search
    │   ├── validators.js            # Form validation helpers
    │   ├── razorpay.js              # Razorpay modal integration helper
    │   └── shell.js                 # Universal layout shell (sidebar, topbar, SPA router)
    ├── shared/
    │   ├── login.html               # Authentication login page
    │   └── contact.html             # Public contact & inquiry page
    ├── owner/                       # Club Owner & Admin Views
    │   ├── dashboard.html           # Executive KPI dashboard & revenue charts
    │   ├── members.html             # Member management & profile viewer
    │   ├── bookings.html            # Court booking list & schedule matrix
    │   ├── courts.html              # Court management & maintenance blocks
    │   ├── orders.html              # Order ledger & fulfilment drawer
    │   ├── products.html            # Products catalog & stock ledger
    │   ├── plans.html               # Membership tiers & enrolled members
    │   ├── payments.html            # Financial transactions ledger
    │   ├── staff.html               # Staff directory & Indian payroll / payslips
    │   └── leads.html               # CRM pipeline & lead conversion
    ├── staff/                       # Staff Operational Dashboards
    │   ├── dashboard.html           # Court booking front desk & quick check-in
    │   ├── shop-dashboard.html      # Pro shop retail POS & stock manager
    │   ├── cafeteria.html           # Bar & Cafe POS, dining tables & food catalog
    │   └── bar-dashboard.html       # Kitchen Display System (KDS) & table map
    └── member/                      # Member Portal
        ├── dashboard.html           # Member dashboard & digital membership card
        ├── membership.html          # Plan benefits & renewal
        ├── book.html                # Live court slot booking with Razorpay checkout
        ├── bookings.html            # My bookings & cancellation
        ├── shop.html                # Pro shop member store
        └── cafeteria.html           # Bar & Cafe dining, table booking & order tracker
```

---

## 💾 Database Schema & Entity Relationship

The system runs on a normalized relational schema with foreign key constraints, indexes, and transactional consistency:

| Table Name | Description | Key Columns |
|---|---|---|
| **`users`** | Authentication credentials & accounts | `id`, `email`, `password_hash`, `role` (`owner`/`staff`/`member`), `full_name`, `phone`, `assigned_area`, `is_active` |
| **`plans`** | Membership tiers & privilege configuration | `id`, `code`, `name`, `annual_fee`, `duration_months`, `court_discount_pct`, `shop_discount_pct`, `bar_discount_pct`, `max_bookings_per_day`, `is_junior` |
| **`members`** | Member profile details & active plan link | `id`, `user_id`, `member_code`, `plan_id`, `date_of_birth`, `join_date`, `expiry_date`, `status`, `emergency_contact_name`, `emergency_contact_phone` |
| **`member_guardians`** | Junior member guardian KYC & consent | `id`, `member_id`, `guardian_name`, `relationship`, `phone`, `consent_given` |
| **`member_checkins`** | Physical front desk check-in history | `id`, `member_id`, `checked_in_by`, `method`, `checkin_time`, `notes` |
| **`membership_history`** | Plan enrollment & renewal audit trail | `id`, `member_id`, `plan_id`, `action`, `start_date`, `end_date`, `amount_paid` |
| **`courts`** | Sports facilities & base pricing | `id`, `name`, `sport` (`Tennis`/`Cricket`/`Badminton`), `surface_type`, `base_price_per_hour`, `is_active` |
| **`court_blocks`** | Maintenance & tournament blackout periods | `id`, `court_id`, `block_date`, `start_time`, `end_time`, `reason` |
| **`bookings`** | Court reservation headers | `id`, `booking_code`, `court_id`, `user_id`, `member_id`, `guest_name`, `booking_date`, `start_time`, `end_time`, `price_charged`, `status` |
| **`booking_slots`** | Atomic 30-min timeslots (Collision Guard) | `id`, `booking_id`, `court_id`, `slot_time`, `UNIQUE KEY (court_id, slot_time)` |
| **`products`** | Merchandise & F&B catalog | `id`, `sku`, `name`, `department` (`shop`/`bar`), `category`, `price`, `cost_price`, `stock_qty`, `reorder_level`, `track_stock`, `is_active` |
| **`product_variants`** | Size, grip, and weight options | `id`, `product_id`, `variant_name`, `sku_suffix`, `price_offset`, `stock_qty`, `reorder_level` |
| **`orders`** | POS & Online sales headers | `id`, `order_code`, `department`, `channel`, `user_id`, `member_id`, `table_no`, `subtotal`, `discount_amount`, `total`, `status`, `fulfilment_status` |
| **`order_items`** | Itemized lines per order | `id`, `order_id`, `product_id`, `variant_id`, `quantity`, `unit_price`, `line_total` |
| **`dining_tables`** | Dynamic restaurant & bar tables | `id`, `table_number`, `capacity`, `section`, `is_occupied`, `occupied_by_member_name`, `current_order_id` |
| **`payroll_payslips`** | Staff payroll & salary vouchers | `id`, `payslip_code`, `user_id`, `staff_name`, `pay_period_month`, `pay_period_year`, `base_salary`, `hra_allowance`, `gross_salary`, `total_deductions`, `net_salary`, `payment_status` |
| **`payments`** | Central financial transaction ledger | `id`, `payment_code`, `source`, `reference_id`, `user_id`, `amount`, `method` (`card`/`upi`/`wallet`/`cash`), `status`, `refund_of_id`, `payment_reference` |
| **`leads`** | CRM sales pipeline & prospects | `id`, `name`, `phone`, `email`, `interest`, `source`, `status`, `converted_member_id` |

---

## 📡 API Endpoints Reference

### Authentication & Sessions
- `POST /api/auth/login` – Authenticate user and initialize role-based session
- `POST /api/auth/logout` – Destroy session and clear cookies
- `GET /api/auth/me` – Retrieve currently logged-in user profile & role

### Members Management
- `GET /api/members` – Search, filter, and paginate member records
- `GET /api/members/:id` – Fetch complete member profile, guardian, check-ins & renewal history
- `POST /api/members` – Register new member with plan enrollment
- `PUT /api/members/:id` – Update member KYC & details
- `POST /api/members/:id/renew` – Renew membership plan with instant ledger entry
- `POST /api/members/:id/checkin` – Log front desk physical attendance
- `DELETE /api/members/:id` – Delete member account (Owner only)

### Court Bookings & Live Matrix
- `GET /api/bookings` – List bookings with filters (date, court, status)
- `GET /api/bookings/:id` – Fetch single booking details, court specs & payment records
- `GET /api/bookings/court-matrix` – Retrieve 30-minute time slot availability matrix
- `POST /api/bookings` – Create booking with atomic slot locking
- `PUT /api/bookings/:id` – Update booking status (confirmed, completed, no-show)
- `POST /api/bookings/:id/cancel` – Cancel booking and process automated refund

### Products & Inventory
- `GET /api/products` – List products filtered by department (`shop`/`bar`), category, stock status
- `GET /api/products/:id` – Fetch product details, variants, and stock movement logs
- `POST /api/products` – Create new product & variants
- `PUT /api/products/:id` – Update product, pricing, reorder thresholds & stock
- `POST /api/products/:id/stock` – Log stock restock, count adjustment, or damage wastage
- `PUT /api/products/:id/toggle-active` – Toggle product visibility

### Orders & Dining Tables
- `GET /api/orders` – Sales ledger with department, channel, and status filters
- `GET /api/orders/:id` – Fetch itemized order breakdown
- `POST /api/orders` – Checkout POS / cafe order with stock deduction
- `PUT /api/orders/:id/fulfilment` – Update Kitchen / Delivery fulfilment status
- `GET /api/orders/tables` – Fetch all dining tables with live occupancy status
- `POST /api/orders/tables` – Add new dining table (label, capacity, section)
- `POST /api/orders/tables/:id/release` – Release occupied table & close tab

### Payments & Razorpay Integration
- `GET /api/payments` – Retrieve unified financial transaction ledger
- `GET /api/payments/:id` – Fetch payment voucher details & refund tracking
- `POST /api/payments/razorpay/create-order` – Create Razorpay server order ID
- `POST /api/payments/razorpay/verify` – Cryptographically verify HMAC-SHA256 signature and confirm order/booking

### Staff & Payroll Hub
- `GET /api/staff` – List staff members and operational assignments
- `GET /api/staff/:id` – Staff profile, assigned area, and compensation history
- `POST /api/staff` – Register staff user
- `PUT /api/staff/:id` – Update staff profile & permissions
- `GET /api/staff/payroll/summary` – Aggregate payroll metrics (total disbursed, average salary)
- `GET /api/staff/payroll/payslips` – List payslips with month/year/area filters
- `GET /api/staff/payroll/payslips/:id` – Fetch full printable salary voucher
- `POST /api/staff/payroll/payslips` – Compute & disburse payroll for staff
- `DELETE /api/staff/payroll/payslips/:id` – Remove payslip record

### CRM Leads Pipeline
- `GET /api/leads` – List leads with status/interest filters
- `GET /api/leads/:id` – Lead profile, inquiry message & activity timeline
- `POST /api/leads` – Capture new lead
- `PUT /api/leads/:id` – Update pipeline status (`new` ➔ `contacted` ➔ `quoted` ➔ `converted`)
- `POST /api/leads/:id/convert` – Convert lead to active member

### Executive Reports & Analytics
- `GET /api/reports/dashboard` – High-level KPI metrics (revenue, bookings, expiring counts, low stock)
- `GET /api/reports/revenue` – 30-day daily revenue trend & departmental breakdown

---

## 🚀 Installation & Setup Guide

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **MySQL / MariaDB**: Server running on port `3306` or `3307` (e.g. XAMPP, MySQL Server)

### 1. Clone & Install
```bash
git clone https://github.com/jaydipbdevaliya27-cloud/odooXld.git
cd odooXld
npm install
```

### 2. Configure Environment (`.env`)
Create a `.env` file at the project root (or copy `.env.example`):
```env
PORT=3000
DB_HOST=localhost
DB_PORT=3307
DB_USER=root
DB_PASSWORD=
DB_NAME=champions_club
SESSION_SECRET=champions_club_secret_session_key_2026

# Optional: Razorpay Test Credentials (defaults to mock simulator if blank)
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourSecretKeyHere
```

### 3. Initialize Database & Seed Demo Data
```bash
# Automatically sets up schema, relational tables, and initial seed records
node server/scripts/seed.js
```

### 4. Start Development Server
```bash
# Start with live reload
npm run dev

# Or start in standard mode
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🔑 Demo Login Credentials

| Role | Email | Password | Default Portal URL | Key Capabilities |
|---|---|---|---|---|
| **Club Owner / Executive** | `owner@champions.club` | `Owner@123` | `/owner/dashboard.html` | Full system access, financials, payroll disbursal, member CRUD, reports |
| **Court Desk Staff** | `staff@champions.club` | `Staff@123` | `/staff/dashboard.html` | Live court schedule, member desk check-in, walk-in booking creation |
| **Pro Shop Staff** | `shopstaff@champions.club` | `Staff@123` | `/staff/shop-dashboard.html` | Retail POS, member discounts, stock adjustments, inventory |
| **Bar & Cafe Staff** | `barstaff@champions.club` | `Staff@123` | `/staff/cafeteria.html` | Cafe POS, table management, KDS kitchen display, order preparation |
| **Gold Tier Member** | `ravi@example.com` | `Member@123` | `/member/dashboard.html` | Court slot booking, Razorpay checkout, pro shop pickup, cafe orders |
| **Platinum Tier Member** | `priya@example.com` | `Member@123` | `/member/dashboard.html` | VIP tier discounts, table dine-in booking, live order tracking |
| **Silver Tier Member** | `carlos@example.com` | `Member@123` | `/member/dashboard.html` | Standard privileges, bookings management, digital membership card |

---

## 🧪 Automated Verification & Test Suite

The project includes an end-to-end automated test suite verifying all business rules, concurrency constraints, discount calculations, and payroll formulas.

Run the test suite:
```bash
node server/scripts/test-all.js
```

### Verified Assertions:
1. ✅ **Atomic Collision Check**: Double-booking prevention via unique slot constraints (`409 Conflict`).
2. ✅ **Membership Tier Discount Calculation**: Accurate line-item discount math for courts, shop, and cafe.
3. ✅ **Daily Booking Quota Enforcement**: Blocking booking attempts exceeding member's daily limit.
4. ✅ **POS Stock State Machine**: Real-time deduction on checkout and inventory restoration on cancellation.
5. ✅ **Indian Payroll Math**: Gross, statutory deductions (PF, PT, TDS), LOP leave deductions, and Net salary computation.
6. ✅ **Razorpay Signature Verification**: HMAC-SHA256 authentication of payment callbacks.
7. ✅ **Dynamic Table Locking**: Table reservation occupancy updates and release lifecycle.
8. ✅ **CRM Conversion**: Lead conversion into active member with credential creation.

---

## 📄 License
This project is open-source under the **MIT License**. Built for high-performance sports and club management.
