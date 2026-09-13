const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/messageAckRetryQueue.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const receipt = (id) => ({ message_id: id, room_id: 'room', sender_id: 1 });
const accepted = { status: 200, data: { status: 'delivered' } };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(post) {
  let stored = null, now = Date.now();
  const modules = {
    '@react-native-async-storage/async-storage': { default: {
      getItem: async () => stored,
      setItem: async (_, value) => { stored = value; },
      removeItem: async () => { stored = null; },
    } },
    './api': { default: { post } },
  };
  const sandbox = { exports: {}, console, Date: class extends Date { static now() { return now; } },
    require: (name) => { assert.ok(modules[name], name); return modules[name]; } };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, advance: (ms) => { now += ms; } };
}
test('slow HTTP retry does not block new receipts and merge preserves them', async () => {
  const entered = deferred(), release = deferred();
  const app = fixture(async () => { entered.resolve(); return release.promise; });
  await app.enqueueMessageAck(receipt('old'));
  const flush = app.flushPendingAcks({ force: true });
  await entered.promise;
  await app.enqueueMessageAck(receipt('new'));
  assert.equal((await app.getQueueStatus()).length, 2);
  release.resolve(accepted);
  await flush;
  assert.deepEqual(Array.from(await app.getQueueStatus(), x => x.message_id), ['new']);
});
test('failed retry cannot resurrect a concurrently acknowledged receipt', async () => {
  const entered = deferred(), release = deferred();
  const app = fixture(async () => { entered.resolve(); await release.promise; throw Error('offline'); });
  await app.enqueueMessageAck(receipt('one'));
  const flush = app.flushPendingAcks({ force: true });
  await entered.promise;
  await app.removeMessageAck('one', 1, 'room');
  release.resolve(); await flush;
  assert.equal((await app.getQueueStatus()).length, 0);
});
test('pending receipts survive more than 24 hours and reject ambiguous success', async () => {
  const app = fixture(async () => ({ status: 200, data: { status: 'not_found' } }));
  await app.enqueueMessageAck(receipt('old'));
  app.advance(3 * 86400000);
  const result = await app.flushPendingAcks({ force: true });
  assert.equal(result.failed, 1);
  assert.equal((await app.getQueueStatus()).length, 1);
});
test('logout during a request cannot restore the old queue', async () => {
  const entered = deferred(), release = deferred();
  const app = fixture(async () => { entered.resolve(); return release.promise; });
  await app.enqueueMessageAck(receipt('old'));
  const flush = app.flushPendingAcks({ force: true });
  await entered.promise;
  await app.clearQueue();
  await app.enqueueMessageAck(receipt('new-account'));
  release.resolve(accepted); await flush;
  assert.deepEqual(Array.from(await app.getQueueStatus(), x => x.message_id), ['new-account']);
});
