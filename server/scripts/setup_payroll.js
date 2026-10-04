const mysql = require('mysql2/promise');
require('dotenv').config({ path: './server/.env' });

async function setupPayrollTable() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3307,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Umesh@2005',
    database: process.env.DB_NAME || 'champions_club'
  });

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS payroll_payslips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payslip_code VARCHAR(50) NOT NULL UNIQUE,
      user_id INT NOT NULL,
      staff_name VARCHAR(100) NOT NULL,
      staff_email VARCHAR(100) NOT NULL,
      assigned_area VARCHAR(50) NOT NULL DEFAULT 'general',
      pay_period_month VARCHAR(20) NOT NULL,
      pay_period_year INT NOT NULL,
      base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
      hra_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
      transport_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
      performance_bonus DECIMAL(10,2) NOT NULL DEFAULT 0,
      overtime_pay DECIMAL(10,2) NOT NULL DEFAULT 0,
      overtime_hours DECIMAL(5,2) NOT NULL DEFAULT 0,
      gross_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
      provident_fund DECIMAL(10,2) NOT NULL DEFAULT 0,
      professional_tax DECIMAL(10,2) NOT NULL DEFAULT 0,
      income_tax_tds DECIMAL(10,2) NOT NULL DEFAULT 0,
      unpaid_leave_deduction DECIMAL(10,2) NOT NULL DEFAULT 0,
      leave_days INT NOT NULL DEFAULT 0,
      total_deductions DECIMAL(10,2) NOT NULL DEFAULT 0,
      net_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_method ENUM('bank_transfer', 'upi', 'cheque', 'cash') NOT NULL DEFAULT 'bank_transfer',
      payment_status ENUM('draft', 'paid', 'processing') NOT NULL DEFAULT 'paid',
      payment_reference VARCHAR(100) NULL,
      paid_at DATETIME NULL,
      created_by_user_id INT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_payslip_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await conn.query(createTableSql);
  console.log('Created payroll_payslips table successfully.');

  const [existing] = await conn.query('SELECT COUNT(*) AS count FROM payroll_payslips');
  if (existing[0].count === 0) {
    await conn.query(`
      INSERT INTO payroll_payslips (
        payslip_code, user_id, staff_name, staff_email, assigned_area,
        pay_period_month, pay_period_year, base_salary, hra_allowance, transport_allowance,
        performance_bonus, overtime_pay, overtime_hours, gross_salary, provident_fund,
        professional_tax, income_tax_tds, unpaid_leave_deduction, leave_days,
        total_deductions, net_salary, payment_method, payment_status, payment_reference, paid_at, notes
      ) VALUES 
      ('PAYSLIP-202609-002', 2, 'Desk Staff - Court Booking', 'staff.booking@championsclub.com', 'booking',
       'September', 2026, 35000.00, 10500.00, 3000.00, 2500.00, 1500.00, 6.00, 52500.00,
       4200.00, 200.00, 1500.00, 0.00, 0, 5900.00, 46600.00, 'bank_transfer', 'paid', 'NEFT-CC992144', '2026-09-30 18:30:00', 'September 2026 Regular Salary'),
      ('PAYSLIP-202609-003', 3, 'Shop Operations Staff', 'staff.shop@championsclub.com', 'shop',
       'September', 2026, 32000.00, 9600.00, 2500.00, 3000.00, 1200.00, 5.00, 48300.00,
       3840.00, 200.00, 1200.00, 1066.67, 1, 6306.67, 41993.33, 'bank_transfer', 'paid', 'NEFT-CC992145', '2026-09-30 18:30:00', 'September 2026 Regular Salary'),
      ('PAYSLIP-202609-004', 4, 'Cafeteria & Bar Staff', 'staff.bar@championsclub.com', 'bar',
       'September', 2026, 30000.00, 9000.00, 2500.00, 2000.00, 2000.00, 8.00, 45500.00,
       3600.00, 200.00, 1000.00, 0.00, 0, 4800.00, 40700.00, 'upi', 'paid', 'UPI-CC992146', '2026-09-30 18:30:00', 'September 2026 Regular Salary');
    `);
    console.log('Inserted sample payroll payslips.');
  }

  await conn.end();
}

setupPayrollTable().catch(console.error);
