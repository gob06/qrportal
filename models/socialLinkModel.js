const { pool } = require('../config/database');

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook', icon: 'bi-facebook', color: '#1877f2' },
  { key: 'instagram', label: 'Instagram', icon: 'bi-instagram', color: '#e4405f' },
  { key: 'tiktok', label: 'TikTok', icon: 'bi-tiktok', color: '#010101' },
  { key: 'youtube', label: 'YouTube', icon: 'bi-youtube', color: '#ff0000' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'bi-linkedin', color: '#0a66c2' },
  { key: 'x', label: 'X (Twitter)', icon: 'bi-twitter-x', color: '#000000' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'bi-whatsapp', color: '#25d366' },
  { key: 'telegram', label: 'Telegram', icon: 'bi-telegram', color: '#26a5e4' },
  { key: 'website', label: 'Website', icon: 'bi-globe', color: '#0d6efd' },
  { key: 'email', label: 'Email', icon: 'bi-envelope-fill', color: '#6c757d' },
  { key: 'custom', label: 'Custom URL', icon: 'bi-link-45deg', color: '#6610f2' }
];

function platformMeta(key) {
  return PLATFORMS.find((p) => p.key === key) || PLATFORMS[PLATFORMS.length - 1];
}

function isValidUrl(url, platform) {
  if (platform === 'email') {
    return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url);
  }
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeUrl(url, platform) {
  if (platform === 'email' && !url.startsWith('mailto:')) return `mailto:${url}`;
  return url;
}

async function listByOrganization(organizationId, activeOnly = false) {
  const statusSql = activeOnly ? "AND status = 'active'" : '';
  const [rows] = await pool.query(
    `SELECT * FROM social_links WHERE organization_id = ? ${statusSql}
     ORDER BY display_order ASC, id ASC`,
    [organizationId]
  );
  return rows;
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM social_links WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function create(organizationId, data) {
  const [[{ next }]] = await pool.query(
    'SELECT COALESCE(MAX(display_order), 0) + 1 AS next FROM social_links WHERE organization_id = ?',
    [organizationId]
  );
  const [result] = await pool.query(
    `INSERT INTO social_links (organization_id, platform, display_name, account_url, display_order, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [organizationId, data.platform, data.display_name, data.account_url, next,
      data.status === 'inactive' ? 'inactive' : 'active']
  );
  return result.insertId;
}

async function update(id, data) {
  await pool.query(
    `UPDATE social_links SET platform = ?, display_name = ?, account_url = ?, status = ?
     WHERE id = ?`,
    [data.platform, data.display_name, data.account_url,
      data.status === 'inactive' ? 'inactive' : 'active', id]
  );
}

async function setStatus(id, status) {
  await pool.query('UPDATE social_links SET status = ? WHERE id = ?', [status, id]);
}

async function destroy(id) {
  await pool.query('DELETE FROM social_links WHERE id = ?', [id]);
}

async function reorder(organizationId, orderedIds) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < orderedIds.length; i += 1) {
      await conn.query(
        'UPDATE social_links SET display_order = ? WHERE id = ? AND organization_id = ?',
        [i + 1, orderedIds[i], organizationId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  PLATFORMS,
  platformMeta,
  isValidUrl,
  normalizeUrl,
  listByOrganization,
  findById,
  create,
  update,
  setStatus,
  destroy,
  reorder
};
