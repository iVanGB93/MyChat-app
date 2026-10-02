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

test('normal neuron custody stays pending when the migration server is unavailable', async () => {
  const calls=[];
  const manager=createTextTransportManager({send:()=>{calls.push('axion');return false;}},
    async()=>{calls.push('direct');return null;},async()=>assert.fail('legacy mailbox'),
    async m=>{assert.equal(m,message);calls.push('neuron');return {peerId:14,delivered:false};});
  assert.deepEqual(await manager.send(message),{sent:true,transport:'neuron',peerId:14,delivered:false});
  assert.deepEqual(calls,['direct','neuron','axion']);
});

test('held normal custody uses the same message for wake-capable fallback but direct receipts skip it',async()=>{
 for(const delivered of [false,true]){
  const sent=[];
  const manager=createTextTransportManager({send:m=>{sent.push(m);return true;}},undefined,undefined,async()=>({peerId:14,delivered}));
  assert.equal((await manager.send(message)).transport,delivered?'neuron':'axion');
  assert.deepEqual(sent,delivered?[]:[message]);
 }
 const offline=createTextTransportManager({send:()=>{throw Error('offline');}},undefined,undefined,async()=>({peerId:14,delivered:false}));
 assert.deepEqual(await offline.send(message),{sent:true,transport:'neuron',peerId:14,delivered:false});
});

test('unavailable normal neuron falls back once and an account change cancels further delivery', async () => {
  let sent=0,current=true;
  const manager=createTextTransportManager({send:()=>{sent++;return true;}},undefined,undefined,async()=>{throw Error('No route');});
  assert.equal((await manager.send(message)).transport,'axion');assert.equal(sent,1);
  const stale=createTextTransportManager({send:()=>assert.fail('stale send')},undefined,undefined,async()=>{current=false;return {peerId:14,delivered:false};});
  assert.equal((await stale.send(message,undefined,()=>current)).sent,false);
});

test('normal neuron bridge drops late results and ignores stale cleanup from a prior registration', async () => {
  const bridge=require('../src/services/transports/neuronTextBridge.ts');let release;
  assert.equal(await bridge.tryNeuronText(message),null);
  const handler=()=>new Promise(r=>release=r),old=bridge.registerNeuronTextAttempt(handler);
  const pending=bridge.tryNeuronText(message),next=bridge.registerNeuronTextAttempt(handler);old();
  release({peerId:14,delivered:true});assert.equal(await pending,null);
  next();assert.equal(await bridge.tryNeuronText(message),null);
});
