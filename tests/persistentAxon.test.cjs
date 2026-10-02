const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), crypto = require('node:crypto');
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
const p = load('identityProtocol'), { createPersistentAxon, AXON_FRAME_BYTES } = load('persistentAxon');
const { pinIdentityRecord } = load('identityAdmission');
const random = n => new Uint8Array(crypto.randomBytes(n));
const now = 1_800_000_000_000;
function identity() {
  const signingSeed = random(32);
  return { signingSeed, record: p.issueRecord(random(32), [p.publicDevice(signingSeed, random(32))], now) };
}
function store() {
  const records = new Map();
  return { read: async id => records.get(id) ?? null, compareAndSet: async (id, expected, next) => {
    const old = records.get(id);
    if ((old ? p.recordDigest(old) : null) !== expected) return false;
    records.set(id, next); return true;
  } };
}
function wires() {
  let dead = false, drop = false;
  const listeners = [], closed = [], history = [[], []];
  const wire = i => ({
    listen(message, close) { listeners[i] = message; closed[i] = close; return () => { listeners[i] = null; closed[i] = null; }; },
    send(raw) { if (dead) throw Error('closed'); history[i].push(raw); queueMicrotask(() => { if (!dead && !drop) listeners[1-i]?.(raw); }); },
    close() { if (dead) return; dead = true; for (const close of closed) close?.(); },
  });
  return { wire, history, inject: (i, frame) => listeners[i]?.(typeof frame === 'string' ? frame : JSON.stringify(frame)), blackhole: () => { drop = true; } };
}
function pair(t, overrides = {}) {
  const transport = wires(), identities = [identity(), identity()];
  let clock = now, active = true; const closed = [0, 0];
  const sessions = identities.map((id, i) => createPersistentAxon({ ...id, instance: random(32), store: store(),
    expectedAccount: identities[1-i].record.account, wire: transport.wire(i), now: () => clock,
    current: () => active, random: async n => random(n), onClosed: () => { closed[i]++; }, ...overrides[i] }));
  t.after(() => sessions.forEach(s => s.stop()));
  return { transport, identities, sessions, closed, advance: ms => { clock += ms; }, lock: () => { active = false; } };
}
async function settle(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('condition did not settle');
}
test('ordinary neurons mutually authenticate and renew the same open axon', async t => {
  const f = pair(t), links = await Promise.all(f.sessions.map(s => s.ready));
  assert.equal(links[0].peer.account, f.identities[1].record.account);
  assert.equal(links[1].peer.account, f.identities[0].record.account);
  const expiry = links.map(l => l.peer.expiresAt), instances = links.map(l => l.peer.instance);
  f.advance(21_000); f.sessions.forEach(s => s.tick());
  await settle(() => links.every((l, i) => l.peer.expiresAt > expiry[i]));
  assert.deepEqual(links.map(l => l.peer.instance), instances);
  assert.deepEqual(f.closed, [0, 0]);
  links[0].close(); assert.deepEqual(f.closed, [1, 1]);
  f.sessions.forEach(s => s.stop()); assert.deepEqual(f.closed, [1, 1]);
});
test('custody waits for a busy request slot, bounds queued work and cancels when locked', async t => {
  for (const lock of [false,true]) {
    let release,received=0;
    const f=pair(t,{1:{onCustody:async()=>{received++;if(received===1)await new Promise(r=>release=r);return '{"status":"ok"}';}}});
    await Promise.all(f.sessions.map(s=>s.ready));
    const first=f.sessions[0].custodyRequest('{"operation":"poll"}');
    await settle(()=>!!release);
    const second=f.sessions[0].custodyRequest('{"operation":"poll"}');
    assert.equal(await f.sessions[0].custodyRequest('{"operation":"poll"}'),null);
    assert.equal(received,1);
    if(lock){f.lock();f.sessions[0].tick();}
    release();
    assert.equal(await first,lock?null:'{"status":"ok"}');
    assert.equal(await second,lock?null:'{"status":"ok"}');
    assert.equal(received,lock?1:2);
  }
});

test('locking or expiring a proof closes authenticated connections', async t => {
  for (const lock of [true, false]) {
    const f = pair(t); await Promise.all(f.sessions.map(s => s.ready));
    if (lock) f.lock(); else f.advance(60_001);
    f.sessions[0].tick(); assert.deepEqual(f.closed, [1, 1]);
  }
});
test('wrong account and failed record persistence cannot establish an axon', async t => {
  for (const overrides of [{ 0: { expectedAccount: identity().record.account } }, { 0: { store: { read: async () => null, compareAndSet: async () => false } } }]) {
    const f = pair(t, overrides);
    const results = await Promise.allSettled(f.sessions.map(s => s.ready));
    assert.ok(results.every(r => r.status === 'rejected')); assert.deepEqual(f.closed, [1, 1]);
  }
});
test('duplicate hello, unsolicited response, oversized and malformed frames fail closed', async t => {
  for (const frame of [null, { version: 1, kind: 'hello', account: identity().record.account },
    { version: 1, kind: 'response', id: 999, body: '{}' }, 'x'.repeat(AXON_FRAME_BYTES + 1)]) {
    const f = pair(t); await Promise.all(f.sessions.map(s => s.ready));
    f.transport.inject(0, frame); assert.deepEqual(f.closed, [1, 1]);
  }
});
test('unresponsive peers lose their axon after a renewal request times out', async t => {
  const f = pair(t); await Promise.all(f.sessions.map(s => s.ready));
  f.transport.blackhole(); f.advance(21_000); f.sessions[0].tick();
  await new Promise(r => setTimeout(r, 4200)); assert.deepEqual(f.closed, [1, 1]);
});
test('adapter cleanup exceptions do not retain authentication or skip close notification', async t => {
  const f = pair(t, { 0: { onClosed: () => { throw Error('observer'); } } });
  await Promise.all(f.sessions.map(s => s.ready));
  assert.doesNotThrow(() => f.sessions[0].stop());
  assert.equal(f.sessions[0].snapshot().state, 'closed');
  assert.equal(f.closed[1], 1);
});
test('concurrent identity pins accept only the exact durably stored record', async () => {
  const id = identity(), db = store();
  assert.deepEqual(await Promise.all([pinIdentityRecord(db, null, id.record), pinIdentityRecord(db, null, id.record)]), [true, true]);
  const conflict = { ...id.record, revision: 1 };
  assert.equal(await pinIdentityRecord(db, null, conflict), false);
  assert.equal(await pinIdentityRecord({ read: async () => null, compareAndSet: async () => false }, null, id.record), false);
  await assert.rejects(pinIdentityRecord({ read: async () => { throw Error('corrupt disk'); }, compareAndSet: async () => false }, null, id.record));
});

