const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync('src/services/mailboxComposition.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(supported = true, configs = new Map()) {
  let state = { user: { id: 1 }, appLifecycle: 'active', activeCall: null, blockedIds: {} };
  const subscribers = new Set(), timers = new Set(), sent = [], saved = [], pins = [];
  let deps, transport, hosted, hostedStops = 0, resets = 0, failPersist = false, attempt, held = null, envelope = null;
  let readGate = null, writeGate = null, writeFails = false, pinFails = false, readCount = 0;
  const rooms = [{ id: 'origin', room_type: 'direct', members: [1, 2], members_detail: [{ id: 2, username: 'Recipient' }] },
    { id: 'relay', room_type: 'direct', members: [1, 3], members_detail: [{ id: 3, username: 'Custodian' }] }];
  const native = supported ? {
    mailboxIdentity: async () => ({ encryption: 'own-encryption', signing: 'own-signing' }),
    mailboxDigest: async () => 'digest', mailboxSign: async () => 'signature', mailboxVerify: async () => true,
    mailboxSeal: async () => ({}), mailboxOpen: async () => 'plaintext',
  } : {};
  const mocks = {
    './transports/neuronExchange': { createNeuronClient: d => { hosted = d; return { exchange: async () => d.current(), stop() { hostedStops++; } }; } },
    '../../modules/axonic-nearby': { default: native },
    '../store/appStore': { useAppStore: { getState: () => state, subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } } },
    './localMessageStore': { getCachedRooms: async () => rooms, getMessagesByIds: async () => saved },
    './ingressRouter': { ingestMessage: async p => { if (!failPersist) saved.push({ room_id: p.room_id, sender_id: p.sender_id, content: p.content, type: 'text', is_mine: false }); } },
    './notificationWsManager': { isNotifWsReady: () => true, sendRawNotif: () => true, subscribeStatus: () => () => {} },
    './transports/p2pTextRuntime': { createP2pTextRuntime(d) { transport = d; return { reset() { resets++; },
      handleSignal: async () => {}, signalingLost() {}, trySend: async (p, options) => { sent.push(p); return options.expectedRecipientIds[0]; } }; } },
    './transports/neuronSignaling': { createNeuronSignaling(d) { return { poll: async () => d.current(), ready: () => d.current(),
      status: () => ({ queued: 0, sent: 0, received: 0, ready: d.current() }), send: () => d.current(), reset() {}, stop() {} }; } },
    './transports/nativeTextPeer': { createNativeTextPeer: () => ({}) },
    './transports/p2pTextBridge': { MAILBOX_ENABLED: true, configureMailboxTextAttempt(fn) { attempt = fn; }, acceptMailboxDelivered: async () => true },
    './transports/mailboxOutbox': { createMailboxOutbox: () => ({ attempt: async () => null, reconcile: async () => {}, matches: async () => true }) },
    './transports/mailboxProtocol': { createMailboxNode(d) { deps = d; return { receive: async () => true, flush: async () => 0 }; } },
    './transports/mailboxStore': { mailboxStore: { get: async () => envelope }, getMailboxOutgoing: async () => held,
      pinMailboxIdentities: async (owner, identities) => { if (pinFails) throw Error('Changed key'); pins.push({ owner, identities }); },
      readMailboxConfiguration: async owner => { readCount++; const result = configs.get(owner) ?? null; if (readGate) await readGate; return result; },
      writeMailboxConfiguration: async (owner, value, current) => { if (writeGate) await writeGate; if (writeFails || !current()) throw Error('Write failed'); if (value === null) configs.delete(owner); else configs.set(owner, JSON.parse(JSON.stringify(value))); } },
  };
  const sandbox = { exports: {}, URL, require: name => { assert.ok(name in mocks, name); return mocks[name]; },
    setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } };
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, sent, saved, pins, timers, native, rooms, configs,
    delayRead: gate => { readGate = gate; }, failWrite: () => { writeFails = true; }, failPins: () => { pinFails = true; },
    delayWrite: gate => { writeGate = gate; },
    get reads() { return readCount; },
    attempt: (...args) => attempt(...args), hold: (e, binding) => { envelope = e; held = binding; },
    get deps() { return deps; }, get transport() { return transport; }, get resets() { return resets; },
    get hosted() { return hosted; }, get hostedStops() { return hostedStops; },
    update(patch) { const prev = state; state = { ...state, ...patch }; for (const fn of subscribers) fn(state, prev); },
    failPersist() { failPersist = true; } };
}
const pairs = () => [{ user: 2, roomId: 'origin', encryption: 'recipient-encryption', signing: 'recipient-signing' },
  { user: 3, roomId: 'relay', encryption: 'relay-encryption', signing: 'relay-signing' }];
