const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/p2pTextComposition.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(nearbyAttempt = async () => null) {
  let state = { user: { id: 18 }, appLifecycle: 'active', activeRoomId: 'room', activeCall: null, blockedIds: {} };
  let subscriber, statusSubscriber, attempt, dependencies, nearbyDependencies, resets = 0, attempts = 0, losses = 0, ready = true, refreshes = 0;
  const nativeConfigurations = [];
  const runtime = { reset() { resets++; }, signalingLost() { losses++; }, async trySend() { attempts++; return 14; }, async handleSignal() {} };
  const mocks = {
    './transports/nearbyRecovery': { createNearbyRecovery: (controller, deps) => {
      assert.equal(deps.automatic, true);
      return { ...controller, refresh() { refreshes++; } };
    } },
    '../../modules/axonic-nearby': { default: null },
    './transports/nearbyTextController': { createNearbyTextController: deps => {
      nearbyDependencies = deps; return { stop: async () => {}, trySend: nearbyAttempt };
    } },
    '../store/appStore': { useAppStore: { getState: () => state, subscribe: fn => { subscriber = fn; } } },
    './localMessageStore': {
      getMessagesByIds: async () => [{ id: 'msg', room_id: 'room', sender_id: 18, content: 'test', is_mine: true }],
      getCachedRooms: async () => [],
    },
    './ingressRouter': { ingestMessage: async () => {} },
    './notificationWsManager': { isNotifWsReady: () => ready, sendRawNotif: () => true, subscribeStatus(fn) { statusSubscriber = fn; } },
    './diagnostics': { debugLog() {} },
    './transports/p2pTextBridge': { P2P_TEXT_ENABLED: true, configureP2pTextAttempt: fn => { attempt = fn; } },
    './transports/p2pTextRuntime': { createP2pTextRuntime: deps => { dependencies = deps; return runtime; } },
    './transports/nativeTextPeer': { createNativeTextPeer(urls) { nativeConfigurations.push(Array.from(urls)); return {}; } },
  };
  vm.runInNewContext(code, { exports: {}, require: name => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name];
  } });
  return { nativeConfigurations, connect: hostOnly => dependencies.createConnection(hostOnly),
    hostFirst: () => dependencies.preferHostCandidates, attempt: message => attempt(message), context: room => dependencies.context(room),
    nearbyContext: () => nearbyDependencies.context(),
    disconnect() { ready = false; statusSubscriber('reconnecting'); },
    signalingReady: () => dependencies.signalingReady(), get losses() { return losses; },
    update(patch) { const previous = state; state = { ...state, ...patch }; subscriber(state, previous); },
    get refreshes() { return refreshes; }, get resets() { return resets; }, get attempts() { return attempts; } };
}

test('starting a call closes text sessions and bypasses P2P until the call ends', async () => {
  const f = fixture();
  const message = { id: 'msg', roomId: 'room', content: 'test' };
  assert.equal(await f.attempt(message), 14);
  f.update({ activeCall: { id: 'call', status: 'connected' } });
  assert.equal(f.resets, 1);
  assert.equal(f.context(), null);
  assert.equal(await f.attempt(message), null, 'transport manager may use Axion');
  assert.equal(f.attempts, 1, 'no text peer is attempted during a call');
  f.update({ activeCall: null });
  assert.equal(await f.attempt(message), 14);
  assert.equal(f.attempts, 2);
});

test('Axion loss preserves eligible chat context but disables new signaling', async () => {
  const f = fixture(); f.disconnect();
  assert.equal(f.resets, 0); assert.equal(f.losses, 1);
  assert.equal(f.signalingReady(), false); assert.equal(f.context().roomId, 'room');
  assert.equal(await f.attempt({ id: 'msg', roomId: 'room', content: 'test' }), 14);
});

test('backgrounding or signing out cancels the direct context', async () => {
  for (const patch of [{ appLifecycle: 'background' }, { user: null }]) {
    const f = fixture(); f.update(patch);
    assert.equal(f.resets, 1); assert.equal(f.context(), null);
    assert.equal(await f.attempt({ id: 'msg', roomId: 'room', content: 'test' }), null);
    assert.equal(f.attempts, 0);
  }
});

test('foreground navigation preserves direct sessions and the previous LAN scope', async () => {
  const f = fixture();f.update({ activeRoomId: null });
  assert.equal(f.resets, 0); assert.equal(f.refreshes, 1);
  assert.equal(f.context('room').roomId, 'room');assert.equal(f.nearbyContext().roomId, 'room');
  assert.equal(await f.attempt({ id: 'msg', roomId: 'room', content: 'test' }), 14);
  f.update({ activeRoomId: 'another-room' });
  assert.equal(f.resets, 0);assert.equal(f.refreshes, 2);
  assert.equal(f.context('room').roomId, 'room');assert.equal(f.nearbyContext().roomId, 'another-room');
});

test('remembered LAN scope is cleared on sign-out and remains suspended in background', () => {
  const f = fixture();f.update({ activeRoomId: null });f.update({ appLifecycle: 'background' });
  assert.equal(f.nearbyContext(), null);assert.equal(f.context('room'), null);
  f.update({ appLifecycle: 'active' });assert.equal(f.nearbyContext().roomId, 'room');
  f.update({ user: null });f.update({ user: { id: 14 } });
  assert.equal(f.nearbyContext(), null);
});

test('account switch during nearby attempt cannot enter the Axion-assisted peer runtime', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const sending = f.attempt({ id: 'msg', roomId: 'room', content: 'test' });
  await new Promise(resolve => setImmediate(resolve));
  f.update({ user: { id: 14 } }); finish(null);
  assert.equal(await sending, null); assert.equal(f.attempts, 0);
});

test('refreshing an unchanged block-list object does not reset sessions', () => {
  const f = fixture(); f.update({ blockedIds: {} }); assert.equal(f.resets, 0);
  f.update({ blockedIds: { 14: true } }); assert.equal(f.resets, 1);
});

test('composition starts automatic discovery and refreshes on account and block changes', () => {
  const f = fixture(); assert.equal(f.refreshes, 1);
  f.update({ user: { id: 14 } }); assert.equal(f.refreshes, 2);
  f.update({ blockedIds: { 18: true } }); assert.equal(f.refreshes, 3);
});

test('a successful LAN delivery takes priority over the internet peer runtime', async () => {
  const f = fixture(async () => 14);
  assert.equal(await f.attempt({ id: 'msg', roomId: 'room', content: 'test' }), 14);
  assert.equal(f.attempts, 0);
});

test('host attempt omits public servers and internet fallback restores STUN', () => {
  const f = fixture(); assert.equal(f.hostFirst(), true);
  f.connect(true); f.connect(false);
  assert.deepEqual(f.nativeConfigurations[0], []);
  assert.ok(f.nativeConfigurations[1].length > 0);
  assert.ok(f.nativeConfigurations[1].every(url => url.startsWith('stun:')));
});
