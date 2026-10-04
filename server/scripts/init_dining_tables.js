/**
 * @file server/scripts/init_dining_tables.js
 * @description Initialize and seed dynamic dining tables.
 */

const db = require('../db');

async function initDiningTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS dining_tables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        table_number VARCHAR(50) NOT NULL UNIQUE,
        capacity INT DEFAULT 4,
        section VARCHAR(50) DEFAULT 'Main Dining',
        status ENUM('available', 'occupied', 'reserved', 'maintenance') DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [rows] = await db.query('SELECT COUNT(*) AS count FROM dining_tables');
    if (rows[0].count === 0) {
      for (let i = 1; i <= 12; i++) {
        const section = i <= 4 ? 'Indoor Lounge' : (i <= 8 ? 'Main Dining' : 'Patio Garden');
        const cap = i % 4 === 0 ? 6 : (i % 2 === 0 ? 4 : 2);
        await db.query(
          'INSERT INTO dining_tables (table_number, capacity, section) VALUES (?, ?, ?)',
          [`Table ${i}`, cap, section]
        );
      }
      console.log('[OK] Seeded 12 default dining tables.');
    } else {
      console.log(`[OK] Dining tables already exist (${rows[0].count} tables).`);
    }

    const [tables] = await db.query('SELECT * FROM dining_tables ORDER BY id ASC');
    console.log('[OK] Current dining tables:', tables.map(t => `${t.table_number} (${t.section})`).join(', '));
  } catch (err) {
    console.error('[ERROR] Initializing dining tables:', err);
    throw err;
  }
}

if (require.main === module) {
  initDiningTables().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { initDiningTables };
