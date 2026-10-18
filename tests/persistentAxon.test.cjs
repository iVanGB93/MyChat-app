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
function wires(media = [false,false], latency = 0) {
  let dead = false, drop = false, paused=false;const held=[];
  const listeners = [], closed = [], history = [[], []];
  const wire = i => ({
    mediaLane:!!media[i],
    bulkAttachments:media[i]==='bulk',
    smallAttachmentBatches:['small','small4'].includes(media[i]),
    smallAttachmentWindow:media[i]==='small4'?4:undefined,
    listen(message, close) { listeners[i] = message; closed[i] = close; return () => { listeners[i] = null; closed[i] = null; }; },
    send(raw) { if (dead) throw Error('closed'); history[i].push(raw); const deliver=()=>{if(!dead&&!drop){if(paused)held.push([1-i,raw]);else listeners[1-i]?.(raw);}};if(latency)setTimeout(deliver,latency);else queueMicrotask(deliver); },
    close() { if (dead) return; dead = true; for (const close of closed) close?.(); },
  });
  return { wire, history,pause:()=>{paused=true;},resume:()=>{paused=false;for(const [i,raw] of held.splice(0))if(!dead)listeners[i]?.(raw);}, inject: (i, frame) => listeners[i]?.(typeof frame === 'string' ? frame : JSON.stringify(frame)), blackhole: () => { drop = true; } };
}
function pair(t, overrides = {}, media = [false,false], latency = 0, factory = createPersistentAxon) {
  const transport = wires(media,latency), identities = [identity(), identity()];
  let clock = now, active = true; const closed = [0, 0];
  const sessions = identities.map((id, i) => factory({ ...id, instance: random(32), store: store(),
    expectedAccount: identities[1-i].record.account, wire: transport.wire(i), now: () => clock,
    current: () => active, random: async n => random(n), onClosed: () => { closed[i]++; }, ...overrides[i] }));
  t.after(() => sessions.forEach(s => s.stop()));
  return { transport, identities, sessions, closed, advance: ms => { clock += ms; }, lock: () => { active = false; } };
}
async function settle(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  assert.fail('condition did not settle');
}

test('stream promotion capability is mutually negotiated and only exposed after authentication',async t=>{
 const handler=Object.assign(async()=>'{"status":"unavailable"}',{streams:true});
 const f=pair(t,{0:{onAttachment:handler,onSignal:async()=>true},1:{onAttachment:handler,onSignal:async()=>true}});
 assert.equal(f.sessions[0].attachmentStreamPeer(),null);
 await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<2;i++){assert.equal(f.sessions[i].attachmentStreamPeer().account,f.identities[1-i].record.account);assert.equal(JSON.parse(f.transport.history[i][0]).attachmentStreams,1);}
 f.lock();assert.equal(f.sessions[0].attachmentStreamPeer(),null);
});
for(const legacy of ['no-stream','no-signaling'])test(`stream promotion stays unavailable for ${legacy} peers`,async t=>{
 const handler=Object.assign(async()=>'{"status":"unavailable"}',{streams:true});
 const f=pair(t,{0:{onAttachment:handler,onSignal:async()=>true},1:{onAttachment:legacy==='no-stream'?async()=>'{"status":"unavailable"}':handler,...(legacy==='no-signaling'?{}:{onSignal:async()=>true})}});
 await Promise.all(f.sessions.map(s=>s.ready));assert.equal(f.sessions[0].attachmentStreamPeer(),null);assert.equal(f.sessions[1].attachmentStreamPeer(),null);
 assert.equal(JSON.parse(f.transport.history[1][0]).attachmentStreams,undefined);
});
test('a push client can register with a gateway without advertising itself as a gateway',async t=>{
 const f=pair(t,{0:{onPush:Object.assign(async()=>'{"status":"unsupported"}',{gateway:false})},1:{onPush:async()=>'{"status":"registered"}'}});
 await Promise.all(f.sessions.map(s=>s.ready));
 assert.equal(f.sessions[0].supportsPush(),true);assert.equal(f.sessions[1].supportsPush(),false);
 assert.equal(JSON.parse(await f.sessions[0].pushRequest('{"operation":"register"}')).status,'registered');
 assert.equal(f.sessions[0].snapshot().state,'connected');
});

for(const mode of ['success','lock','deadline','count-limit','byte-limit'])test(`early custody traffic waits for authentication with bounded lifetime (${mode})`,async t=>{
 let release,held=false,delayRead=false,index=0,handled=0;
 const gate=new Promise(r=>release=r);t.after(()=>release());
 const f=pair(t,{0:{onCustody:async()=>{handled++;return 'ok';}},1:{onCustody:async()=> 'ok'}},[false,false],0,d=>{
  if(index++!==0)return createPersistentAxon(d);
  const base=d.store,wire=d.wire;
  return createPersistentAxon({...d,store:{...base,read:async id=>{if(delayRead&&!held){held=true;await gate;}return base.read(id);}},
   wire:{...wire,listen(message,closed){return wire.listen(raw=>{const frame=JSON.parse(raw);if(frame.kind==='response'&&frame.id===2)delayRead=true;message(raw);},closed);}}});
 });
 await f.sessions[1].ready;await settle(()=>held);
 assert.equal(f.sessions[0].snapshot().state,'authenticating');
 const request=f.sessions[1].custodyRequest('poll');await new Promise(r=>setImmediate(r));
 assert.equal(handled,0);assert.equal(f.sessions[0].snapshot().state,'authenticating');
 if(mode!=='success'){
  if(mode==='lock'){f.lock();f.sessions[0].tick();}
  if(mode==='deadline'){f.advance(10001);f.sessions[0].tick();}
  if(mode==='count-limit'||mode==='byte-limit')for(let i=0;i<4;i++)f.transport.inject(0,{version:1,kind:'request',id:10+i,operation:'custody',body:mode==='byte-limit'?'x'.repeat(15000):'poll'});
  assert.equal(f.sessions[0].snapshot().state,'closed');release();await assert.rejects(f.sessions[0].ready);await request;
  await new Promise(r=>setImmediate(r));assert.equal(handled,0);return;
 }
 release();await f.sessions[0].ready;assert.equal(await request,'ok');assert.equal(handled,1);
 assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
});

test('delayed peer discovery waits a full interval after completion before retrying',async t=>{
 let release,held=false,index=0,received=0;
 const hooks={list:()=>[],received:()=>{received++;}};
 const f=pair(t,{0:{introductions:hooks,onAttachment:async()=> 'ok'},1:{introductions:hooks,onAttachment:async()=> 'ok'}},[true,true],0,d=>{
  if(index++!==0)return createPersistentAxon(d);const wire=d.wire;
  return createPersistentAxon({...d,wire:{...wire,send(raw){const frame=JSON.parse(raw);if(!held&&frame.kind==='request'&&frame.operation==='introductions'){held=true;release=()=>wire.send(raw);}else wire.send(raw);}}});
 });
 await Promise.all(f.sessions.map(s=>s.ready));f.advance(5000);
 await f.sessions[1].attachmentRequest('probe'); // Shared media permits the bounded15s control grace.
 f.sessions[0].tick();await settle(()=>held);
 f.advance(12000);release();await settle(()=>received===1);
 f.advance(3000);f.sessions[0].tick();await new Promise(r=>setImmediate(r));
 const requests=()=>f.transport.history[0].map(JSON.parse).filter(x=>x.operation==='introductions').length;
 assert.equal(requests(),1);f.advance(12000);f.sessions[0].tick();await settle(()=>received===2);
 assert.equal(requests(),2);assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
});

for(const outcome of ['late-response','deadline'])test(`discovery started before media has bounded grace (${outcome})`,async t=>{
 let release,held=false,index=0,received=0;
 const hooks={list:()=>[],received:()=>{received++;}};
 const f=pair(t,{0:{introductions:hooks,onAttachment:async()=> 'ok'},1:{introductions:hooks,onAttachment:async()=> 'ok'}},[true,true],0,d=>{
  if(index++!==0)return createPersistentAxon(d);const wire=d.wire;
  return createPersistentAxon({...d,wire:{...wire,send(raw){const frame=JSON.parse(raw);if(!held&&frame.kind==='request'&&frame.operation==='introductions'){held=true;release=()=>wire.send(raw);}else wire.send(raw);}}});
 });
 await Promise.all(f.sessions.map(s=>s.ready));f.advance(5000);
 f.sessions[0].tick();await settle(()=>held);
 // Discovery began while idle; a media response then shares its channel.
 await f.sessions[1].attachmentRequest('probe');
 f.advance(4001);f.sessions[0].tick();
 assert.equal(f.sessions[0].snapshot().state,'connected');
 if(outcome==='late-response'){
  release();await settle(()=>received===1);
  assert.equal(await f.sessions[1].attachmentRequest('after-discovery'),'ok');
  assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
 }else{
  f.advance(11000);f.sessions[0].tick();
  assert.equal(f.sessions[0].snapshot().closeReason,'exchange-timeout:introductions');
  assert.throws(release,/closed/);await new Promise(r=>setImmediate(r));assert.equal(received,0);
 }
});

test('bidirectional background control traffic survives repeated minute windows', async t => {
  const hooks = {onCustody:async()=> 'ok', onDirectory:async()=> 'ok', onCallRelay:async()=> 'ok'};
  const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
  // 120 ordinary request/response frames per side each minute, plus renewal.
  // The former 64-frame ceiling disconnected this otherwise idle pair.
  for(let second=0;second<180;second++){
    f.advance(1000);f.sessions.forEach(s=>s.tick());
    for(const s of f.sessions)assert.equal(await s.custodyRequest('poll'),'ok');
    assert(f.sessions.every(s=>s.snapshot().state==='connected'));
  }
});

