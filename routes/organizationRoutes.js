const express = require('express');
const organizationController = require('../controllers/organizationController');
const socialLinkController = require('../controllers/socialLinkController');
const { requireAuth, csrfProtect } = require('../middleware/authMiddleware');
const { handleLogoUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use('/admin/organizations', requireAuth);

router.get('/admin/organizations/new', organizationController.showCreateForm);
router.post('/admin/organizations', handleLogoUpload, csrfProtect, organizationController.createOrg);
router.get('/admin/organizations/:id', organizationController.viewOrg);
router.get('/admin/organizations/:id/edit', organizationController.showEditForm);
router.post('/admin/organizations/:id', handleLogoUpload, csrfProtect, organizationController.updateOrg);
router.post('/admin/organizations/:id/toggle-status', csrfProtect, organizationController.toggleStatus);
router.post('/admin/organizations/:id/archive', csrfProtect, organizationController.archiveOrg);
router.post('/admin/organizations/:id/restore', csrfProtect, organizationController.restoreOrg);
router.post('/admin/organizations/:id/delete', csrfProtect, organizationController.deleteOrg);

// Social media link management
router.get('/admin/organizations/:id/social-links', socialLinkController.managePage);
router.post('/admin/organizations/:id/social-links', csrfProtect, socialLinkController.createLink);
router.post('/admin/organizations/:id/social-links/reorder', csrfProtect, socialLinkController.reorderLinks);
router.post('/admin/organizations/:id/social-links/:linkId', csrfProtect, socialLinkController.updateLink);
router.post('/admin/organizations/:id/social-links/:linkId/toggle', csrfProtect, socialLinkController.toggleLink);
router.post('/admin/organizations/:id/social-links/:linkId/delete', csrfProtect, socialLinkController.deleteLink);

module.exports = router;