const endpoint = () => ({ url: 'https://neuron.example', user: 3, node: 'pinned-node', signing: 'relay-signing' });
const stored = owner => ({ version: 1, owner, pairs: pairs(), neuron: endpoint() });
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('trusted neuron introduces only local direct contacts, preserving keys and local room routes', async () => {
  const f = fixture(); await f.startMailboxPrototype([pairs()[1]], endpoint());
  assert.deepEqual(Array.from(await f.hosted.discover()), [2]);
  await f.hosted.introduce([{ ...pairs()[0], roomId: 'server-controlled' }, { user: 99, encryption: 'x', signing: 'y' }]);
  assert.equal(f.deps.identity(2).signing, 'recipient-signing');
  assert.equal(f.deps.identity(99), null);
  assert.deepEqual(Array.from(f.mailboxSessionStatus().discovered), [2]);
  assert.equal(await f.deps.send(2, { kind: 'receipt' }), true);
  assert.equal(f.sent[0].roomId, 'origin');
  await f.hosted.introduce([{ ...pairs()[0], signing: 'replacement' }]);
  assert.equal(f.deps.identity(2).signing, 'recipient-signing');
});

test('introductions reject blocked/deleted contacts and historical pin conflicts', async () => {
  const f = fixture(); await f.startMailboxPrototype([pairs()[1]], endpoint());
  f.update({ blockedIds: { 2: true } });
  assert.equal((await f.hosted.discover()).length, 0);
  await f.hosted.introduce([pairs()[0]]); assert.equal(f.deps.identity(2), null);
  f.update({ blockedIds: {} }); f.failPins();
  await f.hosted.introduce([pairs()[0]]); assert.equal(f.deps.identity(2), null);
  f.rooms.splice(0, 1); await f.hosted.introduce([pairs()[0]]);
  assert.equal(f.mailboxSessionStatus().discovered.length, 0);
});

test('old introduction callbacks cannot affect a replacement account or stopped session', async () => {
  const f = fixture(); await f.startMailboxPrototype([pairs()[1]], endpoint());
  const old = f.hosted, before = f.pins.length;
  f.update({ user: { id: 7 } }); await old.introduce([pairs()[0]]);
  assert.equal(f.pins.length, before); assert.equal(f.mailboxSessionStatus().discovered.length, 0);
});

test('explicit pairing survives a new runtime and restores without Axion authentication', async () => {
  const configs = new Map(), first = fixture(true, configs), p = pairs(), n = endpoint();
  await first.rememberMailboxPairing(p, n);
  p[0].signing = 'mutated'; n.url = 'http://untrusted.example';
  first.stopMailboxPrototype();
  const cold = fixture(true, configs); cold.initializeMailboxRecovery(); cold.initializeMailboxRecovery();
  await cold.restoreMailboxPairing();
  assert.equal(cold.mailboxSessionStatus().owner, 1); assert.equal(cold.reads, 1);
  assert.equal(cold.hosted.endpoint.url, 'https://neuron.example');
  assert.equal(cold.deps.identity(2).signing, 'recipient-signing');
  assert.equal(cold.timers.size, 2);
});

test('saved configuration waits for foreground and never crosses accounts during an async read', async () => {
  const f = fixture(true, new Map([[1, stored(1)]]));
  f.update({ appLifecycle: 'background' }); f.initializeMailboxRecovery(); await drain();
  assert.equal(f.reads, 0);
  let release; f.delayRead(new Promise(r => { release = r; }));
  f.update({ appLifecycle: 'active' }); const old = f.restoreMailboxPairing();
  f.update({ user: { id: 7 } }); release(); await old; await drain();
  assert.equal(f.mailboxSessionStatus().owner, null); assert.equal(f.timers.size, 0); assert.equal(f.pins.length, 0);
  f.update({ user: { id: 1 } }); await f.restoreMailboxPairing();
  assert.equal(f.mailboxSessionStatus().owner, 1);
  f.update({ user: null }); assert.equal(f.timers.size, 0); assert.equal(f.hosted.current(), false);
});

