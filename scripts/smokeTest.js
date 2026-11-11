#!/usr/bin/env node
/**
 * End-to-end smoke test. Run while the app is running locally:
 *   node scripts/smokeTest.js [baseUrl]
 * Exercises login, organization CRUD, permanent QR destination invariants,
 * social links, QR downloads, public landing page and analytics recording.
 */
const assert = require('assert');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const BASE = process.argv[2] || 'http://localhost:3000';
const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...options,
    headers: { cookie: cookieHeader(), ...(options.headers || {}) }
  });
  storeCookies(res);
  return res;
}

function extractCsrf(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  if (!m) throw new Error('CSRF token not found in page');
  return m[1];
}

async function main() {
  let passed = 0;
  const ok = (name) => { passed += 1; console.log(`  PASS  ${name}`); };

  // --- Authentication ---
  let res = await req('/admin');
  assert.strictEqual(res.status, 302, 'unauthenticated /admin should redirect');
  ok('Protected route redirects unauthenticated visitor to login');

  res = await req('/admin/login');
  let csrf = extractCsrf(await res.text());

  res = await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'admin', password: 'wrong-password' })
  });
  assert.strictEqual(res.status, 401, 'wrong password should be rejected');
  ok('Invalid credentials are rejected');

  res = await req('/admin/login');
  csrf = extractCsrf(await res.text());
  res = await req('/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, username: 'admin', password: 'admin123' })
  });
  assert.strictEqual(res.status, 302, 'login should redirect to dashboard');
  ok('Administrator can log in');

  res = await req('/admin');
  assert.strictEqual(res.status, 200);
  csrf = extractCsrf(await res.text());
  ok('Dashboard loads for authenticated administrator');

  // --- CSRF protection ---
  res = await req('/admin/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'No CSRF Org' })
  });
  assert.strictEqual(res.status, 403, 'missing CSRF token should be rejected');
  ok('State-changing request without CSRF token is rejected');

  // --- Create organization (multipart, with logo) ---
  const sharp = require('sharp');
  const logoPng = await sharp({
    create: { width: 240, height: 240, channels: 4, background: { r: 230, g: 57, b: 70, alpha: 1 } }
  }).png().toBuffer();

  const name1 = `Smoke Test Org ${Date.now()}`;
  const form = new FormData();
  form.set('_csrf', csrf);
  form.set('name', name1);
  form.set('description', 'Created by the automated smoke test');
  form.set('primary_color', '#e63946');
  form.set('secondary_color', '#457b9d');
  form.set('background_color', '#f1faee');
  form.set('contact_info', 'smoke@test.local');
  form.set('status', 'active');
  form.set('logo', new Blob([logoPng], { type: 'image/png' }), 'logo.png');

  res = await req('/admin/organizations', { method: 'POST', body: form });
  assert.strictEqual(res.status, 302, `org creation should redirect, got ${res.status}`);
  const orgPath = res.headers.get('location').split('?')[0];
  const orgId = orgPath.match(/organizations\/(\d+)/)[1];
  ok('Organization created with uploaded logo');

  res = await req(orgPath);
  let page = await res.text();
  const permMatch = page.match(/ORG-\d{6}/);
  assert.ok(permMatch, 'permanent id should be displayed');
  const permanentId = permMatch[0];
  const urlMatch = page.match(new RegExp(`${BASE.replace(/[/\\^$.*+?()[\]{}|]/g, '\\$&')}/org/ORG-\\d{6}`));
  assert.ok(urlMatch, 'permanent QR URL should be displayed');
  const permanentUrl = urlMatch[0];
  assert.ok(permanentUrl.endsWith(permanentId));
  assert.ok(page.includes('/uploads/logos/'), 'logo should be shown');
  ok(`Permanent identifier assigned (${permanentId}) with permanent URL`);

  // --- QR generation ---
  res = await req(`/admin/organizations/${orgId}/qr/preview?size=256`);
  assert.strictEqual(res.status, 200);
  let buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'preview should be a PNG');
  ok('QR preview renders as PNG');

  res = await req(`/admin/organizations/${orgId}/qr/download.png?size=512&fg=%23222222&bg=%23ffffff&logo=1`);
  assert.strictEqual(res.status, 200);
  buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 1000, 'download should contain data');
  const meta = await sharp(buf).metadata();
  assert.strictEqual(meta.width, 512, 'PNG should honor requested size');
  ok('QR PNG download works (512px, custom colors, embedded logo)');

  res = await req(`/admin/organizations/${orgId}/qr/download.svg?logo=1`);
  assert.strictEqual(res.status, 200);
  const svg = await res.text();
  assert.ok(svg.includes('<svg'), 'should be SVG');
  assert.ok(svg.includes('data:image/png;base64'), 'SVG should embed the logo');
  ok('QR SVG download works with embedded logo');

  // Decode the QR to prove it encodes the permanent URL? (No decoder dependency;
  // instead verify the server always uses the stored permanent URL via DB checks below.)

  // --- Social links ---
  res = await req(`/admin/organizations/${orgId}/social-links`);
  csrf = extractCsrf(await res.text());
  for (const [platform, displayName, url] of [
    ['facebook', 'Facebook Page', 'https://facebook.com/smoketest'],
    ['instagram', 'Instagram', 'https://instagram.com/smoketest'],
    ['email', 'Email us', 'smoke@test.local']
  ]) {
    res = await req(`/admin/organizations/${orgId}/social-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, platform, display_name: displayName, account_url: url, status: 'active' })
    });
    assert.strictEqual(res.status, 302, `adding ${platform} link should redirect`);
  }
  ok('Social links created (facebook, instagram, email with mailto normalization)');

  res = await req(`/admin/organizations/${orgId}/social-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, platform: 'facebook', display_name: 'Bad', account_url: 'javascript:alert(1)', status: 'active' })
  });
  assert.strictEqual(res.status, 400, 'invalid URL should be rejected');
  ok('Invalid/unsafe social link URL is rejected');

  // Disable the instagram link.
  res = await req(`/admin/organizations/${orgId}/social-links`);
  page = await res.text();
  const linkIds = [...page.matchAll(/data-link-id="(\d+)"/g)].map((m) => m[1]);
  assert.strictEqual(linkIds.length, 3);
  res = await req(`/admin/organizations/${orgId}/social-links/${linkIds[1]}/toggle`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);
  ok('Social link can be disabled');

  // --- Public landing page ---
  res = await fetch(`${BASE}/org/${permanentId}`); // no admin cookies: public visitor
  assert.strictEqual(res.status, 200);
  page = await res.text();
  assert.ok(page.includes(name1), 'landing shows org name');
  assert.ok(page.includes('Facebook Page'), 'landing shows active link');
  assert.ok(page.includes('mailto:smoke@test.local'), 'landing shows email link');
  assert.ok(!page.includes('Instagram'), 'disabled link must NOT appear');
  assert.ok(page.includes('#e63946'), 'landing uses org branding');
  ok('Public landing page shows active links only, with branding (no login needed)');

  // --- Permanence invariants ---
  const name2 = `${name1} RENAMED`;
  res = await req(`/admin/organizations/${orgId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: csrf, name: name2, description: 'renamed', status: 'active',
      primary_color: '#111111', secondary_color: '#222222', background_color: '#ffffff'
    })
  });
  assert.strictEqual(res.status, 302, 'org update should succeed');

  res = await req(orgPath);
  page = await res.text();
  assert.ok(page.includes(name2), 'name should be updated');
  assert.ok(page.includes(permanentUrl), 'permanent URL must be unchanged after rename');
  assert.ok(page.includes(permanentId), 'permanent ID must be unchanged after rename');
  ok('Renaming the organization does NOT change the permanent QR destination');

  res = await fetch(`${BASE}/org/${permanentId}`);
  assert.strictEqual(res.status, 200, 'old QR destination still works after rename');
  ok('Existing QR destination still resolves after rename');

  // Direct DB-level immutability check (trigger must reject changes).
  const { pool } = require('../config/database');
  let triggerBlocked = false;
  try {
    await pool.query('UPDATE organizations SET permanent_qr_url = ? WHERE id = ?', ['https://evil.example/hijack', orgId]);
  } catch (err) {
    triggerBlocked = /immutable/i.test(err.message);
  }
  assert.ok(triggerBlocked, 'DB trigger must block permanent_qr_url changes');
  ok('Database trigger blocks any modification of permanent_qr_url');

  // --- Analytics ---
  const [[scanRow]] = await pool.query(
    'SELECT COUNT(*) AS n FROM qr_scans WHERE organization_id = ?', [orgId]);
  assert.ok(Number(scanRow.n) >= 2, 'landing visits should be recorded');
  const [[metaRow]] = await pool.query(
    'SELECT anonymized_metadata FROM qr_scans WHERE organization_id = ? LIMIT 1', [orgId]);
  assert.ok(/^[0-9a-f]{32}$/.test(metaRow.anonymized_metadata), 'only an anonymized hash is stored');
  ok('QR scans recorded with privacy-preserving anonymized metadata only');

  res = await req('/admin/analytics');
  assert.strictEqual(res.status, 200);
  ok('Analytics dashboard loads');

  // --- Deactivation shows inactive page, not a redirect ---
  res = await req(`/admin/organizations/${orgId}/toggle-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/org/${permanentId}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 200, 'inactive org must not redirect elsewhere');
  page = await res.text();
  assert.ok(page.includes('temporarily unavailable'), 'inactive page message shown');
  ok('Deactivated organization shows inactive page at the same permanent URL');

  // Reactivate.
  await req(`/admin/organizations/${orgId}/toggle-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });

  // --- Archive / restore / identifier reservation ---
  res = await req(`/admin/organizations/${orgId}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/org/${permanentId}`);
  assert.strictEqual(res.status, 404, 'archived org landing shows not-found');
  ok('Archived organization landing page is hidden');

  res = await req(`/admin/organizations/${orgId}/restore`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);
  res = await fetch(`${BASE}/org/${permanentId}`);
  assert.strictEqual(res.status, 200, 'restored org keeps its original destination');
  ok('Restored organization keeps its original permanent QR destination');

  // Create a second org and prove identifiers are never reused after delete.
  res = await req('/admin');
  csrf = extractCsrf(await res.text());
  const form2 = new FormData();
  form2.set('_csrf', csrf);
  form2.set('name', `Reuse Check Org ${Date.now()}`);
  form2.set('status', 'active');
  res = await req('/admin/organizations', { method: 'POST', body: form2 });
  const org2Path = res.headers.get('location').split('?')[0];
  const org2Id = org2Path.match(/organizations\/(\d+)/)[1];
  res = await req(org2Path);
  const perm2 = (await res.text()).match(/ORG-\d{6}/)[0];
  assert.notStrictEqual(perm2, permanentId);

  res = await req(`/admin/organizations/${org2Id}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  res = await req(`/admin/organizations/${org2Id}/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);

  const form3 = new FormData();
  form3.set('_csrf', csrf);
  form3.set('name', `Reuse Check Org B ${Date.now()}`);
  form3.set('status', 'active');
  res = await req('/admin/organizations', { method: 'POST', body: form3 });
  const org3Path = res.headers.get('location').split('?')[0];
  res = await req(org3Path);
  const perm3 = (await res.text()).match(/ORG-\d{6}/)[0];
  assert.notStrictEqual(perm3, perm2, 'deleted identifier must never be reused');
  const [[reg]] = await pool.query(
    'SELECT COUNT(*) AS n FROM permanent_id_registry WHERE permanent_id = ?', [perm2]);
  assert.strictEqual(Number(reg.n), 1, 'deleted identifier stays reserved in the registry');
  ok(`Deleted identifier ${perm2} stays reserved; new org got ${perm3}`);

  // --- Logout ---
  res = await req('/admin');
  csrf = extractCsrf(await res.text());
  res = await req('/admin/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf })
  });
  assert.strictEqual(res.status, 302);
  res = await req('/admin');
  assert.strictEqual(res.status, 302, 'session should be destroyed after logout');
  ok('Administrator can log out; session is destroyed');

  console.log(`\nAll ${passed} smoke tests passed.`);
  await pool.end();
}

main().catch((err) => {
  console.error('\nSMOKE TEST FAILED:', err.message);
  process.exit(1);
});
