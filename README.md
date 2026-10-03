# 🏆 The Champions Club Management System

A full-stack club management web application built for sports clubs featuring court bookings (tennis, cricket, badminton), membership tiers with automatic discount calculation, gear shop POS, sports bar tabs, unified payment ledgers, CRM lead tracking, and executive analytics reports.

Built with **Node.js, Express, MySQL/MariaDB (mysql2/promise), express-session, bcryptjs, Bootstrap 5.3 CDN, and Vanilla JS**.

---

## 🚀 Quickstart

### Prerequisites
- Node.js (v18+)
- MySQL or MariaDB (e.g. XAMPP running on port `3306` or `3307`)

### 1. Configure Environment
Create or verify `.env` at the project root:
```env
PORT=3000
DB_HOST=localhost
DB_PORT=3307
DB_USER=root
DB_PASSWORD=
DB_NAME=champions_club
SESSION_SECRET=champions_club_secret_session_key_2026
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Initialize Database & Seed Demo Data
```bash
npm run seed
```
*(The schema and seed script automatically set up all 11 tables and demo data.)*

### 4. Run Automated Test Suite
```bash
node server/scripts/test-all.js
```
*(Runs 31 automated assertions across all 10 core functional criteria.)*

### 5. Start the Server
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🔑 Demo Login Credentials

| Role | Email | Password | Dashboard URL |
|---|---|---|---|
| **Owner / Manager** | `owner@champions.club` | `Owner@123` | `/owner/dashboard.html` |
| **Staff Member** | `staff@champions.club` | `Staff@123` | `/staff/dashboard.html` |
| **Member (Gold Tier)** | `ravi@example.com` | `Member@123` | `/member/dashboard.html` |
| **Member (Junior Tier)** | `priya@example.com` | `Member@123` | `/member/dashboard.html` |
| **Member (Silver Tier)** | `carlos@example.com` | `Member@123` | `/member/dashboard.html` |

---

## 🏛️ System Architecture

```
odooXld/
├── server/
│   ├── server.js               # Express entry point, middleware, routes mounting
│   ├── config.js               # Operational parameters (opening hours, slots, defaults)
│   ├── db.js                   # MySQL connection pool & transaction helper
│   ├── middleware/
│   │   └── auth.js             # requireLogin, requireRole RBAC middleware
│   ├── routes/                 # Express API endpoints
│   │   ├── auth.js             # Login, logout, session /me
│   │   ├── members.js          # Member listing, detail, enrollment, renewal
│   │   ├── plans.js            # Membership plan CRUD
│   │   ├── courts.js           # Court listing, availability grid, CRUD
│   │   ├── bookings.js         # Booking create, list, cancel
│   │   ├── products.js         # Shop & Bar product CRUD & stock management
│   │   ├── orders.js           # POS & bar orders, tabs, checkout
│   │   ├── payments.js         # Centralized payment ledger
│   │   ├── leads.js            # CRM inquiries, follow-up, member conversion
│   │   └── reports.js          # Owner KPI cards, revenue, expiry, low stock
│   ├── services/               # Reusable business logic
│   │   ├── pricing.js          # Pure discount and total calculators
│   │   ├── memberService.js    # Member lifecycle & transactions
│   │   ├── bookingService.js   # Slot generator, SELECT FOR UPDATE locking, limit checks
│   │   └── orderService.js     # Stock deduction, order state machine, refunds
│   ├── sql/
│   │   └── schema.sql          # 11 relational tables with foreign keys and indexes
│   └── scripts/
│       ├── seed.js             # Seed demo users, plans, courts, products, leads
│       └── test-all.js         # Comprehensive 31-point test suite
└── client/
    ├── css/
    │   └── main.css            # Custom brand tokens, glassmorphism, KPI cards, slot grid
    ├── js/
    │   ├── api.js              # Thin fetch wrapper with 401 handling
    │   └── utils.js            # Formatting (INR, dates), alert banners, session helpers
    ├── shared/
    │   ├── login.html          # Role-redirecting login page
    │   └── contact.html        # Public membership inquiry / lead capture
    ├── owner/                  # Executive views (dashboard, members, bookings, orders, etc.)
    ├── staff/                  # Front desk view (today's schedule, quick actions)
    └── member/                 # Member portal (membership card, slot booking, history)
```

---

## 💾 Database Schema (11 Tables)

1. **`users`**: Human accounts with bcrypt password hashes and roles (`owner`, `staff`, `member`, `visitor`).
2. **`plans`**: Membership tiers (`Silver`, `Gold`, `Junior`) with configurable discount percentages for courts, shop, and bar, plus daily booking limits.
3. **`members`**: Member profile extending user account, storing `member_code` (`CC-0001`), join date, expiry date, and status.
4. **`courts`**: Sports facilities (Tennis, Cricket, Badminton) with hourly base rates.
5. **`bookings`**: Booking header capturing court, member/guest, time range, price charged, and discount applied.
6. **`booking_slots`**: 30-minute atomic slots with `UNIQUE KEY (court_id, slot_start)` preventing concurrent double-bookings at the database level.
7. **`products`**: Inventory catalog for Shop (gear/accessories) and Bar (food/beverages) with reorder levels and stock tracking.
8. **`orders`**: Sale headers for POS counter sales, bar tabs, and online requests.
9. **`order_items`**: Line items per order capturing quantity, unit price, and notes.
10. **`payments`**: Central financial ledger recording all inflows (memberships, court bookings, shop sales, bar tabs) and refunds.
11. **`leads`**: Prospective member pipeline (`new`, `contacted`, `quoted`, `converted`, `lost`).

---

## 🛠️ Key Architectural Decisions

1. **Atomic Double-Booking Prevention via DB Constraints**:
   - Rather than relying solely on application-level checks, each 60-minute booking inserts two 30-minute rows into `booking_slots` with a `UNIQUE KEY (court_id, slot_start)`. Concurrency collisions trigger MySQL error `1062` / `ER_DUP_ENTRY`, returning a clean `409 Conflict`.
2. **Dynamic Server-Side Pricing Verification**:
   - Product prices and discount percentages are always resolved from database records inside transaction locks. Client-supplied price values are ignored to ensure financial integrity.
3. **Daily Booking Quotas via `SELECT FOR UPDATE`**:
   - Member daily limits are enforced within transactions by counting active bookings for the specified date and validating against the member's current tier.
4. **Zero-Build Vanilla Stack for Student Accessibility**:
   - Vanilla ES6 JavaScript and Bootstrap 5.3 CDN are used with clear modular structure, allowing any student or engineer to run and inspect without webpack, babel, or framework overhead.
