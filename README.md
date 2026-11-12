# Social Media QR Portal

A complete, database-driven web application for creating and managing multiple organizations, each with its own branded social media landing page and a **permanent, never-changing QR code destination**.

Built with Node.js, Express, MariaDB, EJS and Bootstrap 5.

## Key Features

- **Multi-organization management** — create unlimited organizations, each with its own logo, branding colors and landing page.
- **Permanent QR destinations** — every organization receives an immutable identifier (e.g. `ORG-000001`) at creation. The QR code always encodes `https://yourdomain.com/org/ORG-000001`, and this never changes — not when the name, logo, colors, links or page design change. Immutability is enforced in application code **and** by a database trigger, and retired identifiers are never reused (append-only registry table).
- **QR code generator** — live preview, custom foreground/background colors, size (256–2048 px), margin, error-correction level, optional centered logo on a white tile (error correction forced to H), PNG and scalable SVG downloads.
- **Social link management** — 11 platforms (Facebook, Instagram, TikTok, YouTube, LinkedIn, X, WhatsApp, Telegram, Website, Email, Custom URL), with display order, enable/disable, URL validation. Changes appear instantly on the public page without reprinting QR codes.
- **Logo uploads and custom platforms** — upload or replace the organization logo directly on its QR generator page. In Settings, add global social platforms with names and uploaded logos, or customize existing platform logos; they are available to every organization and appear on public social links.
- **Public landing pages** — mobile-first, branded with each organization's colors and logo. No visitor registration required.
- **Privacy-respecting scan analytics** — total/daily/weekly/monthly visits per organization with charts. Only a one-way daily-salted hash is stored; no names, emails, phone numbers, locations or fingerprints.
- **Security** — bcrypt password hashing, DB-backed sessions, session regeneration on login, CSRF protection, login rate limiting, Helmet security headers, parameterized queries everywhere, strict upload validation, sanitized filenames.

## Requirements

- Node.js 18+ (LTS recommended)
- MariaDB 10.6+ (or MySQL 8+) — standalone, XAMPP, or the bundled portable setup
- npm

## Local Installation (Windows)

### 1. Install dependencies

```
npm install
```

### 2. Create the database

Using any MariaDB client (XAMPP shell, HeidiSQL, or `mysql` CLI):