test('authenticated control flood still closes at the bounded budget',async t=>{
  const f=pair(t,{0:{onDirectory:async()=> 'ok'},1:{onDirectory:async()=> 'ok'}});
  await Promise.all(f.sessions.map(s=>s.ready));
  for(let i=0;i<260&&f.sessions[0].snapshot().state==='connected';i++)await f.sessions[0].directoryRequest('poll');
  assert(f.sessions.some(s=>s.snapshot().closeReason==='control-rate-limit'));
});

test('native-driven ticks release queued exchanges and enforce deadlines without waiting for JS timers',async t=>{
 let release,count=0;const gate=new Promise(r=>release=r);
 const f=pair(t,{0:{onPush:async()=>null},1:{onPush:async()=>{if(++count===1)await gate;return 'registered';}}});
 await Promise.all(f.sessions.map(s=>s.ready));
 const first=f.sessions[0].pushRequest('first');await settle(()=>count===1);
 const second=f.sessions[0].pushRequest('second');release();assert.equal(await first,'registered');
 f.advance(30);f.sessions[0].tick();assert.equal(await second,'registered');
 f.transport.blackhole();const unanswered=f.sessions[0].pushRequest('third');
 await Promise.resolve();f.advance(4001);f.sessions[0].tick();assert.equal(await unanswered,null);
 assert.equal(f.sessions[0].snapshot().state,'closed');
});

test('push registration waits for occupied request capacity without exceeding it',async t=>{
 let release;const gate=new Promise(r=>release=r);let count=0;
 const f=pair(t,{0:{onPush:async()=>null},1:{onPush:async()=>{if(++count===1)await gate;return 'registered';}}});
 await Promise.all(f.sessions.map(s=>s.ready));
 const a=f.sessions[0].pushRequest('first'),b=f.sessions[0].pushRequest('second');
 await settle(()=>count===1);
 const c=f.sessions[0].pushRequest('third');setTimeout(release,40);
 assert.deepEqual(await Promise.all([a,b,c]),['registered','registered','registered']);
});
test('negotiated call control returns a verified durable receipt and tolerates safe rejection', async t => {
  const calls=load('callControlProtocol'), receipts=load('callControlDelivery'), durable=load('durableCallControl');
  let f, saved=null, receiver;
  const journal={read:async()=>saved,compareAndSet:async(o,id,before,after)=>{if(saved!==before)return false;saved=after;return true;}};
  f=pair(t,{0:{onCallControl:async()=>null},1:{onCallControl:async(raw,peer)=>receiver.receive(raw,peer)}});
  await Promise.all(f.sessions.map(s=>s.ready));
  const [a,b]=f.identities, id='ca'.repeat(32);
  const state=durable.createDurableRecipientCallControl(journal,b.record.account,id,b.record.devices[0].id);
  receiver=receipts.createCallControlDelivery({account:b.record.account,device:b.record.devices[0].id,
    records:{read:async account=>f.identities.find(x=>x.record.account===account)?.record??null},
    current:()=>true,now:()=>now,blocked:()=>false,
    commit:async(raw,latest,time)=>(JSON.parse(raw).kind==='invite'?await state.begin(raw,latest,time):await state.receive(raw,latest,time))||await state.hasStoredEvent(raw,latest,time),
    signReceipt:async(event,time)=>receipts.signCallControlReceipt(event,b.record,b.signingSeed,time)});
  const raw=calls.signCallControl({record:a.record,callId:id,caller:a.record.account,callee:b.record.account,
    callerDevice:a.record.devices[0].id,media:'voice',kind:'invite',invitation:null,sequence:0,issuedAt:now,expiresAt:now+60000},a.signingSeed,now);
  assert.equal(f.sessions[0].supportsCallControl(),true);
  assert.ok(await f.sessions[0].callControlRequest(raw));
  assert.ok(await f.sessions[0].callControlRequest(raw));
  assert.equal(JSON.parse(saved).entries.length,1);
  receiver={receive:async()=>null};
  assert.equal(await f.sessions[0].callControlRequest(raw),null);
  receiver={receive:async()=>JSON.stringify({status:'ok'})};
  assert.equal(await f.sessions[0].callControlRequest(raw),null);
  assert.deepEqual(f.closed,[0,0]);
});
test('call control has bounded priority over queued recovery and push, without starving either',async t=>{
 const calls=load('callControlProtocol'),receipts=load('callControlDelivery');
 let release,entered=false,f;const gate=new Promise(r=>release=r);t.after(()=>release());
 const order=[];
 f=pair(t,{0:{onCallControl:async()=>null,onCustody:async()=>null,onPush:async()=>null},1:{
  onCustody:async raw=>{order.push(raw);if(raw==='held'){entered=true;await gate;}return 'stored';},
  onPush:async()=>{order.push('push');return 'registered';},
  onCallControl:async raw=>{order.push('call');const b=f.identities[1];return receipts.signCallControlReceipt(JSON.parse(raw),b.record,b.signingSeed,now);}
 }});
 await Promise.all(f.sessions.map(s=>s.ready));const [a,b]=f.identities;
 const raw=calls.signCallControl({record:a.record,callId:'ca'.repeat(32),caller:a.record.account,callee:b.record.account,
  callerDevice:a.record.devices[0].id,media:'voice',kind:'invite',invitation:null,sequence:0,issuedAt:now,expiresAt:now+60000},a.signingSeed,now);
 const held=f.sessions[0].custodyRequest('held');await settle(()=>entered);
 const recovery=f.sessions[0].custodyRequest('recovery'),push=f.sessions[0].pushRequest('registration');
 const one=f.sessions[0].callControlRequest(raw),two=f.sessions[0].callControlRequest(raw);
 assert.equal(await f.sessions[0].callControlRequest(raw),null,'urgent reservations remain capped');
 release();const results=await Promise.all([held,recovery,push,one,two]);
 assert.deepEqual(results.slice(0,3),['stored','stored','registered']);assert(results[3]);assert(results[4]);
 assert.deepEqual(order.slice(0,3),['held','call','call']);assert(order.includes('push'));assert(order.includes('recovery'));
 assert.deepEqual(f.closed,[0,0]);
});

test('legacy peers do not advertise or receive call-control requests',async t=>{
  const f=pair(t,{0:{onCallControl:async()=>null}});
  await Promise.all(f.sessions.map(s=>s.ready));
  assert.equal(f.sessions[0].supportsCallControl(),false);
  assert.equal(await f.sessions[0].callControlRequest('{}'),null);
  assert.equal(f.transport.history[0].some(raw=>JSON.parse(raw).operation==='call-control'),false);
  assert.deepEqual(f.closed,[0,0]);
});

test('v2 call peers carry bounded signed media bound to the exact live axon instances',async t=>{
  const media=load('callMediaProtocol');let f,received=0;
  f=pair(t,{0:{onCallControl:async()=>null,onCallMedia:async()=>false},
    1:{onCallControl:async()=>null,onCallMedia:async(raw,peer,instance)=>{
      const e=media.verifyCallMediaSignal(raw,f.identities[0].record,now);
      if(e&&e.sourceInstance===peer.instance&&e.targetInstance===instance){received++;return true;}return false;
    }}});
  await Promise.all(f.sessions.map(s=>s.ready));
  const context=f.sessions[0].mediaContext(),a=f.identities[0],b=f.identities[1];
  const fields={record:a.record,callId:'ab'.repeat(32),invitation:'cd'.repeat(32),acceptance:'ef'.repeat(32),
    target:b.record.account,targetDevice:b.record.devices[0].id,sourceInstance:context.instance,targetInstance:context.peer.instance,
    sequence:1,issuedAt:now,expiresAt:now+30000,kind:'offer',data:{type:'offer',sdp:'v=0'}};
  assert.equal(await f.sessions[0].callMediaRequest(media.signCallMediaSignal(fields,a.signingSeed,now)),true);
  assert.equal(received,1);
  assert.equal(await f.sessions[0].callMediaRequest(media.signCallMediaSignal({...fields,targetInstance:'ff'.repeat(32)},a.signingSeed,now)),false);
  f.lock();assert.equal(f.sessions[0].mediaContext(),null);
  assert.equal(await f.sessions[0].callMediaRequest(media.signCallMediaSignal(fields,a.signingSeed,now)),false);
});

test('v1 call peers never receive v2 media frames',async t=>{
  const f=pair(t,{0:{onCallControl:async()=>null,onCallMedia:async()=>false},1:{onCallControl:async()=>null}});
  await Promise.all(f.sessions.map(s=>s.ready));
  assert.equal(f.sessions[0].mediaContext(),null);
  assert.equal(await f.sessions[0].callMediaRequest('{}'),false);
  assert.equal(f.transport.history[0].some(raw=>JSON.parse(raw).operation==='call-media'),false);
});
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
  await new Promise(r=>setImmediate(r));f.advance(15001);f.sessions[0].tick();assert.deepEqual(f.closed,[1,1]);
});

test('authenticated renewal survives a five-second transport pause without extending an expired proof',async t=>{
 const f=pair(t);await Promise.all(f.sessions.map(s=>s.ready));const old=f.sessions[0].snapshot().expiresAt;
 f.transport.pause();f.advance(21000);f.sessions[0].tick();await new Promise(r=>setImmediate(r));
 f.advance(5001);f.sessions[0].tick();assert.equal(f.sessions[0].snapshot().state,'connected');
 f.transport.resume();await settle(()=>f.sessions[0].snapshot().expiresAt>old);assert.equal(f.sessions[0].snapshot().state,'connected');
 const g=pair(t);await Promise.all(g.sessions.map(s=>s.ready));g.transport.blackhole();g.advance(59000);g.sessions[0].tick();await new Promise(r=>setImmediate(r));g.advance(1001);g.sessions[0].tick();assert.equal(g.sessions[0].snapshot().state,'closed');
});

