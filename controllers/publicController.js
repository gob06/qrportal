const orgModel = require('../models/organizationModel');
const socialLinkModel = require('../models/socialLinkModel');
const analyticsService = require('../services/analyticsService');
const platformModel = require('../models/platformModel');

/**
 * Public landing page. Resolves by the permanent identifier first (the value
 * encoded in every QR code), with the friendly slug as a secondary alias.
 * Archived organizations and unknown identifiers show a not-found page;
 * deactivated organizations show a configurable inactive message. The QR
 * destination itself never redirects anywhere else.
 */
async function landingPage(req, res, next) {
  try {
    const identifier = String(req.params.identifier || '').trim();
    let org = await orgModel.findByPermanentId(identifier);
    if (!org) org = await orgModel.findBySlug(identifier.toLowerCase());

    if (!org || org.archived_at) {
      return res.status(404).render('public/notFound');
    }
    if (org.status !== 'active') {
      return res.status(200).render('public/inactive', { org });
    }

    // Record the visit (aggregated, privacy-respecting analytics only).
    analyticsService.recordScan(org.id, req).catch(() => {});

    const links = await socialLinkModel.listByOrganization(org.id, true);
    const platforms = await platformModel.list();
    res.render('public/landing', {
      org,
      links,
      platformMeta: platformModel.metadata(platforms)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { landingPage };