test('forget cancels pending restoration, removes only routing settings, and keeps pins', async () => {
  const f = fixture(true, new Map([[1, stored(1)]]));
  let release; f.delayRead(new Promise(r => { release = r; }));
  const restoring = f.restoreMailboxPairing(); await f.forgetMailboxPairing(); release(); await restoring;
  assert.equal(f.mailboxSessionStatus().owner, null); assert.equal(f.configs.has(1), false);
  f.delayRead(null); await f.rememberMailboxPairing(pairs(), endpoint()); const pins = f.pins.length;
  await f.forgetMailboxPairing(); await f.restoreMailboxPairing();
  assert.equal(f.timers.size, 0); assert.equal(f.pins.length, pins);
});

test('corrupt, cross-account, insecure and changed-key saved settings fail closed', async () => {
  for (const value of [{ ...stored(1), version: 2 }, stored(7), { ...stored(1), pairs: [null] },
    { ...stored(1), neuron: { ...endpoint(), url: 'http://remote.example' } },
    { ...stored(1), neuron: { ...endpoint(), signing: 'replacement' } }]) {
    const f = fixture(true, new Map([[1, value]])); await f.restoreMailboxPairing();
    assert.equal(f.mailboxSessionStatus().owner, null); assert.ok(f.mailboxSessionStatus().error); assert.equal(f.timers.size, 0);
  }
  const changed = fixture(true, new Map([[1, stored(1)]])); changed.failPins(); await changed.restoreMailboxPairing();
  assert.equal(changed.mailboxSessionStatus().owner, null); assert.equal(changed.timers.size, 0);
});

test('failed durable configuration write shuts down the newly requested session', async () => {
  const f = fixture(); f.failWrite(); await assert.rejects(f.rememberMailboxPairing(pairs(), endpoint()), /Write failed/);
  assert.equal(f.configs.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.mailboxSessionStatus().owner, null);
});
test('foreground cannot restore old settings while forgetting is still writing to disk', async () => {
  const f = fixture(true, new Map([[1, stored(1)]]));
  f.initializeMailboxRecovery(); await f.restoreMailboxPairing();
  let release; f.delayWrite(new Promise(r => { release = r; }));
  const forgetting = f.forgetMailboxPairing();
  f.update({ appLifecycle: 'background' }); f.update({ appLifecycle: 'active' });
  await f.restoreMailboxPairing(); assert.equal(f.mailboxSessionStatus().owner, null);
  release(); await forgetting; await f.restoreMailboxPairing();
  assert.equal(f.configs.size, 0); assert.equal(f.timers.size, 0);
});
test('switching accounts during a saved-settings write resumes only the new account', async () => {
  const f = fixture(true, new Map([[7, stored(7)]])); f.initializeMailboxRecovery(); await drain();
  let release; f.delayWrite(new Promise(r => { release = r; }));
  const remembering = f.rememberMailboxPairing(pairs(), endpoint()); await drain();
  f.update({ user: { id: 7 } }); release();
  await assert.rejects(remembering); await drain();
  assert.equal(f.configs.has(1), false); assert.equal(f.mailboxSessionStatus().owner, 7);
  assert.equal(f.timers.size, 2);
});

test('hosted peer needs no Axion room and pauses when blocked or backgrounded', async () => {
  const f = fixture(), p = pairs(); delete p[1].roomId;
  const endpoint = { url: 'http://127.0.0.1:18080', user: 3, node: 'test-node', signing: 'relay-signing' };
  await f.startMailboxPrototype(p, endpoint);
  endpoint.signing = 'changed'; assert.equal(f.hosted.endpoint.signing, 'relay-signing');
  assert.equal(await f.deps.send(3, { kind: 'receipt' }), true); assert.equal(f.sent.length, 0);
  f.update({ blockedIds: { 3: true } }); assert.equal(f.hosted.current(), false); assert.equal(await f.deps.send(3, { kind: 'receipt' }), false);
  f.update({ blockedIds: {}, appLifecycle: 'background' }); assert.equal(f.hosted.current(), false);
  f.update({ appLifecycle: 'active' }); assert.equal(f.hosted.current(), true);
  f.update({ user: { id: 7 } }); assert.equal(f.hostedStops, 1); assert.equal(f.hosted.current(), false);
});

