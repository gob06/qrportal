const express = require('express');
const authController = require('../controllers/authController');
const { loginLimiter } = require('../middleware/securityMiddleware');
const { csrfProtect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/admin/login', authController.showLogin);
router.post('/admin/login', loginLimiter, csrfProtect, authController.login);
router.post('/admin/logout', csrfProtect, authController.logout);

module.exports = router;
