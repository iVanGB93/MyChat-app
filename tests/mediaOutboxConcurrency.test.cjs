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

function fixture({ isReady = () => true, sendFrame, getRecipients = async () => null, tryDirect = async () => null, tryMailbox = async () => null, tryNeuron = async () => null, neuronEnabled = false, p2pEnabled = false } = {}) {
  const frames = [], pointers = new Map(), pendingByRecipient = new Map();
  const timers = [];
  const peerReceipts = [];
  let finishUpload, uploadCalls = 0;
  const waitingUpload = new Promise((resolve) => { finishUpload = resolve; });
  const schedule = createTransferScheduler(2);
  const modules = {
    './localMessageStore': {
      getPendingOutbox: async (_room, _sender, recipient) => pendingByRecipient.get(recipient) ?? [],
      getMessagesByIds: async ids => [...pendingByRecipient.values()].flat().filter(m => ids.includes(m.id)),
      getMessageExpectedRecipients: getRecipients,
      getMediaPointer: async (id) => pointers.get(id),
      setMediaPointer: async (id, value) => { pointers.set(id, value); },
      clearMessageTransferFailure: async () => {},
      setMessageExpectedRecipients: async (id, peers) => peerReceipts.push({ kind: 'expected', id, peers }),
      markDelivered: async (id, peer) => peerReceipts.push({ kind: 'delivered', id, peer }),
      setMessageSyncState: async (id, sync) => peerReceipts.push({ kind: 'sync', id, sync }),
      getMessageReceiptStatus: async () => 'delivered',
    },
    './mediaLane': {
      uploadMedia: () => schedule('upload', async () => { uploadCalls++; await waitingUpload; return { media_id: 'media', md5: 'hash', size_bytes: 20, mime: 'application/pdf' }; }),
    },
    '../store/appStore': { useAppStore: { getState: () => ({}) } },
    './notificationWsManager': { isNotifWsReady: isReady, sendRawNotif: (frame) => { frames.push(frame); return sendFrame ? sendFrame(frame) : true; } },
    './transports/legacyAxionTextTransport': require('../src/services/transports/legacyAxionTextTransport.ts'),
    './transports/textTransportManager': require('../src/services/transports/textTransportManager.ts'),
    './transports/p2pTextBridge': { MAILBOX_ENABLED: p2pEnabled, tryP2pText: tryDirect, tryMailboxText: tryMailbox },
    './transports/neuronTextBridge': { isNeuronTextReady: () => neuronEnabled, tryNeuronText: tryNeuron },
    './messageLifecycle': require('../src/services/messageLifecycle.ts'),
    './diagnostics': { debugLog() {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(`${compiled}\nexports.sendForTest = sendOutboxFrame; exports.stateForTest = () => getOrCreate('room');
    exports.acceptForTest = (id) => { clearServerAckWatch(id); _serverAcceptedAt.set(id, Date.now()); };
    exports.flushForTest = _doFlush;`, {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name]; },
    // ACK clocks do not fire in these narrowly scoped concurrency tests.
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeout() {}, console,
  });
  module.exports.setCurrentUserId(18, 'test-user');
  return {
    ...module.exports, frames, pointers, pendingByRecipient, timers, peerReceipts, finishUpload, uploadCalls: () => uploadCalls,
    state: module.exports.stateForTest(),
    message: { id: 'message', type: 'document', content: 'test.pdf', file_uri: 'file:///test.pdf', created_at: '2026-09-02T12:00:00Z' },
  };
}

test('custodian storage leaves the normal outgoing bubble pending with no server ACK timer', async () => {
  const f = fixture({ p2pEnabled: true, tryMailbox: async () => ({ peerId: 14, delivered: false }) });
  const msg = { ...f.message, type: 'text' }; f.state.pendingIds.add(msg.id);
  const result = await f.sendForTest(f.state, 'room', msg);
  assert.equal(result.sent, true); assert.equal(result.queued, true);
  assert.equal(f.state.pendingIds.has(msg.id), true); assert.equal(f.state.deliveredIds.has(msg.id), false);
  assert.equal(f.peerReceipts.length, 0); assert.equal(f.frames.length, 0);
  assert.equal(f.timers.some(t => t.delay === 6000), false);
});

test('validated mailbox receipt updates the original bubble and never another account or edited row', async () => {
  const f = fixture(); const msg = { ...f.message, type: 'text', room_id: 'room', sender_id: 18, is_mine: true, status: 'pending' };
  f.pendingByRecipient.set(14, [msg]); f.state.pendingIds.add(msg.id);
  const original = { id: msg.id, roomId: 'room', content: msg.content, createdAt: msg.created_at };
  assert.equal(await f.confirmMailboxDelivery(18, { ...original, content: 'changed' }, 14, () => true), false);
  assert.equal(await f.confirmMailboxDelivery(27, original, 14, () => true), false);
  assert.equal(await f.confirmMailboxDelivery(18, original, 14, () => true), true);
  assert.equal(f.state.deliveredIds.has(msg.id), true); assert.equal(f.state.pendingIds.has(msg.id), false);
  assert.equal(f.peerReceipts.some(r => r.kind === 'sync' && r.sync), true);
});

test('receiver-ready recovery ignores another group member delivery/read flags', async () => {
  for (const flag of ['deliveredIds', 'readIds']) {
    const f = fixture();
    f.state[flag].add(f.message.id);
    f.pendingByRecipient.set(3, [f.message]);
    f.finishUpload();
    await f.flushForTest('room', f.state, 14);
    assert.equal(f.frames.length, 0, 'recipient with no pending receipts gets no replay');
    await f.flushForTest('room', f.state, 3);
    assert.equal(f.frames.length, 1, 'missing recipient must still receive the message');
    assert.equal(f.frames[0].target_recipient_id, 3);
    assert.equal(f.frames[0].hydration, true);
  }
});

test('nearby outbox recovery retries text with its original id while Axion is unavailable', async () => {
  const sent = [];
  const f = fixture({ isReady: () => false, p2pEnabled: true,
    tryDirect: async message => { sent.push(message.id); return 14; } });
  const row = { ...f.message, type: 'text', sender_id: 18, room_id: 'room', is_mine: true, status: 'pending' };
  f.pendingByRecipient.set(14, [row, { ...row, id: 'deleted', is_deleted: true },
    { ...row, id: 'media', type: 'image' }, { ...row, id: 'done', status: 'delivered' }]);
  await f.recoverNearbyTextOutbox('room', 18, 14, () => true);
  assert.deepEqual(sent, ['message']); assert.equal(f.frames.length, 0);
  assert.ok(f.peerReceipts.some(r => r.kind === 'delivered' && r.id === 'message'));
});

test('nearby recovery cancels on context or account changes', async () => {
  let valid = true;
  const sent = [];
  const f = fixture({ isReady: () => false, p2pEnabled: true,
    tryDirect: async message => { sent.push(message.id); valid = false; return 14; } });
  const row = { ...f.message, type: 'text', sender_id: 18, room_id: 'room', is_mine: true, status: 'pending' };
  f.pendingByRecipient.set(14, [row, { ...row, id: 'second' }]);
  await f.recoverNearbyTextOutbox('room', 19, 14, () => true);
  assert.equal(sent.length, 0);
  await f.recoverNearbyTextOutbox('room', 18, 14, () => valid);
  assert.deepEqual(sent, ['message']);
});

test('the room snapshot exposes only the active send attempt as sending', async () => {
  const f = fixture();
  const send = f.sendForTest(f.state, 'room', f.message);
  assert.equal(f.state.sendingIds.has(f.message.id), true);
  f.finishUpload();
  await send;
  const visualTimer = f.timers.find((timer) => timer.delay < 1_000);
  assert.ok(visualTimer, 'expected a short minimum-visibility timer');
  visualTimer.callback();
  assert.equal(f.state.sendingIds.has(f.message.id), true, 'keep animating until server acceptance');
  f.acceptForTest(f.message.id);
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

test('receiver recovery is not suppressed by the original frame awaiting acceptance', async () => {
  const f = fixture();
  f.finishUpload();
  await f.sendForTest(f.state, 'room', f.message);
  await f.sendForTest(f.state, 'room', f.message, { skipIfAwaitingAck: true });
  assert.equal(f.frames.length, 1, 'ordinary replay must remain suppressed');
  for (const recipient of [14, 3]) {
    await f.sendForTest(f.state, 'room', f.message, {
      hydration: true, targetRecipientId: recipient, skipIfAwaitingAck: true,
    });
  }
  assert.equal(f.frames.length, 3);
  assert.deepEqual(f.frames.slice(1).map((frame) => frame.target_recipient_id), [14, 3]);
  assert.equal(f.uploadCalls(), 1);
});

test('recent server acceptance does not stand in for recipient delivery', async () => {
  const f = fixture();
  f.finishUpload();
  await f.sendForTest(f.state, 'room', f.message);
  f.acceptForTest(f.message.id);
  await f.sendForTest(f.state, 'room', f.message, { skipIfAwaitingAck: true });
  assert.equal(f.frames.length, 1);
  await f.sendForTest(f.state, 'room', f.message, {
    hydration: true, targetRecipientId: 14, skipIfAwaitingAck: true,
  });
  assert.equal(f.frames.length, 2);
  assert.equal(f.frames[1].target_recipient_id, 14);
});

test('text outbox preserves the legacy wire frame and targeted recovery through the transport manager', async () => {
  const f = fixture({ getRecipients: async () => [14, 3] });
  const message = { id: 'text-1', type: 'text', content: 'Hello', created_at: '2026-09-27T12:00:00Z',
    reply_to: { id: 'earlier', sender_name: 'Bob', content: 'Hi', type: 'text' }, duration_ms: 0 };
  f.state.pendingIds.add(message.id);
  assert.equal((await f.sendForTest(f.state, 'room', message)).sent, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.frames[0])), {
    type: 'send_message', room_id: 'room', id: 'text-1', message: 'Hello', message_type: 'text',
    created_at: message.created_at, reply_to: message.reply_to, duration_ms: 0, expected_recipient_ids: [14, 3],
  });
  await f.sendForTest(f.state, 'room', message, { skipIfAwaitingAck: true });
  assert.equal(f.frames.length, 1, 'ordinary retry remains suppressed while awaiting acceptance');
  await f.sendForTest(f.state, 'room', message, { hydration: true, targetRecipientId: 14, skipIfAwaitingAck: true });
  assert.equal(f.frames.length, 2);
  assert.equal(f.frames[1].id, message.id);
  assert.equal(f.frames[1].hydration, true);
  assert.equal(f.frames[1].target_recipient_id, 14);
  assert.equal(f.state.pendingIds.has(message.id), true, 'submission must not imply delivery');
  assert.equal(f.state.deliveredIds.has(message.id), false);
  assert.equal(f.uploadCalls(), 0);
});

test('offline text remains eligible for a later send with the original message identity', async () => {
  let ready = false;
  const f = fixture({ isReady: () => ready, getRecipients: async () => [] });
  const message = { id: 'text-offline', type: 'text', content: '', created_at: '2026-09-27T12:00:00Z' };
  assert.equal((await f.sendForTest(f.state, 'room', message)).sent, false);
  assert.equal(f.frames.length, 0);
  assert.equal(f.timers.some((timer) => timer.delay === 6000), false);
  ready = true;
  assert.equal((await f.sendForTest(f.state, 'room', message)).sent, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.frames[0])), {
    type: 'send_message', room_id: 'room', id: message.id, message: '', message_type: 'text',
    created_at: message.created_at, expected_recipient_ids: [],
  });
});

