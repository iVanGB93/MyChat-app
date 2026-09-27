const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/transports/p2pTextRuntime.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '00000000-0000-4000-8000-000000000001';
const text = { id: 'message', roomId: 'room', content: 'Hello', createdAt: '2026-09-27T12:00:00Z' };
const drain = () => new Promise((resolve) => setImmediate(resolve));

test('ordinary text runtime ignores mailbox offers before allocating a session', async () => {
  const f = fixture();
  await f.handleSignal({ event: 'p2p_text_signal', protocol: 1, signal_type: 'offer', room_id: 'room', session_id: id,
    from_endpoint_id: id, from_user_id: 14, data: { sdp: 'offer\r\na=x-axonic-mailbox:1\r\n' } });
  assert.equal(f.sessions.length, 0);
});
const sessionModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/transports/p2pTextSession.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, sessionModule);
function fixture({ peer = async () => ({ id: 14, name: 'Bob' }), opened = true, stored = true, preferHostCandidates = false, applicationScope = false } = {}) {
  let context = { userId: 18, roomId: 'room' };
  let signaling = true;
  const sessions = [], timers = new Set(), logs = [];
  const sandbox = { exports: {}, require: () => ({ isMailboxSdp: sessionModule.exports.isMailboxSdp, isHostOnlyTextSdp: sessionModule.exports.isHostOnlyTextSdp, createP2pTextSession: (options) => {
    const canOpen = typeof opened === 'function' ? opened(options) : opened;
    const session = { options, closed: false, offers: 0, signals: [],
      isReady: () => canOpen && !session.closed,
      waitUntilOpen: async (ms) => { session.openTimeout = ms; return canOpen; }, offer: async () => { session.offers++; return true; },
      send: async (message) => { session.sent = message; return stored; },
      close: () => { session.closed = true; options.onClose(); },
      handleSignal: async (value) => session.signals.push(value) };
    sessions.push(session); return session;
  } }), setTimeout: (fn) => { timers.add(fn); return fn; }, clearTimeout: (fn) => timers.delete(fn) };
  vm.runInNewContext(code, sandbox);
  let nextId = 0;
  const runtime = sandbox.exports.createP2pTextRuntime({ preferHostCandidates,
    context: roomId => applicationScope && context && roomId ? { ...context, roomId } : context, signalingReady: () => signaling, peer,
    sessionId: () => id.slice(0, -4) + String(++nextId).padStart(4, '0'),
    createConnection: () => {}, sendSignal: () => true, persist: async () => true, log: (...args) => logs.push(args) });
  return { ...runtime, sessions, logs, timers, setContext: (value) => { context = value; },
    setSignaling: (value) => { signaling = value; if (!value) runtime.signalingLost(); },
    expire: () => { for (const timer of [...timers]) timer(); } };
}

test('direct receipt keeps the session for repeated sends during an Axion outage', async () => {
  const f = fixture();
  assert.equal(await f.trySend(text), 14);
  assert.equal(f.sessions[0].sent.id, text.id);
  assert.equal(f.sessions[0].closed, false); assert.equal(f.timers.size, 0);
  f.setSignaling(false);
  assert.equal(await f.trySend({ ...text, id: 'second' }), 14);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].offers, 1);
  assert.equal(f.logs.some(([event]) => event === 'session_reused'), true);
  f.reset(); assert.equal(f.sessions[0].closed, true);
});

test('application scope accepts a cached peer offer while no chat screen is active', async () => {
  const f = fixture({ applicationScope: true });f.setContext({ userId: 18, roomId: null });
  await f.handleSignal({ event: 'p2p_text_signal', protocol: 1, signal_type: 'offer', room_id: 'room', session_id: id,
    from_endpoint_id: id, from_user_id: 14, data: { sdp: 'offer' } });
  assert.equal(f.sessions.length, 1); assert.equal(f.sessions[0].options.roomId, 'room');
  assert.equal(await f.trySend(text), 14);assert.equal(f.sessions.length, 1);f.reset();
});

test('application scope never reuses the same peer session for a different room', async () => {
  const f = fixture({ applicationScope: true });
  assert.equal(await f.trySend(text), 14);
  assert.equal(await f.trySend({ ...text, id: 'other-message', roomId: 'other-room' }), 14);
  assert.equal(f.sessions.length, 2);
  assert.equal(f.sessions[0].options.roomId, 'room');assert.equal(f.sessions[1].options.roomId, 'other-room');f.reset();
});

test('application scope still rejects rooms without an authorized cached peer', async () => {
  const f = fixture({ applicationScope: true, peer: async () => null });
  assert.equal(await f.trySend(text), null);assert.equal(f.sessions.length, 0);
});

test('host-first connects without allocating an internet attempt and reuses the connection', async () => {
  const f = fixture({ preferHostCandidates: true });
  assert.equal(await f.trySend(text), 14);
  assert.equal(f.sessions[0].options.hostOnly, true);
  assert.equal(f.sessions[0].openTimeout, 1500);
  assert.equal(await f.trySend({ ...text, id: 'next' }), 14);
  assert.equal(f.sessions.length, 1); f.reset();
});

