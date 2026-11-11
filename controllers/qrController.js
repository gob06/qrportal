const orgModel = require('../models/organizationModel');
const settingsModel = require('../models/settingsModel');
const adminModel = require('../models/adminModel');
const qrService = require('../services/qrService');

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

module.exports = { generatorPage, preview, downloadPng, downloadSvg };
