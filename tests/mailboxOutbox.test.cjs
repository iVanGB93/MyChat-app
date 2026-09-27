const test = require('node:test'), assert = require('node:assert/strict');
const { createMailboxOutbox } = require('../src/services/transports/mailboxOutbox.ts');
const crypto = require('node:crypto');
const message = { id: 'message', roomId: 'room', content: 'Original content', createdAt: '2026-09-27T20:00:00.000Z' };
function fixture() {
  let current = true, row = { ...message }, envelope = null, binding = null, status = 'pending', accepted = true;
  const calls = [], stored = [];
  const digest = async s => crypto.createHash('sha256').update(s).digest('hex');
  const deps = { owner: 22, current: () => current, now: () => Date.parse(message.createdAt),
    read: async () => row, peer: async () => ({ id: 14 }), custodians: () => [14,27], digest,
    binding: async () => binding, bind: async (_id, digest) => { binding = { digest, custody: 0 }; },
    custody: async () => { binding.custody = 1; },
    delivered: async m => { stored.push(m); return true; },
    store: { get: async () => envelope, list: async () => envelope ? [envelope] : [] },
    node: { create: async (id, roomId, recipient, text, createdAt) => {
      calls.push({ kind: 'create', id, createdAt });
      return envelope = { kind: 'envelope', sender: 22, id, roomId, recipient, createdAt, expiresAt: createdAt + 86400000 };
    }, status: async () => status, deposit: async (id, peer) => { calls.push({ kind: 'deposit', id, peer }); return accepted; } },
  };
  const adapter = createMailboxOutbox(deps);
  return { adapter, calls, stored, deps, restart: () => createMailboxOutbox(deps),
    change: patch => { row = { ...row, ...patch }; }, remove: () => { row = null; },
    stop: () => { current = false; }, delivered: () => { status = 'delivered'; }, fail: () => { accepted = false; } };
}
test('regular outgoing message retains original identity/timestamp and custody is not delivery', async () => {
  const f = fixture();
  assert.deepEqual(await f.adapter.attempt(message), { peerId: 14, delivered: false });
  assert.deepEqual(f.calls, [{ kind: 'create', id: message.id, createdAt: Date.parse(message.createdAt) }, { kind: 'deposit', id: message.id, peer: 27 }]);
  assert.equal(f.stored.length, 0);
});
test('durable custody survives adapter restart and suppresses server-bound hydration without re-encrypting', async () => {
  const f = fixture(); await f.adapter.attempt(message);
  assert.deepEqual(await f.restart().attempt(message, { hydration: true, targetRecipientId: 14 }), { peerId: 14, delivered: false });
  assert.equal(f.calls.length, 2);
});
test('only signed-recipient status confirms the normal outgoing row, including restart reconciliation', async () => {
  const f = fixture(); await f.adapter.attempt(message); await f.adapter.reconcile(); assert.equal(f.stored.length, 0);
  f.delivered(); await f.restart().reconcile(); assert.equal(f.stored.length, 1);
  assert.deepEqual(f.stored[0], message);
});
test('changed/deleted outgoing rows and wrong recipients cannot reuse an envelope or apply late receipts', async () => {
  for (const action of ['edit','delete','stop']) {
    const f = fixture(); await f.adapter.attempt(message); f.delivered();
    if(action==='edit')f.change({content:'New content'}); else if(action==='delete')f.remove(); else f.stop();
    await f.adapter.reconcile(); assert.equal(f.stored.length, 0);
    assert.equal(await f.adapter.attempt(message), null);
  }
  const f = fixture(); assert.equal(await f.adapter.attempt(message, {expectedRecipientIds:[14,18]}),null);
  assert.equal(await f.adapter.attempt(message,{hydration:true,targetRecipientId:18}),null);assert.equal(f.calls.length,0);
});
test('unsupported text features and fresh hydration bypass mailbox; failed custody permits fallback', async () => {
  const f = fixture();
  assert.equal(await f.adapter.attempt({...message,replyTo:{id:'x'}}),null);
  assert.equal(await f.adapter.attempt(message,{hydration:true,targetRecipientId:14}),null);
  f.fail(); assert.equal(await f.adapter.attempt(message),null);assert.equal(f.stored.length,0);
});
test('account teardown during encryption cannot bind or deposit into the next account', async () => {
  const f = fixture();const create=f.deps.node.create;
  f.deps.node.create=async(...args)=>{const e=await create(...args);f.stop();return e;};
  assert.equal(await f.adapter.attempt(message),null);assert.equal(f.calls.length,1);
});

test('neuron-enabled outbox tries the recipient before custodians and waits for its signed receipt', async () => {
 const f=fixture();f.deps.preferDirect=true;
 assert.deepEqual(await f.adapter.attempt(message),{peerId:14,delivered:false});
 assert.deepEqual(f.calls.filter(c=>c.kind==='deposit').map(c=>c.peer),[14]);
 f.delivered();await f.adapter.reconcile();assert.equal(f.stored.length,1);
});

test('unreachable direct recipient falls back to a custodian', async () => {
 const f=fixture();f.deps.preferDirect=true;const original=f.deps.node.deposit;
 f.deps.node.deposit=async(id,peer)=>{await original(id,peer);return peer===27;};
 assert.deepEqual(await f.adapter.attempt(message),{peerId:14,delivered:false});
 assert.deepEqual(f.calls.filter(c=>c.kind==='deposit').map(c=>c.peer),[14,27]);
});
