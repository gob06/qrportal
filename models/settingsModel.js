const { pool } = require('../config/database');

const DEFAULTS = {
  site_name: 'Social QR Portal',
  site_logo: '',
  site_url: process.env.BASE_URL || 'http://localhost:3000',
  qr_default_fg: '#000000',
  qr_default_bg: '#ffffff',
  qr_default_size: '512',
  qr_default_ec: 'H',
  upload_max_mb: '5',
  analytics_retention_days: '365'
};

async function getAll() {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM application_settings');
  const settings = { ...DEFAULTS };
  for (const row of rows) settings[row.setting_key] = row.setting_value;
  return settings;
}

async function get(key) {
  const [rows] = await pool.query(
    'SELECT setting_value FROM application_settings WHERE setting_key = ? LIMIT 1', [key]);
  return rows.length ? rows[0].setting_value : (DEFAULTS[key] ?? null);
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO application_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value]
  );
}

async function setMany(entries) {
  for (const [key, value] of Object.entries(entries)) {
    await set(key, value);
  }
}

module.exports = { DEFAULTS, getAll, get, set, setMany };