const { createLocalIdentityController } = load('localIdentityController');
const { createIdentityNetwork } = load('identityNetwork');
async function testMessagePair(t, transform, existing, received, normal = false) {
  const ids=existing??[await controller(),await controller()],bus=wires(), inbox=[[],[]];
  const sessions=await Promise.all(ids.map((id,i)=>{
    const wire=bus.wire(i),send=wire.send;
    wire.send=raw=>{const changed=transform?transform(raw,i):raw;if(changed!==null)send(changed);};
    const handler=message=>received?received(message,i):((inbox[i].push(message)),true);
    return id.createAxon(wire,store(),ids[1-i].status().account,()=>{},undefined,undefined,handler,undefined,normal?handler:undefined);
  }));
  t.after(()=>{sessions.forEach(s=>s.stop());if(!existing)ids.forEach(id=>id.lock());});
  await Promise.all(sessions.map(s=>s.ready));
  return {ids,bus,inbox,sessions};
}

test('encrypted test messages cross authenticated axons and return a receipt without plaintext on the wire',async t=>{
  const f=await testMessagePair(t),text='Axonic encrypted probe é 😀';
  assert.equal(await f.sessions[0].sendTestMessage(text),true);
  assert.equal(f.inbox[1][0].text,text);assert.equal(f.inbox[1][0].from,f.ids[0].status().account);
  assert.equal(await f.sessions[1].sendTestMessage('reply'),true);assert.equal(f.inbox[0][0].text,'reply');
  assert.ok(f.bus.history.flat().filter(x=>JSON.parse(x).kind==='test-message').every(raw=>!raw.includes(text)&&!raw.includes('reply')));
  assert.equal(await f.sessions[0].sendTestMessage('é'.repeat(1025)),false);
  f.ids[0].lock();assert.equal(await f.sessions[0].sendTestMessage('locked'),false);
});

test('tampered ciphertext and forged receipts fail closed without claiming delivery',async t=>{
  for(const kind of ['text','ack']){
    const f=await testMessagePair(t,(raw)=>{
      const frame=JSON.parse(raw);if(frame.kind!=='test-message')return raw;
      const packet=JSON.parse(frame.body);if(packet.kind!==kind)return raw;
      packet.ciphertext=(packet.ciphertext.startsWith('00')?'01':'00')+packet.ciphertext.slice(2);
      frame.body=JSON.stringify(packet);return JSON.stringify(frame);
    });
    assert.equal(await f.sessions[0].sendTestMessage('tamper probe'),false);
    assert.equal(f.inbox[1].length,kind==='text'?0:1);
    assert.ok(f.sessions.every(s=>s.snapshot().state==='closed'));
  }
});

test('test packets cannot be replayed on the same axon or another axon between the same identities',async t=>{
  const f=await testMessagePair(t);assert.equal(await f.sessions[0].sendTestMessage('replay probe'),true);
  const packet=f.bus.history[0].find(raw=>JSON.parse(raw).kind==='test-message');
  const other=await testMessagePair(t,undefined,f.ids);
  other.bus.inject(1,packet);await settle(()=>other.sessions[1].snapshot().state==='closed');assert.equal(other.inbox[1].length,0);
  f.bus.inject(1,packet);await settle(()=>f.sessions[1].snapshot().state==='closed');assert.equal(f.inbox[1].length,1);
});

test('unconfirmed test messages are bounded to one pending send and cancel on lock',async t=>{
  const f=await testMessagePair(t,raw=>{
    const frame=JSON.parse(raw);return frame.kind==='test-message'&&JSON.parse(frame.body).kind==='ack'?null:raw;
  });
  const pending=f.sessions[0].sendTestMessage('unconfirmed');
  assert.equal(await f.sessions[0].sendTestMessage('second pending'),false);
  await settle(()=>f.inbox[1].length===1);f.ids[0].lock();assert.equal(await pending,false);
});

