const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
function load(file, mocks = {}) {
  const sandbox = { exports: {}, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, sandbox);
  return sandbox.exports;
}
const protocol = load('src/services/transports/mailboxProtocol.ts');
// Actual SQLite SQL/transactions, adapted to Expo's promise API. Each fixture has a fresh database.
function storage(filename = ':memory:') {
  const sql = new DatabaseSync(filename);
  const db = {
    execAsync: async text => sql.exec(text),
    runAsync: async (text, ...args) => sql.prepare(text).run(...args),
    getFirstAsync: async (text, ...args) => sql.prepare(text).get(...args) ?? null,
    getAllAsync: async (text, ...args) => sql.prepare(text).all(...args),
    async withExclusiveTransactionAsync(fn) {
      sql.exec('BEGIN IMMEDIATE');
      try { await fn(db); sql.exec('COMMIT'); } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { ...load('src/services/transports/mailboxStore.ts', { 'expo-sqlite': { openDatabaseAsync: async () => db }, './mailboxProtocol': protocol }), sql };
}
const keys = new Map([1, 2, 3, 4].map(user => [user, {
  encryption: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }),
  signing: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
}]));
const publicKeys = new Map([...keys].map(([user, k]) => [user, {
  encryption: k.encryption.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  signing: k.signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
}]));
const publicKey = value => crypto.createPublicKey({ key: Buffer.from(value, 'base64'), type: 'spki', format: 'der' });
// Real cryptographic operations; native OAEP MGF interoperability is covered by Kotlin tests.
const engine = {
  async seal(key, header, plaintext) {
    const secret = crypto.randomBytes(32), iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
    cipher.setAAD(Buffer.from(header));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { wrappedKey: crypto.publicEncrypt({ key: publicKey(key), oaepHash: 'sha256' }, secret).toString('base64'),
      iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') };
  },
  async open(owner, header, sealed) {
    const secret = crypto.privateDecrypt({ key: keys.get(owner).encryption.privateKey, oaepHash: 'sha256' }, Buffer.from(sealed.wrappedKey, 'base64'));
    const ciphertext = Buffer.from(sealed.ciphertext, 'base64');
    const cipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(sealed.iv, 'base64'));
    cipher.setAAD(Buffer.from(header)); cipher.setAuthTag(ciphertext.subarray(-16));
    return Buffer.concat([cipher.update(ciphertext.subarray(0, -16)), cipher.final()]).toString('utf8');
  },
  async sign(owner, value) { return crypto.sign('sha256', Buffer.from(value), keys.get(owner).signing.privateKey).toString('base64'); },
  async verify(key, value, signature) { return crypto.verify('sha256', Buffer.from(value), publicKey(key), Buffer.from(signature, 'base64')); },
  async digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); },
};
const id = '10000000-0000-4000-8000-000000000001';
const room = '20000000-0000-4000-8000-000000000001';
test('unpaired historical receipts cannot block current paired receipts', async () => {
  const old = { kind: 'receipt', id: 'old', sender: 99, recipient: 2 };
  const current = { kind: 'receipt', id: 'current', sender: 1, recipient: 2 };
  const sent = [];
  const node = protocol.createMailboxNode({ owner: 2, current: () => true, now: Date.now,
    identity: user => [1,2,3].includes(user) ? publicKeys.get(user) : null, crypto: engine,
    store: { list: async () => [old, current] }, persist: async () => true,
    send: async (peer, p) => { sent.push(p.id); return p.sender !== 99; } });
  assert.equal(await node.flush(3), 1);
  assert.deepEqual(sent, ['current']);
});
function network() {
  const stores = new Map(), nodes = new Map(), live = new Map(), inbox = new Map(), wires = [];
  let now = Date.now(), failPersistence = false, badQuota = false;
  const make = owner => {
    if (!stores.has(owner)) stores.set(owner, storage());
    live.set(owner, true);
    const node = protocol.createMailboxNode({ owner, current: () => live.get(owner), now: () => now,
      identity: user => publicKeys.get(user), crypto: engine,
      store: { ...stores.get(owner).mailboxStore, put: (...args) => badQuota ? Promise.resolve(false) : stores.get(owner).mailboxStore.put(...args) },
      async persist(e, plaintext) { if (failPersistence) return false; inbox.set(`${owner}:${e.id}`, plaintext); return true; },
      async send(peer, packet) { wires.push({ owner, peer, packet }); return live.get(peer) && nodes.get(peer).receive(owner, JSON.stringify(packet)); },
    }); nodes.set(owner, node); return node;
  };
  [1, 2, 3, 4].forEach(make);
  return { nodes, stores, wires, inbox, live, make, now: () => now, advance: ms => { now += ms; },
    failPersistence: () => { failPersistence = true; }, full: () => { badQuota = true; },
    create: () => nodes.get(1).create(id, room, 2, 'Only the recipient can read this 🌎'),
  };
}

