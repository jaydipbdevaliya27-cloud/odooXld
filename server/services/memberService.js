/**
 * @file server/services/memberService.js
 * @description Member management business logic.
 * All DB access goes through db.js; no raw connections here.
 *
 * Exported functions:
 *   listMembers(filters)                 – paginated member list with plan info
 *   getMemberById(id)                    – single member + plan + user details
 *   enrollMember(data)                   – create user + member + payment in one transaction
 *   updateMember(id, data)               – update member details
 *   renewMember(memberId, planId, method)– extend expiry + record payment
 */

const bcrypt  = require('bcryptjs');
const db      = require('../db');
const pricing = require('./pricing');

const HASH_ROUNDS = 10;
const PAGE_SIZE   = 20;

// ── Generate sequential member code ──────────────────────────────────────────
async function nextMemberCode() {
  const [[{ maxId }]] = await db.query("SELECT COALESCE(MAX(id), 0) AS maxId FROM members");
  let nextNum = Number(maxId) + 1;
  let code = `CC-${String(nextNum).padStart(4, '0')}`;
  let [exists] = await db.query("SELECT id FROM members WHERE member_code = ?", [code]);
  while (exists.length > 0) {
    nextNum++;
    code = `CC-${String(nextNum).padStart(4, '0')}`;
    [exists] = await db.query("SELECT id FROM members WHERE member_code = ?", [code]);
  }
  return code;
}

// ── listMembers ───────────────────────────────────────────────────────────────
/**
 * Returns paginated list of members with plan and user fields.
 * @param {object} filters – { search, status, plan_id, page }
 */
async function listMembers({ search = '', status = '', plan_id = '', page = 1 } = {}) {
  let where  = '1=1';
  const params = [];

  if (search) {
    where += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR m.member_code LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status)  { where += ' AND m.status = ?';  params.push(status); }
  if (plan_id) { where += ' AND m.plan_id = ?'; params.push(plan_id); }

  const offset = (page - 1) * PAGE_SIZE;

  const [members] = await db.query(
    `SELECT m.*, u.full_name, u.email, u.phone, u.role,
            p.name AS plan_name,
            p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct,
            p.max_bookings_per_day
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
      WHERE ${where}
      ORDER BY m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  // Total count for pagination
  const [[countRow]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM members m
       JOIN users u ON m.user_id = u.id
      WHERE ${where}`,
    params
  );

  return { members, total: countRow.total, page, pages: Math.ceil(countRow.total / PAGE_SIZE) };
}