test('old peers without test capability cannot receive test payloads',async t=>{
  const ids=[await controller(),await controller()],bus=wires();
  const sessions=await Promise.all(ids.map((id,i)=>id.createAxon(bus.wire(i),store(),ids[1-i].status().account,
    ()=>{},undefined,undefined,i===0?()=>true:undefined)));
  t.after(()=>ids.forEach(id=>id.lock()));await Promise.all(sessions.map(s=>s.ready));
  assert.equal(await sessions[0].sendTestMessage('unsupported'),false);
  assert.ok(sessions.every(s=>s.snapshot().state==='connected'));
});
async function controller(randomSource = async n => random(n), clock = () => now) {
  let vault = null, secret = null;
  // Fast deterministic KDF fixture only; production parameters are tested separately.
  const c = createLocalIdentityController({ readVault: async () => vault, readDeviceSecret: async () => secret,
    writeVault: async v => { vault = v; }, writeDeviceSecret: async v => { secret = v; } }, randomSource, clock,
    async (password, salt) => new Uint8Array(crypto.createHash('sha256').update(password).update(salt).digest()));
  const phrase = await c.beginCreate(); await c.confirmBackup(phrase, 'test fixture password'); return c;
}
test('controller-owned axons mutually authenticate and lock closes both immediately', async t => {
  const a = await controller(), b = await controller(), w = wires();
  t.after(() => { a.lock(); b.lock(); });
  const [one, two] = await Promise.all([a.createAxon(w.wire(0), store(), b.status().account), b.createAxon(w.wire(1), store(), a.status().account)]);
  await Promise.all([one.ready, two.ready]);
  a.lock(); assert.equal(one.snapshot().state, 'closed'); assert.equal(two.snapshot().state, 'closed');
  assert.equal(a.publicRecord(), null);
  await assert.rejects(a.createAxon(w.wire(0), store()), /unavailable/);
});
test('locking while socket randomness is pending closes the wire and prevents late startup', async () => {
  let release, blocked = false, closed = 0;
  const c = await controller(async n => { if (blocked) await new Promise(r => { release = r; }); return random(n); });
  blocked = true;
  const opening = c.createAxon({ send() { assert.fail('must not send after lock'); }, listen() { assert.fail('must not attach after lock'); }, close() { closed++; } }, store());
  c.lock(); assert.equal(closed, 1); release(); await assert.rejects(opening, /interrupted/); assert.equal(closed, 1);
});
function lifecycleIdentity() {
  const listeners = new Set(); let unlocked = true;
  return { status: () => ({ state: unlocked ? 'unlocked' : 'locked', account: 'axonic:1:' + 'ab'.repeat(32), busy: false }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    createAxon() { assert.fail('canceled transport must not enter identity controller'); },
    set(value) { unlocked = value; for (const fn of listeners) fn(); } };
}
test('network lock and unlock retain canceled dial reservations until the transport settles', async () => {
  const id = lifecycleIdentity(); let resolve, calls = 0, closed = 0;
  const network = createIdentityNetwork({ identity: id, store: store(), now: () => now, limit: 1,
    connect: async () => { calls++; return new Promise(r => { resolve = r; }); } });
  const candidate = { account: 'axonic:1:' + 'cd'.repeat(32), endpoint: 'test:peer', route: 'lan', expiresAt: now + 60000 };
  assert.equal(network.offer(candidate), true); network.tick(); assert.equal(calls, 1);
  id.set(false); id.set(true); network.tick(); assert.equal(network.snapshot().state, 'waiting');
  assert.equal(network.offer(candidate), false); assert.equal(calls, 1);
  resolve({ close() { closed++; } }); await settle(() => network.snapshot().pool.connections.length === 0);
  network.tick(); assert.equal(network.snapshot().state, 'active'); assert.equal(closed, 1);
  assert.equal(network.snapshot().pool.known, 0); network.stop();
});
test('network participation and disposal prevent dialing and discard discovered candidates', () => {
  const id = lifecycleIdentity(), network = createIdentityNetwork({ identity: id, store: store(), now: () => now,
    connect: async () => { assert.fail('paused runtime must not dial'); } });
  const candidate = { account: 'axonic:1:' + 'cd'.repeat(32), endpoint: 'test:peer', route: 'lan', expiresAt: now + 60000 };
  network.offer(candidate); network.setParticipation(false); network.tick();
  assert.equal(network.snapshot().state, 'paused'); assert.equal(network.offer(candidate), false);
  network.setParticipation(true); network.tick(); assert.equal(network.snapshot().pool.known, 0);
  network.stop(); id.set(false); id.set(true); network.tick(); assert.equal(network.snapshot().state, 'stopped');
});

const { createLanIdentityRuntime } = load('lanIdentityRuntime');
function lanBus() {
  let next = 0;
  const devices = [], sockets = new Map();
  function close(id) {
    const s = sockets.get(id); if (!s || s.closed) return;
    s.closed = true; s.reject?.(Error('closed')); s.reject = null;
    close(s.peer);
  }
  function device(host) {
    const d = { host, account: null, active: false, incoming: [], waiting: null, reads: 0, dials: 0 };
    devices.push(d);
    const api = {
      async axonLanStart(account) { d.account = account; d.active = true; },
      axonLanStop() {
        d.active = false; d.waiting?.reject(Error('stopped')); d.waiting = null;
        for (const [id, s] of sockets) if (s.owner === d) close(id);
      },
      axonLanSnapshot: () => ({ active: d.active, peers: devices.filter(p => p !== d && p.active)
        .map(p => ({ account: p.account, host: p.host, port: 9000 })) }),
      async axonConnect(host) {
        const remote = devices.find(p => p.host === host && p.active); assert.ok(remote); d.dials++;
        const a = String(++next), b = String(++next);
        sockets.set(a, { owner: d, peer: b, queue: [] });
        sockets.set(b, { owner: remote, peer: a, queue: [], first: true });
        return a;
      },
      async axonRead(id) {
        d.reads++; const s = sockets.get(id); if (s.closed) throw Error('closed');
        if (s.queue.length) return s.queue.shift();
        return new Promise((resolve, reject) => { s.resolve = resolve; s.reject = reject; });
      },
      async axonWrite(id, raw) {
        const local = sockets.get(id), remote = sockets.get(local.peer); if (local.closed || remote.closed) return false;
        if (remote.first) {
          remote.first = false;
          const incoming = { id: local.peer, account: JSON.parse(raw).account, host: d.host, hello: raw };
          if (remote.owner.waiting) { remote.owner.waiting.resolve(incoming); remote.owner.waiting = null; }
          else remote.owner.incoming.push(incoming);
        } else if (remote.resolve) { remote.resolve(raw); remote.resolve = null; remote.reject = null; }
        else remote.queue.push(raw);
        return true;
      },
      async axonAccept() {
        if (!d.active) throw Error('stopped');
        if (d.incoming.length) return d.incoming.shift();
        return new Promise((resolve, reject) => { d.waiting = { resolve, reject }; });
      },
      axonClaim(id) { assert.ok(!sockets.get(id).closed); },
      axonClose: close,
    };
    return { api, state: d };
  }
  return { device };
}
test('LAN discovery connects non-contact identities once, authenticates both directions and closes on lock', async t => {
  const a = await controller(), b = await controller(), bus = lanBus();
  const da = bus.device('192.168.1.20'), db = bus.device('192.168.1.21');
  const ra = createLanIdentityRuntime({ identity: a, native: da.api, store: store(), now: () => now });
  const rb = createLanIdentityRuntime({ identity: b, native: db.api, store: store(), now: () => now });
  t.after(() => { ra.stop(); rb.stop(); a.lock(); b.lock(); });
  ra.tick(); rb.tick(); await new Promise(r => setImmediate(r)); ra.tick(); rb.tick();
  const connected = r => r.snapshot().pool?.connections.filter(c => c.state === 'connected').length;
  await settle(() => connected(ra) === 1 && connected(rb) === 1);
  assert.equal(da.state.dials + db.state.dials, 1);
  assert.equal(ra.snapshot().pool.connections[0].account, b.status().account);
  assert.equal(rb.snapshot().pool.connections[0].account, a.status().account);
  const higher = a.status().account > b.status().account ? ra : rb;
  assert.equal(higher.snapshot().pool.known, 0, 'incoming addresses must not become dial candidates');
  a.lock(); await settle(() => connected(rb) === 0);
  assert.equal(ra.snapshot().state, 'locked'); assert.equal(da.state.active, false);
});
test('incoming sockets cannot exceed a pool occupied by an outgoing attempt', () => {
  const id = lifecycleIdentity(); let closed = 0;
  const runtime = createIdentityNetwork({ identity: id, store: store(), now: () => now, limit: 1,
    connect: () => new Promise(() => {}) });
  runtime.offer({ account: 'axonic:1:' + 'cd'.repeat(32), endpoint: 'test:peer', route: 'lan', expiresAt: now + 60000 }); runtime.tick();
  assert.equal(runtime.accept({ account: 'axonic:1:' + 'ef'.repeat(32), endpoint: 'accepted:test', route: 'lan', expiresAt: now + 60000 },
    { close() { closed++; } }), false);
  assert.equal(closed, 1); assert.equal(runtime.snapshot().pool.connections.length, 1); runtime.stop();
});

test('normal chat traverses the composed LAN runtime without enabling experimental messages',async t=>{
 const ids=[await controller(),await controller()],bus=lanBus(),inbox=[[],[]];
 const runtimes=ids.map((identity,i)=>createLanIdentityRuntime({identity,native:bus.device(`192.168.1.${30+i}`).api,store:store(),now:()=>now,
  onChatMessage:message=>{inbox[i].push(message);return true;}}));
 t.after(()=>{runtimes.forEach(r=>r.stop());ids.forEach(id=>id.lock());});
 runtimes.forEach(r=>r.tick());await new Promise(r=>setImmediate(r));runtimes.forEach(r=>r.tick());
 await settle(()=>runtimes.every(r=>r.snapshot().pool?.connections.some(c=>c.state==='connected')));
 const target=ids[1].status().account,id='af'.repeat(32);
 assert.equal(await runtimes[0].sendTestMessage(target,'test channel disabled'),false);
 assert.equal(await runtimes[0].sendChatMessage(target,'normal runtime payload',id),true);
 assert.deepEqual(inbox[1],[{from:ids[0].status().account,id,text:'normal runtime payload'}]);
 ids[0].lock();assert.equal(await runtimes[0].sendChatMessage(target,'after lock',id),false);
});

test('internet participation survives unavailable Wi-Fi and shares the global pool', async t => {
  const id = lifecycleIdentity(); let dialed = 0, canceled = 0;
  const runtime = createLanIdentityRuntime({ identity: id, store: store(), now: () => now,
    native: { axonLanStart: async () => { throw Error('No Wi-Fi'); }, axonLanStop() {},
      axonLanSnapshot: () => ({ active: false, peers: [] }) },
    internet: { peers: [{ account: 'axonic:1:' + 'cd'.repeat(32), endpoint: 'wss://test/v2/axon' }],
      connect: (_candidate, context) => { dialed++; return new Promise((resolve, reject) => {
        context.signal.addEventListener('abort', () => { canceled++; reject(Error('closed')); });
      }); } },
  });
  t.after(() => runtime.stop()); runtime.tick(); await new Promise(r => setImmediate(r)); runtime.tick();
  assert.equal(dialed, 1); assert.equal(canceled, 0);
  assert.equal(runtime.snapshot().pool.limit, 5);
  assert.equal(runtime.snapshot().pool.connections[0].route, 'internet');
  assert.match(runtime.snapshot().error, /Wi-Fi/);
  id.set(false); await new Promise(r => setImmediate(r)); assert.equal(canceled, 1);
  assert.equal(runtime.snapshot().state, 'locked');
});

const { createIntroductionService, verifyIntroductions, createIntroductionDirectory } = load('identityIntroductions');
const { signIdentityRequest } = load('identityAdmission');
function introductionFixture(options = {}) {
  const issuer = identity(), requester = identity(), third = identity(), instance = random(32), db = store();
  let clock = now, active = true;
  const peer = { account: requester.record.account, device: requester.record.devices[0].id,
    instance: random(32).toString(), expiresAt: now + 60000 };
  const source = { account: issuer.record.account, device: issuer.record.devices[0].id,
    instance: Buffer.from(instance).toString('hex'), expiresAt: now + 60000 };
  const list = [{ account: third.record.account, expiresAt: now + 90000 },
    { account: requester.record.account, expiresAt: now + 60000 },
    { account: issuer.record.account, expiresAt: now + 60000 },
    { account: third.record.account, expiresAt: now + 60000 }];
  const service = createIntroductionService({ ...issuer, instance, store: db, now: () => clock,
    current: () => active, peer: () => peer, list: () => list, ...options });
  const request = (who = requester, target = source) => JSON.stringify(signIdentityRequest(who.record, who.signingSeed,
    { account: target.account, instance: target.instance }, 'lookup', 'introductions-v1', random(32), clock));
  return { issuer, requester, third, source, peer, db, list, request, service,
    advance: ms => { clock += ms; }, lock: () => { active = false; }, now: () => clock };
}
test('introductions are signed, connection bound, ephemeral reports with no third-party pins', async () => {
  const f = introductionFixture(), q = f.request(), raw = await f.service(q);
  const peers = verifyIntroductions(raw, q, f.source, f.issuer.record, now);
  assert.deepEqual(peers, [{ account: f.third.record.account, expiresAt: now + 60000 }]);
  assert.equal(await f.db.read(f.third.record.account), null);
  assert.equal(verifyIntroductions(raw, f.request(), f.source, f.issuer.record, now), null);
  assert.equal(verifyIntroductions(raw, q, { ...f.source, instance: '00'.repeat(32) }, f.issuer.record, now), null);
  const changed = JSON.parse(raw); changed.peers[0].account = identity().record.account;
  assert.equal(verifyIntroductions(JSON.stringify(changed), q, f.source, f.issuer.record, now), null);
  assert.equal(verifyIntroductions(raw, q, f.source, f.issuer.record, now + 60001), null);
  f.advance(11000); assert.equal(await f.service(q), null);
});
test('introduction service rejects strangers, wrong sockets, floods, locks and pending lock races', async () => {
  for (const kind of ['stranger', 'socket', 'lock']) {
    const f = introductionFixture();
    const q = kind === 'stranger' ? f.request(identity()) : kind === 'socket'
      ? f.request(f.requester, { ...f.source, instance: '00'.repeat(32) }) : f.request();
    if (kind === 'lock') f.lock();
    assert.equal(await f.service(q), null);
  }
  const f = introductionFixture(); assert.ok(await f.service(f.request()));
  assert.equal(await f.service(f.request()), null);
  let release;
  const waiting = introductionFixture({ store: { read: () => new Promise(r => { release = r; }), compareAndSet: async () => true } });
  const result = waiting.service(waiting.request()); waiting.lock(); release(null);
  assert.equal(await result, null);
});
test('introduction batches and directory remain bounded, replace rather than accumulate, and clear by source', async () => {
  const f = introductionFixture();
  f.list.splice(0, f.list.length, ...Array.from({ length: 20 }, () => ({ account: identity().record.account, expiresAt: now + 60000 })));
  const q = f.request(), peers = verifyIntroductions(await f.service(q), q, f.source, f.issuer.record, now);
  assert.equal(peers.length, 8);
  const directory = createIntroductionDirectory(f.now);
  const sources = Array.from({ length: 9 }, () => identity().record.account);
  for (const source of sources) directory.replace(source, peers);
  assert.equal(directory.snapshot().length, 64);
  directory.replace(sources[0], [peers[0]]); assert.equal(directory.snapshot().length, 57);
  directory.remove(sources[0]); assert.equal(directory.snapshot().length, 56);
  directory.replace(sources[1], Array(9).fill(peers[0])); assert.equal(directory.snapshot().length, 56);
  directory.replace(sources[1], [{ ...peers[0], expiresAt: now + 60001 }]); assert.equal(directory.snapshot().length, 56);
  f.advance(60001); assert.deepEqual(directory.snapshot(), []);
  directory.replace(sources[0], [{ ...peers[0], expiresAt: f.now() + 10000 }]); directory.clear();
  assert.deepEqual(directory.snapshot(), []);
});
test('negotiated introductions coexist with renewed authentication on the same axon', async t => {
  const third = identity(), reports = [null, null];
  const hooks = i => ({ list: () => [{ account: third.record.account, expiresAt: now + 60000 }], received: p => { reports[i] = p; } });
  const f = pair(t, { 0: { introductions: hooks(0) }, 1: { introductions: hooks(1) } });
  const links = await Promise.all(f.sessions.map(s => s.ready));
  f.advance(6000); f.sessions.forEach(s => s.tick());
  await settle(() => reports.every(Boolean));
  assert.ok(reports.every(p => p[0].account === third.record.account));
  f.advance(15000); f.sessions.forEach(s => s.tick());
  await settle(() => links.every(l => l.peer.expiresAt > now + 60000));
  assert.deepEqual(f.closed, [0, 0]);
});
test('older peers without introduction capability continue authenticating without new operations', async t => {
  const f = pair(t, { 0: { introductions: { list: () => [], received: () => assert.fail('unexpected report') } } });
  await Promise.all(f.sessions.map(s => s.ready));
  f.advance(6000); f.sessions.forEach(s => s.tick());
  await new Promise(r => setTimeout(r, 20));
  assert.equal(f.transport.history.flat().some(raw => JSON.parse(raw).operation === 'introductions'), false);
  assert.deepEqual(f.closed, [0, 0]);
});

const { signAxonSignal, verifyAxonSignal, createAxonSignaling } = load('axonSignaling');
test('signed signaling binds sender, target, session, SDP and expiry; relay only forwards online sender-owned frames', async () => {
  const a = identity(), b = identity(), relay = identity(), db = store(), session = Buffer.from(random(32)).toString('hex');
  const raw = signAxonSignal(a.record, a.signingSeed, [], b.record.account, session, 'offer', 'v=0\r\n', now);
  assert.equal(verifyAxonSignal(raw, now).record.account, a.record.account);
  assert.equal(verifyAxonSignal(raw, now + 30001), null);
  const altered = JSON.parse(raw); altered.target = relay.record.account;
  assert.equal(verifyAxonSignal(JSON.stringify(altered), now), null);
  const via = { account: a.record.account, device: a.record.devices[0].id, expiresAt: now + 60000, instance: '00'.repeat(32) };
  const forwarded = [], received = [];
  const router = createAxonSignaling({ account: relay.record.account, store: db, now: () => now, current: () => true,
    connected: id => [a.record.account,b.record.account].includes(id), send: (id, body) => { forwarded.push([id, body]); return true; }, receive: () => assert.fail('relay consumed offer') });
  assert.equal(await router.receive(raw, { ...via, account: b.record.account }), false);
  assert.equal(await router.receive(raw, via), true); assert.equal(await router.receive(raw, via), false);
  assert.deepEqual(forwarded, [[b.record.account,raw]]);
  const recipient = createAxonSignaling({ account: b.record.account, store: store(), now: () => now, current: () => true,
    connected: id => id === relay.record.account, send: () => assert.fail('recipient forwarded'), receive: (s, via) => received.push([s,via]) });
  assert.equal(await recipient.receive(raw, { ...via, account: relay.record.account }), true);
  assert.equal(received[0][0].record.account, a.record.account);
});
test('signaling cannot queue for offline peers, survive locks, accept oversized SDP or establish a third hop', async () => {
  const a = identity(), b = identity(), relay = identity(), session = Buffer.from(random(32)).toString('hex');
  assert.throws(() => signAxonSignal(a.record,a.signingSeed,[],b.record.account,session,'offer','v=0\r\n'+'x'.repeat(7000),now));
  const raw = signAxonSignal(a.record,a.signingSeed,[],b.record.account,session,'offer','v=0\r\n',now);
  const via = { account:a.record.account,device:a.record.devices[0].id,expiresAt:now+60000,instance:'00'.repeat(32) };
  for (const active of [true,false]) {
    const r = createAxonSignaling({ account:relay.record.account,store:store(),now:()=>now,current:()=>active,
      connected:id=>id===a.record.account,send:()=>assert.fail('offline forwarding'),receive:()=>assert.fail('unexpected receipt') });
    assert.equal(await r.receive(raw,via),false);
  }
});

const { createRtcAxonTransport, validAxonSdp } = load('rtcAxonTransport');
function rtcFixture() {
  const pcs = new Map(); let sequence = 0;
  class Events {
    listeners = new Map();
    addEventListener(type, fn) { const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list); }
    emit(type, value={}) { for(const fn of this.listeners.get(type)||[]) fn(value); }
  }
  class Channel extends Events {
    label='axonic-identity-v1';protocol='axonic-identity-v1';readyState='connecting';bufferedAmount=0;
    send(data) { queueMicrotask(()=>this.other.emit('message',{data})); }
    close() { if(this.readyState==='closed')return;this.readyState='closed';this.emit('close');this.other?.close(); }
  }
  const sdp = id => 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 '+Array(32).fill('AB').join(':')+'\r\na=x-test:'+id+'\r\n';
  class PC extends Events {
    id=++sequence;localDescription=null;iceGatheringState='complete';connectionState='new';
    constructor(){super();pcs.set(this.id,this);}
    createDataChannel(){this.channel=new Channel();return this.channel;}
    async createOffer(){return {type:'offer',sdp:sdp(this.id)};}
    async createAnswer(){return {type:'answer',sdp:sdp(this.id)};}
    async setLocalDescription(d){this.localDescription=d;}
    async setRemoteDescription(d){
      this.other=pcs.get(Number(/a=x-test:(\d+)/.exec(d.sdp)[1]));
      if(d.type==='offer') {this.channel=new Channel();this.channel.protocol='';this.emit('datachannel',{channel:this.channel});}
      else {this.channel.other=this.other.channel;this.other.channel.other=this.channel;
        this.channel.readyState=this.other.channel.readyState='open';this.channel.emit('open');this.other.channel.emit('open');}
    }
    close(){this.connectionState='closed';this.channel?.close();}
  }
  return { PC,sdp };
}