test('control traffic sharing a recently active media lane tolerates a bounded stall',async t=>{
 const hooks={onAttachment:async()=> 'media',onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 await f.sessions[0].attachmentRequest('{}');f.transport.pause();const request=f.sessions[0].custodyRequest('{}');
 await new Promise(r=>setImmediate(r));f.advance(5001);f.sessions[0].tick();assert.equal(f.sessions[0].snapshot().state,'connected');
 f.transport.resume();assert.equal(await request,'control');
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
test('foreground resume retries deferred LAN without letting discovery refresh bypass backoff', async t => {
  const ids = [await controller(), await controller()].sort((a,b)=>a.status().account.localeCompare(b.status().account));
  const bus=lanBus(),devices=ids.map((_,i)=>bus.device(`192.168.1.${80+i}`));
  let attempts=0;
  const dial=devices[0].api.axonConnect;
  devices[0].api.axonConnect=async host=>{if(++attempts===1)throw Error('Lifecycle socket closed');return dial(host);};
  const runtimes=ids.map((identity,i)=>createLanIdentityRuntime({identity,native:devices[i].api,store:store(),now:()=>now,rtc:{}}));
  t.after(()=>{runtimes.forEach(r=>r.stop());ids.forEach(id=>id.lock());});
  runtimes.forEach(r=>r.tick());await new Promise(r=>setImmediate(r));runtimes.forEach(r=>r.tick());
  await settle(()=>attempts===1);await new Promise(r=>setImmediate(r));
  for(let i=0;i<5;i++){runtimes.forEach(r=>r.tick());await new Promise(r=>setImmediate(r));}
  assert.equal(attempts,1);
  runtimes[0].resume();runtimes.forEach(r=>r.tick());
  await settle(()=>runtimes.every(r=>r.snapshot().pool?.connections.some(c=>c.state==='connected'&&c.route==='lan')));
  assert.equal(attempts,2);
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
test('RTC stream is pinned to authenticated device and closes independently of chat',async t=>{
 const {PC}=rtcFixture(),ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 const transports=[],sessions=[];let receivedLane,observed;
 const attach=(i,wire)=>{sessions[i]=createPersistentAxon({...ids[i],store:store(),instance:random(32),random:async n=>random(n),now:()=>now,current:()=>true,
  expectedAccount:ids[1-i].record.account,wire,onAttachment:async()=>null,onClosed(){}});};
 for(let i=0;i<2;i++)transports[i]=createRtcAxonTransport({account:()=>ids[i].record.account,now:()=>now,random:async()=>Buffer.from(random(32)).toString('hex'),
  authenticated:()=>{},streamCredit:async()=>true,createConnection:()=>new PC(),
  sign:(target,session,kind,sdp)=>JSON.stringify({target,session,kind,sdp,device:ids[i].record.devices[0].id,record:ids[i].record,expiresAt:now+30000}),
  send:(_via,raw)=>{queueMicrotask(()=>transports[1-i].receive(JSON.parse(raw),'relay'));return true;},accept:(_candidate,wire)=>{attach(i,wire);return true;}});
 t.after(()=>transports.forEach(x=>x.stop()));
 assert.equal(transports[0].canStream(ids[1].record.account,ids[1].record.devices[0].id),false);
 attach(0,await transports[0].connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}}));
 await settle(()=>sessions.length===2);await Promise.all(sessions.map(s=>s.ready));
 assert.equal(transports[0].canStream(ids[1].record.account,'wrong-device'),false);
 transports[1].listenStreams((account,device,lane)=>{assert.equal(account,ids[0].record.account);assert.equal(device,ids[0].record.devices[0].id);receivedLane=lane;lane.listen(data=>observed=data,()=>{});return true;});
 const lane=transports[0].openStream(ids[1].record.account,ids[1].record.devices[0].id);lane.listen(()=>{},()=>{});await lane.ready();
 assert.equal(transports[0].canStream(ids[1].record.account,ids[1].record.devices[0].id),false,'one lane per RTC peer');
 lane.send(new Uint8Array([1,2,3]));await settle(()=>observed);assert.deepEqual(observed,new Uint8Array([1,2,3]));
 lane.close();assert.equal(receivedLane.live(),false);assert(sessions.every(s=>s.snapshot().state==='connected'));
 assert.equal(transports[0].canStream(ids[1].record.account,ids[1].record.devices[0].id),true);
});
test('RTC path diagnostics expose only selected route metrics, never addresses or IDs',()=>{
 const {rtcPathSummary}=load('rtcAxonTransport');
 const reports=new Map([
  ['transport',{type:'transport',selectedCandidatePairId:'pair'}],
  ['pair',{type:'candidate-pair',state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote',bytesSent:42,bytesReceived:24,currentRoundTripTime:0.02,requestsSent:Infinity,responsesReceived:-1}],
  ['local',{candidateType:'host',protocol:'udp',address:'private-address',port:123}],
  ['remote',{candidateType:'srflx',address:'public-address',usernameFragment:'secret'}]
 ]);
 const summary=JSON.parse(JSON.stringify(rtcPathSummary(reports)));
 assert.deepEqual(summary,{selected:true,state:'succeeded',localType:'host',remoteType:'srflx',protocol:'udp',roundTripSeconds:0.02,bytesSent:42,bytesReceived:24});
 reports.delete('transport');assert.deepEqual(rtcPathSummary(reports),{selected:false});
 reports.get('pair').selected=true;reports.get('local').protocol='private-address';
 assert.equal(rtcPathSummary(reports).protocol,undefined);
 assert.equal(rtcPathSummary(reports).selected,true);
});
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
    remoteDescriptions=[];
    id=++sequence;localDescription=null;iceGatheringState='complete';connectionState='new';
    constructor(){super();pcs.set(this.id,this);}
    createDataChannel(label='axonic-identity-v1'){
      if(label==='axonic-stream-v1'&&this.other){const local=new Channel(),remote=new Channel();local.label=remote.label=label;local.protocol=remote.protocol=label;
       local.other=remote;remote.other=local;queueMicrotask(()=>{local.readyState=remote.readyState='open';this.other.emit('datachannel',{channel:remote});local.emit('open');remote.emit('open');});return local;}
      this.channel=new Channel();return this.channel;}
    async createOffer(options){this.offerOptions=options;return {type:'offer',sdp:sdp(this.id)};}
    async createAnswer(){return {type:'answer',sdp:sdp(this.id)};}
    async setLocalDescription(d){this.localDescription=d;}
    async setRemoteDescription(d){
      this.remoteDescriptions.push(d);
      this.other=pcs.get(Number(/a=x-test:(\d+)/.exec(d.sdp)[1]));
      if(d.type==='offer') {if(!this.channel){this.channel=new Channel();this.channel.protocol='';this.emit('datachannel',{channel:this.channel});}}
      else {this.channel.other=this.other.channel;this.other.channel.other=this.channel;
        this.channel.readyState=this.other.channel.readyState='open';this.channel.emit('open');this.other.channel.emit('open');}
    }
    close(){this.connectionState='closed';this.channel?.close();}
  }
  return { PC,sdp };
}

test('RTC diagnostics bound concurrent sampling and discard results after closure',async t=>{
 const ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 const {PC}=rtcFixture();let pc,clock=now,calls=0,resolveStats;
 const logs=[];t.mock.method(console,'info',(...args)=>logs.push(args));
 const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>clock,random:async()=> 'ab'.repeat(32),createConnection:()=>{
  pc=new PC();pc.getStats=()=>{calls++;return new Promise(resolve=>resolveStats=resolve);};return pc;
 },sign:()=>'',send:()=>true,accept:()=>false});
 t.after(()=>transport.stop());
 await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
 pc.connectionState='connected';pc.emit('connectionstatechange');pc.emit('connectionstatechange');assert.equal(calls,1);
 resolveStats(new Map());await new Promise(resolve=>setImmediate(resolve));
 pc.emit('connectionstatechange');assert.equal(calls,1);clock+=1000;
 pc.emit('connectionstatechange');assert.equal(calls,2);transport.stop();resolveStats(new Map());
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(logs.filter(args=>args[0]==='[Axonic RTC path]').length,1);
});

