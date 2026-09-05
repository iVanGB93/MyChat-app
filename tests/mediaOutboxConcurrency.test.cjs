const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createTransferScheduler } = require('../src/services/mediaTransferPolicy.ts');

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/chatWsManager.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function fixture() {
  const frames = [], pointers = new Map();
  const timers = [];
  let finishUpload, uploadCalls = 0;
  const waitingUpload = new Promise((resolve) => { finishUpload = resolve; });
  const schedule = createTransferScheduler(2);
  const modules = {
    './localMessageStore': {
      getMessageExpectedRecipients: async () => null,
      getMediaPointer: async (id) => pointers.get(id),
      setMediaPointer: async (id, value) => { pointers.set(id, value); },
      clearMessageTransferFailure: async () => {},
    },
    './mediaLane': {
      uploadMedia: () => schedule('upload', async () => { uploadCalls++; await waitingUpload; return { media_id: 'media', md5: 'hash', size_bytes: 20, mime: 'application/pdf' }; }),
    },
    '../store/appStore': { useAppStore: { getState: () => ({}) } },
    './notificationWsManager': { isNotifWsReady: () => true, sendRawNotif: (frame) => { frames.push(frame); return true; } },
    './messageLifecycle': { shouldSuppressOutboxReplay: (awaitingAck) => awaitingAck },
    './diagnostics': { debugLog() {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(`${compiled}\nexports.sendForTest = sendOutboxFrame; exports.stateForTest = createRoomState;`, {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name]; },
    // ACK clocks do not fire in these narrowly scoped concurrency tests.
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {}, console,
  });
  module.exports.setCurrentUserId(18, 'test-user');
  return {
    ...module.exports, frames, pointers, timers, finishUpload, uploadCalls: () => uploadCalls,
    state: module.exports.stateForTest(),
    message: { id: 'message', type: 'document', content: 'test.pdf', file_uri: 'file:///test.pdf', created_at: '2026-09-02T12:00:00Z' },
  };
}

test('the room snapshot exposes only the active send attempt as sending', async () => {
  const f = fixture();
  const send = f.sendForTest(f.state, 'room', f.message);
  assert.equal(f.state.sendingIds.has(f.message.id), true);
  f.finishUpload();
  await send;
  const visualTimer = f.timers.find((timer) => timer.delay < 1_000);
  assert.ok(visualTimer, 'expected a short minimum-visibility timer');
  visualTimer.callback();
  assert.equal(f.state.sendingIds.has(f.message.id), false);
});

test('manual and reconnect sends share the entire upload/pointer/frame operation', async () => {
  const f = fixture();
  const first = f.sendForTest(f.state, 'room', f.message);
  const reconnect = f.sendForTest(f.state, 'room', f.message, { skipIfAwaitingAck: true });
  assert.equal(first, reconnect);
  f.finishUpload();
  await Promise.all([first, reconnect]);
  assert.equal(f.uploadCalls(), 1);
  assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].media_id, 'media');
});

test('group recovery keeps each target while sharing attachment bytes', async () => {
  const f = fixture();
  const sends = [14, 3].map((id) => f.sendForTest(f.state, 'room', f.message, { hydration: true, targetRecipientId: id }));
  f.finishUpload();
  await Promise.all(sends);
  assert.equal(f.uploadCalls(), 1);
  assert.deepEqual(f.frames.map((frame) => frame.target_recipient_id), [14, 3]);
  assert.ok(f.frames.every((frame) => frame.hydration));
});

test('a completed upload cannot send a pointer from a different signed-in user', async () => {
  const f = fixture();
  const send = f.sendForTest(f.state, 'room', f.message);
  await new Promise((resolve) => setImmediate(resolve));
  f.setCurrentUserId(14, 'other-user');
  f.finishUpload();
  assert.equal((await send).sent, false);
  assert.equal(f.frames.length, 0);
  assert.equal(f.pointers.size, 0);
});
