require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const { testConnection } = require('./config/database');
const { securityHeaders, generalLimiter } = require('./middleware/securityMiddleware');
const { csrfToken } = require('./middleware/authMiddleware');
const settingsModel = require('./models/settingsModel');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const qrRoutes = require('./routes/qrRoutes');
const publicRoutes = require('./routes/publicRoutes');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(generalLimiter);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/logos', express.static(path.join(__dirname, 'uploads', 'logos'), {
  immutable: true, maxAge: '7d'
}));

// Session store backed by MariaDB (survives restarts; works on cPanel).
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000
});

app.use(session({
  name: 'qrportal.sid',
  secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: Number(process.env.SESSION_MAX_AGE_MS || 3600000)
  }
}));

app.use(csrfToken);

// Expose common locals to all views.
app.use(async (req, res, next) => {
  res.locals.adminUsername = req.session.adminUsername || null;
  res.locals.currentPath = req.path;
  try {
    res.locals.siteSettings = await settingsModel.getAll();
  } catch {
    res.locals.siteSettings = settingsModel.DEFAULTS;
  }
  next();
});

// Routes
app.use(authRoutes);
app.use(qrRoutes);
app.use(organizationRoutes);
app.use(adminRoutes);
app.use(publicRoutes);

app.get('/', (req, res) => res.redirect('/admin'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('public/notFound');
});

// Central error handler: logs details server-side, shows a generic page.
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}]`, err);
  if (res.headersSent) return next(err);
  res.status(500).render('error');
});

async function start() {
  try {
    await testConnection();
    console.log('Database connection OK');
  } catch (err) {
    console.error('Could not connect to the database. Check your .env settings.');
    console.error(err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Social QR Portal running at http://localhost:${PORT}`);
    console.log(`Admin dashboard:            http://localhost:${PORT}/admin`);
  });
}

start();

module.exports = app;