test('RTC tolerates a transient ICE disconnection but bounds recovery and closes on failure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 for(const hardFailure of [false,true]){
  const {PC}=rtcFixture();let pc;
  const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,random:async()=> 'ab'.repeat(32),createConnection:()=>pc=new PC(),sign:()=>'',send:()=>true,accept:()=>false});
  t.after(()=>transport.stop());const wire=await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
  let closed=0;wire.listen(()=>{},()=>closed++);pc.channel.readyState='open';pc.channel.emit('open');
  const state=s=>{pc.connectionState=s;pc.emit('connectionstatechange');};
  state('disconnected');t.mock.timers.tick(7999);assert.equal(closed,0);
  state('connected');t.mock.timers.tick(2);assert.equal(closed,0);
  state('disconnected');
  if(hardFailure)state('failed');else{t.mock.timers.tick(4000);state('connecting');state('disconnected');t.mock.timers.tick(4000);}
  assert.equal(closed,1);assert.deepEqual(transport.snapshot(),[]);t.mock.timers.tick(10000);assert.equal(closed,1);
 }
});

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
  const transports=[],sessions=[], wires=[], admitted=[0,0];
  const attach=(i,wire)=>{wires[i]=wire;sessions[i]=createPersistentAxon({...ids[i],store:store(),instance:random(32),random:async n=>random(n),
    now:()=>now,current:()=>true,expectedAccount:ids[1-i].record.account,wire,onAttachment:async()=>null,onClosed(){}});};
  for(let i=0;i<2;i++)transports[i]=createRtcAxonTransport({account:()=>ids[i].record.account,now:()=>now,random:async()=>Buffer.from(random(32)).toString('hex'),
    mediaLane:true,authenticated:()=>{assert.equal(sessions[i].snapshot().state,'connected');admitted[i]++;},
    createConnection:()=>new PC(),sign:(target,session,kind,sdp)=>JSON.stringify({target,session,kind,sdp,record:ids[i].record,expiresAt:now+30000}),
    send:(_via,raw)=>{queueMicrotask(()=>transports[1-i].receive(JSON.parse(raw),'relay'));return true;},
    accept:(_candidate,wire)=>{attach(i,wire);return true;}});
  t.after(()=>transports.forEach(x=>x.stop()));
  const abort=new AbortController();attach(0,await transports[0].connect({account:ids[1].record.account,endpoint:'rtc:relay'}, {signal:abort.signal,onClosed(){}}));
  await settle(()=>sessions.length===2);await Promise.all(sessions.map(s=>s.ready));
  assert.ok(sessions.every(s=>s.snapshot().state==='connected'));
  assert.deepEqual(admitted,[1,1]);
  assert(sessions.every(s=>s.supportsAttachmentBulk()&&s.attachmentBatchChunks()===3&&s.attachmentBatchWindow()===2));
  transports[0].stop();assert.ok(sessions.every(s=>s.snapshot().state==='closed'));
  assert.deepEqual(transports.map(t=>t.snapshot()),[[],[]]);
});
test('RTC recovery binds fresh signed negotiation to the existing device, session and certificate',async t=>{
 const {PC}=rtcFixture(),ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 const transports=[],pcs=[],wires=[],packets=[];let automatic=true;
 for(let i=0;i<2;i++)transports[i]=createRtcAxonTransport({account:()=>ids[i].record.account,now:()=>now,
  random:async()=>Buffer.from(random(32)).toString('hex'),authenticated:()=>{},createConnection:()=>pcs[i]=new PC(),
  sign:(...args)=>signAxonSignal(ids[i].record,ids[i].signingSeed,[],...args,now),
  send:(_via,raw)=>{const signal=verifyAxonSignal(raw,now);assert.ok(signal);packets.push({i,signal});if(automatic)queueMicrotask(()=>transports[1-i].receive(signal,'relay'));return true;},
  accept:(_candidate,wire)=>{wires[i]=wire;return true;}});
 t.after(()=>transports.forEach(x=>x.stop()));
 wires[0]=await transports[0].connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
 await settle(()=>packets.length===2&&pcs[0].channel.readyState==='open');wires.forEach(w=>w.enableAttachments());
 const original=packets[0].signal.session,channels=pcs.map(p=>p.channel);automatic=false;
 pcs[0].connectionState='disconnected';pcs[0].emit('connectionstatechange');
 await settle(()=>packets.length===3);const offer=packets[2].signal;
 assert.notEqual(offer.session,original);assert.match(offer.sdp,new RegExp('a=x-axonic-restart:'+original));
 assert.deepEqual(pcs[0].offerOptions,{iceRestart:true});
 for(const bad of [{...offer,device:'bad'}, {...offer,sdp:offer.sdp.replace(/AB:/g,'CD:')}, {...offer,sdp:offer.sdp.replace(original,'00'.repeat(32))}])transports[1].receive(bad,'relay');
 transports[1].receive(offer,'wrong-relay');await new Promise(r=>setImmediate(r));assert.equal(packets.length,3);
 transports[1].receive(offer,'relay');await settle(()=>packets.length===4);const answer=packets[3].signal;
  transports[0].receive(packets[1].signal,'relay'); // stale initial answer cannot answer the restart
  transports[0].receive({...answer,device:'bad'},'relay');
  assert.equal(pcs[0].remoteDescriptions.length,1);
  transports[0].receive(answer,'relay');await new Promise(r=>setImmediate(r));
  assert.equal(pcs[0].remoteDescriptions.length,2);assert.equal(pcs[1].remoteDescriptions.length,2);
 assert.deepEqual(pcs.map(p=>p.channel),channels);assert.ok(transports.every(x=>x.snapshot()[0].open));
 const received=[];wires[1].listen(raw=>received.push(raw),()=>{});wires[0].send('after restart');await new Promise(r=>setImmediate(r));assert.deepEqual(received,['after restart']);
 pcs[0].connectionState='connected';pcs[0].emit('connectionstatechange');pcs[0].connectionState='disconnected';pcs[0].emit('connectionstatechange');
 transports[1].receive({...offer,session:'ee'.repeat(32)},'relay');await new Promise(r=>setImmediate(r));assert.equal(packets.length,4);
});

test('RTC restart cannot outlive closure or extend the existing disconnect deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {PC,sdp}=rtcFixture(),ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 let pc,release,calls=0,sends=0;
 const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,
  authenticated:()=>{},random:()=>++calls===1?Promise.resolve('ab'.repeat(32)):new Promise(r=>release=r),
  createConnection:()=>{pc=new PC();pc.setRemoteDescription=async()=>{};return pc;},sign:()=>'',send:()=>{sends++;return true;},accept:()=>false});
 t.after(()=>transport.stop());
 const wire=await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
 await new Promise(r=>setImmediate(r));pc.channel.readyState='open';pc.channel.emit('open');wire.enableAttachments();
 transport.receive({target:ids[0].record.account,record:ids[1].record,device:ids[1].record.devices[0].id,kind:'answer',session:'ab'.repeat(32),sdp:sdp(1),expiresAt:now+30000},'relay');
 await new Promise(r=>setImmediate(r));pc.connectionState='disconnected';pc.emit('connectionstatechange');assert.equal(calls,2);
 t.mock.timers.tick(8000);assert.deepEqual(transport.snapshot(),[]);release('cd'.repeat(32));await new Promise(r=>setImmediate(r));assert.equal(sends,1);
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

