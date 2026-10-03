/**
 * @file server/db.js
 * @description MySQL connection pool using mysql2/promise.
 * THIS IS THE ONLY FILE IN THE PROJECT THAT OPENS A DATABASE CONNECTION.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

// MySQL pool configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3307', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'champions_club',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  timezone: '+05:30',
  decimalNumbers: true,
  multipleStatements: true
});

/**
 * Executes a parameterized SQL query on the pool.
 * @param {string} sql - Parameterized SQL query string with ? placeholders
 * @param {Array} params - Array of parameter values
 * @returns {Promise<Array>} [rows, fields]
 */
async function query(sql, params = []) {
  return await pool.query(sql, params);
}

/**
 * Executes an async callback inside an atomic transaction.
 * Automatically commits on success and rolls back on error.
 * @param {Function} callback - async function(connection)
 * @returns {Promise<any>}
 */
async function transaction(callback) {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  query,
  transaction
};