test('hosted pairing rejects insecure remote HTTP and mismatched pinned signing keys', async () => {
  const f = fixture();
  for (const endpoint of [
    { url: 'http://example.com', user: 3, node: 'test', signing: 'relay-signing' },
    { url: 'https://example.com', user: 3, node: 'test', signing: 'changed-key' },
  ]) await assert.rejects(f.startMailboxPrototype(pairs(), endpoint), /Invalid pinned neuron/);
  assert.equal(f.hosted, undefined);
});

test('cold-start outbox recovery retains valid durable custody before pairing resumes', async () => {
  const f = fixture(); const createdAt = new Date().toISOString();
  const message = { id: 'held', roomId: 'origin', content: 'held content', createdAt };
  f.saved.push({ id: 'held', room_id: 'origin', sender_id: 1, is_mine: true, type: 'text', content: message.content, created_at: createdAt });
  f.hold({ kind: 'envelope', sender: 1, recipient: 2, roomId: 'origin', createdAt: Date.parse(createdAt) }, { custody: 1, digest: 'digest' });
  const result = await f.attempt(message, { hydration: true, targetRecipientId: 2 });
  assert.equal(result.delivered, false); assert.equal(result.peerId, 2); assert.equal(f.timers.size, 0);
  assert.equal(await f.attempt({ ...message, content: 'changed' }), null);
  f.update({ user: { id: 3 } }); assert.equal(await f.attempt(message), null);
});

test('old native builds fail clearly without enabling mailbox traffic', async () => {
  const f = fixture(false);
  await assert.rejects(f.startMailboxPrototype(pairs()), /updated Android app/);
  assert.equal(f.timers.size, 0); assert.equal(f.pins.length, 0);
});
test('explicit immutable pairing selects mailbox channel and validates cached relay route', async () => {
  const f = fixture(); const config = pairs(); await f.startMailboxPrototype(config);
  assert.equal(f.transport.application, 'mailbox');
  assert.equal(f.pins[0].owner, 1);
  config[1].roomId = 'origin'; config[1].signing = 'replaced';
  assert.equal(f.deps.identity(3).signing, 'relay-signing');
  assert.equal(await f.deps.send(3, { kind: 'envelope', id: 'test' }), true);
  assert.equal(f.sent[0].roomId, 'relay');
  assert.equal(await f.deps.send(99, { kind: 'envelope', id: 'test' }), false);
  f.update({ blockedIds: { 3: true } });
  assert.equal(f.deps.identity(3), null);
  assert.equal(await f.deps.send(3, { kind: 'envelope', id: 'test' }), false);
  f.stopMailboxPrototype(); assert.equal(f.timers.size, 0);
});
test('account changes invalidate old nodes and clear retries; background pauses participation', async () => {
  const f = fixture(); await f.startMailboxPrototype(pairs()); const old = f.deps;
  f.update({ appLifecycle: 'background' }); assert.equal(old.current(), false);
  f.update({ appLifecycle: 'active' }); assert.equal(old.current(), true);
  f.update({ user: { id: 2 } }); assert.equal(old.current(), false); assert.equal(f.timers.size, 0);
  assert.equal(await old.send(3, { kind: 'envelope', id: 'test' }), false);
  assert.equal(f.sent.length, 0);
});
test('recipient writes only an authorized original chat and checks durable message after ingest', async () => {
  const f = fixture(); await f.startMailboxPrototype(pairs());
  const envelope = { id: 'test', roomId: 'origin', sender: 2, recipient: 1, createdAt: Date.now() };
  assert.equal(await f.deps.persist({ ...envelope, sender: 3 }, 'text'), false);
  assert.equal(await f.deps.persist({ ...envelope, roomId: 'unknown' }, 'text'), false);
  f.failPersist(); assert.equal(await f.deps.persist(envelope, 'text'), false);
  f.stopMailboxPrototype();
  const ok = fixture(); await ok.startMailboxPrototype(pairs());
  assert.equal(await ok.deps.persist(envelope, 'text'), true);
  assert.equal(await ok.deps.persist(envelope, 'changed'), false);
  ok.stopMailboxPrototype();
});
