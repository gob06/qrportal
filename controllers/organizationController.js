const orgModel = require('../models/organizationModel');
const socialLinkModel = require('../models/socialLinkModel');
const adminModel = require('../models/adminModel');
const analyticsService = require('../services/analyticsService');
const imageService = require('../services/imageService');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function cleanColor(value, fallback) {
  return HEX_RE.test(value || '') ? value : fallback;
}

function validateOrgInput(body) {
  const errors = [];
  const name = String(body.name || '').trim();
  if (!name || name.length < 2 || name.length > 150) {
    errors.push('Organization name must be between 2 and 150 characters.');
  }
  const description = String(body.description || '').trim().slice(0, 500);
  const contact = String(body.contact_info || '').trim().slice(0, 255);
  return {
    errors,
    data: {
      name,
      description,
      contact_info: contact,
      primary_color: cleanColor(body.primary_color, '#0d6efd'),
      secondary_color: cleanColor(body.secondary_color, '#6c757d'),
      background_color: cleanColor(body.background_color, '#f8f9fa'),
      status: body.status === 'inactive' ? 'inactive' : 'active'
    }
  };
}

async function dashboard(req, res, next) {
  try {
    const search = String(req.query.search || '').trim().slice(0, 100);
    const sort = String(req.query.sort || 'created_at');
    const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [counts, orgList, scanSummary, activity] = await Promise.all([
      orgModel.counts(),
      orgModel.list({ search, sort, dir, page, perPage: 10, includeArchived: req.query.archived === '1' }),
      analyticsService.summary(),
      adminModel.recentActivity(8)
    ]);
    res.render('admin/dashboard', {
      counts, orgList, scanSummary, activity,
      query: { search, sort, dir, page, archived: req.query.archived === '1' },
      flash: req.query.msg || null
    });
  } catch (err) {
    next(err);
  }
}

function showCreateForm(req, res) {
  res.render('admin/orgForm', { org: null, errors: [], values: {} });
}

async function createOrg(req, res, next) {
  try {
    const { errors, data } = validateOrgInput(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      return res.status(400).render('admin/orgForm', { org: null, errors, values: req.body });
    }
    if (req.file) {
      data.logo = await imageService.optimizeLogo(req.file.filename);
    }
    const created = await orgModel.create(data, process.env.BASE_URL || `${req.protocol}://${req.get('host')}`);
    await adminModel.logActivity(req.session.adminId, 'org_create',
      `Created organization "${data.name}" (${created.permanentId})`);
    res.redirect(`/admin/organizations/${created.id}?msg=Organization created. Permanent QR destination assigned.`);
  } catch (err) {
    next(err);
  }
}

async function viewOrg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const [links, scanSummary] = await Promise.all([
      socialLinkModel.listByOrganization(org.id),
      analyticsService.summary(org.id)
    ]);
    res.render('admin/orgView', { org, links, scanSummary, flash: req.query.msg || null });
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    res.render('admin/orgForm', { org, errors: [], values: org });
  } catch (err) {
    next(err);
  }
}

async function updateOrg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const { errors, data } = validateOrgInput(req.body);
    if (req.uploadError) errors.push(req.uploadError);
    if (errors.length) {
      if (req.file) await imageService.deleteLogo(req.file.filename);
      return res.status(400).render('admin/orgForm', { org, errors, values: req.body });
    }
    // Editing the name updates the friendly slug but NEVER the permanent
    // identifier or permanent QR destination.
    if (data.name !== org.name) {
      data.slug = await orgModel.generateUniqueSlug(data.name, org.id);
    }
    if (req.file) {
      await imageService.deleteLogo(org.logo);
      data.logo = await imageService.optimizeLogo(req.file.filename);
    } else if (req.body.remove_logo === '1') {
      await imageService.deleteLogo(org.logo);
      data.logo = null;
    }
    await orgModel.update(org.id, data);
    await adminModel.logActivity(req.session.adminId, 'org_update',
      `Updated organization "${data.name}" (${org.permanent_id})`);
    res.redirect(`/admin/organizations/${org.id}?msg=Organization updated. QR destination unchanged.`);
  } catch (err) {
    next(err);
  }
}

async function toggleStatus(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    const status = org.status === 'active' ? 'inactive' : 'active';
    await orgModel.setStatus(org.id, status);
    await adminModel.logActivity(req.session.adminId, 'org_status',
      `Set organization "${org.name}" (${org.permanent_id}) to ${status}`);
    res.redirect(`/admin?msg=Organization ${status === 'active' ? 'activated' : 'deactivated'}.`);
  } catch (err) {
    next(err);
  }
}

async function archiveOrg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    await orgModel.archive(org.id);
    await adminModel.logActivity(req.session.adminId, 'org_archive',
      `Archived organization "${org.name}" (${org.permanent_id})`);
    res.redirect('/admin?msg=Organization archived. Its permanent identifier is preserved and will never be reused.');
  } catch (err) {
    next(err);
  }
}

async function restoreOrg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    await orgModel.restore(org.id);
    await adminModel.logActivity(req.session.adminId, 'org_restore',
      `Restored organization "${org.name}" (${org.permanent_id})`);
    res.redirect('/admin?msg=Organization restored with its original QR destination.');
  } catch (err) {
    next(err);
  }
}

async function deleteOrg(req, res, next) {
  try {
    const org = await orgModel.findById(req.params.id);
    if (!org) return res.status(404).render('admin/notFound');
    await imageService.deleteLogo(org.logo);
    await orgModel.destroy(org.id);
    await adminModel.logActivity(req.session.adminId, 'org_delete',
      `Deleted organization "${org.name}" (${org.permanent_id}); identifier remains reserved`);
    res.redirect('/admin?msg=Organization deleted. Its permanent identifier remains reserved and cannot be reused.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dashboard,
  showCreateForm,
  createOrg,
  viewOrg,
  showEditForm,
  updateOrg,
  toggleStatus,
  archiveOrg,
  restoreOrg,
  deleteOrg
};
