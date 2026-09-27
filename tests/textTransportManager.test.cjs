const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextTransportManager } = require('../src/services/transports/textTransportManager.ts');
const message = Object.freeze({ id: 'original-id', roomId: 'room', content: 'Hello', createdAt: 'now' });

test('mailbox custody follows direct failure and avoids server handoff without claiming delivery', async () => {
  const calls = [];
  const manager = createTextTransportManager({ send: () => assert.fail('server copy') },
    async () => { calls.push('direct'); return null; }, async m => {
      assert.equal(m, message); calls.push('mailbox'); return { peerId: 14, delivered: false };
    });
  assert.deepEqual(await manager.send(message), { sent: true, transport: 'mailbox', peerId: 14, delivered: false });
  assert.deepEqual(calls, ['direct', 'mailbox']);
});
test('unavailable mailbox falls back once, but account changes cancel fallback', async () => {
  let sent = 0, valid = true;
  const manager = createTextTransportManager({ send: () => { sent++; return true; } }, async () => null, async () => null);
  assert.equal((await manager.send(message)).transport, 'axion'); assert.equal(sent, 1);
  const stale = createTextTransportManager({ send: () => assert.fail('stale account') }, async () => null,
    async () => { valid = false; return { peerId: 14, delivered: false }; });
  assert.equal((await stale.send(message, undefined, () => valid)).sent, false);
});

test('missing capability, failed connection and lost peer receipt each fall back once with the original identity', async () => {
  for (const direct of [undefined, async () => null, async () => { throw Error('connection failed'); }]) {
    const sent = [];
    const manager = createTextTransportManager({ send: (value) => { sent.push(value); return true; } }, direct);
    assert.deepEqual(await manager.send(message), { sent: true, transport: 'axion' });
    assert.equal(sent.length, 1); assert.equal(sent[0], message);
  }
});

test('peer-confirmed storage skips legacy submission', async () => {
  const manager = createTextTransportManager({ send: () => assert.fail('duplicate legacy send') }, async () => 14);
  assert.deepEqual(await manager.send(message), { sent: true, transport: 'p2p', peerId: 14 });
});

test('a connection or account change during the attempt prevents fallback', async () => {
  let valid = true;
  const manager = createTextTransportManager({ send: () => assert.fail('wrong session') }, async () => { valid = false; return null; });
  assert.equal((await manager.send(message, undefined, () => valid)).sent, false);
});