// ── getMemberById ─────────────────────────────────────────────────────────────
async function getMemberById(id) {
  const [rows] = await db.query(
    `SELECT m.*, u.full_name, u.email, u.phone,
            p.name AS plan_name,
            p.court_discount_pct, p.shop_discount_pct, p.bar_discount_pct,
            p.max_bookings_per_day
       FROM members m
       JOIN users u ON m.user_id = u.id
       JOIN plans p ON m.plan_id = p.id
      WHERE m.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// ── enrollMember ──────────────────────────────────────────────────────────────
/**
 * Creates a new user account + member record + membership payment in one transaction.
 * @param {object} data – { full_name, email, phone, plan_id, password, payment_method,
 *                          date_of_birth, emergency_contact_name, emergency_contact_phone }
 * @returns {object} newly created member row
 */
async function enrollMember(data) {
  const full_name = data.full_name || data.fullName;
  const email = data.email;
  const phone = data.phone;
  const plan_id = data.plan_id || data.planId;
  const password = data.password || 'Champions@123';
  const payment_method = data.payment_method || data.paymentMethod || 'cash';
  const date_of_birth = data.date_of_birth || data.dateOfBirth;
  const emergency_contact_name = data.emergency_contact_name || data.emergencyContactName;
  const emergency_contact_phone = data.emergency_contact_phone || data.emergencyContactPhone;
  const notes = data.notes;

  if (!full_name || !email || !plan_id) {
    throw new Error('full_name, email, and plan_id are required');
  }

  // Fetch plan to get fee and duration
  const [plans] = await db.query('SELECT * FROM plans WHERE id = ? AND is_active = 1', [plan_id]);
  if (!plans.length) throw new Error('Plan not found or inactive');
  const plan = plans[0];

  return db.transaction(async (conn) => {
    // Check for duplicate email
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length) throw new Error(`Email ${email} is already registered`);

    // Create user account
    const passwordHash = await bcrypt.hash(password, HASH_ROUNDS);
    const [userResult] = await conn.query(
      "INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?,?,?,?,?)",
      [email.toLowerCase(), passwordHash, 'member', full_name, phone || null]
    );
    const userId = userResult.insertId;

    // Generate member code
    const memberCode = await nextMemberCode();

    // Calculate join and expiry dates
    const joinDate   = new Date().toISOString().slice(0, 10);
    const expDate    = new Date();
    expDate.setMonth(expDate.getMonth() + plan.duration_months);
    const expiryDate = expDate.toISOString().slice(0, 10);

    // Insert member record
    const [memberResult] = await conn.query(
      `INSERT INTO members
         (user_id, member_code, plan_id, date_of_birth, join_date, expiry_date,
          emergency_contact_name, emergency_contact_phone, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [userId, memberCode, plan_id, date_of_birth || null, joinDate, expiryDate,
       emergency_contact_name || null, emergency_contact_phone || null, notes || null]
    );
    const memberId = memberResult.insertId;

    // Record membership payment
    const paymentCode = `PAY-MEM-${Date.now()}`;
    await conn.query(
      `INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method)
       VALUES (?,?,?,?,?,?)`,
      [paymentCode, 'membership', memberId, userId, plan.annual_fee, payment_method]
    );

    // Return the created member
    const [rows] = await conn.query(
      `SELECT m.*, u.full_name, u.email, p.name AS plan_name
         FROM members m JOIN users u ON m.user_id=u.id JOIN plans p ON m.plan_id=p.id
        WHERE m.id=?`,
      [memberId]
    );
    return rows[0];
  });
}

// ── updateMember ──────────────────────────────────────────────────────────────
async function updateMember(id, data) {
  const { status, notes, plan_id, emergency_contact_name, emergency_contact_phone } = data;

  await db.query(
    `UPDATE members SET status=?, notes=?, plan_id=?,
            emergency_contact_name=?, emergency_contact_phone=?
       WHERE id=?`,
    [status, notes || null, plan_id, emergency_contact_name || null, emergency_contact_phone || null, id]
  );
  return getMemberById(id);
}

// ── renewMember ───────────────────────────────────────────────────────────────
/**
 * Extends a member's expiry date by the plan's duration_months.
 * Records a payment entry.
 */
async function renewMember(memberId, planId, paymentMethod = 'cash') {
  const member = await getMemberById(memberId);
  if (!member) throw new Error('Member not found');

  const [plans] = await db.query('SELECT * FROM plans WHERE id = ? AND is_active = 1', [planId || member.plan_id]);
  if (!plans.length) throw new Error('Plan not found');
  const plan = plans[0];

  // New expiry = current expiry + duration (or today + duration if already expired)
  const base     = new Date(member.expiry_date) > new Date() ? new Date(member.expiry_date) : new Date();
  base.setMonth(base.getMonth() + plan.duration_months);
  const newExpiry = base.toISOString().slice(0, 10);

  await db.query(
    "UPDATE members SET plan_id=?, expiry_date=?, status='active' WHERE id=?",
    [plan.id, newExpiry, memberId]
  );

  const paymentCode = `PAY-REN-${Date.now()}`;
  await db.query(
    "INSERT INTO payments (payment_code, source, reference_id, user_id, amount, method) VALUES (?,?,?,?,?,?)",
    [paymentCode, 'membership', memberId, member.user_id, plan.annual_fee, paymentMethod]
  );

  return { message: 'Membership renewed', new_expiry: newExpiry, plan: plan.name };
}

module.exports = { listMembers, getMemberById, enrollMember, updateMember, renewMember };