test('failed text handoff does not start an acceptance timer or suppress the next attempt', async () => {
  for (const failure of [() => false, () => { throw Error('socket closed'); }]) {
    let failed = true;
    const f = fixture({ sendFrame: () => failed ? failure() : true });
    const message = { id: 'text-retry', type: 'text', content: 'Hello', created_at: '2026-09-27T12:00:00Z' };
    assert.equal((await f.sendForTest(f.state, 'room', message)).sent, false);
    assert.equal(f.timers.some((timer) => timer.delay === 6000), false);
    failed = false;
    assert.equal((await f.sendForTest(f.state, 'room', message, { skipIfAwaitingAck: true })).sent, true);
    assert.equal(f.frames[0].id, f.frames[1].id);
    assert.equal(f.timers.filter((timer) => timer.delay === 6000).length, 1);
  }
});

test('text cannot leave under another account or after disconnect during recipient lookup', async () => {
  for (const transition of ['account', 'disconnect']) {
    let finishLookup, ready = true;
    const waiting = new Promise((resolve) => { finishLookup = resolve; });
    const f = fixture({ isReady: () => ready, getRecipients: () => waiting });
    const send = f.sendForTest(f.state, 'room', { id: 'text-race', type: 'text', content: 'Hello', created_at: 'now' });
    await new Promise((resolve) => setImmediate(resolve));
    if (transition === 'account') f.setCurrentUserId(14, 'other-user');
    else ready = false;
    finishLookup([14]);
    assert.equal((await send).sent, false);
    assert.equal(f.frames.length, 0);
    assert.equal(f.timers.some((timer) => timer.delay === 6000), false);
  }
});

