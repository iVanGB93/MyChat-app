const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const sandbox = { exports: {}, console, setTimeout, clearTimeout, require: (name) => mocks[name] ?? {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, sandbox);
  return sandbox.exports;
}
function router(ledger = new Set(), persist = async (id) => { ledger.add(id); }) {
  let applied = 0;
  const api = load('ingressRouter.ts', {
    './rrp/envelope': { toEnvelope: (raw) => ({ type: 'message.update', room_id: raw.room_id, payload: raw }) },
    './localMessageStore': {
      isEventProcessed: async (id) => ledger.has(id),
      markEventProcessed: persist,
    },
    './chatWsManager': {
      applyRemoteMessageUpdates: async () => { await Promise.resolve(); applied++; },
      flushStoredReceiptConfirmations: async () => {},
    },
  });
  return { route: (updates) => api.routeInbound({ room_id: 'group', from_user_id: 42, updates }, 'ws'), applied: () => applied };
}
const update = (id) => ({ id, message_id: 'old-message', changes: { reacted_emoji: '❤️', updated_at: new Date().toISOString() } });

test('failed ledger writes do not ACK or alert, and remain retryable in-process', async () => {
  const ledger = new Set();
  let fail = true;
  const r = router(ledger, async (id) => { if (fail) throw Error('disk full'); ledger.add(id); });
  await assert.rejects(r.route([update('disk-failure')]), /disk full/);
  fail = false;
  const result = await r.route([update('disk-failure')]);
  assert.equal(result.freshUpdates.length, 1);
  assert.equal(result.ackUpdateIds.length, 1);
  assert.equal((await router(ledger).route([update('disk-failure')])).freshUpdates.length, 0);
});

test('concurrent reaction retries alert only once but all copies get ACKs', async () => {
  const r = router();
  const results = await Promise.all([r.route([update('one')]), r.route([update('one')])]);
  assert.equal(r.applied(), 1);
  assert.equal(results[0].freshUpdates.length, 1);
  assert.equal(results[1].freshUpdates.length, 0);
  for (const result of results) {
    assert.equal(result.ackUpdateIds[0], 'one');
    assert.equal(result.ackSenderId, 42);
  }
});
test('persistent ledger suppresses alerts after restarting the router', async () => {
  const ledger = new Set();
  await router(ledger).route([update('persisted')]);
  const result = await router(ledger).route([update('persisted'), update('new')]);
  assert.equal(result.freshUpdates.length, 1);
  assert.equal(result.freshUpdates[0].id, 'new');
  assert.equal(result.ackUpdateIds.length, 2);
});
test('duplicate IDs within one batch produce only one fresh update', async () => {
  const result = await router().route([update('same'), update('same')]);
  assert.equal(result.freshUpdates.length, 1);
});
test('old and undated replays stay silent, new reactions on old messages are eligible', () => {
  const { isRecentAlertUpdate } = load('update-alert-policy.ts');
  assert.equal(isRecentAlertUpdate(update('new')), true);
  assert.equal(isRecentAlertUpdate({ id: 'old', changes: { updated_at: '2020-01-01' } }), false);
  assert.equal(isRecentAlertUpdate({ id: 'legacy', changes: {} }), false);
  assert.equal(isRecentAlertUpdate({ changes: { updated_at: new Date().toISOString() } }), false);
});
test('muted, inactive and currently viewed chats suppress reaction banners', () => {
  const { decideInAppMessageToast } = load('notificationDecision.ts');
  const p = { event: 'message_update', room_id: 'group' };
  assert.equal(decideInAppMessageToast(p, { appActive: true, mutedRooms: { group: true } }).allow, false);
  assert.equal(decideInAppMessageToast(p, { appActive: false }).allow, false);
  assert.equal(decideInAppMessageToast(p, { appActive: true, activeRoomId: 'group' }).allow, false);
  assert.equal(decideInAppMessageToast(p, { appActive: true }).allow, true);
});
