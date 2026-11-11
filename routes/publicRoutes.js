const express = require('express');
const publicController = require('../controllers/publicController');

const router = express.Router();

// Permanent QR destination: /org/{permanent-id} (slug also accepted as alias)
router.get('/org/:identifier', publicController.landingPage);

module.exports = router;
