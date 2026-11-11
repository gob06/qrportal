const { pool } = require('../config/database');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'org';
}

async function generateUniqueSlug(name, excludeId = null) {
  const base = slugify(name);
  let slug = base;
  let i = 1;
  // Loop until the slug is free (bounded by existing org count).
  for (;;) {
    const [rows] = excludeId
      ? await pool.query('SELECT id FROM organizations WHERE slug = ? AND id <> ? LIMIT 1', [slug, excludeId])
      : await pool.query('SELECT id FROM organizations WHERE slug = ? LIMIT 1', [slug]);
    if (rows.length === 0) return slug;
    i += 1;
    slug = `${base}-${i}`;
  }
}

/**
 * Allocates a permanent organization identifier (e.g. ORG-000001).
 * Identifiers come from an append-only registry table so they are
 * never reused, even if the organization is later archived or deleted.
 */
async function allocatePermanentId(conn) {
  const placeholder = `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const [result] = await conn.query(
    'INSERT INTO permanent_id_registry (permanent_id) VALUES (?)',
    [placeholder]
  );
  const permanentId = `ORG-${String(result.insertId).padStart(6, '0')}`;
  await conn.query(
    'UPDATE permanent_id_registry SET permanent_id = ? WHERE id = ?',
    [permanentId, result.insertId]
  );
  return permanentId;
}

/**
 * Creates an organization with an immutable permanent_id and
 * permanent_qr_url, assigned exactly once inside a transaction.
 */
async function create(data, baseUrl) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const permanentId = await allocatePermanentId(conn);
    const permanentQrUrl = `${baseUrl.replace(/\/+$/, '')}/org/${permanentId}`;
    const slug = await generateUniqueSlug(data.name);
    const [result] = await conn.query(
      `INSERT INTO organizations
        (permanent_id, name, slug, logo, description, primary_color, secondary_color,
         background_color, contact_info, permanent_qr_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        permanentId,
        data.name,
        slug,
        data.logo || null,
        data.description || null,
        data.primary_color || '#0d6efd',
        data.secondary_color || '#6c757d',
        data.background_color || '#f8f9fa',
        data.contact_info || null,
        permanentQrUrl,
        data.status === 'inactive' ? 'inactive' : 'active'
      ]
    );
    await conn.commit();
    return { id: result.insertId, permanentId, slug, permanentQrUrl };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Updates editable fields only. permanent_id and permanent_qr_url are
 * intentionally excluded and additionally protected by a DB trigger.
 */
async function update(id, data) {
  const fields = [];
  const values = [];
  const editable = ['name', 'slug', 'logo', 'description', 'primary_color',
    'secondary_color', 'background_color', 'contact_info', 'status'];
  for (const key of editable) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(data[key]);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM organizations WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findByPermanentId(permanentId) {
  const [rows] = await pool.query(
    'SELECT * FROM organizations WHERE permanent_id = ? LIMIT 1', [permanentId]);
  return rows[0] || null;
}

async function findBySlug(slug) {
  const [rows] = await pool.query('SELECT * FROM organizations WHERE slug = ? LIMIT 1', [slug]);
  return rows[0] || null;
}

async function list({ search = '', sort = 'created_at', dir = 'desc', page = 1, perPage = 10, includeArchived = false } = {}) {
  const sortable = { name: 'name', slug: 'slug', status: 'status', created_at: 'created_at' };
  const sortCol = sortable[sort] || 'created_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (Math.max(1, page) - 1) * perPage;
  const where = [];
  const params = [];
  if (!includeArchived) where.push('archived_at IS NULL');
  if (search) {
    where.push('(name LIKE ? OR slug LIKE ? OR permanent_id LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT * FROM organizations ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    [...params, perPage, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM organizations ${whereSql}`, params);
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}

async function counts() {
  const [[row]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'active' AND archived_at IS NULL) AS active,
       SUM(status = 'inactive' AND archived_at IS NULL) AS inactive,
       SUM(archived_at IS NOT NULL) AS archived
     FROM organizations`);
  return {
    total: Number(row.total || 0),
    active: Number(row.active || 0),
    inactive: Number(row.inactive || 0),
    archived: Number(row.archived || 0)
  };
}

async function setStatus(id, status) {
  await pool.query('UPDATE organizations SET status = ? WHERE id = ?', [status, id]);
}

/**
 * Soft delete: archives the record. The permanent_id stays in the registry
 * and in the organizations row, so it can never be reassigned.
 */
async function archive(id) {
  await pool.query(
    "UPDATE organizations SET archived_at = CURRENT_TIMESTAMP, status = 'inactive' WHERE id = ?", [id]);
}

async function restore(id) {
  await pool.query(
    "UPDATE organizations SET archived_at = NULL, status = 'active' WHERE id = ?", [id]);
}

/** Hard delete. The registry row keeps the identifier reserved forever. */
async function destroy(id) {
  await pool.query('DELETE FROM organizations WHERE id = ?', [id]);
}

module.exports = {
  slugify,
  generateUniqueSlug,
  create,
  update,
  findById,
  findByPermanentId,
  findBySlug,
  list,
  counts,
  setStatus,
  archive,
  restore,
  destroy
};
