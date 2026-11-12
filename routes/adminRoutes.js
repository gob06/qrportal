const express = require('express');
const organizationController = require('../controllers/organizationController');
const analyticsController = require('../controllers/analyticsController');
const settingsController = require('../controllers/settingsController');
const { requireAuth, csrfProtect } = require('../middleware/authMiddleware');
const { handleLogoUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

router.use('/admin', requireAuth);

router.get('/admin', organizationController.dashboard);
router.get('/admin/analytics', analyticsController.analyticsPage);
router.get('/admin/settings', settingsController.settingsPage);
router.post('/admin/settings', csrfProtect, settingsController.saveSettings);
router.post('/admin/settings/platforms', handleLogoUpload, csrfProtect, settingsController.savePlatform);
router.post('/admin/settings/platforms/:key', handleLogoUpload, csrfProtect, settingsController.savePlatform);

module.exports = router;
