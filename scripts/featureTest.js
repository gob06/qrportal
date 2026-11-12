const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const LOGOS = path.join(ROOT, 'uploads', 'logos');
const CSRF = 'test-csrf-token';

test('QR logo and global platform HTTP workflows', async t => {
  const uploadedFiles = new Set();
  const settings = new Map();
  const links = [];
  const organizations = [1, 2].map(id => ({
    id, name: `Test organization ${id}`, permanent_id: `ORG-00000${id}`,
    permanent_qr_url: `https://example.test/org/ORG-00000${id}`,
    status: 'active', logo: null, archived_at: null,
    primary_color: '#000000', secondary_color: '#111111', background_color: '#ffffff',
    created_at: new Date(), description: '', contact_info: ''
  }));
  let failOrgUpdate = false;
  let failPlatformSave = false;
  const activities = [];
  const errors = [];
  const pool = {
    async query(sql, params = []) {
      if (sql.startsWith('SELECT setting_key')) {
        return [[...settings].filter(([key]) =>
          !sql.includes('WHERE') || key.startsWith('social_platform:')
        ).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
      }
      if (sql.includes('INSERT INTO application_settings')) {
        if (failPlatformSave) throw new Error('Test platform write failure');
        settings.set(params[0], params[1]);
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM organizations')) {
        const field = sql.includes('permanent_id =') ? 'permanent_id' : 'id';
        return [organizations.filter(org => String(org[field]) === String(params[0])).map(org => ({ ...org }))];
      }
      if (sql.startsWith('UPDATE organizations SET logo')) {
        if (failOrgUpdate) throw new Error('Test database write failure');
        const org = organizations.find(item => item.id === Number(params[1]));
        org.logo = params[0];
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT COALESCE(MAX(display_order)')) {
        return [[{ next: links.length + 1 }]];
      }
      if (sql.includes('INSERT INTO social_links')) {
        const id = links.length + 1;
        links.push({
          id, organization_id: params[0], platform: params[1], display_name: params[2],
          account_url: params[3], display_order: params[4], status: params[5]
        });
        return [{ insertId: id }];
      }
      if (sql.startsWith('SELECT * FROM social_links WHERE organization_id')) {
        return [links.filter(link => link.organization_id === Number(params[0]) &&
          (!sql.includes("status = 'active'") || link.status === 'active'))];
      }
      if (sql.startsWith('SELECT * FROM social_links WHERE id')) {
        return [links.filter(link => link.id === Number(params[0]))];
      }
      if (sql.includes('UPDATE social_links SET platform')) {
        const link = links.find(item => item.id === Number(params[4]));
        Object.assign(link, {
          platform: params[0], display_name: params[1], account_url: params[2], status: params[3]
        });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in feature test: ${sql}`);
    }
  };
  function stubModule(relativePath, exports) {
    const id = require.resolve(relativePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  // Keep the HTTP, model SQL, image processing and templates real; isolate database I/O.
  stubModule('../config/database', { pool });
  stubModule('../models/adminModel', {
    async logActivity(...args) { activities.push(args); }
  });
  stubModule('../services/analyticsService', {
    async recordScan() {},
    async purgeOldScans() {}
  });
  const settingsModel = require('../models/settingsModel');
  const platformModel = require('../models/platformModel');
  const { csrfToken } = require('../middleware/authMiddleware');
  const { handleLogoUpload } = require('../middleware/uploadMiddleware');
  stubModule('../middleware/uploadMiddleware', {
    handleLogoUpload(req, res, next) {
      handleLogoUpload(req, res, err => {
        if (req.file) {
          uploadedFiles.add(req.file.filename);
          uploadedFiles.add(`${path.parse(req.file.filename).name}-opt.png`);
        }
        next(err);
      });
    }
  });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = req.get('x-test-admin') === '1' ? { adminId: 1, csrfToken: CSRF } : {};
    res.locals.siteSettings = settingsModel.DEFAULTS;
    res.locals.currentPath = req.path;
    res.locals.adminUsername = 'Test admin';
    next();
  });
  app.use(csrfToken);
  app.use('/uploads/logos', express.static(LOGOS));
  app.use(require('../routes/qrRoutes'));
  app.use(require('../routes/organizationRoutes'));
  app.use(require('../routes/adminRoutes'));
  app.use(require('../routes/publicRoutes'));
  app.use((err, req, res, next) => {
    errors.push(err);
    res.status(500).send('Test request failed');
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const file of uploadedFiles) {
      try {
        await fs.unlink(path.join(LOGOS, file));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const png = await sharp({
    create: { width: 800, height: 800, channels: 4, background: '#ff6600' }
  }).png().toBuffer();
  async function request(url, options = {}) {
    return fetch(base + url, {
      redirect: 'manual', ...options,
      headers: { 'x-test-admin': '1', ...options.headers }
    });
  }
  function upload(fields, image = png, type = 'image/png', token = CSRF) {
    const form = new FormData();
    form.set('_csrf', token);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (image !== null) form.set('logo', new Blob([image], { type }), 'upload.png');
    return { method: 'POST', body: form };
  }
  function form(fields) {
    return {
      method: 'POST',
      body: new URLSearchParams({ _csrf: CSRF, ...fields })
    };
  }
  async function assertNoExtraFiles(before) {
    assert.deepEqual((await fs.readdir(LOGOS)).sort(), before.sort());
  }

  await t.test('upload routes require authentication before writing files', async () => {
    const before = await fs.readdir(LOGOS);
    for (const url of ['/admin/organizations/1/qr/logo', '/admin/settings/platforms']) {
      const res = await request(url, { ...upload({ label: 'Discord' }), headers: { 'x-test-admin': '0' } });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/admin/login');
    }
    await assertNoExtraFiles(before);
  });

  await t.test('invalid CSRF rejects and removes multipart images', async () => {
    const before = await fs.readdir(LOGOS);
    for (const token of ['short', 'x'.repeat(CSRF.length)]) {
      for (const url of ['/admin/organizations/1/qr/logo', '/admin/settings/platforms']) {
        const res = await request(url, upload({ label: 'Discord' }, png, 'image/png', token));
        assert.equal(res.status, 403);
      }
    }
    await assertNoExtraFiles(before);
  });

  await t.test('QR upload validates required files and MIME types', async () => {
    let res = await request('/admin/organizations/1/qr/logo', upload({}, null));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Please choose a logo image/);
    res = await request('/admin/organizations/1/qr/logo', upload({}, 'not an image', 'text/plain'));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Only PNG/);
  });

  await t.test('QR upload saves an optimized organization logo without changing its destination', async () => {
    const destination = organizations[0].permanent_qr_url;
    const res = await request('/admin/organizations/1/qr/logo', upload({}));
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /logo=1/);
    const logo = organizations[0].logo;
    assert.match(logo, /^logo-.*-opt\.png$/);
    const meta = await sharp(path.join(LOGOS, logo)).metadata();
    assert.equal(meta.width, 600);
    assert.equal(meta.format, 'png');
    assert.equal(organizations[0].permanent_qr_url, destination);
    const page = await request(res.headers.get('location'));
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /id="qrLogo"[^>]*checked/);
    assert.ok(html.includes(logo));
    const landing = await request('/org/ORG-000001');
    assert.ok((await landing.text()).includes(logo));
  });

  await t.test('replacement removes the old logo only after persistence succeeds', async () => {
    const oldLogo = organizations[0].logo;
    const res = await request('/admin/organizations/1/qr/logo', upload({}));
    assert.equal(res.status, 302);
    assert.notEqual(organizations[0].logo, oldLogo);
    await assert.rejects(fs.access(path.join(LOGOS, oldLogo)), { code: 'ENOENT' });
    const before = await fs.readdir(LOGOS);
    const currentLogo = organizations[0].logo;
    failOrgUpdate = true;
    const failed = await request('/admin/organizations/1/qr/logo', upload({}));
    failOrgUpdate = false;
    assert.equal(failed.status, 500);
    assert.equal(organizations[0].logo, currentLogo);
    await fs.access(path.join(LOGOS, currentLogo));
    await assertNoExtraFiles(before);
    assert.match(errors.pop().message, /Test database write failure/);
  });

  await t.test('PNG and SVG QR output embed the uploaded logo', async () => {
    const plain = await request('/admin/organizations/1/qr/preview?size=256');
    const embedded = await request('/admin/organizations/1/qr/preview?size=256&logo=1');
    assert.equal(embedded.status, 200);
    const buffer = Buffer.from(await embedded.arrayBuffer());
    assert.equal((await sharp(buffer).metadata()).width, 256);
    assert.notDeepEqual(buffer, Buffer.from(await plain.arrayBuffer()));
    const svg = await request('/admin/organizations/1/qr/download.svg?logo=1');
    assert.match(await svg.text(), /data:image\/png;base64/);
  });

  await t.test('JPEG and WEBP uploads are re-encoded as PNG', async () => {
    for (const format of ['jpeg', 'webp']) {
      const input = await sharp(png).toFormat(format).toBuffer();
      const res = await request('/admin/organizations/1/qr/logo', upload({}, input, `image/${format}`));
      assert.equal(res.status, 302);
      const meta = await sharp(path.join(LOGOS, organizations[0].logo)).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, 600);
    }
  });

  await t.test('platform creation validates names and requires a logo', async () => {
    let res = await request('/admin/settings/platforms', upload({ label: '' }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Platform name must/);
    res = await request('/admin/settings/platforms', upload({ label: 'Discord' }, null));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /Please upload a platform logo/);
    assert.equal(settings.size, 0);
  });

  let discord;
  await t.test('custom platform persists and is available to every organization', async () => {
    const res = await request('/admin/settings/platforms', upload({ label: 'Discord' }));
    assert.equal(res.status, 302);
    const platforms = await platformModel.list();
    discord = platforms.find(platform => platform.label === 'Discord');
    assert.ok(discord);
    assert.ok(discord.key.length <= 30);
    assert.equal(platforms.length, 12);
    assert.ok(settings.has(`social_platform:${discord.key}`));
    for (const id of [1, 2]) {
      const page = await request(`/admin/organizations/${id}/social-links`);
      assert.equal(page.status, 200);
      assert.ok((await page.text()).includes(`value="${discord.key}"`));
    }
    const page = await request('/admin/settings');
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(discord.logo));
  });

  await t.test('custom platform supports link creation, editing and public logos', async () => {
    for (const id of [1, 2]) {
      const res = await request(`/admin/organizations/${id}/social-links`, form({
        platform: discord.key, display_name: 'Join us', account_url: 'https://discord.com/example'
      }));
      assert.equal(res.status, 302);
      const publicPage = await request(`/org/ORG-00000${id}`);
      const html = await publicPage.text();
      assert.equal(publicPage.status, 200);
      assert.ok(html.includes(discord.logo));
      assert.ok(html.includes('https://discord.com/example'));
    }
    const edit = await request('/admin/organizations/1/social-links/1', form({
      platform: discord.key, display_name: 'Join our community', account_url: 'https://discord.com/updated'
    }));
    assert.equal(edit.status, 302);
    const publicPage = await request('/org/ORG-000001');
    assert.match(await publicPage.text(), /Join our community/);
    const image = await request(`/uploads/logos/${discord.logo}`, { headers: { 'x-test-admin': '0' } });
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/png/);
  });

  await t.test('unknown platforms and unsafe URLs remain invalid', async () => {
    for (const [platform, url] of [['unknown', 'https://example.com'], [discord.key, 'javascript:alert(1)']]) {
      const res = await request('/admin/organizations/1/social-links', form({
        platform, display_name: 'Invalid', account_url: url
      }));
      assert.equal(res.status, 400);
    }
    assert.equal(links.length, 2);
  });

  await t.test('platform duplicate names are rejected and temporary images removed', async () => {
    const before = await fs.readdir(LOGOS);
    const res = await request('/admin/settings/platforms', upload({ label: 'discord' }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /already exists/);
    await assertNoExtraFiles(before);
  });

  await t.test('platform edits retain the key and propagate logos to existing links', async () => {
    const oldLogo = discord.logo;
    let res = await request(`/admin/settings/platforms/${discord.key}`, upload({ label: 'Community' }));
    assert.equal(res.status, 302);
    discord = (await platformModel.list()).find(platform => platform.key === discord.key);
    assert.equal(discord.label, 'Community');
    assert.notEqual(discord.logo, oldLogo);
    await assert.rejects(fs.access(path.join(LOGOS, oldLogo)), { code: 'ENOENT' });
    res = await request('/org/ORG-000001');
    const html = await res.text();
    assert.ok(html.includes(discord.logo));
    assert.ok(html.includes('Community logo'));
    res = await request(`/admin/settings/platforms/${discord.key}`, upload({ label: 'Community chat' }, null));
    assert.equal(res.status, 302);
    const updated = (await platformModel.list()).find(platform => platform.key === discord.key);
    assert.equal(updated.logo, discord.logo);
  });

  await t.test('built-in platform logos can be customized without losing defaults', async () => {
    const res = await request('/admin/settings/platforms/facebook', upload({ label: 'Facebook' }));
    assert.equal(res.status, 302);
    const platforms = await platformModel.list();
    assert.equal(platforms.filter(platform => platform.key === 'facebook').length, 1);
    assert.ok(platforms.find(platform => platform.key === 'facebook').logo);
    assert.equal(platforms.find(platform => platform.key === 'email').icon, 'bi-envelope-fill');
    assert.ok(require('../models/socialLinkModel').isValidUrl('hello@example.com', 'email'));
  });

  await t.test('platform persistence failures keep the existing logo and clean new files', async () => {
    const before = await fs.readdir(LOGOS);
    const original = (await platformModel.list()).find(platform => platform.key === discord.key);
    failPlatformSave = true;
    const res = await request(`/admin/settings/platforms/${discord.key}`, upload({ label: 'Community chat' }));
    failPlatformSave = false;
    assert.equal(res.status, 500);
    await assertNoExtraFiles(before);
    const unchanged = (await platformModel.list()).find(platform => platform.key === discord.key);
    assert.equal(unchanged.logo, original.logo);
    await fs.access(path.join(LOGOS, original.logo));
    assert.match(errors.pop().message, /Test platform write failure/);
  });

  await t.test('platform definitions survive model reloads and unrelated settings saves', async () => {
    const res = await request('/admin/settings', form({
      site_name: 'Updated portal', site_url: 'https://example.test'
    }));
    assert.equal(res.status, 302);
    delete require.cache[require.resolve('../models/platformModel')];
    const reloaded = require('../models/platformModel');
    const saved = (await reloaded.list()).find(platform => platform.key === discord.key);
    assert.ok(saved.logo);
    const invalid = await request('/admin/settings', form({ site_url: 'invalid' }));
    assert.equal(invalid.status, 400);
    assert.ok((await invalid.text()).includes('Community chat'));
  });

  await t.test('malformed stored platform definitions surface errors instead of hiding them', async () => {
    settings.set('social_platform:bad', JSON.stringify({ label: 'Broken', logo: '../bad.png' }));
    await assert.rejects(platformModel.list(), /Invalid social platform configuration/);
    const before = await fs.readdir(LOGOS);
    const res = await request('/admin/settings/platforms', upload({ label: 'Database error' }));
    assert.equal(res.status, 500);
    assert.match(errors.pop().message, /Invalid social platform configuration/);
    settings.delete('social_platform:bad');
    await assertNoExtraFiles(before);
  });

  await t.test('invalid image bytes and unknown targets do not leave files', async () => {
    const before = await fs.readdir(LOGOS);
    for (const url of ['/admin/organizations/1/qr/logo', '/admin/settings/platforms']) {
      const res = await request(url, upload({ label: 'Invalid image' }, 'not an image'));
      assert.equal(res.status, 400);
      assert.match(await res.text(), /Could not process the logo/);
    }
    for (const url of ['/admin/organizations/999/qr/logo', '/admin/settings/platforms/not-real']) {
      const res = await request(url, upload({ label: 'Missing' }));
      assert.equal(res.status, 404);
    }
    await assertNoExtraFiles(before);
  });

  await t.test('oversized files respect the configured upload limit', async () => {
    const before = await fs.readdir(LOGOS);
    const limit = Number(process.env.UPLOAD_MAX_SIZE_MB || 5);
    for (const url of ['/admin/settings/platforms', '/admin/organizations/1/qr/logo']) {
      const res = await request(url, upload({
        label: 'Too large'
      }, Buffer.alloc((limit + 1) * 1024 * 1024)));
      assert.equal(res.status, 400);
      assert.match(await res.text(), /upload limit/);
    }
    await assertNoExtraFiles(before);
  });

  assert.equal(errors.length, 0);
  assert.ok(activities.some(([, action]) => action === 'org_logo_update'));
  assert.ok(activities.some(([, action]) => action === 'platform_update'));
});