test('RTC rejects oversized, binary and empty frames and bounds the pre-listener queue', async t => {
  const ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
  for(const payload of ['x'.repeat(20001),'😀'.repeat(5001),new Uint8Array(2),'']) {
    const {PC}=rtcFixture();let pc;
    const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,random:async()=> 'ab'.repeat(32),
      createConnection:()=>pc=new PC(),sign:()=>'',send:()=>true,accept:()=>false});
    t.after(()=>transport.stop());
    const wire=await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
    let delivered=0,closed=0;wire.listen(()=>delivered++,()=>closed++);
    pc.channel.emit('message',{data:payload});
    assert.equal(delivered,0);assert.equal(closed,1);assert.deepEqual(transport.snapshot(),[]);
  }
  const {PC}=rtcFixture();let pc;
  const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,random:async()=> 'ab'.repeat(32),
    createConnection:()=>pc=new PC(),sign:()=>'',send:()=>true,accept:()=>false});
  t.after(()=>transport.stop());
  const wire=await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
  pc.channel.emit('message',{data:'😀'.repeat(5000)});pc.channel.emit('message',{data:'x'.repeat(20000)});
  assert.equal(transport.snapshot().length,1);
  pc.channel.emit('message',{data:'extra'});
  let received=0,closed=0;wire.listen(()=>received++,()=>closed++);
  assert.equal(received,0);assert.equal(closed,1);
  assert.equal(validAxonSdp('v=0\r\n'+'x'.repeat(7000)),false);
});
test('RTC data channels carry independent mutual identity authentication and close together on lock', async t => {
  const { PC } = rtcFixture(), ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
  const transports=[],sessions=[], wires=[];
  const attach=(i,wire)=>{wires[i]=wire;sessions[i]=createPersistentAxon({...ids[i],store:store(),instance:random(32),random:async n=>random(n),
    now:()=>now,current:()=>true,expectedAccount:ids[1-i].record.account,wire,onClosed(){}});};
  for(let i=0;i<2;i++)transports[i]=createRtcAxonTransport({account:()=>ids[i].record.account,now:()=>now,random:async()=>Buffer.from(random(32)).toString('hex'),
    createConnection:()=>new PC(),sign:(target,session,kind,sdp)=>JSON.stringify({target,session,kind,sdp,record:ids[i].record,expiresAt:now+30000}),
    send:(_via,raw)=>{queueMicrotask(()=>transports[1-i].receive(JSON.parse(raw),'relay'));return true;},
    accept:(_candidate,wire)=>{attach(i,wire);return true;}});
  t.after(()=>transports.forEach(x=>x.stop()));
  const abort=new AbortController();attach(0,await transports[0].connect({account:ids[1].record.account,endpoint:'rtc:relay'}, {signal:abort.signal,onClosed(){}}));
  await settle(()=>sessions.length===2);await Promise.all(sessions.map(s=>s.ready));
  assert.ok(sessions.every(s=>s.snapshot().state==='connected'));
  transports[0].stop();assert.ok(sessions.every(s=>s.snapshot().state==='closed'));
  assert.deepEqual(transports.map(t=>t.snapshot()),[[],[]]);
});
test('RTC refuses media/relay SDP, rejects pool admission before answering, and cancels pending randomness', async () => {
  const { PC,sdp }=rtcFixture();assert.equal(validAxonSdp(sdp(1)),true);
  assert.equal(validAxonSdp(sdp(1)+'m=audio 9 RTP/AVP 0\r\n'),false);
  assert.equal(validAxonSdp(sdp(1)+'a=candidate:1 1 UDP 1 1.1.1.1 123 typ relay\r\n'),false);
  const ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));let sends=0,release;
  const receiver=createRtcAxonTransport({account:()=>ids[1].record.account,now:()=>now,random:async()=>'',createConnection:()=>new PC(),
    sign:()=>'',send:()=>{sends++;return true;},accept:()=>false});
  receiver.receive({target:ids[1].record.account,record:ids[0].record,kind:'offer',session:'00'.repeat(32),sdp:sdp(1),expiresAt:now+30000},'relay');
  assert.equal(sends,0);assert.deepEqual(receiver.snapshot(),[]);
  const sender=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,random:()=>new Promise(r=>release=r),createConnection:()=>new PC(),sign:()=>'',send:()=>true,accept:()=>false});
  const promise=sender.connect({account:ids[1].record.account,endpoint:'rtc:relay'}, {signal:new AbortController().signal,onClosed(){}});
  sender.stop();release('00'.repeat(32));await assert.rejects(promise,/canceled/);
});

