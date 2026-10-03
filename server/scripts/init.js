require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function init() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true
    });

    console.log('Connected! Dropping outdated DB and loading schema...');
    await connection.query('DROP DATABASE IF EXISTS champions_club;');
    const schema = fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8');
    await connection.query(schema);
    console.log('Schema loaded.');
    await connection.end();
}

init().catch(e => { console.error(e); process.exit(1); });
