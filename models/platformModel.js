const crypto = require('crypto');
const { pool } = require('../config/database');
const settingsModel = require('./settingsModel');
const { PLATFORMS, platformMeta } = require('./socialLinkModel');

const PREFIX = 'social_platform:';

async function list() {
  const [rows] = await pool.query(
    'SELECT setting_key, setting_value FROM application_settings WHERE setting_key LIKE ? ORDER BY setting_key',
    [`${PREFIX}%`]
  );
  const platforms = PLATFORMS.map(platform => ({ ...platform, logo: null }));
  for (const row of rows) {
    const key = row.setting_key.slice(PREFIX.length);
    const saved = JSON.parse(row.setting_value);
    if (typeof saved?.label !== 'string' || typeof saved?.logo !== 'string' ||
        !/^[a-z0-9_-]{1,30}$/.test(key) || !/^logo-[a-zA-Z0-9-]+-opt\.png$/.test(saved.logo)) {
      throw new Error(`Invalid social platform configuration: ${row.setting_key}`);
    }
    const index = platforms.findIndex(platform => platform.key === key);
    const platform = {
      ...platformMeta(key), key, label: saved.label, logo: saved.logo
    };
    if (index === -1) platforms.push(platform);
    else platforms[index] = platform;
  }
  return platforms;
}

function metadata(platforms) {
  return key => platforms.find(platform => platform.key === key) || platformMeta(key);
}

async function save(key, label, logo) {
  const platformKey = key || `p_${crypto.randomBytes(12).toString('hex')}`;
  await settingsModel.set(`${PREFIX}${platformKey}`, JSON.stringify({ label, logo }));
  return platformKey;
}

module.exports = { list, metadata, save };
