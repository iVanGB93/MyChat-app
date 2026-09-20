const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function setup() {
  let displayed;
  const cancelled = [];
  const extra = [
    { id: 'legacy-room', notification: { data: { room_id: 'p', type: 'new_message' } } },
    { id: 'other-room', notification: { data: { roomId: 'other', type: 'new_message' } } },
    { id: 'call', notification: { data: { roomId: 'p', type: 'incoming_call' } } },
  ];
  const api = { displayNotification: async (value) => { displayed = value; },
    cancelNotification: async (id) => cancelled.push(id),
    getDisplayedNotifications: async () => [...extra, ...(displayed ? [{ id: displayed.id, notification: displayed }] : [])] };
  const mocks = {
    '@notifee/react-native': { default: api, AndroidImportance: { HIGH: 4 }, AndroidStyle: { MESSAGING: 3 }, AndroidVisibility: { PRIVATE: 0 } },
    'react-native': { Platform: { OS: 'android' } },
    './api': { resolveMediaUrl: (value) => value },
    '../utils/chat-preview-text': { chatPreviewText: (value) => value },
    './contact-nicknames': { notificationContactName: async (_, name) => name },
    'expo-notifications': { dismissNotificationAsync: async (id) => cancelled.push(id),
      getPresentedNotificationsAsync: async () => extra.map((item) => ({ request: { identifier: 'expo-' + item.id, content: item.notification } })) },
  };
  const sandbox = { exports: {}, require: (name) => { assert.ok(mocks[name], name); return mocks[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/messageNotificationService.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return { send: sandbox.exports.displayMessageNotification, cancel: sandbox.exports.cancelMessageNotification, cancelled, get: () => displayed };
}

test('opening a room clears only its message cards across current and legacy paths', async () => {
  const s = setup(); await s.cancel('p');
  assert.deepEqual(s.cancelled.sort(), ['message:p', 'legacy-room', 'msg-room-p', 'expo-legacy-room'].sort());
  await s.cancel(''); assert.equal(s.cancelled.length, 4);
});

test('chat cleanup follows visibility and foreground state, not just mount', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/chat/ChatRoomScreen.tsx'), 'utf8');
  assert.match(source, /if \(!isScreenFocused \|\| appState !== 'active'\) return;\s*useAppStore.getState\(\).setActiveRoom\(roomId\)/);
  assert.match(source, /\[roomId, isScreenFocused, appState\]/);
});

test('private notification leaves sender formatting to Android', async () => {
  const s = setup();
  await s.send({ roomId: 'p', roomName: 'PC', senderName: 'PC', text: 'Test message', messageId: '1' });
  assert.equal(s.get().body, 'Test message');
  assert.equal(s.get().android.style.title, undefined);
  assert.equal(s.get().android.style.messages[0].person.name, 'PC');
  assert.equal(s.get().android.style.messages[0].text, 'Test message');
});

test('group messages and replies contain no injected speaker prefixes', async () => {
  const s = setup();
  const base = { roomId: 'g', roomName: 'Family', senderName: 'Enrique' };
  await s.send({ ...base, text: 'Muy bien', messageId: '1' });
  assert.equal(s.get().android.style.title, 'Family');
  assert.equal(s.get().body, 'Muy bien');
  assert.equal(s.get().android.style.messages[0].person.name, 'Enrique');
  await s.send({ ...base, text: 'PC: a name typed by the user', messageId: '2', fromMe: true });
  const messages = s.get().android.style.messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, 'Muy bien');
  assert.equal(messages[1].text, 'PC: a name typed by the user');
  assert.equal(messages[1].person, undefined);
  await s.send({ ...base, text: 'Duplicate', messageId: '2' });
  assert.equal(s.get().android.style.messages.length, 2);
});
