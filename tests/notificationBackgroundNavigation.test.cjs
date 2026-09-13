const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseNotificationDestination } = require('../src/services/notificationDestination.ts');

function fixture() {
  let handler;
  let pending;
  const modules = {
    '@notifee/react-native': {
      default: { onBackgroundEvent: (callback) => { handler = callback; } },
      EventType: { PRESS: 1, ACTION_PRESS: 2 },
    },
    './callNotificationService': { handleCallNotificationEvent: () => {} },
    './notificationReplyService': { handleMessageReplyEvent: async () => {} },
    './notificationActionService': { handleMarkReadEvent: async () => {} },
    './pendingRoomNav': { setPendingRoomNav: async (value) => { pending = JSON.parse(JSON.stringify(value)); } },
    './diagnostics': { debugLog: () => {} },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/notificationBackgroundDispatcher.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {}, console, require: (name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  } };
  vm.runInNewContext(compiled, sandbox);
  sandbox.exports.registerNotificationBackgroundHandler();
  return {
    press: (data, action = 'default') => handler({ type: 1, detail: { notification: { data }, pressAction: { id: action } } }),
    pending: () => pending,
  };
}

test('background group tap preserves explicit group identity across persisted navigation', async () => {
  const app = fixture();
  // Group and sender deliberately share a name: name-based inference is insufficient.
  await app.press({ type: 'new_message', roomId: 'g1', roomName: 'Family', senderName: 'Family', senderId: '7', isGroup: 'true' });
  assert.equal(app.pending().isGroup, 'true');
  const destination = parseNotificationDestination({ type: 'new_message', ...app.pending() });
  assert.equal(destination.roomId, 'g1');
  assert.equal(destination.otherUserId, undefined);
});

test('background tap accepts snake-case group payloads', async () => {
  const app = fixture();
  await app.press({ type: 'new_message', room_id: 'g2', room_name: 'Team', sender_id: '7', room_type: 'group' });
  const destination = parseNotificationDestination({ type: 'new_message', ...app.pending() });
  assert.equal(destination.roomId, 'g2');
  assert.equal(destination.otherUserId, undefined);
});

test('direct-message background taps retain the peer and action buttons do not navigate', async () => {
  const app = fixture();
  const data = { type: 'new_message', roomId: 'd1', roomName: 'Ana', senderName: 'Ana', senderId: '7', isGroup: 'false' };
  await app.press(data, 'mark_read');
  assert.equal(app.pending(), undefined);
  await app.press(data);
  assert.equal(parseNotificationDestination({ type: 'new_message', ...app.pending() }).otherUserId, 7);
});
