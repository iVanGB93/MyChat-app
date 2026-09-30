const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const crypto = require('node:crypto');
const { ed25519 } = require('@noble/curves/ed25519.js');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const code = ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(n => n.startsWith('./') ? load(n.slice(2).replace(/\.(js|ts)$/, '')) : require(n), exports);
  cache.set(name, exports); return exports;
}
const p = load('identityProtocol'), vault = load('identityVault');
const { createLocalIdentityController } = load('localIdentityController');
const { createIdentityAdmission, signIdentityRequest } = load('identityAdmission');
const { createIdentityExchange } = load('identityExchange');
const { authenticateIdentityPeer } = load('identityClient');
const { createNeuronConnections } = load('neuronConnections');
const { createIdentityConnectionOpener } = load('neuronIdentityConnection');
const now = 1_800_000_000_000;
const random = n => new Uint8Array(crypto.randomBytes(n));
test('chat binding signatures stay inside the unlocked identity controller', async () => {
  const c = createLocalIdentityController(localStorage(), async n => random(n), () => now,
    async (password, salt) => new Uint8Array(crypto.createHash('sha256').update(password).update(salt).digest()));
  const challenge = { version: 1, roomId: '22222222-2222-4222-8222-222222222222', requester: 14,
    requesterAccount: 'axonic:1:' + 'a1'.repeat(32), peer: 18, nonce: 'ab'.repeat(32), expiresAt: now + 60000 };
  assert.throws(() => c.signChatBinding(18, challenge), /Unlock/);
  await c.confirmBackup(await c.beginCreate(), 'synthetic controller test password');
  const proof = c.signChatBinding(18, challenge);
  assert.equal(load('chatIdentityBinding').verifyChatBinding(proof, challenge, 18, now), true);
  assert.throws(() => c.signChatBinding(99, challenge), /Invalid/);
  c.lock(); assert.throws(() => c.signChatBinding(18, challenge), /Unlock/);
});
function account() {
  const root = random(32), signing = random(32), encryption = random(32);
  const device = p.publicDevice(signing, encryption);
  return { root, signing, encryption, device, record: p.issueRecord(root, [device], now) };
}
function fixture() {
  const a = account(), b = account(); let clock = now;
  const v = p.createIdentityVerifier(b.record.account, random, () => clock);
  const proof = () => p.proveIdentity(a.record, a.device, a.signing, v.challenge(), b.record.account, clock);
  return { a, b, v, proof, advance: ms => { clock += ms; } };
}
test('fresh self-owned identities authenticate without a registry and proofs are one-time', () => {
  const f = fixture(), raw = JSON.stringify(f.proof());
  assert.equal(f.v.verify(raw, null).account, f.a.record.account);
  assert.equal(f.v.verify(raw, null), null);
});
test('native Node Ed25519 verifies portable account authority signatures', () => {
  const a = account(), r = a.record;
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(r.root, 'hex')]), type: 'spki', format: 'der' });
  const body = JSON.stringify(['axonic-identity-record-v1', 1, r.account, r.root, 0, null, r.issuedAt, r.expiresAt,
    r.devices.map(d => [d.id, d.signing, d.encryption])]);
  assert.equal(crypto.verify(null, Buffer.from(body), key, Buffer.from(r.signature, 'hex')), true);
});
test('tampering with account, device, encryption key, record lifetime, or signature is rejected', () => {
  const a = account();
  for (const mutate of [r => r.account = account().record.account, r => r.devices[0].encryption = '00'.repeat(32),
    r => r.devices[0].signing = '00'.repeat(32), r => r.expiresAt += 1, r => r.signature = '00'.repeat(64),
    r => r.devices.push(r.devices[0]), r => r.revision = -1]) {
    const r = JSON.parse(JSON.stringify(a.record)); mutate(r); assert.equal(p.verifyRecord(r, now), false);
  }
  assert.equal(p.verifyRecord(a.record, now + p.RECORD_LIFETIME), false);
});
test('proofs bind verifier, issued nonce, device keys, and expiry', () => {
  for (const mutate of [q => q.challenge.verifier = account().record.account, q => q.challenge.nonce = '00'.repeat(32),
    q => q.challenge.expiresAt += 1, q => q.signature = '00'.repeat(64), q => q.device = '00'.repeat(32)]) {
    const f = fixture(), q = JSON.parse(JSON.stringify(f.proof())); mutate(q); assert.equal(f.v.verify(JSON.stringify(q), null), null);
  }
  const f = fixture(), q = f.proof(); f.advance(60_000); assert.equal(f.v.verify(JSON.stringify(q), null), null);
  assert.throws(() => p.proveIdentity(f.a.record, f.a.device, f.a.signing, f.v.challenge(), f.a.record.account, now + 60000));
});
test('revocation updates are monotonic, forks fail closed, and missing history is explicit', () => {
  const f = fixture(), newDevice = account();
  const next = p.issueRecord(f.a.root, [newDevice.device], now + 1, f.a.record);
  assert.equal(p.compareRecord(next, f.a.record, now + 1), 'accept');
  assert.equal(p.compareRecord(f.a.record, next, now + 1), 'stale');
  const fork = p.issueRecord(f.a.root, [f.a.device, newDevice.device], now + 1, f.a.record);
  assert.equal(p.compareRecord(fork, next, now + 1), 'conflict');
  const later = p.issueRecord(f.a.root, [newDevice.device], now + 2, next);
  assert.equal(p.compareRecord(later, f.a.record, now + 2), 'missing-history');
  assert.equal(f.v.verify(JSON.stringify(f.proof()), next), null);
});
test('pending challenges are bounded, expired entries are reclaimed, and no predictable RNG fallback exists', () => {
  const f = fixture(); for (let i = 0; i < 256; i++) f.v.challenge();
  assert.throws(() => f.v.challenge(), /capacity/); f.advance(60_001); assert.ok(f.v.challenge());
  const broken = p.createIdentityVerifier(f.b.record.account, () => new Uint8Array(2), () => now);
  assert.throws(() => broken.challenge(), /randomness/);
});
test('recovery retains account identity, replaces device keys, and requires the prior signed record', async () => {
  const created = await vault.createLocalIdentity(async n => random(n), now);
  assert.equal(created.recoveryPhrase.split(' ').length, 24);
  const restored = await vault.recoverReplacingDevices(created.recoveryPhrase, created.identity.record, async n => random(n), now + 1);
  assert.equal(restored.record.account, created.identity.record.account);
  assert.notEqual(restored.record.devices[0].id, created.identity.record.devices[0].id);
  assert.equal(p.compareRecord(restored.record, created.identity.record, now + 1), 'accept');
  await assert.rejects(vault.recoverReplacingDevices(created.recoveryPhrase, account().record, async n => random(n), now));
  const root = vault.rootFromEntropy(created.identity.entropy);
  assert.equal(Buffer.from(ed25519.getPublicKey(root)).toString('hex'), created.identity.record.root); root.fill(0);
  vault.destroyIdentity(created.identity); vault.destroyIdentity(restored);
  assert.ok(restored.entropy.every(x => x === 0));
});
test('password vault requires password AND device secret; authenticates public metadata and survives serialization', async () => {
  const { identity } = await vault.createLocalIdentity(async n => random(n), now);
  const deviceSecret = random(32), password = 'test-only password 2026';
  const sealed = await vault.sealIdentity(identity, password, deviceSecret, async n => random(n), now);
  const raw = JSON.stringify(sealed);
  assert.ok(!raw.includes(password)); assert.ok(!raw.includes(Buffer.from(identity.entropy).toString('hex')));
  const unlocked = await vault.unlockIdentity(raw, password, deviceSecret, now);
  assert.equal(unlocked.record.account, identity.record.account);
  assert.deepEqual(unlocked.signingSeed, identity.signingSeed);
  await assert.rejects(vault.unlockIdentity(raw, 'wrong password 2026', deviceSecret, now), /Unable to unlock/);
  await assert.rejects(vault.unlockIdentity(raw, password, random(32), now), /Unable to unlock/);
  const corrupt = { ...sealed, ciphertext: (sealed.ciphertext.startsWith('00') ? '01' : '00') + sealed.ciphertext.slice(2) };
  await assert.rejects(vault.unlockIdentity(JSON.stringify(corrupt), password, deviceSecret, now));
  await assert.rejects(vault.unlockIdentity(JSON.stringify({ ...sealed, kdf: 'scrypt-999999999' }), password, deviceSecret, now));
  await assert.rejects(vault.unlockIdentity(JSON.stringify({ ...sealed, record: account().record }), password, deviceSecret, now));
  vault.destroyIdentity(identity); vault.destroyIdentity(unlocked); deviceSecret.fill(0);
});

