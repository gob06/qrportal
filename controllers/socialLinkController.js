const orgModel = require('../models/organizationModel');
const socialLinkModel = require('../models/socialLinkModel');
const adminModel = require('../models/adminModel');
const platformModel = require('../models/platformModel');

function validateLinkInput(body, platforms) {
  const errors = [];
  const platform = String(body.platform || '').trim();
  if (!platforms.some((p) => p.key === platform)) {
    errors.push('Please choose a valid platform.');
  }
  const displayName = String(body.display_name || '').trim().slice(0, 100);
  if (!displayName) errors.push('Display name is required.');
  let accountUrl = String(body.account_url || '').trim().slice(0, 500);
  if (!socialLinkModel.isValidUrl(accountUrl, platform)) {
    errors.push('Please enter a valid URL (https://...) or email address for the Email platform.');
  } else {
    accountUrl = socialLinkModel.normalizeUrl(accountUrl, platform);
  }
  return {
    errors,
    data: {
      platform,
      display_name: displayName,
      account_url: accountUrl,
      status: body.status === 'inactive' ? 'inactive' : 'active'
    }
  };
}

async function managePage(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const links = await socialLinkModel.listByOrganization(org.id);
    const platforms = await platformModel.list();
    res.render('admin/socialLinks', {
      org,
      links,
      platforms,
      platformMeta: platformModel.metadata(platforms),
      errors: [],
      flash: req.query.msg || null
    });
  } catch (err) {
    next(err);
  }
}

async function createLink(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const platforms = await platformModel.list();
    const { errors, data } = validateLinkInput(req.body, platforms);
    if (errors.length) {
      const links = await socialLinkModel.listByOrganization(org.id);
      return res.status(400).render('admin/socialLinks', {
        org, links,
        platforms,
        platformMeta: platformModel.metadata(platforms),
        errors, flash: null
      });
    }
    await socialLinkModel.create(org.id, data);
    await adminModel.logActivity(req.session.adminId, 'link_create',
      `Added ${data.platform} link to "${org.name}"`);
    res.redirect(`/admin/organizations/${org.id}/social-links?msg=Social link added.`);
  } catch (err) {
    next(err);
  }
}

async function updateLink(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    const link = await socialLinkModel.findById(req.params.linkId);
    if (!org || !link || link.organization_id !== org.id) {
      return res.status(404).render('admin/notFound');
    }
    const platforms = await platformModel.list();
    const { errors, data } = validateLinkInput(req.body, platforms);
    if (errors.length) {
      return res.redirect(`/admin/organizations/${org.id}/social-links?msg=${encodeURIComponent(errors[0])}`);
    }
    await socialLinkModel.update(link.id, data);
    await adminModel.logActivity(req.session.adminId, 'link_update',
      `Updated ${data.platform} link on "${org.name}"`);
    res.redirect(`/admin/organizations/${org.id}/social-links?msg=Social link updated.`);
  } catch (err) {
    next(err);
  }
}

async function toggleLink(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    const link = await socialLinkModel.findById(req.params.linkId);
    if (!org || !link || link.organization_id !== org.id) {
      return res.status(404).render('admin/notFound');
    }
    const status = link.status === 'active' ? 'inactive' : 'active';
    await socialLinkModel.setStatus(link.id, status);
    res.redirect(`/admin/organizations/${org.id}/social-links?msg=Link ${status === 'active' ? 'enabled' : 'disabled'}.`);
  } catch (err) {
    next(err);
  }
}

async function deleteLink(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    const link = await socialLinkModel.findById(req.params.linkId);
    if (!org || !link || link.organization_id !== org.id) {
      return res.status(404).render('admin/notFound');
    }
    await socialLinkModel.destroy(link.id);
    await adminModel.logActivity(req.session.adminId, 'link_delete',
      `Deleted ${link.platform} link from "${org.name}"`);
    res.redirect(`/admin/organizations/${org.id}/social-links?msg=Social link deleted.`);
  } catch (err) {
    next(err);
  }
}

async function reorderLinks(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).json({ error: 'Not found' });
    const order = Array.isArray(req.body.order)
      ? req.body.order.map((n) => parseInt(n, 10)).filter(Number.isInteger)
      : [];
    if (order.length) await socialLinkModel.reorder(org.id, order);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { managePage, createLink, updateLink, toggleLink, deleteLink, reorderLinks };