test('normal message waiting for group metadata withholds ACK without closing the axon',async t=>{
 let ready=false,attempts=0;
 const f=await testMessagePair(t,undefined,undefined,async()=>{attempts++;return ready;},true);
 const id='bc'.repeat(32),pending=f.sessions[0].sendChatMessage('group waiting for membership',id);
 await settle(()=>attempts===1);
 assert.equal(f.sessions[1].snapshot().state,'connected');
 assert.equal(f.bus.history[1].filter(raw=>JSON.parse(raw).kind==='chat-message').length,0);
 assert.equal(await pending,false);ready=true;
 assert.equal(await f.sessions[0].sendChatMessage('group waiting for membership',id),true);
 assert.equal(f.sessions[1].snapshot().state,'connected');
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

test('call relay is negotiated independently without changing legacy feature slots',async t=>{
 let seen=null;
 const f=pair(t,{1:{onCallRelay:async(raw,peer)=>{seen={raw,peer};return JSON.stringify({accepted:true});}}});
 await Promise.all(f.sessions.map(s=>s.ready));
 assert.equal(f.sessions[0].relayPeer().account,f.identities[1].record.account);
 const raw=JSON.stringify({version:1,operation:'pending'});
 assert.deepEqual(JSON.parse(await f.sessions[0].callRelayRequest(raw)),{accepted:true});
 assert.equal(seen.raw,raw);assert.equal(seen.peer.account,f.identities[0].record.account);
 assert.equal(f.sessions[1].relayPeer(),null);
 assert.equal(await f.sessions[1].callRelayRequest(raw),null);
 assert.equal(await f.sessions[0].callRelayRequest('x'.repeat(13001)),null);
 assert.deepEqual(f.closed,[0,0]);
});
test('call relay refuses old peers and a session locked while awaiting a response',async t=>{
 const old=pair(t);await Promise.all(old.sessions.map(s=>s.ready));
 assert.equal(await old.sessions[0].callRelayRequest('{}'),null);
 let release;
 const f=pair(t,{1:{onCallRelay:()=>new Promise(r=>release=r)}});
 await Promise.all(f.sessions.map(s=>s.ready));
 const pending=f.sessions[0].callRelayRequest('{}');await settle(()=>!!release);f.lock();release('{}');
 assert.equal(await pending,null);
});

test('authenticated negotiated attachments have a separate bounded budget and keep normal control alive',async t=>{
 const f=pair(t,{0:{onAttachment:async()=>'{"status":"ok"}'},1:{onAttachment:async raw=>raw}});await Promise.all(f.sessions.map(s=>s.ready));
 assert(f.sessions[0].supportsAttachments());
 for(let i=0;i<80;i++){f.advance(50);assert.equal(await f.sessions[0].attachmentRequest(JSON.stringify({version:1,index:i})),JSON.stringify({version:1,index:i}));}
 assert.equal(f.sessions[0].snapshot().state,'connected');f.advance(20000);f.sessions.forEach(s=>s.tick());await settle(()=>f.transport.history[0].filter(s=>s.includes('authenticate')).length>=2);
 assert.equal(f.sessions[0].snapshot().state,'connected');
});
test('four attachment reads queue without rejecting chunks or overlapping wire requests',async t=>{
 let release;const received=[];
 const hooks={onAttachment:async raw=>{received.push(raw);return raw==='first'?await new Promise(r=>{release=()=>r('first-ok');}):raw+'-ok';}};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 const first=f.sessions[0].attachmentRequest('first');await settle(()=>!!release);
 const rest=['second','third','fourth'].map(raw=>f.sessions[0].attachmentRequest(raw));
 assert.equal(await f.sessions[0].attachmentRequest('overflow'),null);
 assert.deepEqual(received,['first']);release();assert.equal(await first,'first-ok');
 for(let i=0;i<rest.length;i++){f.advance(50);assert.equal(await rest[i],['second-ok','third-ok','fourth-ok'][i]);}
 assert.deepEqual(received,['first','second','third','fourth']);
 assert.equal(f.sessions[0].snapshot().state,'connected');
});

test('queued control traffic gets a turn before attachment read-ahead continues',async t=>{
 let release;const received=[];
 const hooks={onCustody:async()=>{received.push('control');return 'ok';},onAttachment:async raw=>{received.push(raw);return raw==='first'?await new Promise(r=>{release=()=>r('ok');}):'ok';}};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 const first=f.sessions[0].attachmentRequest('first');await settle(()=>!!release);
 const second=f.sessions[0].attachmentRequest('second');const control=f.sessions[0].custodyRequest('{}');
 release();await first;f.advance(50);await control;await second;
 assert.deepEqual(received,['first','control','second']);
});

test('closing an axon drains all locally queued attachment requests',async t=>{
 const hooks={onAttachment:async()=> 'ok'};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 f.transport.blackhole();const requests=Array.from({length:4},()=>f.sessions[0].attachmentRequest('{}'));
 await new Promise(r=>setImmediate(r));f.sessions[0].stop();
 assert.deepEqual(await Promise.all(requests),[null,null,null,null]);
});

test('an old peer cannot be sent attachment frames',async t=>{
 const f=pair(t,{0:{onAttachment:async()=>'{"status":"ok"}'}});await Promise.all(f.sessions.map(s=>s.ready));
 assert.equal(f.sessions[0].supportsAttachments(),false);assert.equal(await f.sessions[0].attachmentRequest('{}'),null);
 assert.equal(f.sessions[0].snapshot().state,'connected');
});
test('paced bidirectional attachment bursts stay connected across minute windows',async t=>{
 const hooks={onAttachment:async()=> 'ok',onCustody:async()=> 'control-ok'};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<1300;i++){
  f.advance(50);f.sessions.forEach(s=>s.tick());
  for(const s of f.sessions)assert.equal(await s.attachmentRequest('{}'),'ok');
 }
 for(const s of f.sessions){assert.equal(s.snapshot().state,'connected');assert.equal(await s.custodyRequest('poll'),'control-ok');}
 // At 25 ms, the second request must wait until the safe pacing interval ends.
 f.advance(25);let sent=false;const waiting=f.sessions[0].attachmentRequest('{}').then(r=>{sent=true;return r;});
 await new Promise(r=>setTimeout(r,5));assert.equal(sent,false);f.advance(25);assert.equal(await waiting,'ok');
});

test('remembered locator callback follows mutual authentication and excludes inbound source addresses',async t=>{
 const a=await controller(),b=await controller(),left=[],right=[];
 const listeners=[],queues=[[],[]],closed=[];let dead=false;
 const w={wire:i=>({listen(fn,end){listeners[i]=fn;closed[i]=end;for(const raw of queues[i])queueMicrotask(()=>!dead&&fn(raw));queues[i]=[];return()=>{listeners[i]=null;};},send(raw){queueMicrotask(()=>{if(dead)return;if(listeners[1-i])listeners[1-i](raw);else queues[1-i].push(raw);});},close(){if(dead)return;dead=true;for(const end of closed)end?.();}})};
 const A=createIdentityNetwork({identity:a,store:store(),now:()=>now,onConnected:c=>left.push(c),connect:async()=>w.wire(0)});
 const B=createIdentityNetwork({identity:b,store:store(),now:()=>now,onConnected:c=>right.push(c),connect:async()=>{throw Error('No inbound dial');}});
 t.after(()=>{A.stop();B.stop();a.lock();b.lock();});
 const candidate={account:b.status().account,endpoint:'axon-lan://10.0.0.2:18080',route:'lan',expiresAt:now+60000};
 assert(B.accept({account:a.status().account,endpoint:'axon-lan://10.0.0.1:49152',route:'lan',expiresAt:now+60000},w.wire(1)));
 assert(A.offer(candidate));A.tick();assert.equal(left.length,0);assert.equal(right.length,0);
 await settle(()=>A.snapshot().pool.connections.some(c=>c.state==='connected')&&B.snapshot().pool.connections.some(c=>c.state==='connected'));
 assert.deepEqual(left,[candidate]);assert.deepEqual(right,[]);
});

test('network routes signed call media to the connected recipient without requiring a relay neuron',async t=>{
 const a=await controller(),b=await controller(),received=[];
 const listeners=[],queues=[[],[]],closed=[];let dead=false;
 const wire=i=>({listen(fn,end){listeners[i]=fn;closed[i]=end;for(const raw of queues[i])queueMicrotask(()=>!dead&&fn(raw));queues[i]=[];return()=>{listeners[i]=null;};},send(raw){queueMicrotask(()=>{if(dead)return;if(listeners[1-i])listeners[1-i](raw);else queues[1-i].push(raw);});},close(){if(dead)return;dead=true;for(const end of closed)end?.();}});
 const A=createIdentityNetwork({identity:a,store:store(),now:()=>now,connect:async()=>wire(0)});
 const B=createIdentityNetwork({identity:b,store:store(),now:()=>now,onRelayedCallMedia:async raw=>{const e=load('callMediaProtocol').verifyCallMediaSignal(raw,a.publicRecord(),now);if(!e)return false;received.push(raw);return true;},connect:async()=>{throw Error('No dial');}});
 t.after(()=>{A.stop();B.stop();a.lock();b.lock();});
 B.accept({account:a.status().account,endpoint:'axon-lan://10.0.0.1:49152',route:'lan',expiresAt:now+60000},wire(1));
 A.offer({account:b.status().account,endpoint:'axon-lan://10.0.0.2:18080',route:'lan',expiresAt:now+60000});A.tick();
 await settle(()=>A.snapshot().pool.connections.some(c=>c.state==='connected')&&B.snapshot().pool.connections.some(c=>c.state==='connected'));
 const raw=a.signCallMedia({callId:'1'.repeat(64),invitation:'2'.repeat(64),acceptance:'3'.repeat(64),target:b.status().account,targetDevice:b.publicRecord().devices[0].id,sourceInstance:'4'.repeat(64),targetInstance:'5'.repeat(64),sequence:1,issuedAt:now,expiresAt:now+30000,kind:'offer',data:{type:'offer',sdp:'v=0'}});
 assert.equal(await A.sendRelayedMedia(raw),true);assert.deepEqual(received,[raw]);
 assert.equal(await A.sendRelayedMedia(JSON.stringify({...JSON.parse(raw),targetDevice:'0'.repeat(64)})),false);
 assert.equal(await A.sendRelayedMedia(JSON.stringify({...JSON.parse(raw),signature:'0'.repeat(128)})),false);assert.equal(received.length,1);
});

test('waiting push registration prevents new poll reservations from starving it',async t=>{
 let release,entered=0;const gate=new Promise(r=>release=r);
 const f=pair(t,{0:{onPush:async()=>null,onCustody:async()=>null},1:{onPush:async()=> 'registered',onCustody:async()=>{entered++;await gate;return 'ok';}}});
 await Promise.all(f.sessions.map(s=>s.ready));const first=f.sessions[0].custodyRequest('poll-one'),second=f.sessions[0].custodyRequest('poll-two');
 await settle(()=>entered===1);const push=f.sessions[0].pushRequest('register');
 assert.equal(await f.sessions[0].custodyRequest('new-poll'),null);release();
 assert.equal(await push,'registered');await Promise.all([first,second]);assert(f.sessions[0].supportsPush());
});

test('RTC candidate gathering progresses with a native clock while JS timers are suspended',async()=>{
 const {PC}=rtcFixture(),ids=[identity(),identity()].sort((a,b)=>a.record.account.localeCompare(b.record.account));
 let waits=0,sent=0,pc;const original=global.setTimeout;
 global.setTimeout=()=>({unref(){}});
 const transport=createRtcAxonTransport({account:()=>ids[0].record.account,now:()=>now,random:async()=> 'ab'.repeat(32),
 createConnection:()=>{pc=new PC();pc.iceGatheringState='gathering';return pc;},
 wait:async ms=>{assert.equal(ms,25);waits++;pc.iceGatheringState='complete';},sign:()=> 'signed',send:()=>{sent++;return true;},accept:()=>false});
 try {await transport.connect({account:ids[1].record.account,endpoint:'rtc:relay'},{signal:new AbortController().signal,onClosed(){}});
  for(let i=0;i<12;i++)await Promise.resolve();assert.equal(waits,1);assert.equal(sent,1);
 } finally {transport.stop();global.setTimeout=original;}
});

test('first-contact custody resolves a signed sender record before decrypting and acknowledging',async t=>{
 const a=await controller(),b=await controller();t.after(()=>{a.lock();b.lock();});
 const records=store();await records.compareAndSet(b.status().account,null,b.publicRecord());
 const envelope=await a.sealCustody(b.publicRecord(),b.publicRecord().devices[0].id,'ce'.repeat(32),'first contact from a new neuron');
 let commits=0,lookups=0;
 assert.equal(await b.receiveCustody(envelope,records,async()=>{commits++;return true;}),null);
 const resolver=load('peerIdentityResolver').createPeerIdentityResolver({records,now:()=>now,current:()=>true,
  lookup:async account=>{lookups++;assert.equal(account,a.status().account);return {status:'found',queried:1,answered:1,rejected:0,sources:[],packet:{record:a.publicRecord(),history:[]}};}});
 t.after(()=>resolver.stop());
 const operational={...records,read:async account=>{const result=await resolver.resolve(account);return result.status==='found'?result.record:null;}};
 const receipt=await b.receiveCustody(envelope,operational,async m=>{commits++;assert.equal(m.text,'first contact from a new neuron');return true;});
 assert.equal(lookups,1);assert.equal(commits,1);assert.ok(await records.read(a.status().account));
 assert.equal(await load('custodyProtocol').verifyCustody(receipt,records,now),true);
 const composition=require('node:fs').readFileSync('src/composition/neuronRuntime.ts','utf8');
 assert.match(composition,/receiveCustody\(envelope,operationalRecords,m=>receiveMessage\(m,relay\)\)/);
});

test('native ticks release queued custody polling when background JS timers are suspended',async t=>{
 let release;
 const hooks={onCustody:async raw=>raw==='first'?await new Promise(r=>{release=()=>r('first-ok');}):'second-ok'};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 const original=setTimeout;global.setTimeout=()=>({});
 try{
  const first=f.sessions[0].custodyRequest('first');
  for(let n=0;n<20&&!release;n++)await Promise.resolve();
  assert.equal(typeof release,'function');
  let received=null;const second=f.sessions[0].custodyRequest('second').then(r=>{received=r;});
  release();assert.equal(await first,'first-ok');
  for(let n=0;n<30&&received===null;n++){f.advance(30);f.sessions.forEach(s=>s.tick());await new Promise(r=>setImmediate(r));}
  assert.equal(received,'second-ok');await second;
 }finally{global.setTimeout=original;}
});

test('native ticks expire unanswered exchanges when background JS timers are suspended',async t=>{
 const hooks={onCustody:async()=> 'ok'};
 const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 const original=setTimeout;global.setTimeout=()=>({});
 try{
  f.transport.blackhole();let done=false;
  const request=f.sessions[0].custodyRequest('poll').then(r=>{assert.equal(r,null);done=true;});
  f.advance(4001);f.sessions[0].tick();await new Promise(r=>setImmediate(r));
  assert.equal(done,true);assert.equal(f.sessions[0].snapshot().closeReason,'exchange-timeout:custody');await request;
 }finally{global.setTimeout=original;}
});

function mediaClock(t,f){const timer=setInterval(()=>{f.advance(5);f.sessions.forEach(s=>s.tick());},5);t.after(()=>clearInterval(timer));}

test('small RTC batches negotiate independently, fit worst-case proofs, and retain control traffic',async t=>{
 const data='A'.repeat(4*Math.ceil(3*(4096+16+32*16)/3));
 const sample=JSON.stringify({status:'ok',data,custodians:Array.from({length:10},()=> 'axonic:1:'+'f'.repeat(64))});
 const hooks={onAttachment:async()=>sample,onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},['small','small']);await Promise.all(f.sessions.map(s=>s.ready));
 assert(f.sessions.every(s=>s.supportsAttachmentBulk()&&s.attachmentBatchChunks()===3));
 const request=JSON.stringify({operation:'direct-get-batch',count:3});
 assert.equal(await f.sessions[0].attachmentBulkRequest(request),sample);
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');
 assert(f.transport.history.flat().every(raw=>Buffer.byteLength(raw)<=20000));
 assert.equal(await f.sessions[0].attachmentBulkRequest(JSON.stringify({operation:'direct-get-batch',count:4})),null);
 const old=pair(t,{0:hooks,1:hooks},['small',true]);await Promise.all(old.sessions.map(s=>s.ready));
 assert(!old.sessions[0].supportsAttachmentBulk());
});

