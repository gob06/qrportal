const crypto = require('crypto');
const { pool } = require('../config/database');

/**
 * Records a landing-page visit. Privacy-first: no raw IP, UA, name, email or
 * location is stored. anonymized_metadata holds a one-way daily-salted hash of
 * (IP + UA) that is only usable to estimate same-day unique visits.
 */
async function recordScan(organizationId, req) {
  const day = new Date().toISOString().slice(0, 10);
  const salt = `${process.env.SESSION_SECRET || 'salt'}:${day}`;
  const visitorHash = crypto
    .createHash('sha256')
    .update(`${salt}:${req.ip}:${req.get('user-agent') || ''}`)
    .digest('hex')
    .slice(0, 32);
  await pool.query(
    'INSERT INTO qr_scans (organization_id, anonymized_metadata) VALUES (?, ?)',
    [organizationId, visitorHash]
  );
}

async function totals() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS total FROM qr_scans');
  return Number(row.total || 0);
}

async function summary(organizationId = null) {
  const where = organizationId ? 'WHERE organization_id = ?' : '';
  const params = organizationId ? [organizationId] : [];
  const [[row]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(scanned_at >= CURDATE()) AS today,
       SUM(scanned_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS week,
       SUM(scanned_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS month,
       COUNT(DISTINCT CASE WHEN scanned_at >= CURDATE() THEN anonymized_metadata END) AS unique_today
     FROM qr_scans ${where}`, params);
  return {
    total: Number(row.total || 0),
    today: Number(row.today || 0),
    week: Number(row.week || 0),
    month: Number(row.month || 0),
    uniqueToday: Number(row.unique_today || 0)
  };
}

/** Daily scan counts for the last N days (fills empty days with 0). */
async function dailySeries(days = 30, organizationId = null) {
  const orgSql = organizationId ? 'AND organization_id = ?' : '';
  const params = organizationId ? [days - 1, organizationId] : [days - 1];
  const [rows] = await pool.query(
    `SELECT DATE(scanned_at) AS day, COUNT(*) AS scans
     FROM qr_scans
     WHERE scanned_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ${orgSql}
     GROUP BY DATE(scanned_at)
     ORDER BY day ASC`, params);
  const map = new Map(rows.map((r) => {
    const d = r.day instanceof Date
      ? new Date(r.day.getTime() - r.day.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      : String(r.day).slice(0, 10);
    return [d, Number(r.scans)];
  }));
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    series.push({ day: key, scans: map.get(key) || 0 });
  }
  return series;
}

async function perOrganization(limit = 20) {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.permanent_id, o.slug, COUNT(s.id) AS scans,
            MAX(s.scanned_at) AS last_scan
     FROM organizations o
     LEFT JOIN qr_scans s ON s.organization_id = o.id
     GROUP BY o.id
     ORDER BY scans DESC
     LIMIT ?`, [limit]);
  return rows;
}

async function recentScans(limit = 15) {
  const [rows] = await pool.query(
    `SELECT s.scanned_at, o.name, o.permanent_id
     FROM qr_scans s
     JOIN organizations o ON o.id = s.organization_id
     ORDER BY s.scanned_at DESC, s.id DESC
     LIMIT ?`, [limit]);
  return rows;
}

/** Deletes scan rows older than the retention window. */
async function purgeOldScans(retentionDays) {
  const days = Math.max(1, parseInt(retentionDays, 10) || 365);
  const [result] = await pool.query(
    'DELETE FROM qr_scans WHERE scanned_at < DATE_SUB(CURDATE(), INTERVAL ? DAY)', [days]);
  return result.affectedRows;
}

module.exports = { recordScan, totals, summary, dailySeries, perOrganization, recentScans, purgeOldScans };
