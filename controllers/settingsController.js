const settingsModel = require('../models/settingsModel');
const adminModel = require('../models/adminModel');
const analyticsService = require('../services/analyticsService');
const platformModel = require('../models/platformModel');
const imageService = require('../services/imageService');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

async function settingsPage(req, res, next) {
  try {
    const settings = await settingsModel.getAll();
    const platforms = await platformModel.list();
    res.render('admin/settings', { settings, platforms, flash: req.query.msg || null, errors: [] });
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
      const platforms = await platformModel.list();
      return res.status(400).render('admin/settings', { settings, platforms, flash: null, errors });
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

async function savePlatform(req, res, next) {
  let logo;
  let saved = false;
  try {
    const platforms = await platformModel.list();
    const existing = req.params.key
      ? platforms.find(platform => platform.key === req.params.key)
      : null;
    if (req.params.key && !existing) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      return res.status(404).render('admin/notFound');
    }
    const label = String(req.body.label || '').trim();
    const errors = [];
    if (label.length < 2 || label.length > 60) errors.push('Platform name must be between 2 and 60 characters.');
    if (platforms.some(platform => platform.key !== existing?.key &&
        platform.label.toLowerCase() === label.toLowerCase())) {
      errors.push('A platform with this name already exists.');
    }
    if (req.uploadError) errors.push(req.uploadError);
    if (!req.file && !existing?.logo && !req.uploadError) errors.push('Please upload a platform logo.');
    if (!errors.length && req.file) {
      try {
        logo = await imageService.optimizeLogo(req.file.filename);
      } catch (err) {
        console.error('Platform logo processing failed:', err);
        errors.push('Could not process the logo. Please upload a valid PNG, JPG or WEBP image.');
      }
    }
    if (errors.length) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      const settings = await settingsModel.getAll();
      return res.status(400).render('admin/settings', { settings, platforms, flash: null, errors });
    }
    const key = await platformModel.save(existing?.key, label, logo || existing.logo);
    saved = true;
    if (logo && existing?.logo) await imageService.deleteLogo(existing.logo);
    await adminModel.logActivity(req.session.adminId, 'platform_update',
      `${existing ? 'Updated' : 'Added'} global social platform "${label}" (${key})`);
    res.redirect('/admin/settings?msg=Social platform saved for all organizations.');
  } catch (err) {
    try {
      if (!saved) {
        if (req.file) await imageService.deleteLogo(req.file.filename);
        if (logo) await imageService.deleteLogo(logo);
      }
    } catch (cleanupError) {
      console.error('Platform logo cleanup failed:', cleanupError);
    }
    next(err);
  }
}

module.exports = { settingsPage, saveSettings, savePlatform };