test('current receipt can reply while a historical flush is blocked', async () => {
 let release;const pending=new Promise(r=>release=r),sent=[];
 const receipt={kind:'receipt',id:'new',sender:1,recipient:2};
 const node=protocol.createMailboxNode({owner:2,current:()=>true,now:Date.now,identity:u=>publicKeys.get(u),crypto:engine,
   store:{list:async()=>[{...receipt,id:'old'}],get:async()=>receipt},persist:async()=>true,
   send:async(peer,p)=>{sent.push(p.id);if(p.id==='old')await pending;return true;}});
 const flushing=node.flush(1);await Promise.resolve();await Promise.resolve();
 assert.equal(await node.reply('new',1),true);assert.deepEqual(sent,['old','new']);release();await flushing;
});

test('offline recipient retrieves ciphertext from a restarted custodian and sender requires recipient signature', async () => {
  const f = network(); const envelope = await f.create(); assert.ok(envelope);
  f.live.set(2, false);
  assert.equal(await f.nodes.get(1).deposit(id, 3), true);
  assert.equal(await f.nodes.get(1).status(id), 'pending');
  assert.equal(await f.nodes.get(3).flush(2), 0);
  assert.equal(f.inbox.size, 0);
  assert.equal(f.stores.get(3).sql.prepare('SELECT wire FROM packets').get().wire.includes('Only the recipient'), false);
  await assert.rejects(engine.open(3, protocol.envelopeHeader(envelope), envelope));
  f.make(3); // Process state replaced; durable SQLite data survives.
  f.live.set(2, true);
  assert.equal(await f.nodes.get(3).flush(2), 1);
  assert.equal(f.inbox.get(`2:${id}`), 'Only the recipient can read this 🌎');
  assert.equal(await f.nodes.get(1).status(id), 'pending');
  assert.equal(await f.nodes.get(2).flush(3), 1);
  assert.equal(await f.nodes.get(3).flush(1), 1);
  assert.equal(await f.nodes.get(1).status(id), 'delivered');
  assert.equal(await f.nodes.get(3).flush(2), 0, 'stop forwarding after recipient receipt');
  assert.equal(f.wires.some(w => JSON.stringify(w.packet).includes('Only the recipient')), false);
});

test('forged receipt and modified routing, body, expiry or recipient are rejected', async () => {
  const f = network(); const e = await f.create();
  for (const patch of [{ recipient: 4 }, { roomId: crypto.randomUUID() }, { sender: 3 },
    { ciphertext: e.ciphertext.replace(/^./, e.ciphertext[0] === 'A' ? 'B' : 'A') }, { expiresAt: e.expiresAt - 1 }]) {
    assert.equal(await f.nodes.get(3).receive(1, JSON.stringify({ ...e, ...patch })), false);
  }
  const receipt = { kind: 'receipt', version: 1, id, sender: 1, recipient: 2, expiresAt: e.expiresAt,
    envelopeDigest: await engine.digest(protocol.signedBody(e)), signature: '' };
  receipt.signature = await engine.sign(3, protocol.signedBody(receipt));
  assert.equal(await f.nodes.get(1).receive(3, JSON.stringify(receipt)), false);
  assert.equal(await f.nodes.get(1).status(id), 'pending');
});

test('fourth device cannot read recipient ciphertext or route it through another custodian', async () => {
  const f = network(); const e = await f.create();
  await assert.rejects(engine.open(4, protocol.envelopeHeader(e), e));
  assert.equal(await f.nodes.get(3).receive(4, JSON.stringify(e)), false);
  assert.equal(await f.nodes.get(3).receive(999, JSON.stringify(e)), false);
});

test('duplicate delivery is idempotent; expired messages are removed; collisions cannot overwrite', async () => {
  const f = network(); const e = await f.create();
  assert.equal(await f.nodes.get(1).deposit(id, 3), true);
  assert.equal(await f.nodes.get(1).deposit(id, 3), true);
  await f.nodes.get(3).flush(2); await f.nodes.get(3).flush(2);
  assert.equal(f.inbox.size, 1);
  assert.equal(f.stores.get(3).sql.prepare('SELECT COUNT(*) AS n FROM packets').get().n, 1);
  const collision = { ...e, ciphertext: 'AAAA' };
  collision.signature = await engine.sign(1, protocol.signedBody(collision));
  assert.equal(await f.nodes.get(3).receive(1, JSON.stringify(collision)), false);
  f.advance(protocol.MAILBOX_TTL + 1);
  assert.equal(await f.nodes.get(3).receive(1, JSON.stringify(e)), false);
  assert.equal((await f.stores.get(3).mailboxStore.list(3, f.now())).length, 0);
});