for (const mode of ['unavailable', 'stale', 'promotion']) test(`three composed runtimes authenticate RTC and clear on lock (LAN: ${mode})`, async t => {
  const staleLan = mode === 'stale';
  let clock=now;const make=()=>controller(undefined,()=>clock);const hubId=await make(), clients=[await make(),await make()], {PC}=rtcFixture();
  const hub=createIdentityNetwork({identity:hubId,store:store(),now:()=>clock,connect:async()=>{throw Error('Hub has no dial candidates');}});
  function pipe() {
    const handlers=[],closures=[],queue=[[],[]];let dead=false;
    return [0,1].map(i=>({
      send(raw){if(dead)throw Error('closed');queueMicrotask(()=>{if(dead)return;if(handlers[1-i])handlers[1-i](raw);else queue[1-i].push(raw);});},
      listen(message,close){handlers[i]=message;closures[i]=close;const q=queue[i];queue[i]=[];q.forEach(message);return()=>{handlers[i]=null;closures[i]=null;};},
      close(){if(dead)return;dead=true;closures.forEach(c=>c?.());},
    }));
  }
  let lanAttempts=0;
  const bus=lanBus(), devices=[bus.device('192.168.1.20'),bus.device('192.168.1.21')];
  let revealLan=false;
  const runtimes=clients.map((id,i)=>createLanIdentityRuntime({identity:id,store:store(),now:()=>clock,
    native:mode==='promotion'?{...devices[i].api,axonLanSnapshot:()=>({...devices[i].api.axonLanSnapshot(),
      peers:revealLan?devices[i].api.axonLanSnapshot().peers:[]})}:{axonLanStart:async()=>{if(!staleLan)throw Error('Wi-Fi discovery unavailable');},axonLanStop(){},
      axonAccept:()=>new Promise(()=>{}),
      axonConnect:async()=>{lanAttempts++;throw Error('Advertised LAN endpoint is no longer reachable');},
      axonLanSnapshot:()=>({active:staleLan,peers:staleLan?[{account:clients[1-i].status().account,host:'10.0.0.2',port:12345}]:[]})},
    internet:{peers:[{account:hubId.status().account,endpoint:'test:hub'}],connect:async()=>{
      const [client,server]=pipe();assert.equal(hub.accept({account:id.status().account,endpoint:'accepted:test',route:'internet',expiresAt:clock+60000},server),true);return client;}},
    rtc:{random:async()=>Buffer.from(random(32)).toString('hex'),createConnection:()=>new PC(),sign:(...args)=>id.signSignal(...args)},
  }));
  t.after(()=>{runtimes.forEach(r=>r.stop());hub.stop();clients.forEach(c=>c.lock());hubId.lock();});
  const connected=r=>r.snapshot().pool?.connections.filter(c=>c.state==='connected').length||0;
  const tick=()=>{hub.tick();runtimes.forEach(r=>r.tick());};tick();
  await settle(()=>runtimes.every(r=>connected(r)===1));
  clock+=6000;tick();await settle(()=>runtimes.every(r=>r.snapshot().introductions.length===1));
  clock+=3000;tick();await settle(()=>runtimes.every(r=>connected(r)===2));
  assert.ok(runtimes.every(r=>r.snapshot().rtc.length===1&&r.snapshot().rtc[0].open));
  assert.equal(lanAttempts,staleLan?1:0);
  if(mode==='promotion') {
    revealLan=true;tick();
    await settle(()=>runtimes.every(r=>r.snapshot().pool.connections.some(c=>c.route==='lan'&&c.state==='connected')));
    assert.ok(runtimes.every(r=>r.snapshot().rtc.length===0));
    assert.equal(devices.reduce((n,d)=>n+d.state.dials,0),1);
  }
  hub.stop();
  for(let n=0;n<4;n++){clock+=21000;tick();await new Promise(r=>setTimeout(r,35));assert.ok(runtimes.every(r=>connected(r)===1),JSON.stringify(runtimes.map(r=>r.snapshot())));}
  clients[0].lock();await settle(()=>runtimes[0].snapshot().rtc.length===0&&connected(runtimes[1])===0);
  assert.deepEqual(runtimes[0].snapshot().introductions,[]);
});