test('peer storage receipt updates local delivery without sending an Axion frame or starting its ACK timer', async () => {
  const f = fixture({ tryDirect: async () => 14 });
  const message = { id: 'direct-text', type: 'text', content: 'Hello', created_at: '2026-09-27T12:00:00Z' };
  f.state.pendingIds.add(message.id);
  assert.equal((await f.sendForTest(f.state, 'room', message)).sent, true);
  assert.equal(f.frames.length, 0);
  assert.deepEqual(f.peerReceipts.map((entry) => entry.kind), ['expected', 'delivered', 'sync']);
  assert.equal(f.state.deliveredIds.has(message.id), true);
  assert.equal(f.timers.some((timer) => timer.delay === 6000), false);
});

test('account change while awaiting a peer prevents receipt writes and legacy fallback under the new user', async () => {
  let finish;
  const f = fixture({ tryDirect: () => new Promise((resolve) => { finish = resolve; }) });
  const send = f.sendForTest(f.state, 'room', { id: 'old-user', type: 'text', content: 'Hello', created_at: 'now' });
  await new Promise((resolve) => setImmediate(resolve));
  f.setCurrentUserId(14, 'other-user'); finish(14);
  assert.equal((await send).sent, false);
  assert.equal(f.frames.length, 0); assert.equal(f.peerReceipts.length, 0);
});