function localStorage() {
  const data = { vault: null, secret: null };
  return { data, readVault: async () => data.vault, writeVault: async value => { data.vault = value; },
    readDeviceSecret: async () => data.secret, writeDeviceSecret: async value => { data.secret = value; } };
}
test('native password adapter interoperates with portable vaults and rejects invalid derived keys', async () => {
  const { identity } = await vault.createLocalIdentity(async n => random(n), now);
  const secret = random(32), password = 'contraseña 🔑 test';
  const native = async (value, salt) => new Uint8Array(crypto.scryptSync(value, salt, 32,
    { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }));
  const portable = await vault.sealIdentity(identity, password, secret, async n => random(n), now);
  const opened = await vault.unlockIdentity(JSON.stringify(portable), password, secret, now, native);
  assert.equal(opened.record.account, identity.record.account);
  const sealedNative = await vault.sealIdentity(identity, password, secret, async n => random(n), now, native);
  const openedPortable = await vault.unlockIdentity(JSON.stringify(sealedNative), password, secret, now);
  assert.deepEqual(openedPortable.signingSeed, identity.signingSeed);
  await assert.rejects(vault.sealIdentity(identity, password, secret, async n => random(n), now,
    async () => new Uint8Array(16)), /Password derivation unavailable/);
  vault.destroyIdentity(identity); vault.destroyIdentity(opened); vault.destroyIdentity(openedPortable); secret.fill(0);
});