test('small batches reject oversized requests before serving and retain the 20KB receive bound',async t=>{
 let called=0;const hooks={onAttachment:async()=>{called++;return 'ok';}};
 const f=pair(t,{0:hooks,1:hooks},['small','small']);await Promise.all(f.sessions.map(s=>s.ready));
 f.transport.inject(0,{version:1,kind:'bulk-request',id:1,body:JSON.stringify({operation:'direct-get-batch',count:128})});
 await settle(()=>f.sessions[0].snapshot().state==='closed');assert.equal(called,0);
 const g=pair(t,{0:hooks,1:hooks},['small','small']);await Promise.all(g.sessions.map(s=>s.ready));
 g.transport.inject(0,{version:1,kind:'bulk-response',id:1,body:'x'.repeat(20001)});
 await settle(()=>g.sessions[0].snapshot().state==='closed');
});

test('relay upload capability admits bounded large requests only at an opted-in endpoint',async t=>{
 const body=JSON.stringify({version:1,operation:'put-batch',digest:'ab'.repeat(32),index:0,count:32,data:'A'.repeat(180000)});
 let handled=0;const receiver={onAttachment:Object.assign(async raw=>{handled++;assert.equal(raw,body);return '{"status":"held"}';},{uploadBatch:true}),onCustody:async()=> 'control'};
 const sender={onAttachment:async()=> '{}',onCustody:async()=> 'control'};
 const f=pair(t,{0:sender,1:receiver},['bulk','bulk']);await Promise.all(f.sessions.map(s=>s.ready));
 assert(f.sessions[0].supportsAttachmentUploadBatch());assert(!f.sessions[1].supportsAttachmentUploadBatch());
 assert.equal(await f.sessions[0].attachmentBulkRequest(body),'{"status":"held"}');assert.equal(handled,1);
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');assert.equal(f.sessions[0].snapshot().state,'connected');
 const old=pair(t,{0:sender,1:sender},['bulk','bulk']);await Promise.all(old.sessions.map(s=>s.ready));
 assert(!old.sessions[0].supportsAttachmentUploadBatch());assert.equal(await old.sessions[0].attachmentBulkRequest(body),null);assert.equal(old.sessions[0].snapshot().state,'connected');
 const small=pair(t,{0:receiver,1:receiver},['small','small']);await Promise.all(small.sessions.map(s=>s.ready));assert(!small.sessions[0].supportsAttachmentUploadBatch());assert.equal(await small.sessions[0].attachmentBulkRequest(body),null);
});
for(const mode of ['not-opted-in','wrong-operation','unknown-field','over-limit'])test('bulk upload cannot enlarge unrelated/invalid request admission: '+mode,async t=>{
 let handled=0;const hooks={onAttachment:Object.assign(async()=>{handled++;return '{}';},{uploadBatch:mode!=='not-opted-in'})};
 const f=pair(t,{0:hooks,1:hooks},['bulk','bulk']);await Promise.all(f.sessions.map(s=>s.ready));
 const body={version:1,operation:mode==='wrong-operation'?'offer':'put-batch',digest:'ab'.repeat(32),index:0,count:32,data:'A'.repeat(mode==='over-limit'?850000:180000),...(mode==='unknown-field'?{ignored:'no'}:{})};
 f.transport.inject(0,{version:1,kind:'bulk-request',id:987,body:JSON.stringify(body)});await settle(()=>f.sessions[0].snapshot().state==='closed');assert.equal(handled,0);
});

test('authenticated bulk response delivers a bounded batch while control remains usable',async t=>{
 const sample='A'.repeat(790000),hooks={onAttachment:async()=>sample,onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},['bulk','bulk']);await Promise.all(f.sessions.map(s=>s.ready));
 assert(f.sessions.every(s=>s.supportsAttachmentBulk()));
 assert.equal(await f.sessions[0].attachmentBulkRequest('{}'),sample);
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');assert.equal(f.sessions[0].snapshot().state,'connected');
});

test('preferred smaller bulk batches use proportional pacing without changing legacy capability',async t=>{
 let calls=0;const hooks={onAttachment:async()=>{calls++;return 'ok';}};
 const f=pair(t,{0:hooks,1:hooks},['bulk','bulk'],0,d=>createPersistentAxon({...d,wire:{...d.wire,preferredAttachmentBatchChunks:32}}));await Promise.all(f.sessions.map(s=>s.ready));
 assert.equal(f.sessions[0].attachmentBatchChunks(),32);
 const raw=JSON.stringify({operation:'direct-get-batch',count:32});assert.equal(await f.sessions[0].attachmentBulkRequest(raw),'ok');
 const next=f.sessions[0].attachmentBulkRequest(raw);await new Promise(r=>setTimeout(r,10));assert.equal(calls,1);
 f.advance(63);assert.equal(await next,'ok');assert.equal(calls,2);
});
test('bulk capability requires both adapters and still rejects oversized control frames',async t=>{
 const hooks={onAttachment:async()=> 'ok'};
 const old=pair(t,{0:hooks,1:hooks},['bulk',true]);await Promise.all(old.sessions.map(s=>s.ready));
 assert.equal(old.sessions[0].supportsAttachmentBulk(),false);assert.equal(await old.sessions[0].attachmentBulkRequest('{}'),null);
 assert.equal(await old.sessions[0].attachmentRequest('{}'),'ok');
 const f=pair(t,{0:hooks,1:hooks},['bulk','bulk']);await Promise.all(f.sessions.map(s=>s.ready));
 f.transport.inject(0,{version:1,kind:'request',id:123,operation:'custody',body:'x'.repeat(20001)});
 await settle(()=>f.sessions[0].snapshot().state==='closed');assert.equal(f.sessions[0].snapshot().closeReason,'oversized-control');
});
test('bulk requests drain on close and oversized responses close the session',async t=>{
 const hooks={onAttachment:async()=> 'x'.repeat(850001)};
 const f=pair(t,{0:hooks,1:hooks},['bulk','bulk']);await Promise.all(f.sessions.map(s=>s.ready));
 assert.equal(await f.sessions[0].attachmentBulkRequest('{}'),null);assert.equal(f.sessions[0].snapshot().state,'closed');
 const g=pair(t,{0:hooks,1:hooks},['bulk','bulk']);await Promise.all(g.sessions.map(s=>s.ready));g.transport.blackhole();
 const pending=g.sessions[0].attachmentBulkRequest('{}');g.sessions[0].stop();assert.equal(await pending,null);
});