test('receipts wait for storage, duplicate logical IDs can be re-encrypted after reconnect, conflicting content fails',async t=>{
 const saved=new Map();let release;const commit=async message=>{const old=saved.get(message.id);if(old)return old===message.text;saved.set(message.id,message.text);return true;};
 const first=await testMessagePair(t,undefined,undefined,async m=>{await new Promise(r=>release=r);return commit(m);});
 const key='a1'.repeat(32);let finished=false;const pending=first.sessions[0].sendTestMessage('persist me',key).then(ok=>{finished=true;return ok;});
 await settle(()=>!!release);assert.equal(finished,false);assert.equal(saved.size,0);release();assert.equal(await pending,true);
 const retry=await testMessagePair(t,undefined,first.ids,commit);
 assert.equal(await retry.sessions[0].sendTestMessage('persist me',key),true);assert.equal(saved.size,1);
 assert.equal(await retry.sessions[0].sendTestMessage('conflicting text',key),false);assert.equal(saved.get(key),'persist me');
});
test('failed storage and lock during storage produce no successful receipt',async t=>{
 for(const failure of ['disk','lock']){
  let release;const f=await testMessagePair(t,undefined,undefined,async()=>{await new Promise(r=>release=r);if(failure==='disk')throw Error('disk full');return true;});
  const pending=f.sessions[0].sendTestMessage('commit failure probe');await settle(()=>!!release);
  if(failure==='lock')f.ids[1].lock();release();assert.equal(await pending,false);
 }
});
test('v1 volatile receipt capability is not accepted as v2 persistence',async t=>{
 const f=await testMessagePair(t,raw=>{const frame=JSON.parse(raw);if(frame.kind==='hello')frame.features=frame.features.map(x=>x==='test-messages-v2'?'test-messages-v1':x);return JSON.stringify(frame);});
 assert.equal(await f.sessions[0].sendTestMessage('must not send'),false);assert.equal(f.inbox[1].length,0);
});