test('local creation requires recovery confirmation, survives cold start, and locks without touching legacy storage', async () => {
  const store = localStorage(), c = createLocalIdentityController(store, async n => random(n), () => now);
  await c.inspect(); assert.equal(c.status().state, 'empty');
  const phrase = await c.beginCreate(); assert.equal(c.status().state, 'backup'); assert.equal(store.data.vault, null);
  await assert.rejects(c.confirmBackup('wrong words', 'local password test'), /do not match/);
  assert.equal(store.data.secret, null);
  await c.confirmBackup(phrase, 'local password test');
  const id = c.status().account; assert.equal(c.status().state, 'unlocked'); assert.ok(id.startsWith('axonic:1:'));
  assert.ok(!store.data.vault.includes(phrase));
  const publicCopy = c.publicRecord(); publicCopy.devices.length = 0; assert.equal(c.publicRecord().devices.length, 1);
  c.lock(); assert.equal(c.publicRecord(), null); assert.equal(c.status().state, 'locked');
  const cold = createLocalIdentityController(store, async n => random(n), () => now);
  await cold.inspect(); assert.equal(cold.status().account, id);
  await assert.rejects(cold.unlock('wrong password test')); assert.equal(cold.status().state, 'locked');
  await cold.unlock('local password test'); assert.equal(cold.status().state, 'unlocked');
  await assert.rejects(cold.beginCreate(), /already exists/); cold.lock();
});
test('locking during creation cancels the draft; concurrent operations cannot overwrite it', async () => {
  const store = localStorage(); let release;
  const gate = new Promise(r => { release = r; });
  const c = createLocalIdentityController(store, async n => { await gate; return random(n); }, () => now);
  const pending = c.beginCreate();
  await assert.rejects(c.beginCreate(), /already running/); c.lock(); release();
  await assert.rejects(pending, /interrupted/);
  assert.equal(c.status().state, 'empty'); assert.equal(store.data.vault, null);
});
test('background locking during a completed vault write persists a locked account, never unlocks late', async () => {
  const store = localStorage(); let c;
  store.writeVault = async value => { store.data.vault = value; c.lock(); };
  c = createLocalIdentityController(store, async n => random(n), () => now);
  const phrase = await c.beginCreate(); await c.confirmBackup(phrase, 'local password test');
  assert.equal(c.status().state, 'locked'); assert.equal(c.publicRecord(), null);
  const cold = createLocalIdentityController(store, async n => random(n), () => now);
  await cold.unlock('local password test'); assert.equal(cold.status().account, c.status().account); cold.lock();
});
test('failed storage write leaves no falsely created account and remains retryable', async () => {
  const store = localStorage(), original = store.writeVault;
  store.writeVault = async () => { throw Error('Disk unavailable'); };
  const c = createLocalIdentityController(store, async n => random(n), () => now);
  const phrase = await c.beginCreate(); await assert.rejects(c.confirmBackup(phrase, 'local password test'), /Disk unavailable/);
  assert.equal(c.status().state, 'backup'); assert.equal(store.data.vault, null);
  store.writeVault = original; await c.confirmBackup(phrase, 'local password test');
  assert.equal(c.status().state, 'unlocked'); c.lock();
});

