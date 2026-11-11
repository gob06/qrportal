const express = require('express');
const qrController = require('../controllers/qrController');
const { requireAuth } = require('../middleware/authMiddleware');

const router = express.Router();

router.use('/admin/organizations/:id/qr', requireAuth);

router.get('/admin/organizations/:id/qr', qrController.generatorPage);
router.get('/admin/organizations/:id/qr/preview', qrController.preview);
router.get('/admin/organizations/:id/qr/download.png', qrController.downloadPng);
router.get('/admin/organizations/:id/qr/download.svg', qrController.downloadSvg);

module.exports = router;