test('normal chat negotiates independently and acknowledges only after durable storage',async t=>{
 let release,committed=false;
 const f=await testMessagePair(t,undefined,undefined,async()=>{await new Promise(r=>release=r);committed=true;return true;},true);
 let finished=false;const pending=f.sessions[0].sendChatMessage('normal durable payload','ab'.repeat(32)).then(ok=>{finished=true;return ok;});
 await settle(()=>!!release);assert.equal(finished,false);assert.equal(committed,false);
 release();assert.equal(await pending,true);assert.equal(committed,true);
 const packets=f.bus.history.flat().map(JSON.parse).filter(f=>f.kind==='chat-message');
 assert.equal(packets.length,2);assert.ok(packets.every(f=>!f.body.includes('normal durable payload')));
});

test('older test-only peers decline normal chat while retaining the experimental channel',async t=>{
 const f=await testMessagePair(t,raw=>{const frame=JSON.parse(raw);if(frame.kind==='hello')frame.features=frame.features.filter(x=>x!=='chat-text-v1');return JSON.stringify(frame);},undefined,undefined,true);
 assert.equal(await f.sessions[0].sendChatMessage('must not send','ac'.repeat(32)),false);
 assert.equal(f.bus.history.flat().some(raw=>JSON.parse(raw).kind==='chat-message'),false);
 assert.equal(await f.sessions[0].sendTestMessage('compatible probe'),true);
 assert.equal(f.inbox[1].length,1);
});