test('no receipt after chat persistence failure, full storage or account teardown', async () => {
  for (const failure of ['failPersistence', 'full']) {
    const f = network(); const e = await f.create(); f[failure]();
    assert.equal(await f.nodes.get(2).receive(1, JSON.stringify(e)), false);
    assert.equal(await f.stores.get(2).mailboxStore.get(2, 'receipt', id, f.now()), null);
  }
  const f = network(); const e = await f.create(); f.live.set(2, false);
  assert.equal(await f.nodes.get(2).receive(1, JSON.stringify(e)), false);
  assert.equal(f.inbox.size, 0);
});

test('SQLite quota reserves receipt space, isolates accounts and immutable pins reject replacement', async () => {
  const f = network(); const e = await f.create(); const s = f.stores.get(3);
  for (let i = 0; i < 100; i++) assert.equal(await s.mailboxStore.put(3, { ...e, id: crypto.randomUUID() }, f.now()), true);
  assert.equal(await s.mailboxStore.put(3, e, f.now()), false);
  assert.equal(await s.mailboxStore.put(4, e, f.now()), true);
  assert.equal(await s.mailboxStore.get(3, 'envelope', id, f.now()), null);
  const receipt = { kind: 'receipt', version: 1, id, sender: 1, recipient: 2, expiresAt: e.expiresAt,
    envelopeDigest: 'a'.repeat(64), signature: e.signature };
  assert.equal(await s.mailboxStore.put(3, receipt, f.now()), true);
  const pin = { user: 1, ...publicKeys.get(1) };
  await s.pinMailboxIdentities(3, [pin]); await s.pinMailboxIdentities(3, [pin]);
  await assert.rejects(s.pinMailboxIdentities(3, [{ ...pin, ...publicKeys.get(2) }]), /identity changed/);
});

test('malformed, excessive and expired packets fail before cryptography or storage', () => {
  for (const raw of ['null', '[]', '1', '{', '{}', 'x'.repeat(10001)]) assert.equal(protocol.parseMailboxPacket(raw, Date.now()), null);
});

test('ciphertext survives closing and reopening an on-disk SQLite mailbox', async () => {
  const path = require('node:path'), os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'axonic-mailbox-test-'));
  const filename = path.join(directory, 'mailbox.db');
  let first, second;
  try {
    const f = network(); const envelope = await f.create();
    first = storage(filename);
    assert.equal(await first.mailboxStore.put(3, envelope, f.now()), true);
    first.sql.close(); first = null;
    second = storage(filename);
    const recovered = await second.mailboxStore.get(3, 'envelope', id, f.now());
    assert.equal(protocol.signedBody(recovered), protocol.signedBody(envelope));
    assert.equal(JSON.stringify(recovered).includes('Only the recipient'), false);
  } finally {
    first?.sql.close(); second?.sql.close();
    // This directory is created exclusively for this test, never a computed repository path.
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('even a valid recipient signature cannot confirm a different envelope', async () => {
  const f = network(); const e = await f.create();
  const receipt = { kind: 'receipt', version: 1, id, sender: 1, recipient: 2, expiresAt: e.expiresAt,
    envelopeDigest: 'f'.repeat(64), signature: '' };
  receipt.signature = await engine.sign(2, protocol.signedBody(receipt));
  assert.equal(await f.nodes.get(1).receive(2, JSON.stringify(receipt)), false);
  assert.equal(await f.nodes.get(1).status(id), 'pending');
});

test('outgoing bindings retain custody, isolate accounts and reject changed message digests', async () => {
  const s = storage(), now = Date.now();
  await s.bindMailboxOutgoing(22, id, 'original-digest', now + 60000);
  await s.markMailboxCustody(22, id);
  assert.equal((await s.getMailboxOutgoing(22, id, now)).custody, 1);
  assert.equal(await s.getMailboxOutgoing(14, id, now), null);
  await assert.rejects(s.bindMailboxOutgoing(22, id, 'changed-digest', now + 60000), /identity collision/);
  assert.equal(await s.getMailboxOutgoing(22, id, now + 60001), null);
});
