const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function compile(service) {
  return ts.transpileModule(
    fs.readFileSync(path.join(__dirname, `../src/services/${service}.ts`), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('notification mark-read waits for durable receipt persistence before connecting and dismissing', async () => {
  const persistence = deferred();
  const events = [];
  const modules = {
    '@notifee/react-native': { EventType: { ACTION_PRESS: 2 } },
    './localMessageStore': { getUnreadReceivedIds: async () => ['photo-1', 'photo-2', 'photo-3', 'text-1'] },
    './chatWsManager': {
      markRoomAsRead: async () => {
        events.push('persist-start');
        await persistence.promise;
        events.push('persisted');
      },
      connectRoom: async () => { events.push('connected'); },
    },
    '../store/appStore': { useAppStore: { getState: () => ({ clearRoomUnread: () => events.push('unread-cleared') }) } },
    './messageNotificationService': { cancelMessageNotification: async () => { events.push('dismissed'); } },
  };
  const sandbox = {
    exports: {}, console,
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
  };
  vm.runInNewContext(compile('notificationActionService'), sandbox);

  let finished = false;
  const action = sandbox.exports.markRoomReadFromNotification('room-1').then(() => { finished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.deepEqual(events, ['persist-start']);

  persistence.resolve();
  await action;
  assert.deepEqual(events, ['persist-start', 'persisted', 'connected', 'unread-cleared', 'dismissed']);
});

function chatFixture({ outgoingRooms = [], pendingUpdates = [], storedMessages = [] } = {}) {
  const frames = [];
  const queued = [];
  const applied = [];
  const localStore = {
    getMessagesByIds: async () => storedMessages,
    queueMessageUpdate: async (roomId, messageId, changes, options) => {
      queued.push({ roomId, messageId, changes: { ...changes }, options });
      return options.id;
    },
    applyMessageChanges: async (messageId, changes) => { applied.push({ messageId, changes }); },
    getRoomsWithPendingOutgoingMessages: async () => outgoingRooms,
    getPendingOutboxUpdates: async (roomId) => roomId
      ? pendingUpdates.filter((entry) => entry.room_id === roomId)
      : pendingUpdates,
    getPendingUnsyncedOutgoingMessages: async () => [],
    getPendingOutbox: async () => [],
    getMessagesByIdsForResend: async () => [],
    getStoredReceiptConfirmations: async () => [],
  };
  const modules = {
    './localMessageStore': localStore,
    './mediaLane': {},
    '../store/appStore': { useAppStore: { getState: () => ({ setChatRoomAuthenticated() {}, setChatRoomStatus() {} }) } },
    './notificationWsManager': {
      ensureWsAlive: async () => {},
      isNotifWsReady: () => true,
      reconnectWsNow() {},
      sendRawNotif: (frame) => { frames.push(frame); return true; },
      subscribeStatus: () => () => {},
    },
    './messageLifecycle': {},
    './diagnostics': { debugLog() {} },
  };
  const sandbox = {
    exports: {}, console,
    setTimeout: () => ({ fake: true }),
    clearTimeout() {},
    require(name) {
      assert.ok(name in modules, `Unexpected dependency ${name}`);
      return modules[name];
    },
  };
  vm.runInNewContext(compile('chatWsManager'), sandbox);
  sandbox.exports.setCurrentUserId(99, 'reader');
  return { app: sandbox.exports, frames, queued, applied };
}

test('headless mark-read targets each original author from SQLite and sends one Axion batch', async () => {
  const fx = chatFixture({
    storedMessages: [
      { id: 'photo-1', sender_id: 7 },
      { id: 'photo-2', sender_id: 7 },
      { id: 'photo-3', sender_id: 7 },
      { id: 'text-1', sender_id: 7 },
    ],
  });
  await fx.app.markRoomAsRead('room-1', ['photo-1', 'photo-2', 'photo-3', 'text-1']);

  assert.equal(fx.queued.length, 4);
  assert.ok(fx.queued.every((entry) => entry.changes.receipt_target_id === 7));
  assert.ok(fx.queued.every((entry) => entry.options.expectedPeerIds[0] === 7));
  assert.equal(fx.applied.length, 4);
  const updateFrames = fx.frames.filter((frame) => frame.type === 'message_update');
  assert.equal(updateFrames.length, 1);
  assert.equal(updateFrames[0].updates.length, 4);
});

test('Axion authentication recovers a mutation-only room after process restart', async () => {
  const fx = chatFixture({
    pendingUpdates: [{
      id: 'read-update-1', room_id: 'room-with-only-read-receipt', message_id: 'photo-1',
      changes: { is_read: true, receipt_target_id: 7 }, expected_peer_ids: [7],
      acked_by_user_ids: [], created_at: 1,
    }],
  });
  await fx.app.recoverPendingOutgoingMessages();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(fx.frames.some((frame) => frame.type === 'room_ready' && frame.room_id === 'room-with-only-read-receipt'));
  assert.ok(fx.frames.some((frame) => frame.type === 'message_update' && frame.updates[0].id === 'read-update-1'));
});