test('media bursts use at most four credits and refill at the original average rate',async t=>{
 let hold=false;const releases=new Map(),hooks={onAttachment:async raw=>hold?new Promise(r=>releases.set(raw,r)):raw};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<6;i++){f.advance(5);assert.equal(await f.sessions[0].attachmentRequest('warm'),'warm');}
 f.advance(20);hold=true;
 const batch=['a','b','c','d'].map(raw=>f.sessions[0].attachmentRequest(raw));
 await settle(()=>releases.size===4);assert.equal(f.sessions[0].snapshot().mediaInFlight,4);
 for(const name of ['a','b','c','d'])releases.get(name)(name);await Promise.all(batch);
 const next=f.sessions[0].attachmentRequest('next');await new Promise(setImmediate);assert(!releases.has('next'));
 f.advance(4);f.sessions[0].tick();await new Promise(setImmediate);assert(!releases.has('next'));
 f.advance(1);f.sessions[0].tick();await settle(()=>releases.has('next'));releases.get('next')('next');assert.equal(await next,'next');
 // A backwards wall clock cannot mint credits.
 f.advance(-100);const backwards=f.sessions[0].attachmentRequest('backwards');await new Promise(setImmediate);assert(!releases.has('backwards'));
 f.sessions[0].stop();assert.equal(await backwards,null);
});
test('media lane pipelines replies out of order while control completes independently',async t=>{
 let hold=false;const releases=new Map();
 const hooks={onCustody:async()=> 'control',onAttachment:async raw=>hold?new Promise(r=>releases.set(raw,r)):raw};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));mediaClock(t,f);
 for(let i=0;i<6;i++)assert.equal(await f.sessions[0].attachmentRequest('warm'),'warm');
 hold=true;
 const batch=['a','b','c','d'].map(raw=>f.sessions[0].attachmentRequest(raw));
 await settle(()=>releases.size===4);
 assert.equal(await f.sessions[0].attachmentRequest('overflow'),null);
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');
 for(const name of ['d','b','a','c'])releases.get(name)(name+'-ok');
 assert.deepEqual(await Promise.all(batch),['a-ok','b-ok','c-ok','d-ok']);
 assert(f.sessions.every(s=>s.snapshot().state==='connected'));
 assert(f.transport.history[0].some(raw=>JSON.parse(raw).kind==='media-request'));
});
test('new media peer falls back to serialized attachments with an old adapter',async t=>{
 const hooks={onAttachment:async raw=>raw};const f=pair(t,{0:hooks,1:hooks},[true,false]);
 await Promise.all(f.sessions.map(s=>s.ready));assert.equal(await f.sessions[0].attachmentRequest('old'),'old');
 assert(f.sessions.every(s=>!s.snapshot().mediaLane));assert(!f.transport.history.flat().some(raw=>JSON.parse(raw).kind==='media-request'));
});
test('media lane timeout and close drain requests without retaining pending buffers',async t=>{
 const hooks={onAttachment:async raw=>raw};const f=pair(t,{0:hooks,1:hooks},[true,true]);
 await Promise.all(f.sessions.map(s=>s.ready));f.transport.blackhole();
 const requests=Array.from({length:4},()=>f.sessions[0].attachmentRequest('{}'));
 await new Promise(r=>setImmediate(r));f.advance(4001);f.sessions[0].tick();
 assert.deepEqual(await Promise.all(requests),[null,null,null,null]);
 assert.equal(f.sessions[0].snapshot().mediaInFlight,0);assert.equal(f.sessions[0].snapshot().state,'connected');
 f.sessions[0].stop();assert.equal(f.sessions[0].snapshot().mediaInFlight,0);
});
test('media lane rejects unnegotiated frames and cannot bypass authentication',async t=>{
 const hooks={onAttachment:async raw=>raw};const f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 f.transport.inject(0,{version:1,kind:'media-request',id:123,body:'{}'});
 await settle(()=>f.sessions[0].snapshot().state==='closed');
 assert.equal(f.sessions[0].snapshot().closeReason,'invalid-media-request');
});
for(const bulk of [false,true])test(`one expired media request preserves authentication and ignores only its matching late reply: bulk=${bulk}`,async t=>{
 let release,hold=true;const hooks={onAttachment:async raw=>hold?new Promise(r=>release=r):raw,onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},bulk?['small','small']:[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 const raw=JSON.stringify({operation:'direct-get-batch',count:3});
 const request=()=>bulk?f.sessions[0].attachmentBulkRequest(raw):f.sessions[0].attachmentRequest(raw);
 const pending=request();await settle(()=>!!release);f.advance(bulk?15001:4001);f.sessions[0].tick();
 assert.equal(await pending,null);assert.equal(f.sessions[0].snapshot().state,'connected');assert.equal(f.sessions[0].snapshot().mediaInFlight,0);
 release(raw);await new Promise(r=>setImmediate(r));assert.equal(f.sessions[0].snapshot().state,'connected');
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');
 hold=false;f.advance(5);assert.equal(await request(),raw);assert.equal(f.sessions[0].snapshot().consecutiveMediaTimeouts,0);
 f.transport.inject(0,{version:1,kind:bulk?'bulk-response':'media-response',id:999999,body:'unsolicited'});
 await settle(()=>f.sessions[0].snapshot().state==='closed');assert.equal(f.sessions[0].snapshot().closeReason,'invalid-media-response');
});

test('three consecutive media timeouts still close the axon',async t=>{
 let calls=0;const hooks={onAttachment:async()=>{calls++;return new Promise(()=>{});}};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=1;i<=3;i++){const pending=f.sessions[0].attachmentRequest('{}');await settle(()=>calls===i);f.advance(4001);f.sessions[0].tick();assert.equal(await pending,null);}
 assert.equal(f.sessions[0].snapshot().state,'closed');assert.equal(f.sessions[0].snapshot().closeReason,'repeated-media-timeout');
});

test('media lane shrinks its window when a receiver responds slowly',async t=>{
 let release,slow=false;const hooks={onAttachment:async raw=>slow?new Promise(r=>release=r):raw};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<6;i++){f.advance(5);await f.sessions[0].attachmentRequest('warm');}
 assert.equal(f.sessions[0].snapshot().mediaWindow,4);slow=true;f.advance(5);
 const pending=f.sessions[0].attachmentRequest('slow');await settle(()=>!!release);f.advance(1001);release('ok');await pending;
 assert.equal(f.sessions[0].snapshot().mediaWindow,2);
});

test('media lane enforces four inbound operations even for an authenticated peer',async t=>{
 let calls=0;const hooks={onAttachment:async()=>{calls++;return new Promise(()=>{});}};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 for(let id=100;id<105;id++)f.transport.inject(0,{version:1,kind:'media-request',id,body:'{}'});
 await settle(()=>f.sessions[0].snapshot().state==='closed');assert.equal(calls,4);
 assert.equal(f.sessions[0].snapshot().closeReason,'invalid-media-request');
});
test('media lane remains authenticated during paced bidirectional traffic and renewal',async t=>{
 const hooks={onAttachment:async()=> 'ok',onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},[true,true]);await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<2000;i++){
  f.advance(10);for(const session of f.sessions)assert.equal(await session.attachmentRequest('{}'),'ok');
 }
 f.advance(10);f.sessions.forEach(s=>s.tick());await settle(()=>f.transport.history[0].filter(raw=>raw.includes('authenticate')).length>=2);
 for(const session of f.sessions){assert.equal(session.snapshot().state,'connected');assert.equal(await session.custodyRequest('{}'),'control');}
});

test('measured media window uses actual authenticated axon scheduling with identical payloads',{skip:!process.env.AXON_MEDIA_BENCHMARK},async t=>{
 const sample='a'.repeat(8192),results=[];
 for(const enabled of [false,true]){
  const hooks={onAttachment:async()=>sample};const f=pair(t,{0:hooks,1:hooks},[enabled,enabled],10);await Promise.all(f.sessions.map(s=>s.ready));mediaClock(t,f);
  const start=performance.now();for(let index=0;index<64;index+=4){const replies=await Promise.all(Array.from({length:4},()=>f.sessions[0].attachmentRequest('{}')));for(const reply of replies)assert.equal(reply,sample);}
  results.push({mediaLane:enabled,bytes:256*1024,oneWayDelayMs:10,elapsedMs:Math.round(performance.now()-start),state:f.sessions[0].snapshot().state});f.sessions.forEach(s=>s.stop());
 }
 t.diagnostic(JSON.stringify(results));assert(results.every(r=>r.state==='connected'));
});

