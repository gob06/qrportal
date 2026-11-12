const orgModel = require('../models/organizationModel');
const settingsModel = require('../models/settingsModel');
const adminModel = require('../models/adminModel');
const qrService = require('../services/qrService');
const imageService = require('../services/imageService');

function optionsFromQuery(query, settings) {
  return qrService.sanitizeOptions({
    fg: query.fg || settings.qr_default_fg,
    bg: query.bg || settings.qr_default_bg,
    size: query.size || settings.qr_default_size,
    margin: query.margin !== undefined ? query.margin : 2,
    errorCorrection: query.ec || settings.qr_default_ec,
    embedLogo: query.logo === '1'
  });
}

async function generatorPage(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const settings = await settingsModel.getAll();
    res.render('admin/qrGenerator', {
      org,
      errors: [],
      flash: req.query.msg || null,
      embedLogo: req.query.logo === '1',
      defaults: {
        fg: settings.qr_default_fg,
        bg: settings.qr_default_bg,
        size: settings.qr_default_size,
        ec: settings.qr_default_ec
      }
    });
  } catch (err) {
    next(err);
  }
}

async function uploadLogo(req, res, next) {
  let logo;
  let saved = false;
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      return res.status(404).render('admin/notFound');
    }
    const errors = [];
    if (req.uploadError) errors.push(req.uploadError);
    if (!req.file && !errors.length) errors.push('Please choose a logo image.');
    if (!errors.length) {
      try {
        logo = await imageService.optimizeLogo(req.file.filename);
      } catch (err) {
        console.error('QR logo processing failed:', err);
        errors.push('Could not process the logo. Please upload a valid PNG, JPG or WEBP image.');
      }
    }
    if (errors.length) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      const settings = await settingsModel.getAll();
      return res.status(400).render('admin/qrGenerator', {
        org, errors, flash: null, embedLogo: Boolean(org.logo),
        defaults: {
          fg: settings.qr_default_fg, bg: settings.qr_default_bg,
          size: settings.qr_default_size, ec: settings.qr_default_ec
        }
      });
    }
    await orgModel.update(org.id, { logo });
    saved = true;
    await imageService.deleteLogo(org.logo);
    await adminModel.logActivity(req.session.adminId, 'org_logo_update',
      `Updated logo for "${org.name}" (${org.permanent_id}) from QR generator`);
    res.redirect(`/admin/organizations/${org.id}/qr?logo=1&msg=Organization logo updated. QR destination unchanged.`);
  } catch (err) {
    try {
      if (!saved) {
        if (req.file) await imageService.deleteLogo(req.file.filename);
        if (logo) await imageService.deleteLogo(logo);
      }
    } catch (cleanupError) {
      console.error('QR logo cleanup failed:', cleanupError);
    }
    next(err);
  }
}

/**
 * Live preview. The encoded URL is ALWAYS the permanent destination stored in
 * the database — it is never constructed from the editable name or slug.
 */
async function preview(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).send('Not found');
    const settings = await settingsModel.getAll();
    const opts = optionsFromQuery(req.query, settings);
    const png = await qrService.generatePng(org.permanent_qr_url, opts, org.logo);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    next(err);
  }
}

async function downloadPng(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).send('Not found');
    const settings = await settingsModel.getAll();
    const opts = optionsFromQuery(req.query, settings);
    const png = await qrService.generatePng(org.permanent_qr_url, opts, org.logo);
    await adminModel.logActivity(req.session.adminId, 'qr_download',
      `Downloaded PNG QR for "${org.name}" (${org.permanent_id}) -> ${org.permanent_qr_url}`);
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="qr-${org.permanent_id}-${opts.size}px.png"`);
    res.send(png);
  } catch (err) {
    next(err);
  }
}

async function downloadSvg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).send('Not found');
    const settings = await settingsModel.getAll();
    const opts = optionsFromQuery(req.query, settings);
    const svg = await qrService.generateSvg(org.permanent_qr_url, opts, org.logo);
    await adminModel.logActivity(req.session.adminId, 'qr_download',
      `Downloaded SVG QR for "${org.name}" (${org.permanent_id}) -> ${org.permanent_qr_url}`);
    res.set('Content-Type', 'image/svg+xml');
    res.set('Content-Disposition', `attachment; filename="qr-${org.permanent_id}.svg"`);
    res.send(svg);
  } catch (err) {
    next(err);
  }
}

module.exports = { generatorPage, uploadLogo, preview, downloadPng, downloadSvg };