function registry() {
  const records = new Map();
  return { records, read: async id => records.get(id) ?? null,
    compareAndSet: async (id, expected, next) => {
      const old = records.get(id);
      if ((old ? p.recordDigest(old) : null) !== expected || (!old && records.size >= 32)) return false;
      records.set(id, JSON.parse(JSON.stringify(next))); return true;
    } };
}
function peer() {
  const a = account(), store = registry(); let active = true;
  const d = { account: a.record.account, instance: random(32), store, now: () => now, current: () => active };
  return { ...a, store, d, engine: createIdentityAdmission(d), stop: () => { active = false; } };
}
const request = (sender, receiver, payload = 'hello', operation = 'authenticate') => JSON.stringify(signIdentityRequest(
  sender.record, sender.signing, receiver.engine.audience(), operation, payload, random(32), now));
test('ordinary participants mutually admit new identities with identical rules and no FirstNeuron', async () => {
  const peers = [peer(), peer(), peer()];
  for (const sender of peers) for (const receiver of peers) if (sender !== receiver) {
    const result = await receiver.engine.accept(request(sender, receiver));
    assert.equal(result.account, sender.record.account); assert.equal(result.payload, 'hello');
    assert.equal(receiver.store.records.get(sender.record.account).devices[0].id, sender.device.id);
  }
  peers[0].stop();
  assert.equal((await peers[2].engine.accept(request(peers[1], peers[2]))).account, peers[1].record.account);
});
test('signed requests bind their action, content, target, and runtime; replay fails concurrently and after restart', async () => {
  const a = peer(), b = peer();
  for (const change of [q => q.payload = 'changed', q => q.operation = 'lookup', q => q.target = a.record.account,
    q => q.instance = '00'.repeat(32), q => q.time += 1]) {
    const q = JSON.parse(request(a, b)); change(q); assert.equal(await b.engine.accept(JSON.stringify(q)), null);
  }
  const raw = request(a, b);
  assert.equal((await Promise.all([b.engine.accept(raw), b.engine.accept(raw)])).filter(Boolean).length, 1);
  const future = JSON.stringify(signIdentityRequest(a.record, a.signing, b.engine.audience(), 'authenticate', '', random(32), now + 10000));
  assert.ok(await b.engine.accept(future));
  b.engine = createIdentityAdmission({ ...b.d, instance: random(32) });
  assert.equal(await b.engine.accept(future), null);
  assert.ok(await b.engine.accept(request(a, b)));
});
test('admission grants nothing if durable storage fails, fills up, or runtime locks during storage', async () => {
  const a = peer(), b = peer();
  b.store.compareAndSet = async () => false;
  assert.equal(await b.engine.accept(request(a, b)), null);
  b.store.compareAndSet = async () => { b.stop(); return true; };
  assert.equal(await b.engine.accept(request(a, b)), null);
});
test('concurrent conflicting updates cannot replace the first accepted identity record', async () => {
  const a = peer(), b = peer(); assert.ok(await b.engine.accept(request(a, b)));
  const first = p.issueRecord(a.root, [a.device], now, a.record);
  const other = p.issueRecord(a.root, [a.device, account().device], now, a.record);
  const raws = [first, other].map(record => request({ ...a, record }, b));
  assert.equal((await Promise.all(raws.map(raw => b.engine.accept(raw)))).filter(Boolean).length, 1);
  assert.equal(b.store.records.get(a.record.account).revision, 1);
  assert.equal(await b.engine.accept(request(a, b)), null);
});