test('relabeling experimental or normal ciphertext cannot cross message domains',async t=>{
 for(const kind of ['test-message','chat-message']){
  const f=await testMessagePair(t,raw=>{const frame=JSON.parse(raw);if(frame.kind===kind)frame.kind=kind==='test-message'?'chat-message':'test-message';return JSON.stringify(frame);},undefined,undefined,true);
  const result=kind==='test-message'?await f.sessions[0].sendTestMessage('domain probe'):await f.sessions[0].sendChatMessage('domain probe','ad'.repeat(32));
  assert.equal(result,false);assert.equal(f.inbox[1].length,0);
  assert.equal(f.sessions[1].snapshot().state,'closed');
 }
});

test('normal storage failure or locking during persistence cannot acknowledge delivery',async t=>{
 for(const failure of ['disk','lock']){
  let release;const f=await testMessagePair(t,undefined,undefined,async()=>{await new Promise(r=>release=r);if(failure==='disk')throw Error('disk full');return true;},true);
  const pending=f.sessions[0].sendChatMessage('commit failure','ae'.repeat(32));await settle(()=>!!release);
  if(failure==='lock')f.ids[1].lock();release();assert.equal(await pending,false);
  assert.equal(f.bus.history[1].filter(raw=>JSON.parse(raw).kind==='chat-message').length,0);
 }
});

test('custody controller signs receipt only after own inbox commit and never after a lock race',async t=>{
 const a=await controller(),b=await controller();t.after(()=>{a.lock();b.lock();});
 const records=store();await records.compareAndSet(a.status().account,null,a.publicRecord());await records.compareAndSet(b.status().account,null,b.publicRecord());
 const e=await a.sealCustody(b.publicRecord(),b.publicRecord().devices[0].id,'ef'.repeat(32),'own durable custody probe');
 assert.equal(await b.receiveCustody(e,records,async()=>false),null);
 const receipt=await b.receiveCustody(e,records,async message=>{assert.equal(message.text,'own durable custody probe');return true;});
 assert.equal(await load('custodyProtocol').verifyCustody(receipt,records,now),true);
 let release;const pending=b.receiveCustody(e,records,()=>new Promise(r=>release=r));await settle(()=>!!release);b.lock();release(true);await assert.rejects(pending);
});