test('media scheduler benchmark with coarse mobile-like timers',{skip:!process.env.AXON_SCHEDULER_BENCHMARK},async t=>{
 const code=ts.transpileModule(fs.readFileSync('src/services/identity/persistentAxon.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText,out={};
 new Function('require','exports','setTimeout',code)(n=>n.startsWith('./')?load(n.slice(2).replace(/\.ts$/,'')):require(n),out,(cb,ms)=>setTimeout(cb,Math.max(16,ms)));
 const results=[],sample='a'.repeat(8192);
 for(let round=0;round<3;round++){
  const epoch=Date.now(),hooks={now:()=>now+Date.now()-epoch,onAttachment:async()=>sample};
  const f=pair(t,{0:hooks,1:hooks},[true,true],10,out.createPersistentAxon);await Promise.all(f.sessions.map(s=>s.ready));
  const start=performance.now();for(let index=0;index<192;index+=4){
   const replies=await Promise.all(Array.from({length:4},()=>f.sessions[0].attachmentRequest('{}')));assert(replies.every(r=>r===sample));
  }
  results.push(Math.round(performance.now()-start));assert.equal(f.sessions[0].snapshot().state,'connected');f.sessions.forEach(s=>s.stop());
 }
 t.diagnostic(JSON.stringify({scope:'simulated 16ms timer floor, 10ms one-way link, 192 chunks; no phone I/O',milliseconds:results}));
});

test('small RTC batch pairs start together while rate, overflow and control limits remain bounded',async t=>{
 const releases=new Map(),hooks={onAttachment:raw=>new Promise(r=>releases.set(JSON.parse(raw).index,r)),onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},['small','small']);await Promise.all(f.sessions.map(s=>s.ready));
 const request=index=>JSON.stringify({operation:'direct-get-batch',count:3,index});
 const first=f.sessions[0].attachmentBulkRequest(request(0)),second=f.sessions[0].attachmentBulkRequest(request(3));
 await new Promise(setImmediate);
 assert.equal(releases.size,2,'both negotiated batch slots should start without a timer round trip');
 assert.equal(await f.sessions[0].attachmentBulkRequest(request(6)),null);
 assert.equal(await f.sessions[0].custodyRequest('{}'),'control');
 releases.get(3)('second');releases.get(0)('first');assert.deepEqual(await Promise.all([first,second]),['first','second']);
 const next=f.sessions[0].attachmentBulkRequest(request(6));await new Promise(setImmediate);assert(!releases.has(6));
 f.advance(4);await new Promise(setImmediate);assert(!releases.has(6));
 f.advance(1);await settle(()=>releases.has(6));releases.get(6)('next');assert.equal(await next,'next');
 f.advance(-100);const backward=f.sessions[0].attachmentBulkRequest(request(9));await new Promise(setImmediate);assert(!releases.has(9));
 f.sessions[0].stop();assert.equal(await backward,null);
});

for(const modes of [['small4','small4'],['small4','small'],['small','small4']])test('small batch window negotiates safely '+modes.join('/'),async t=>{
 const releases=[],hooks={onAttachment:()=>new Promise(r=>releases.push(r)),onCustody:async()=> 'control'};
 const f=pair(t,{0:hooks,1:hooks},modes);await Promise.all(f.sessions.map(s=>s.ready));
 const n=modes.every(x=>x==='small4')?4:2;assert(f.sessions.every(s=>s.attachmentBatchWindow()===n));
 const raw=JSON.stringify({operation:'direct-get-batch',count:3});const requests=Array.from({length:n},()=>f.sessions[0].attachmentBulkRequest(raw));
 await settle(()=>releases.length===n);assert.equal(await f.sessions[0].attachmentBulkRequest(raw),null);assert.equal(await f.sessions[0].custodyRequest('{}'),'control');
 releases.reverse().forEach(r=>r('ok'));assert.deepEqual(await Promise.all(requests),Array(n).fill('ok'));assert(f.sessions.every(s=>s.snapshot().state==='connected'));
});

test('quality observes existing exchanges without adding wire frames or advertising scores',async t=>{
 let f;f=pair(t,{0:{onCustody:async()=> 'ok'},1:{onCustody:async()=>{f.advance(75);return 'ok';}}});await Promise.all(f.sessions.map(s=>s.ready));
 const before=f.transport.history.map(h=>h.length);assert.equal(await f.sessions[0].custodyRequest('poll'),'ok');const q=f.sessions[0].snapshot().quality;assert.equal(q.samples,1);assert.equal(q.responseMs,75);assert.equal(f.sessions[0].snapshot().requestTimings['roundTrip:custody'].meanMs,75);assert.equal(f.sessions[1].snapshot().requestTimings['handler:custody'].meanMs,75);
 assert.deepEqual(f.transport.history.map((h,i)=>h.length-before[i]),[1,1]);assert.ok(f.transport.history.flat().every(raw=>!raw.includes('quality')&&!raw.includes('responseMs')));
 f.transport.blackhole();const work=f.sessions[0].custodyRequest('poll');await new Promise(r=>setImmediate(r));f.advance(4001);f.sessions[0].tick();await work;assert.equal(f.sessions[0].snapshot().quality.failures,1);
});

test('bidirectional normal chat queues an ACK while durable receive is busy without closing',async t=>{
 let release;const seen=[];const f=await testMessagePair(t,undefined,undefined,async(message,i)=>{if(i===1)await new Promise(r=>release=r);seen.push(message.text);return true;},true);
 const a=f.sessions[0].sendChatMessage('one','c1'.repeat(32));await settle(()=>!!release);
 const b=f.sessions[1].sendChatMessage('two','c2'.repeat(32));await settle(()=>seen.includes('two'));
 await new Promise(r=>setTimeout(r,20));assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
 release();assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.deepEqual(seen.sort(),['one','two']);assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
});
test('normal chat receive queue remains bounded while storage is blocked',async t=>{
 let release;const f=await testMessagePair(t,undefined,undefined,async()=>{await new Promise(r=>release=r);return true;},true);
 const pending=f.sessions[0].sendChatMessage('bounded','c3'.repeat(32));await settle(()=>!!release);
 const frame=JSON.parse(f.bus.history[0].find(raw=>JSON.parse(raw).kind==='chat-message'));
 for(let i=0;i<4;i++)f.bus.inject(1,frame);
 await settle(()=>f.sessions[1].snapshot().state==='closed');assert.equal(f.sessions[1].snapshot().closeReason,'chat-receive-queue-full');release();assert.equal(await pending,false);
});

test('bounded custody recovery has its own budget and leaves control exchanges usable',async t=>{
 const hooks={onCustody:async()=> 'ok',onDirectory:async()=> 'ok'},f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 for(let i=0;i<300;i++)assert.equal(await f.sessions[0].custodyRequest('poll'),'ok');
 assert.equal(await f.sessions[0].directoryRequest('lookup'),'ok');assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
 for(let i=300;i<512;i++)await f.sessions[0].custodyRequest('poll');
 assert.equal(JSON.parse(await f.sessions[0].custodyRequest('poll')).status,'retry');
 assert.equal(await f.sessions[0].directoryRequest('lookup'),'ok');
 assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
 for(let i=513;i<4097;i++)await f.sessions[0].custodyRequest('poll');
 assert.ok(f.sessions.some(s=>s.snapshot().closeReason==='custody-rate-limit'));
});

test('backlog poll pacing preserves control capacity and live setting changes do not require reconnecting',async t=>{
 const policy=load('recoveryPolicy');t.after(()=>policy.setRecoveryPolicy({...policy.DEFAULT_RECOVERY_POLICY}));
 const hooks={onCustody:async()=>'{"status":"ok","packet":null}',onDirectory:async()=> 'ok'},f=pair(t,{0:hooks,1:hooks});await Promise.all(f.sessions.map(s=>s.ready));
 let sent=0,deferred=0;for(let i=0;i<200;i++){const reply=JSON.parse(await f.sessions[0].custodyRequest(JSON.stringify({operation:i%2?'poll':'group-poll'})));if(reply.status==='retry')deferred++;else sent++;}
 assert.equal(sent,4);assert.equal(deferred,196);assert.equal(await f.sessions[0].directoryRequest('lookup'),'ok');
 f.advance(1000);assert.equal(JSON.parse(await f.sessions[0].custodyRequest('{"operation":"poll"}')).status,'ok');
 policy.setRecoveryPolicy({pollsPerMinute:90,custodyFramesPerMinute:768});f.advance(667);
 assert.equal(JSON.parse(await f.sessions[0].custodyRequest('{"operation":"poll"}')).status,'ok');
 assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
});

test('recovery budget survives socket replacement and clock rollback; invalid settings cannot disable protection',()=>{
 const p=load('recoveryPolicy'),owner='test-owner-reconnect',peer='test-peer-reconnect';
 for(let i=0;i<4;i++)assert.equal(p.reserveRecoveryPoll(owner,peer,now),0);
 assert(p.reserveRecoveryPoll(owner,peer,now)>0,'a replacement socket uses the same identity budget');
 assert(p.reserveRecoveryPoll(owner,peer,now-5000)>0);
 assert.throws(()=>p.setRecoveryPolicy({pollsPerMinute:Infinity,custodyFramesPerMinute:512}));
 assert.throws(()=>p.setRecoveryPolicy({pollsPerMinute:60,custodyFramesPerMinute:0}));
});

test('queued custody hands off on reply without waiting for the polling timer',async t=>{
 let release;const seen=[];const f=pair(t,{0:{onCustody:async()=> 'ok'},1:{onCustody:async raw=>{seen.push(raw);if(raw==='first')await new Promise(r=>release=r);return 'ok';}}});
 await Promise.all(f.sessions.map(s=>s.ready));const first=f.sessions[0].custodyRequest('first');await settle(()=>!!release);
 const second=f.sessions[0].custodyRequest('second');assert.deepEqual(seen,['first']);release();
 // Drain promise continuations, not a wall-clock timeout: the old 25ms polling path cannot run here.
 for(let i=0;i<30;i++)await Promise.resolve();
 assert.deepEqual(seen,['first','second']);assert.deepEqual(await Promise.all([first,second]),['ok','ok']);
 assert.ok(f.sessions.every(s=>s.snapshot().state==='connected'));
});
