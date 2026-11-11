const express = require('express');
const organizationController = require('../controllers/organizationController');
const analyticsController = require('../controllers/analyticsController');
const settingsController = require('../controllers/settingsController');
const { requireAuth, csrfProtect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use('/admin', requireAuth);

router.get('/admin', organizationController.dashboard);
router.get('/admin/analytics', analyticsController.analyticsPage);
router.get('/admin/settings', settingsController.settingsPage);
router.post('/admin/settings', csrfProtect, settingsController.saveSettings);

module.exports = router;
