const settingsModel = require('../models/settingsModel');
const adminModel = require('../models/adminModel');
const analyticsService = require('../services/analyticsService');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

async function settingsPage(req, res, next) {
  try {
    const settings = await settingsModel.getAll();
    res.render('admin/settings', { settings, flash: req.query.msg || null, errors: [] });
  } catch (err) {
    next(err);
  }
}

async function saveSettings(req, res, next) {
  try {
    const errors = [];
    const b = req.body;
    const entries = {
      site_name: String(b.site_name || 'Social QR Portal').trim().slice(0, 100),
      site_url: String(b.site_url || '').trim().slice(0, 255),
      qr_default_fg: HEX_RE.test(b.qr_default_fg || '') ? b.qr_default_fg : '#000000',
      qr_default_bg: HEX_RE.test(b.qr_default_bg || '') ? b.qr_default_bg : '#ffffff',
      qr_default_size: String(Math.min(2048, Math.max(128, parseInt(b.qr_default_size, 10) || 512))),
      qr_default_ec: ['L', 'M', 'Q', 'H'].includes(b.qr_default_ec) ? b.qr_default_ec : 'H',
      upload_max_mb: String(Math.min(20, Math.max(1, parseInt(b.upload_max_mb, 10) || 5))),
      analytics_retention_days: String(Math.min(3650, Math.max(1, parseInt(b.analytics_retention_days, 10) || 365)))
    };
    if (entries.site_url) {
      try {
        const u = new URL(entries.site_url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad');
      } catch {
        errors.push('Website URL must be a valid http(s) URL.');
      }
    }
    if (errors.length) {
      const settings = await settingsModel.getAll();
      return res.status(400).render('admin/settings', { settings, flash: null, errors });
    }
    await settingsModel.setMany(entries);
    // Apply retention policy immediately.
    await analyticsService.purgeOldScans(entries.analytics_retention_days);
    await adminModel.logActivity(req.session.adminId, 'settings_update', 'Updated application settings');
    res.redirect('/admin/settings?msg=Settings saved.');
  } catch (err) {
    next(err);
  }
}

module.exports = { settingsPage, saveSettings };