test('established P2P outbox delivery works without Axion and records durable receipts', async () => {
  const f = fixture({ isReady: () => false, p2pEnabled: true, tryDirect: async () => 14 });
  const result = await f.sendForTest(f.state, 'room', { ...f.message, type: 'text', content: 'direct' });
  assert.equal(result.sent, true); assert.equal(f.frames.length, 0);
  assert.ok(f.peerReceipts.some(r => r.kind === 'delivered' && r.peer === 14));
  assert.ok(f.peerReceipts.some(r => r.kind === 'sync' && r.sync === true));
});

test('failed P2P during Axion outage remains pending without a false receipt or server frame', async () => {
  const f = fixture({ isReady: () => false, p2pEnabled: true });
  assert.equal((await f.sendForTest(f.state, 'room', { ...f.message, type: 'text' })).sent, false);
  assert.equal(f.frames.length, 0); assert.equal(f.peerReceipts.length, 0);
});

test('normal neuron custody stays pending without Axion and does not start a server acceptance timer', async () => {
  const f=fixture({isReady:()=>false,neuronEnabled:true,tryNeuron:async()=>({peerId:14,delivered:false})});
  const msg={...f.message,type:'text'};f.state.pendingIds.add(msg.id);
  const result=await f.sendForTest(f.state,'room',msg);
  assert.equal(result.sent,true);assert.equal(result.queued,true);assert.equal(f.state.pendingIds.has(msg.id),true);
  assert.equal(f.peerReceipts.length,0);assert.equal(f.frames.length,0);assert.equal(f.timers.some(t=>t.delay===6000),false);
});
