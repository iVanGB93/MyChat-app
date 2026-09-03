const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/contactService.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
).outputText;
const contact = { id: 42, contact: 18, contact_detail: { id: 18 } };
const failure = (status, data) => ({ response: { status, data } });

function fixture(options = {}) {
  const requests = [], accepted = [], cached = [], warnings = [];
  const api = {
    async post(url, data) {
      requests.push({ method: 'POST', url, data });
      if (options.postError) throw options.postError;
      return { data: contact };
    },
    async get(url) {
      requests.push({ method: 'GET', url });
      if (options.getError) throw options.getError;
      return { data: options.contacts ?? [contact] };
    },
  };
  const adapters = {
    './localFirstCollections': {
      invalidateCollection() {},
      async refreshCollection(options) {
        assert.equal(options.force, true, 'acceptance reconciliation must bypass cache');
        const { data } = await api.get(options.legacyUrl);
        return Array.isArray(data) ? data : data.results;
      },
    },
    './api': api,
    './presenceService': { seedPresenceFromUsers() {}, subscribePresenceUsers() {} },
    '../store/appStore': { useAppStore: { getState: () => ({
      user: { id: options.owner ?? 14 }, addContactId: (id) => accepted.push(id),
    }) } },
    './localMessageStore': { async cacheAcceptedContact(owner, entry) {
      cached.push({ owner, entry });
      if (options.cacheError) throw options.cacheError;
    } },
  };
  const sandbox = { exports: {}, console: { warn: (message) => warnings.push(message) }, require(name) {
    assert.ok(name in adapters, `Unexpected dependency: ${name}`);
    return adapters[name];
  } };
  vm.runInNewContext(compiled, sandbox);
  return { ...sandbox.exports, requests, accepted, cached, warnings };
}

test('accept persists the server contact in memory and local caches', async () => {
  const app = fixture();
  assert.equal(await app.acceptContact(14, 18), contact);
  assert.deepEqual(app.accepted, [18]);
  assert.deepEqual(app.cached, [{ owner: 14, entry: contact }]);
  assert.equal(app.requests.length, 1);
});

test('older server duplicate 500 is accepted only after confirming the exact contact', async () => {
  const app = fixture({ postError: failure(500), contacts: { results: [contact] } });
  assert.equal(await app.acceptContact(14, 18), contact);
  assert.deepEqual(app.requests.map((r) => r.method), ['POST', 'GET']);
  assert.deepEqual(app.accepted, [18]);
});

test('lost POST response can be reconciled without another write', async () => {
  const app = fixture({ postError: new Error('timeout') });
  assert.equal(await app.acceptContact(14, 18), contact);
  assert.equal(app.requests.filter((r) => r.method === 'POST').length, 1);
});

test('unconfirmed server failure is not accepted and preserves the original error', async () => {
  const error = failure(500);
  for (const options of [{ contacts: [{ ...contact, contact: 99 }] }, { getError: new Error('offline') }]) {
    const app = fixture({ ...options, postError: error });
    await assert.rejects(app.acceptContact(14, 18), (actual) => actual === error);
    assert.deepEqual(app.accepted, []);
    assert.deepEqual(app.cached, []);
  }
});

test('400, auth, missing user and throttling errors are never treated as accepted', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const error = failure(status);
    const app = fixture({ postError: error });
    await assert.rejects(app.acceptContact(14, 18), (actual) => actual === error);
    assert.equal(app.requests.length, 1);
    assert.deepEqual(app.accepted, []);
  }
});

test('local cache failure does not turn server acceptance into a UI failure', async () => {
  const app = fixture({ cacheError: new Error('database is locked') });
  assert.equal(await app.acceptContact(14, 18), contact);
  assert.deepEqual(app.accepted, [18]);
  assert.equal(app.warnings.length, 1);
});

test('switching accounts during acceptance cannot mutate the new account', async () => {
  const app = fixture({ owner: 99 });
  await assert.rejects(app.acceptContact(14, 18), /Account changed/);
  assert.deepEqual(app.accepted, []);
  assert.deepEqual(app.cached, []);
});

test('validation and connection errors provide useful feedback without server internals', () => {
  const app = fixture();
  assert.equal(app.contactErrorMessage(failure(400, { contact: ['Unblock this user first.'] })), 'Unblock this user first.');
  assert.match(app.contactErrorMessage(new Error('offline')), /connection/);
  assert.match(app.contactErrorMessage(failure(401)), /sign in/);
  assert.match(app.contactErrorMessage(failure(500, '<html>private server traceback</html>')), /try again shortly/);
});