```
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

This creates the `social_qr_portal` database, all tables, the immutability trigger, default settings, and a default administrator.

> If your client does not support `DELIMITER` (e.g. some GUI tools), run the trigger block from `database/schema.sql` separately.

### 3. Configure the environment

```
copy .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `PORT` | Local port (default `3000`) |
| `BASE_URL` | Public base URL encoded into QR codes, e.g. `http://localhost:3000` locally or `https://yourdomain.com` in production |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | MariaDB connection |
| `SESSION_SECRET` | Long random string (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SESSION_MAX_AGE_MS` | Session expiration in ms (default 1 hour) |
| `UPLOAD_MAX_SIZE_MB` | Logo upload limit (default 5) |

> **Important:** `BASE_URL` is baked into each organization's permanent QR URL at creation time. Set it to your final domain before creating production organizations.

### 4. Start the application

```
npm start
```

- Application: http://localhost:3000
- Admin login: http://localhost:3000/admin

Default administrator (from `seed.sql`): username `admin`, password `admin123`.
**Change it immediately:**

```
npm run create-admin -- admin YourNewStrongPassword
```

(The script creates a new admin or resets the password of an existing one.)

### 5. Verify the installation

With the app running, execute the automated end-to-end test suite (24 checks including all permanent-destination invariants):

```
node scripts/smokeTest.js
```

Manual checks:
1. Log in at `/admin`, create an organization with a logo.
2. Open its QR page, toggle colors/size/logo and download PNG + SVG.
3. Scan the QR with a phone — it opens `/org/ORG-xxxxxx`.
4. Rename the organization, replace the logo, edit social links — re-scan the **same printed QR**: it still works.
5. Check Analytics for the recorded visits.

## Project Structure

```
social-media-qr-portal/
├── config/database.js          MariaDB connection pool (mysql2)
├── controllers/                Route handlers (auth, orgs, links, QR, analytics, settings, public)
├── middleware/                 Auth + CSRF, Multer uploads, Helmet + rate limiting
├── models/                     Parameterized data access (admins, organizations, links, settings)
├── routes/                     Express routers (auth, admin, organizations, QR, public)
├── services/                   QR generation (qrcode + sharp), image optimization, analytics
├── public/                     CSS and client-side JS
├── uploads/logos/              Optimized uploaded logos
├── views/admin/                EJS admin dashboard pages
├── views/public/               Public landing / inactive / not-found pages
├── database/schema.sql         Schema + immutability trigger
├── database/seed.sql           Default admin + settings
├── scripts/createAdmin.js      Create/reset an administrator
├── scripts/smokeTest.js        End-to-end functional tests
├── .env.example
└── server.js                   Application entry point
```

## How Permanent QR Destinations Work

1. On creation, a row is inserted into the append-only `permanent_id_registry` table; its auto-increment id becomes `ORG-000001`, `ORG-000002`, …
2. The full destination (`BASE_URL/org/ORG-xxxxxx`) is stored in `organizations.permanent_qr_url` at that moment.
3. The QR generator **always reads this stored value** — it is never rebuilt from the editable name or slug.
4. A `BEFORE UPDATE` trigger rejects any SQL that tries to modify `permanent_id` or `permanent_qr_url`, and the admin UI exposes neither field for editing.
5. Archiving or deleting an organization keeps its registry row, so the identifier can never be assigned to another organization.
6. Deactivated organizations show a friendly "temporarily unavailable" page at the same URL; the QR never redirects elsewhere.
7. The editable `slug` (e.g. `/org/my-organization`) works as a convenience alias, but QR codes only ever encode the permanent identifier.

## Z.com cPanel Deployment

### Before you start — verify your plan supports:

- **Node.js applications** (look for "Setup Node.js App" in cPanel). Not all Z.com plans include this.
- Node.js 18 or newer.
- MariaDB/MySQL databases.
- Persistent file storage (for `uploads/logos`).
- HTTPS/SSL (Let's Encrypt via cPanel is fine).

> **If your plan has no Node.js support:** this application cannot run on plain PHP shared hosting. Alternatives: upgrade to a Z.com plan/VPS with Node.js, or host the Node app on a service such as a VPS, Render or Railway and keep only the domain/DNS at Z.com. A static-only export is not possible because QR management, uploads and analytics require a server and database.

### Step-by-step

1. **Create the database** — cPanel → *MySQL Databases*: create a database (e.g. `youruser_qrportal`), a DB user with a strong password, and grant the user **ALL PRIVILEGES** on the database.
2. **Import the schema** — cPanel → *phpMyAdmin* → select the database → *Import* → upload `database/schema.sql`, then `database/seed.sql`.
   - Remove the `CREATE DATABASE`/`USE` lines first if phpMyAdmin complains (the database already exists), and set the trigger `DELIMITER` in the phpMyAdmin SQL tab if needed.
3. **Upload the application** — cPanel → *File Manager* (or SFTP): upload the project (without `node_modules` and `.env`) to e.g. `~/qrportal`.
4. **Create the Node.js app** — cPanel → *Setup Node.js App* → Create Application:
   - Node.js version: 18+ (latest available)
   - Application mode: `Production`
   - Application root: `qrportal`
   - Application URL: your domain
   - Application startup file: `server.js`
5. **Set environment variables** in the same screen:
   - `NODE_ENV=production`
   - `BASE_URL=https://yourdomain.com`
   - `DB_HOST=localhost`, `DB_PORT=3306`
   - `DB_USER`, `DB_PASSWORD`, `DB_NAME` from step 1
   - `SESSION_SECRET` = a long random string
6. **Install dependencies** — click *Run NPM Install* (or in the app's terminal: `npm install --production`).
7. **Upload directory permissions** — ensure `uploads/logos` exists and is writable (755 is usually sufficient under cPanel since the app runs as your user).
8. **Domain + SSL** — point the domain/subdomain at the application URL and install an SSL certificate (cPanel → *SSL/TLS Status* → Run AutoSSL). The app sets secure cookies automatically when `NODE_ENV=production`.
9. **Start/Restart the app** and test in production:
   - Log in at `https://yourdomain.com/admin` and change the default password.
   - Create a real organization — its QR will now encode `https://yourdomain.com/org/ORG-xxxxxx`.
   - Scan from a phone over mobile data; verify the landing page and analytics.

### Production notes

- Custom social platforms are stored in the existing `application_settings` table; no database migration or reimport is required. Back up `uploads/logos` along with the database to preserve both organization and platform logos. Uploads accept PNG, JPG and WEBP, are re-encoded as PNG, and follow `UPLOAD_MAX_SIZE_MB`.
- On an organization's QR page, uploading a logo replaces its organization logo on the public page and in future QR previews/downloads. Enable "Embed organization logo in center" when downloading. Existing printed QR codes retain the same destination.
- In **Settings → Social platforms**, add a platform name and logo, then select that platform when adding or editing an organization's social link. Custom platforms accept HTTP/HTTPS URLs; the built-in Email platform retains email-address handling. Editing a platform's name or logo updates existing links without changing their URLs.
- Run `node --test scripts/startupTest.js scripts/featureTest.js` for startup and upload/platform regression tests. Feature tests use a test HTTP server, real image processing and templates, and an in-memory database adapter; they do not connect to your database.
- The startup file owns the listener after its database check. Do not export the Express app from `server.js`: LiteSpeed's Node.js launcher can auto-listen on that export before asynchronous startup completes, causing `http.Server.listen() was called more than once`. Run `node --test scripts/startupTest.js` to check this startup behavior.
- Sessions are stored in MariaDB (`sessions` table, auto-created), so they survive app restarts and Passenger process recycling.
- Back up the database regularly (cPanel → *Backup*); the `organizations` and `permanent_id_registry` tables are the source of truth for QR permanence.
- `BASE_URL` changes only affect organizations created afterwards — existing permanent URLs are intentionally never rewritten. Keep the old domain redirecting if you ever migrate.

## Security Summary

| Area | Implementation |
|---|---|
| Passwords | bcrypt (12 rounds) via `bcryptjs` |
| Sessions | `express-session` + MariaDB store, httpOnly/SameSite cookies, secure in production, regeneration on login, 1-hour rolling expiry |
| CSRF | Per-session token validated on every state-changing request |
| SQL injection | 100% parameterized queries (`mysql2`) |
| Rate limiting | 10 login attempts / 15 min; 300 requests / min overall |
| Headers | Helmet with a restrictive Content-Security-Policy |
| Uploads | MIME whitelist (PNG/JPG/WEBP), 5 MB cap, random sanitized filenames, sharp re-encoding (strips metadata/payloads) |
| Errors | Generic error pages; details only in server logs |
| Secrets | `.env` (never committed); DB credentials never reach the frontend |

## License

MIT
