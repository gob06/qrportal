const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(filename, 'utf8');

function loadStartup() {
  const calls = { listens: 0, exits: [], logs: [], errors: [] };
  let resolveConnection;
  let rejectConnection;
  const connection = new Promise((resolve, reject) => {
    resolveConnection = resolve;
    rejectConnection = reject;
  });
  const app = {
    set() {},
    use() {},
    get() {},
    listen(port, callback) {
      calls.listens += 1;
      assert.equal(calls.listens, 1, 'Only one listener is allowed');
      assert.equal(port, 3000);
      callback();
    }
  };
  const express = Object.assign(() => app, {
    static() {},
    urlencoded() {},
    json() {}
  });
  const modules = {
    dotenv: { config() {} },
    path,
    express,
    'express-session': () => {},
    'express-mysql-session': () => function MySQLStore() {},
    './config/database': { testConnection: () => connection },
    './middleware/securityMiddleware': {},
    './middleware/authMiddleware': {},
    './models/settingsModel': {}
  };
  const context = {
    __dirname: path.dirname(filename),
    module: { exports: {} },
    require(id) {
      if (Object.hasOwn(modules, id)) return modules[id];
      if (id.startsWith('./routes/')) return () => {};
      throw new Error(`Unexpected dependency: ${id}`);
    },
    process: {
      env: {},
      exit(code) { calls.exits.push(code); }
    },
    console: {
      log(message) { calls.logs.push(message); },
      error(message) { calls.errors.push(message); }
    }
  };
  vm.runInNewContext(source, context, { filename });
  return { calls, context, resolveConnection, rejectConnection };
}

const flushStartup = () => new Promise(resolve => setImmediate(resolve));

test('standalone startup waits for the database and listens once', async () => {
  const { calls, resolveConnection } = loadStartup();
  assert.equal(calls.listens, 0);
  resolveConnection();
  await flushStartup();
  assert.equal(calls.listens, 1);
  assert.deepEqual(calls.exits, []);
  assert.ok(calls.logs.includes('Database connection OK'));
});

test('LiteSpeed fallback does not create a second listener', async () => {
  const { calls, context, resolveConnection } = loadStartup();
  // LiteSpeed checks the startup module's exports before async startup finishes.
  const exportedApp = context.module.exports;
  if (!calls.listens && typeof exportedApp.listen === 'function') {
    exportedApp.listen(3000, () => {});
  }
  assert.equal(calls.listens, 0);
  resolveConnection();
  await flushStartup();
  assert.equal(calls.listens, 1);
});

test('database failure logs the error and exits without listening', async () => {
  const { calls, rejectConnection } = loadStartup();
  rejectConnection(new Error('Access denied'));
  await flushStartup();
  assert.deepEqual(calls.exits, [1]);
  assert.equal(calls.listens, 0);
  assert.ok(calls.errors.includes('Access denied'));
});
