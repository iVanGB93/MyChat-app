const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/call-end-queue.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function setup(storage = new Map()) {
  let online = false, owner = 1, brokenStorage = false;
  const sent = [], timers = [];
  const sandbox = { exports: {}, console: { warn() {} }, setTimeout: (fn) => { timers.push(fn); return timers.length; }, require: (name) => ({
    '@react-native-async-storage/async-storage': { default: {
      getItem: async (key) => { if (brokenStorage) throw Error('disk'); return storage.get(key); },
      setItem: async (key, value) => { if (brokenStorage) throw Error('disk'); storage.set(key, value); },
    } },
    './api': { default: { post: async (url) => { if (!online) throw Error('offline'); sent.push({ url, owner }); } } },
    '../store/appStore': { useAppStore: { getState: () => ({ user: { id: owner } }) } },
  }[name]) };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, sent, online: () => { online = true; }, switchUser: (id) => { owner = id; }, storageFailure: (value) => { brokenStorage = value; } };
}
test('offline hang-up survives restart and reconnect flushes it', async () => {
  const storage = new Map(), first = setup(storage);
  assert.equal((await first.requestCallEnd('call1', 'end')).status, 'queued');
  const restarted = setup(storage); restarted.online();
  await restarted.flushPendingCallEnds();
  assert.equal(restarted.sent.length, 1);
  await restarted.flushPendingCallEnds();
  assert.equal(restarted.sent.length, 1);
});
test('queued hang-ups are isolated by signed-in user', async () => {
  const s = setup(); await s.requestCallEnd('call1', 'end');
  s.switchUser(2); s.online(); await s.flushPendingCallEnds();
  assert.equal(s.sent.length, 0);
  s.switchUser(1); await s.flushPendingCallEnds();
  assert.equal(s.sent.length, 1);
});
test('storage and network failure retain hang-up in memory for recovery', async () => {
  const s = setup(); s.storageFailure(true);
  assert.equal((await s.requestCallEnd('call1', 'end')).status, 'queued');
  s.storageFailure(false); s.online(); await s.flushPendingCallEnds();
  assert.equal(s.sent.length, 1);
});
