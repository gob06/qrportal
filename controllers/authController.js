const bcrypt = require('bcryptjs');
const adminModel = require('../models/adminModel');

function showLogin(req, res) {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { error: null, layoutless: true });
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).render('admin/login', { error: 'Username and password are required.', layoutless: true });
    }
    const admin = await adminModel.findByUsername(String(username).trim());
    const valid = admin && await bcrypt.compare(String(password), admin.password_hash);
    if (!valid) {
      return res.status(401).render('admin/login', { error: 'Invalid username or password.', layoutless: true });
    }
    // Regenerate the session on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.adminId = admin.id;
      req.session.adminUsername = admin.username;
      adminModel.logActivity(admin.id, 'login', `Administrator ${admin.username} logged in`).catch(() => {});
      res.redirect('/admin');
    });
  } catch (err) {
    next(err);
  }
}

function logout(req, res) {
  const adminId = req.session.adminId;
  const username = req.session.adminUsername;
  req.session.destroy(() => {
    if (adminId) {
      adminModel.logActivity(adminId, 'logout', `Administrator ${username} logged out`).catch(() => {});
    }
    res.clearCookie('qrportal.sid');
    res.redirect('/admin/login');
  });
}

module.exports = { showLogin, login, logout };
