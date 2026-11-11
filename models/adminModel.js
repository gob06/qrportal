const { pool } = require('../config/database');

async function findByUsername(username) {
  const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.query('SELECT id, username, created_at FROM admins WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function create(username, passwordHash) {
  const [result] = await pool.query(
    'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
    [username, passwordHash]
  );
  return result.insertId;
}

async function logActivity(adminId, action, description) {
  await pool.query(
    'INSERT INTO admin_activity_logs (admin_id, action, description) VALUES (?, ?, ?)',
    [adminId, action, description]
  );
}

async function recentActivity(limit = 10) {
  const [rows] = await pool.query(
    `SELECT l.action, l.description, l.created_at, a.username
     FROM admin_activity_logs l
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = { findByUsername, findById, create, logActivity, recentActivity };
