const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/mediaConfirmationQueue.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
).outputText;

function fixture() {
  const storage = new Map();
  const requests = [];
  let handler = async () => ({ status: 200, data: { ok: true, all_confirmed: true } });
  const adapters = {
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async (key) => { storage.delete(key); },
    },
    './api': { __esModule: true, default: { post: async (url, data) => {
      requests.push({ url, data });
      return handler(url, data);
    } } },
    './installationIdentity': { getInstallationId: async () => 'install-1' },
    './diagnostics': { debugLog() {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in adapters, `unexpected dependency ${name}`);
      return adapters[name];
    },
    Date,
    JSON,
  });
  return {
    queue: module.exports,
    storage,
    requests,
    respondWith(next) { handler = next; },
  };
}

test('failed media confirmation remains durable and a forced lifecycle retry clears it', async () => {
  const app = fixture();
  app.respondWith(async () => { throw Error('offline'); });
  assert.equal(await app.queue.confirmMediaDownloaded('media-1'), false);
  assert.equal((await app.queue.getPendingMediaConfirmations()).length, 1);

  app.respondWith(async () => ({ status: 200, data: { ok: true, all_confirmed: false } }));
  const result = await app.queue.flushPendingMediaConfirmations({ force: true });
  assert.equal(result.flushed, 1);
  assert.equal(result.failed, 0);
  assert.equal((await app.queue.getPendingMediaConfirmations()).length, 0);
  assert.equal(app.requests.length, 2);
});

test('successful confirmation is removed even while other recipients remain outstanding', async () => {
  const app = fixture();
  app.respondWith(async () => ({ status: 200, data: { ok: true, all_confirmed: false } }));
  assert.equal(await app.queue.confirmMediaDownloaded('media-2'), true);
  assert.equal((await app.queue.getPendingMediaConfirmations()).length, 0);
  assert.equal(app.requests[0].url, '/api/chat/media/media-2/downloaded/');
  assert.equal(app.requests[0].data.installation_id, 'install-1');
});