function clientPair() {
  const alice = peer(), bob = peer(); let active = true;
  const server = createIdentityExchange({ record: bob.record, signingSeed: bob.signing, ...bob.d });
  const d = { localAccount: alice.record.account, expectedAccount: bob.record.account, store: alice.store,
    random: async n => random(n), now: () => now, current: () => active,
    exchange: async (op, raw) => op === 'describe' ? server.describe(JSON.parse(raw).nonce) : server.authenticate(raw),
    sign: async audience => signIdentityRequest(alice.record, alice.signing, audience, 'authenticate', '', random(32), now) };
  return { alice, bob, d, stop: () => { active = false; } };
}

test('connection pool admits a real cryptographic peer and releases it when its transport closes', async () => {
  const f = clientPair(); let onClosed, closed = 0;
  const open = createIdentityConnectionOpener({ ...f.d, transport: async () => ({
    exchange: f.d.exchange, onClosed: cb => { onClosed = cb; return () => {}; }, close: () => { closed++; },
  }) });
  const pool = createNeuronConnections({ localAccount: f.alice.record.account, now: () => now, open });
  pool.offer({ account: f.bob.record.account, endpoint: 'in-memory:test', route: 'lan', expiresAt: now + 60000 });
  pool.tick();
  await new Promise(r => setImmediate(r));
  assert.equal(pool.snapshot().connections[0].state, 'connected');
  assert.ok(f.bob.store.records.has(f.alice.record.account));
  onClosed(); assert.equal(pool.snapshot().connections.length, 0); assert.equal(closed, 1);
});

test('connection adapter rejects impersonation and closes a transport arriving after cancellation', async () => {
  const f = clientPair(); let closed = 0;
  const transport = { exchange: f.d.exchange, onClosed: () => () => {}, close: () => { closed++; } };
  const c = { account: account().record.account, endpoint: 'in-memory:test', route: 'internet', expiresAt: now + 60000 };
  const open = createIdentityConnectionOpener({ ...f.d, transport: async () => transport });
  assert.equal(await open(c, { signal: new AbortController().signal, onClosed() {} }), null);
  assert.equal(closed, 1);
  let resolve; const pending = new Promise(r => { resolve = r; });
  const delayed = createIdentityConnectionOpener({ ...f.d, transport: () => pending });
  const controller = new AbortController();
  const result = delayed(c, { signal: controller.signal, onClosed() {} });
  controller.abort(); resolve(transport); assert.equal(await result, null); assert.equal(closed, 2);
});
test('identity client completes mutual authentication and records both public identities automatically', async () => {
  const f = clientPair(), result = await authenticateIdentityPeer(f.d);
  assert.equal(result.account, f.bob.record.account); assert.equal(result.device, f.bob.device.id);
  assert.equal(f.alice.store.records.get(f.bob.record.account).root, f.bob.record.root);
  assert.equal(f.bob.store.records.get(f.alice.record.account).root, f.alice.record.root);
});
test('client refuses substituted peers, forged acknowledgments, storage failures and late replies after lock', async () => {
  const wrong = clientPair(); wrong.d.expectedAccount = account().record.account;
  assert.equal(await authenticateIdentityPeer(wrong.d), null);
  const forged = clientPair(), exchange = forged.d.exchange;
  forged.d.exchange = async (op, raw) => {
    const response = await exchange(op, raw);
    if (op === 'describe') return response;
    const r = JSON.parse(response); r.signature = '00'.repeat(64); return JSON.stringify(r);
  };
  assert.equal(await authenticateIdentityPeer(forged.d), null);
  const disk = clientPair(); disk.d.store.compareAndSet = async () => false;
  assert.equal(await authenticateIdentityPeer(disk.d), null);
  const locked = clientPair(), delayed = locked.d.exchange;
  locked.d.exchange = async (op, raw) => { const r = await delayed(op, raw); if (op === 'authenticate') locked.stop(); return r; };
  assert.equal(await authenticateIdentityPeer(locked.d), null);
});

