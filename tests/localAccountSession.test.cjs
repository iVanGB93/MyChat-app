const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const out = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync('src/services/identity/' + name + '.ts', 'utf8'), {compilerOptions: {module: 1, target: 9}}).outputText)(p => p.startsWith('./') ? load(p.slice(2).replace(/\.ts$/, '')) : require(p), out);
  cache.set(name, out); return out;
}
const {createLocalAccountSession} = load('localAccountSession');
const {displayIdentity, parseIdentityCode, chooseBackupWords, checkBackupWords} = load('identityPresentation');
const account = 'axonic:1:' + 'ab'.repeat(32), password = 'a device-only test password';
function fixture(overrides = {}) {
  let state = 'unlocked';
  const storage = {policy: null, credential: null};
  const identity = {status: () => ({state, account}), unlock: async value => {if (value !== password) throw Error('Wrong password'); state = 'unlocked';}, lock: () => {state = 'locked';}};
  const session = createLocalAccountSession({identity, readPolicy: async () => storage.policy, writePolicy: async value => {storage.policy = value;},
    readCredential: async () => storage.credential, writeCredential: async value => {storage.credential = value;}, removeCredential: async () => {storage.credential = null;}, ...overrides});
  return {session, identity, storage};
}
test('default device session resumes after cold start without weakening password verification', async () => {
  const f = fixture(); await f.session.initialize(); assert.equal(f.session.autoLock(), false);
  await f.session.remember(password); f.identity.lock(); await f.session.initialize(); assert.equal(f.identity.status().state, 'unlocked');
  f.identity.lock(); f.storage.credential = JSON.stringify({version: 1, account, password: 'wrong'});
  await f.session.initialize(); assert.equal(f.identity.status().state, 'locked'); assert.equal(f.storage.credential, null);
});
test('opt-in locking clears automatic login and remains enabled across cold start', async () => {
  const f = fixture(); await f.session.remember(password); await f.session.setAutoLock(true); f.identity.lock();
  await f.session.initialize(); assert.equal(f.session.autoLock(), true); assert.equal(f.identity.status().state, 'locked'); assert.equal(f.storage.credential, null);
  await assert.rejects(f.session.setAutoLock(false, 'wrong'), /Wrong password/); assert.equal(f.session.autoLock(), true);
  await f.session.setAutoLock(false, password); f.identity.lock(); await f.session.initialize(); assert.equal(f.identity.status().state, 'unlocked');
});
test('manual lock prevents a pending remembered login from being stored afterwards', async () => {
  let release, started, credential; const gate = new Promise(resolve => {release = resolve;});
  const f = fixture({writeCredential: async value => {started = true; await gate; credential = value;}, removeCredential: async () => {credential = null;}});
  const pending = f.session.remember(password); while (!started) await new Promise(resolve => setImmediate(resolve));
  const locked = f.session.lock(); release(); await Promise.all([pending, locked]);
  assert.equal(credential, null); assert.equal(f.identity.status().state, 'locked');
});
test('remembered login cannot unlock a different local identity', async () => {
  const f = fixture(); f.identity.lock(); f.storage.credential = JSON.stringify({version: 1, account: 'someone-else', password});
  await f.session.initialize(); assert.equal(f.identity.status().state, 'locked'); assert.equal(f.storage.credential, null);
});
test('manual lock cancels a late cold-start credential read', async () => {
  let release; const gate = new Promise(resolve => {release = resolve;});
  const f = fixture({readCredential: () => gate}); f.identity.lock(); const pending = f.session.initialize();
  await new Promise(resolve => setImmediate(resolve)); await f.session.lock(); release(JSON.stringify({version: 1, account, password}));
  await pending; assert.equal(f.identity.status().state, 'locked');
});
test('two backup challenges have distinct random positions and require the exact selected words', async () => {
  const words = 'one two three four five six seven eight nine ten eleven twelve';
  const positions = await chooseBackupWords(12, async () => new Uint8Array([255, 3, 3, 7]));
  assert.deepEqual(positions, [3, 7]); assert.equal(checkBackupWords(words, positions, [' FOUR ', 'eight']), true);
  assert.equal(checkBackupWords(words, positions, ['eight', 'four']), false);
  assert.equal(checkBackupWords(words, [3, 3], ['four', 'four']), false);
});
test('friendly identity sharing round trips to the signed account and accepts previous codes', () => {
  const code = displayIdentity(account); assert.ok(code.startsWith('axon:')); assert.ok(code.length<68);
  assert.equal(parseIdentityCode('axon'+'ab'.repeat(32)),account); assert.equal(parseIdentityCode(code), account); assert.equal(parseIdentityCode(account), account);
  assert.equal(parseIdentityCode(code.slice(0, -1)), null); assert.equal(parseIdentityCode('axon' + 'g'.repeat(64)), null);
});

test('a delayed startup policy read cannot override newly enabled locking', async () => {
  let releasePolicy, releaseRemoval;
  const policy = new Promise(resolve => {releasePolicy = resolve;});
  const removal = new Promise(resolve => {releaseRemoval = resolve;});
  const f = fixture({readPolicy: () => policy, removeCredential: () => removal});
  f.storage.credential = JSON.stringify({version: 1, account, password}); f.identity.lock();
  const startup = f.session.initialize();
  const enabling = f.session.setAutoLock(true);
  releasePolicy('0'); await startup;
  const result = {state: f.identity.status().state, autoLock: f.session.autoLock()};
  releaseRemoval(); await enabling;
  assert.deepEqual(result, {state: 'locked', autoLock: true});
});

test('enabled lock policy is persisted even if deleting the remembered credential fails', async () => {
  const f = fixture({removeCredential: async () => {throw Error('Keystore temporarily unavailable');}});
  await f.session.remember(password);
  await assert.rejects(f.session.setAutoLock(true), /Keystore/);
  assert.equal(f.storage.policy, '1'); assert.equal(f.session.autoLock(), true);
});

test('malformed lock preference does not authorize automatic login', async () => {
  const f = fixture(); f.storage.policy = 'invalid'; f.storage.credential = JSON.stringify({version: 1, account, password});
  f.identity.lock(); await f.session.initialize();
  assert.equal(f.session.autoLock(), true); assert.equal(f.identity.status().state, 'locked'); assert.equal(f.storage.credential, null);
});

test('manual lock blocks cold resume even when keystore deletion fails, without enabling auto-lock', async () => {
  const f = fixture({removeCredential: async () => {throw Error('Keystore temporarily unavailable');}});
  await f.session.remember(password);
  await assert.rejects(f.session.lock(), /Keystore/);
  await f.session.initialize();
  assert.equal(f.identity.status().state, 'locked'); assert.equal(f.session.autoLock(), false);
  await f.identity.unlock(password); await f.session.remember(password);
  assert.equal(f.storage.policy, '0');
  f.identity.lock(); await f.session.initialize(); assert.equal(f.identity.status().state, 'unlocked');
});

test('manual lock still deletes the automatic credential when preference storage fails', async () => {
  const f = fixture({writePolicy: async () => {throw Error('Preference storage unavailable');}});
  await f.session.remember(password); await assert.rejects(f.session.lock(), /Preference storage/);
  assert.equal(f.storage.credential, null); assert.equal(f.identity.status().state, 'locked');
});

test('enabling automatic locking still deletes the credential when preference storage fails', async () => {
  const f = fixture({writePolicy: async () => {throw Error('Preference storage unavailable');}});
  await f.session.remember(password); await assert.rejects(f.session.setAutoLock(true), /Preference storage/);
  assert.equal(f.storage.credential, null); assert.equal(f.session.autoLock(), true);
});
