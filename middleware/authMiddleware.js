const crypto = require('crypto');

/** Blocks access to admin routes for unauthenticated sessions. */
function requireAuth(req, res, next) {
  if (req.session && req.session.adminId) return next();
  if (req.xhr || req.get('accept')?.includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/admin/login');
}

/** Ensures a per-session CSRF token exists and exposes it to views. */
function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/** Validates the CSRF token on state-changing requests. */
function csrfProtect(req, res, next) {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutating.includes(req.method)) return next();
  const token = req.body?._csrf || req.get('x-csrf-token');
  if (token && req.session.csrfToken && crypto.timingSafeEqual(
    Buffer.from(String(token)), Buffer.from(String(req.session.csrfToken))
  )) {
    return next();
  }
  return res.status(403).send('Invalid CSRF token. Please go back, refresh the page, and try again.');
}

module.exports = { requireAuth, csrfToken, csrfProtect };
