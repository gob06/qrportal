#!/usr/bin/env node
// Creates (or resets the password of) an administrator account.
// Usage: node scripts/createAdmin.js <username> <password>
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: node scripts/createAdmin.js <username> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (username, password_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [username, hash]
  );
  console.log(`Administrator "${username}" created/updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