test('unreachable host candidates close before the bounded internet attempt', async () => {
  const f = fixture({ preferHostCandidates: true, opened: options => !options.hostOnly });
  assert.equal(await f.trySend(text), 14);
  assert.equal(f.sessions.length, 2); assert.equal(f.sessions[0].closed, true);
  assert.equal(f.sessions[1].options.hostOnly, false); assert.equal(f.sessions[1].openTimeout, 3000);
  assert.notEqual(f.sessions[0].options.sessionId, f.sessions[1].options.sessionId);
  assert.equal(f.sessions[0].sent, undefined); assert.equal(f.sessions[1].sent.id, text.id);
  f.reset();
});

test('incoming host-only preference is honored after peer authorization', async () => {
  const f = fixture();
  await f.handleSignal({ event: 'p2p_text_signal', protocol: 1, signal_type: 'offer', room_id: 'room', session_id: id,
    from_endpoint_id: id, from_user_id: 14, data: { sdp: 'v=0\r\na=x-axonic-host-only:1\r\n' } });
  assert.equal(f.sessions[0].options.hostOnly, true); f.reset();
});

test('both connection attempts failing return to delivery fallback without sending text', async () => {
  const f = fixture({ preferHostCandidates: true, opened: false });
  assert.equal(await f.trySend(text), null);
  assert.equal(f.sessions.length, 2);
  assert.ok(f.sessions.every(s => s.closed && !s.sent));
  assert.equal(f.timers.size, 0);
});

test('context cancellation between host and internet attempts prevents the second allocation', async () => {
  const f = fixture({ preferHostCandidates: true, opened: () => {
    f.setContext(null); return false;
  } });
  assert.equal(await f.trySend(text), null);
  assert.equal(f.sessions.length, 1); assert.equal(f.sessions[0].closed, true);
  assert.equal(f.sessions[0].sent, undefined); assert.equal(f.timers.size, 0);
});

test('an outage cannot allocate a new session, including after the ready peer closes', async () => {
  const f = fixture(); f.setSignaling(false);
  assert.equal(await f.trySend(text), null); assert.equal(f.sessions.length, 0);
  f.setSignaling(true); assert.equal(await f.trySend(text), 14);
  f.sessions[0].close(); f.setSignaling(false);
  assert.equal(await f.trySend(text), null); assert.equal(f.sessions.length, 1);
});

test('an accepted incoming session is reusable in the reverse direction without signaling', async () => {
  const f = fixture();
  await f.handleSignal({ event: 'p2p_text_signal', protocol: 1, signal_type: 'offer', room_id: 'room', session_id: id,
    from_endpoint_id: id, from_user_id: 14, data: { sdp: 'offer' } });
  f.setSignaling(false);
  assert.equal(await f.trySend(text), 14);
  assert.equal(f.sessions.length, 1); assert.equal(f.sessions[0].offers, 0);
  f.reset();
});

test('unsupported message and room contexts never create a peer connection', async () => {
  const f = fixture();
  for (const [message, options] of [[{ ...text, replyTo: {} }], [text, { hydration: true }],
    [{ ...text, roomId: 'another' }], [text, { expectedRecipientIds: [14, 20] }]]) {
    assert.equal(await f.trySend(message, options), null);
  }
  f.setContext(null); assert.equal(await f.trySend(text), null);
  assert.equal(f.sessions.length, 0);
});

test('failed connection and missing storage receipt return fallback eligibility', async () => {
  for (const params of [{ opened: false }, { stored: false }]) {
    const f = fixture(params);
    assert.equal(await f.trySend(text), null); assert.equal(f.sessions[0].closed, true);
  }
});

test('deadline or reset during discovery prevents a late connection from sending', async () => {
  for (const action of ['expire', 'reset']) {
    let finish;
    const f = fixture({ peer: () => new Promise((resolve) => { finish = resolve; }) });
    const sending = f.trySend(text);
    f[action]();
    finish({ id: 14, name: 'Bob' });
    assert.equal(await sending, null); await drain();
    assert.equal(f.sessions.length, 0); assert.equal(f.timers.size, 0);
  }
});

test('only authenticated supported offers for the active direct peer can allocate a session', async () => {
  const f = fixture();
  const signal = { event: 'p2p_text_signal', protocol: 1, signal_type: 'offer', room_id: 'room', session_id: id,
    from_endpoint_id: id, from_user_id: 14, data: { sdp: 'offer' } };
  for (const changes of [{ from_user_id: 33 }, { room_id: 'other' }, { protocol: 2 }, { signal_type: 'answer' }]) {
    await f.handleSignal({ ...signal, ...changes });
  }
  assert.equal(f.sessions.length, 0);
  await f.handleSignal(signal); assert.equal(f.sessions.length, 1);
  f.setContext(null); f.reset();
  assert.equal(await f.sessions[0].options.persistIncoming({ id: 'late' }), false);
  assert.equal(f.sessions[0].closed, true);
});