test('renewals keep keys and account stable; bounded ancestry bridges expired pins without trusting gaps or forks', () => {
  const a = account(); let state = { record: a.record, history: [] }, clock = now;
  assert.equal(p.renewIdentityRecord(a.root, state.record, [], clock), null);
  for (let i=0;i<3;i++) { clock += 24*86400000; state = p.renewIdentityRecord(a.root, state.record, state.history, clock); }
  assert.equal(state.record.account,a.record.account); assert.deepEqual(state.record.devices,a.record.devices);
  assert.equal(p.compareRecord(state.record,a.record,clock),'missing-history');
  assert.equal(p.compareRecord(state.record,a.record,clock,state.history),'accept');
  assert.equal(p.compareRecord(state.record,a.record,clock,state.history.slice(1)),'missing-history');
  const bad=structuredClone(state.history);bad[1].signature='00'.repeat(64);
  assert.equal(p.compareRecord(state.record,a.record,clock,bad),'invalid');
  const fork=p.issueRecord(a.root,[account().device],state.history[1].issuedAt,a.record);
  assert.equal(p.compareRecord(state.record,fork,clock,state.history),'conflict');
  for(let i=0;i<10;i++){clock+=24*86400000;state=p.renewIdentityRecord(a.root,state.record,state.history,clock);}
  assert.ok(state.history.length<=p.HISTORY_RECORDS);assert.ok(Buffer.byteLength(JSON.stringify(state.history))<=p.HISTORY_BYTES);
  assert.equal(p.compareRecord(state.record,a.record,clock,state.history),'missing-history');
});

test('both directions authenticate after missing multiple renewals and persist the latest pins', async () => {
  const a=account(), b=account();let clock=now, aa={record:a.record,history:[]}, bb={record:b.record,history:[]};
  for(let i=0;i<3;i++){clock+=24*86400000;aa=p.renewIdentityRecord(a.root,aa.record,aa.history,clock);bb=p.renewIdentityRecord(b.root,bb.record,bb.history,clock);}
  for(const [local,remote,ls,rs] of [[a,b,aa,bb],[b,a,bb,aa]]) {
    const clientStore=registry(),serverStore=registry();clientStore.records.set(remote.record.account,remote.record);serverStore.records.set(local.record.account,local.record);
    const service=createIdentityExchange({...rs,signingSeed:remote.signing,instance:random(32),store:serverStore,now:()=>clock,current:()=>true});
    const result=await authenticateIdentityPeer({expectedAccount:remote.record.account,localAccount:local.record.account,store:clientStore,
      random:async n=>random(n),now:()=>clock,current:()=>true,
      exchange:async(op,raw)=>op==='describe'?service.describe(JSON.parse(raw).nonce):service.authenticate(raw),
      sign:async audience=>signIdentityRequest(ls.record,local.signing,audience,'authenticate','',random(32),clock,ls.history)});
    assert.equal(result?.account,remote.record.account);assert.equal((await clientStore.read(remote.record.account)).revision,3);
    assert.equal((await serverStore.read(local.record.account)).revision,3);
  }
});

test('unlock renews and saves the vault before admission; failed writes preserve the old vault', async () => {
  const storage=localStorage(); let clock=now;
  const fast=async(p,s)=>new Uint8Array(crypto.createHash('sha256').update(p).update(s).digest());
  const make=()=>createLocalIdentityController(storage,async n=>random(n),()=>clock,fast);
  const c=make();await c.confirmBackup(await c.beginCreate(),'test renewal password');const original=c.publicRecord();c.lock();clock+=31*86400000;
  const old=storage.data.vault, write=storage.writeVault;storage.writeVault=async()=>{throw Error('disk full');};
  await assert.rejects(c.unlock('test renewal password'),/disk full/);assert.equal(storage.data.vault,old);assert.equal(c.status().state,'locked');
  storage.writeVault=write;await c.unlock('test renewal password');
  assert.equal(c.publicRecord().revision,1);assert.equal(c.publicRecord().account,original.account);assert.deepEqual(c.publicRecord().devices,original.devices);
  c.lock();const cold=make();await cold.unlock('test renewal password');assert.equal(cold.publicRecord().revision,1);cold.lock();
});
