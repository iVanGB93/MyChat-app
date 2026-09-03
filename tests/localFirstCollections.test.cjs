const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/localFirstCollections.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function fixture() {
  const storage = new Map(), requests = [];
  let rows = [], user = { id: 14 }, next = { upserts: [{ id: 'a', name: 'A' }], removed_ids: [], versions: { a: 'v1' } };
  const controls = { post: async () => ({ data: next }), get: async () => ({ data: { results: [], next: null } }) };
  const adapters = {
    './api': { __esModule: true, BASE_URL: 'https://chat.example', default: {
      post: async (url, data) => { requests.push({ url, data }); return controls.post(url, data); },
      get: async (url) => { requests.push({ url }); return controls.get(url); },
    } },
    '../store/appStore': { useAppStore: { getState: () => ({ user }) } },
    '@react-native-async-storage/async-storage': {
      getItem: async (key) => storage.get(key), setItem: async (key, value) => storage.set(key, value),
    },
  };
  const sandbox = { exports: {}, require(name) { assert.ok(name in adapters, name); return adapters[name]; } };
  vm.runInNewContext(compiled, sandbox);
  const options = {
    resource: 'rooms', syncUrl: '/rooms/sync/', legacyUrl: '/rooms/', id: (row) => row.id,
    read: async () => rows, save: async (_, value) => { rows = value; },
  };
  return { ...sandbox.exports, requests, storage, controls, options,
    run: (extra = {}) => sandbox.exports.refreshCollection({ ...options, ...extra }),
    setRows: (value) => { rows = value; }, setUser: (value) => { user = value; },
    setDelta: (value) => { next = value; }, rows: () => rows };
}

test('overlapping screens share one request; focus within freshness window reads locally', async () => {
  const app = fixture();
  await Promise.all([app.run(), app.run(), app.run()]);
  assert.equal(app.requests.length, 1);
  await app.run();
  assert.equal(app.requests.length, 1);
});

test('missing SQLite rows bypass a fresh timestamp and request their metadata again', async () => {
  const app = fixture();
  await app.run();
  app.setRows([]);
  await app.run();
  assert.equal(app.requests.length, 2);
  assert.equal(Object.keys(app.requests[1].data.versions).length, 0);
  assert.equal(app.rows().length, 1);
});

test('first delta removes departed rooms left in a cache from an older app', async () => {
  const app = fixture();
  app.setRows([{ id: 'departed' }]);
  app.setDelta({ upserts: [{ id: 'current' }], removed_ids: ['departed'], versions: { current: 'v1' } });
  await app.run();
  assert.equal(app.requests[0].data.versions.departed, '');
  assert.deepEqual([...app.rows()].map((row) => row.id), ['current']);
});

test('unchanged metadata records freshness without rewriting SQLite collections', async () => {
  const app = fixture();
  await app.run();
  app.setDelta({ upserts: [], removed_ids: [], versions: { a: 'v1' } });
  let writes = 0;
  await app.run({ force: true, save: async () => { writes++; } });
  assert.equal(writes, 0);
});

test('delta refresh changes only supplied rows, removes departed rooms and sends known versions', async () => {
  const app = fixture();
  await app.run();
  app.setDelta({ upserts: [{ id: 'b', name: 'B' }], removed_ids: ['a'], versions: { b: 'v2' } });
  await app.run({ force: true });
  assert.equal(app.requests[1].data.versions.a, 'v1');
  assert.deepEqual([...app.rows()].map((row) => row.id), ['b']);
});

test('server removals do not erase local call history', async () => {
  const app = fixture();
  await app.run({ resource: 'calls', preserveHistory: true });
  app.setDelta({ upserts: [{ id: 'b' }], removed_ids: ['a'], versions: { b: 'v1' } });
  await app.run({ resource: 'calls', preserveHistory: true, force: true });
  assert.equal(app.rows().length, 2);
});

test('network failure preserves local data and does not mark the check fresh', async () => {
  const app = fixture();
  app.setRows([{ id: 'local' }]);
  app.controls.post = async () => { throw Error('offline'); };
  await assert.rejects(app.run(), /offline/);
  assert.equal(app.rows()[0].id, 'local');
  assert.equal(app.storage.size, 0);
});

test('a mutation during a fetch prevents stale data from replacing newer local metadata', async () => {
  const app = fixture();
  app.controls.post = async () => {
    app.invalidateCollection('rooms');
    app.setRows([{ id: 'newer' }]);
    return { data: { upserts: [{ id: 'stale' }], removed_ids: [], versions: {} } };
  };
  await app.run();
  assert.equal(app.rows()[0].id, 'newer');
  assert.equal(app.storage.size, 0);
});

test('switching account while a request runs cannot save into the new account', async () => {
  const app = fixture();
  app.controls.post = async () => {
    app.setUser({ id: 99 });
    return { data: { upserts: [{ id: 'private' }], removed_ids: [], versions: {} } };
  };
  await assert.rejects(app.run(), /Account changed/);
  assert.equal(app.rows().length, 0);
});

test('older server fallback follows all pages and rejects foreign pagination URLs', async () => {
  const app = fixture();
  app.controls.post = async () => { throw { response: { status: 404 } }; };
  app.controls.get = async (url) => ({ data: url === '/rooms/'
    ? { results: [{ id: 'a' }], next: 'https://chat.example/rooms/?page=2' }
    : { results: [{ id: 'b' }], next: null } });
  assert.equal((await app.run()).length, 2);
  app.controls.get = async () => ({ data: { results: [], next: 'https://evil.example/steal' } });
  await assert.rejects(app.fetchCollectionPages('/rooms/'), /Untrusted/);
});
