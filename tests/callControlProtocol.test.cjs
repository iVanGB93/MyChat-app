const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
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
const p = load('identityProtocol'), c = load('callControlProtocol');
const now = 1800000000000, seed = n => new Uint8Array(32).fill(n);
function fixture() {
  const a = p.publicDevice(seed(2), seed(3)), b = p.publicDevice(seed(5), seed(6)), b2 = p.publicDevice(seed(7), seed(8));
  const caller = p.issueRecord(seed(1), [a], now), callee = p.issueRecord(seed(4), [b,b2], now);
  const fields = { record: caller, callId: 'ab'.repeat(32), caller: caller.account, callee: callee.account,
    callerDevice: a.id, media: 'voice', kind: 'invite', invitation: null, sequence: 0, issuedAt: now, expiresAt: now + 60000 };
  const invite = c.signCallControl(fields, seed(2), now);
  const invitation = c.callControlDigest(JSON.parse(invite));
  const event = (kind, options={}) => {
    const isCaller = ['cancel','end','selected'].includes(kind);
    const { device2, ...overrides } = options;
    return c.signCallControl({ ...fields, record: isCaller ? caller : callee, kind, invitation,
      sequence: 1, issuedAt: now + 1, ...overrides }, seed(isCaller ? 2 : device2 ? 7 : 5), now + 1);
  };
  return { caller, callee, a,b,b2, fields, invite, event, state: c.createCallerCallControl(invite, caller, now) };
}
test('signatures bind participants, media, identity, sequence and call ID', () => {
  const f=fixture();
  assert.ok(c.verifyCallControl(f.invite,f.caller,now));
  for (const change of [{callId:'cd'.repeat(32)},{media:'video'},{callee:f.caller.account},{sequence:1},{callerDevice:f.b.id}]) {
    assert.equal(c.verifyCallControl(JSON.stringify({...JSON.parse(f.invite),...change}),f.caller,now),null);
  }
  assert.equal(c.verifyCallControl(f.invite,f.callee,now),null);
  assert.equal(c.verifyCallControl(' '.repeat(6001),f.caller,now),null);
  assert.equal(c.verifyCallControl(f.invite,f.caller,now+60000),null);
});

const durable = load('durableCallControl');
function memoryStore() {
  let value = null;
  return { read: async () => value,
    async compareAndSet(owner, callId, before, after) { if(value !== before) return false; value=after; return true; },
    corrupt() { value='broken'; } };
}
function session(f,store) { return durable.createDurableCallerCallControl(store,f.caller.account,f.fields.callId); }
function recipient(f,store,device=f.b.id) { return durable.createDurableRecipientCallControl(store,f.callee.account,f.fields.callId,device); }
function selection(f,accept) { return f.event('selected',{selectedDevice:JSON.parse(accept).device,acceptance:c.callControlDigest(JSON.parse(accept))}); }
const delivery = load('callControlDelivery');
const runtime = load('callControlRuntime');
function runtimePair(f) {
  const stores=[memoryStore(),memoryStore()], peers=[f.caller,f.callee].map(record=>({account:record.account,
    device:record.account===f.caller.account?f.a.id:f.b.id,instance:'aa'.repeat(32),expiresAt:now+60000}));
  const runtimes=[], sent=[[],[]], blocked=[false,false];let drop=false;
  const make=i=>runtime.createCallControlRuntime({account:peers[i].account,device:peers[i].device,store:stores[i],
    records:{read:async account=>[f.caller,f.callee].find(r=>r.account===account)??null},
    now:()=>now+10,current:()=>true,blocked:()=>blocked[i],
    signReceipt:async(e,t)=>delivery.signCallControlReceipt(e,i?f.callee:f.caller,seed(i?5:2),t),
    send:async(account,device,raw)=>{sent[i].push(JSON.parse(raw).kind);const ack=await runtimes[1-i].receive(raw,peers[i]);return drop?null:ack;}});
  runtimes.push(make(0),make(1));
  return {runtimes,stores,peers,sent,block:i=>{blocked[i]=true;},drop:value=>{drop=value;},reopen:i=>{runtimes[i].stop();runtimes[i]=make(i);}};
}
test('runtime retries a lost acknowledgment after restart then remembers it durably',async()=>{
  const f=fixture(),x=runtimePair(f),invite=JSON.parse(f.invite);
  assert.equal(await x.runtimes[0].submit(f.invite),true);
  x.drop(true);
  assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),0);
  x.reopen(0);x.reopen(1);x.drop(false);
  assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),1);
  x.reopen(0);
  assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),0);
  assert.deepEqual(x.sent[0],['invite','invite']);
  assert.equal((await recipient(f,x.stores[1]).snapshot(now+10)).status,'ringing');
});
test('runtime suppresses cancelled unsent invitation and persists unknown-call cancellation',async()=>{
  const f=fixture(),x=runtimePair(f),invite=JSON.parse(f.invite);
  await x.runtimes[0].submit(f.invite);
  assert.equal(await x.runtimes[0].submit(f.event('cancel')),true);
  x.reopen(0);
  assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),1);
  assert.deepEqual(x.sent[0],['cancel']);
  x.reopen(1);
  assert.equal(await x.runtimes[1].receive(f.invite,x.peers[0]),null);
  assert.equal((await recipient(f,x.stores[1]).snapshot(now+10)).status,'cancelled');
});
test('runtime completes invitation, acceptance and selected-device receipt without Django',async()=>{
  const f=fixture(),x=runtimePair(f),invite=JSON.parse(f.invite),accept=f.event('accept');
  await x.runtimes[0].submit(f.invite);assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),1);
  assert.equal(await x.runtimes[1].submit(accept),true);assert.equal(await x.runtimes[1].drain(invite,x.peers[0]),1);
  assert.equal(await x.runtimes[0].submit(selection(f,accept)),true);assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),1);
  x.reopen(0);x.reopen(1);
  assert.equal((await recipient(f,x.stores[1]).snapshot(now+10)).confirmed,true);
  assert.equal(await session(f,x.stores[0]).pendingSelection(f.caller,now+10),null);
  assert.equal(await x.runtimes[0].drain(invite,x.peers[1]),0);
});
function receiverDelivery(f, overrides={}) {
  const store=memoryStore(), r=recipient(f,store);
  const records={read:async account=>account===f.caller.account?f.caller:account===f.callee.account?f.callee:null};
  let clock=now+2;
  const d={account:f.callee.account,device:f.b.id,records,current:()=>true,now:()=>clock,blocked:()=>false,
    commit:async(raw,latest,time)=>{
      const event=JSON.parse(raw);
      return (event.kind==='invite'?await r.begin(raw,latest,time):await r.receive(raw,latest,time)) || await r.hasStoredEvent(raw,latest,time);
    },signReceipt:async(event,time)=>delivery.signCallControlReceipt(event,f.callee,seed(5),time),...overrides};
  return {api:delivery.createCallControlDelivery(d),r,store,d,setTime:t=>{clock=t;},
    peer:{account:f.caller.account,device:f.a.id,instance:'aa'.repeat(32),expiresAt:now+60000}};
}
test('direct delivery receipts follow durable admission; retransmission does not replay lifecycle',async()=>{
  const f=fixture(), x=receiverDelivery(f);
  const first=await x.api.receive(f.invite,x.peer);
  assert.ok(delivery.verifyCallControlReceipt(first,JSON.parse(f.invite),f.callee,now+2));
  const duplicate=await x.api.receive(f.invite,x.peer);
  assert.ok(duplicate);
  assert.equal((await x.r.snapshot(now+2)).status,'ringing');
  const cancel=f.event('cancel');
  assert.ok(await x.api.receive(cancel,x.peer));
  assert.ok(await x.api.receive(cancel,x.peer));
  assert.equal((await x.r.snapshot(now+2)).status,'cancelled');
  assert.ok(await x.api.receive(f.invite,x.peer)); // Admission receipt does not revive state.
  assert.equal((await x.r.snapshot(now+2)).status,'cancelled');
});
test('delivery rejects blocked, expired, impersonated and relayed peers before persistence',async()=>{
  const f=fixture();let commits=0;
  const x=receiverDelivery(f,{commit:async()=>{commits++;return true;}});
  assert.equal(await x.api.receive(f.invite,{...x.peer,device:f.b.id}),null);
  assert.equal(await x.api.receive(f.invite,{...x.peer,account:f.callee.account}),null);
  assert.equal(await x.api.receive(f.invite,{...x.peer,expiresAt:now}),null);
  const blocked=receiverDelivery(f,{blocked:()=>true,commit:async()=>{commits++;return true;}});
  assert.equal(await blocked.api.receive(f.invite,blocked.peer),null);
  assert.equal(commits,0);
});
test('no receipt on disk failure, unknown cancellation or session teardown during save',async()=>{
  const f=fixture(), x=receiverDelivery(f);
  assert.equal(await x.api.receive(f.event('cancel'),x.peer),null);
  assert.equal(await x.r.snapshot(now+2),null);
  let signed=0, active=true;
  const fail=receiverDelivery(f,{commit:async()=>{throw Error('disk full');},signReceipt:async()=>{signed++;return '';}});
  assert.equal(await fail.api.receive(f.invite,fail.peer),null);
  const stopped=receiverDelivery(f,{current:()=>active,commit:async()=>{active=false;return true;},signReceipt:async()=>{signed++;return '';}});
  assert.equal(await stopped.api.receive(f.invite,stopped.peer),null);
  assert.equal(signed,0);
});
test('receipt binds exact event, signer device, destination and current identity',async()=>{
  const f=fixture(), x=receiverDelivery(f), raw=await x.api.receive(f.invite,x.peer), event=JSON.parse(f.invite);
  for(const fields of [{event:'ab'.repeat(32)},{targetDevice:f.b.id},{callId:'ee'.repeat(32)}]) {
    assert.equal(delivery.verifyCallControlReceipt(JSON.stringify({...JSON.parse(raw),...fields}),event,f.callee,now+2),null);
  }
  const revoked=p.issueRecord(seed(4),[f.b2],now+1,f.callee);
  assert.equal(delivery.verifyCallControlReceipt(raw,event,revoked,now+2),null);
  assert.equal(delivery.verifyCallControlReceipt(raw,event,f.callee,now+60000),null);
  const selected=JSON.parse(selection(f,f.event('accept')));
  assert.throws(()=>delivery.signCallControlReceipt(selected,f.callee,seed(7),now+2),/Invalid/);
});
test('recipient cancellation before selection survives restart and prevents activation', async () => {
  const f=fixture(), store=memoryStore(), r=recipient(f,store), accept=f.event('accept');
  await r.begin(f.invite,f.caller,now);
  assert.equal(await r.receive(accept,f.callee,now+2),true);
  assert.equal(await r.receive(f.event('cancel',{sequence:2}),f.caller,now+3),true);
  assert.equal(await recipient(f,store).receive(selection(f,accept),f.caller,now+4),false);
  assert.equal((await recipient(f,store).snapshot(now+5)).status,'cancelled');
});
test('recipient confirms only its own saved acceptance; another device selection is terminal', async () => {
  const f=fixture(), store=memoryStore(), r=recipient(f,store), accept=f.event('accept');
  await r.begin(f.invite,f.caller,now);
  assert.equal(await r.receive(selection(f,accept),f.caller,now+1),false);
  assert.equal(await r.receive(f.event('accept',{device2:true}),f.callee,now+2),false);
  assert.equal(await r.receive(accept,f.callee,now+3),true);
  assert.equal(await recipient(f,store).receive(selection(f,accept),f.caller,now+4),true);
  assert.equal((await recipient(f,store).snapshot(now+5)).confirmed,true);
  assert.equal(await r.receive(selection(f,f.event('accept',{device2:true})),f.caller,now+6),false);
  const otherStore=memoryStore(), other=recipient(f,otherStore);
  await other.begin(f.invite,f.caller,now);
  assert.equal(await other.receive(selection(f,f.event('accept',{device2:true})),f.caller,now+2),true);
  assert.equal((await recipient(f,otherStore).snapshot(now+3)).status,'answered-elsewhere');
  assert.equal(await other.receive(accept,f.callee,now+4),false);
  await assert.rejects(recipient(f,otherStore,f.b2.id).snapshot(now+5),/journal/);
});
test('saved selection outbox replays identical bytes after reopening and stops at cancel or expiry', async () => {
  const f=fixture(), store=memoryStore(), a=session(f,store), accept=f.event('accept'), selected=selection(f,accept);
  await a.begin(f.invite,f.caller,now);
  await a.receive(accept,f.callee,now+2);
  assert.equal(await a.pendingSelection(f.caller,now+3),null);
  await a.receive(selected,f.caller,now+4);
  assert.equal(await session(f,store).pendingSelection(f.caller,now+5),selected);
  assert.equal(await session(f,store).pendingSelection(f.caller,now+6),selected);
  assert.equal(await a.pendingSelection(f.caller,now+60000),null);
  await assert.rejects(a.pendingSelection(f.caller,now+7),/clock/);
  const store2=memoryStore(), b=session(f,store2);
  await b.begin(f.invite,f.caller,now); await b.receive(accept,f.callee,now+2); await b.receive(selected,f.caller,now+3);
  await b.receive(f.event('cancel',{sequence:2}),f.caller,now+4);
  assert.equal(await session(f,store2).pendingSelection(f.caller,now+5),null);
});
test('decline is durable on the receiving device and unconfirmed acceptance expires', async () => {
  const f=fixture(), store=memoryStore(), r=recipient(f,store);
  await r.begin(f.invite,f.caller,now); await r.receive(f.event('reject'),f.callee,now+2);
  assert.equal((await recipient(f,store).snapshot(now+3)).status,'rejected');
  assert.equal(await r.receive(f.event('accept',{sequence:2}),f.callee,now+4),false);
  const otherStore=memoryStore(), other=recipient(f,otherStore), accept=f.event('accept');
  await other.begin(f.invite,f.caller,now); await other.receive(accept,f.callee,now+2);
  assert.equal((await recipient(f,otherStore).snapshot(now+60000)).status,'expired');
  assert.equal(await other.receive(selection(f,accept),f.caller,now+60000),false);
});
test('signed selection binds the exact accepting device and acceptance', () => {
  const f=fixture(), accept=f.event('accept');
  const selected=f.event('selected',{selectedDevice:f.b.id,acceptance:c.callControlDigest(JSON.parse(accept))});
  assert.equal(c.verifyCallSelection(f.invite,accept,selected,f.caller,f.callee,now+3),true);
  for(const change of [{selectedDevice:f.b2.id},{acceptance:'cc'.repeat(32)}]) {
    const wrong=f.event('selected',{selectedDevice:f.b.id,acceptance:c.callControlDigest(JSON.parse(accept)),...change});
    assert.equal(c.verifyCallSelection(f.invite,accept,wrong,f.caller,f.callee,now+3),false);
  }
  assert.equal(c.verifyCallControl(JSON.stringify({...JSON.parse(selected),selectedDevice:f.b2.id}),f.caller,now+3),null);
});
test('concurrent acceptance chooses one durable winner and survives reopening', async () => {
  const f=fixture(), store=memoryStore(), a=session(f,store), b=session(f,store);
  assert.equal(await a.begin(f.invite,f.caller,now),true);
  const results=await Promise.all([a.receive(f.event('accept'),f.callee,now+2),b.receive(f.event('accept',{device2:true}),f.callee,now+2)]);
  assert.equal(results.filter(Boolean).length,1);
  const reopened=session(f,store), state=await reopened.snapshot(now+3);
  const selected=f.event('selected',{selectedDevice:state.selectedDevice,acceptance:state.acceptance});
  assert.equal(await reopened.receive(selected,f.caller,now+4),true);
  assert.equal((await session(f,store).snapshot(now+5)).confirmed,true);
  assert.equal(await session(f,store).receive(selected,f.caller,now+6),false);
});
test('cancelled state and observed expiry remain terminal after reopening', async () => {
  const f=fixture(), store=memoryStore(), a=session(f,store);
  await a.begin(f.invite,f.caller,now);
  await a.receive(f.event('cancel'),f.caller,now+2);
  assert.equal(await session(f,store).receive(f.event('accept'),f.callee,now+3),false);
  assert.equal(await session(f,store).begin(f.invite,f.caller,now+3),false);
  const g=fixture(), store2=memoryStore(), b=session(g,store2);
  await b.begin(g.invite,g.caller,now);
  assert.equal((await b.snapshot(now+60000)).status,'expired');
  assert.equal(await session(g,store2).receive(g.event('accept'),g.callee,now+3),false);
  await assert.rejects(session(g,store2).snapshot(now+3),/clock/);
});
test('disk failure never reports an accepted selection and corruption fails closed', async () => {
  const f=fixture(), store=memoryStore(), a=session(f,store);
  await a.begin(f.invite,f.caller,now);
  const broken={...store,compareAndSet:async()=>{throw Error('disk full');}};
  await assert.rejects(session(f,broken).receive(f.event('accept'),f.callee,now+2),/disk full/);
  assert.equal((await a.snapshot(now+3)).status,'ringing');
  store.corrupt();
  await assert.rejects(a.snapshot(now+4));
});
test('latest pinned identity blocks revoked signing devices', () => {
  const f=fixture(), next=p.issueRecord(seed(4),[f.b2],now+1,f.callee);
  assert.equal(c.verifyCallControl(f.event('accept'),next,now+2),null);
  assert.throws(()=>c.signCallControl({...f.fields,record:next},seed(5),now+2),/Unauthorized/);
});
test('first accepting device wins; duplicates and another device cannot end it', () => {
  const f=fixture(), accept=f.event('accept');
  assert.equal(f.state.receive(accept,f.callee,now+2),true);
  assert.equal(f.state.receive(accept,f.callee,now+3),false);
  assert.equal(f.state.receive(f.event('accept',{device2:true}),f.callee,now+3),false);
  const end = c.signCallControl({...JSON.parse(accept),kind:'end',sequence:2},seed(7),now+3);
  assert.equal(f.state.receive(end,f.callee,now+3),false);
  assert.equal(f.state.snapshot(now+3).selectedDevice,f.b.id);
  assert.equal(f.state.receive(f.event('end'),f.caller,now+3),true);
});
test('cancellation and expiry cannot be revived by delayed acceptance', () => {
  const f=fixture();
  assert.equal(f.state.receive(f.event('cancel'),f.caller,now+2),true);
  assert.equal(f.state.receive(f.event('accept'),f.callee,now+3),false);
  assert.equal(f.state.snapshot(now+3).status,'cancelled');
  const g=fixture();
  assert.equal(g.state.receive(g.event('accept'),g.callee,now+60000),false);
  assert.equal(g.state.snapshot(now+60000).status,'expired');
});
test('one device declining does not reject other devices; same device cannot revive', () => {
  const f=fixture();
  assert.equal(f.state.receive(f.event('reject'),f.callee,now+2),true);
  assert.equal(f.state.receive(f.event('accept',{sequence:2}),f.callee,now+3),false);
  assert.equal(f.state.receive(f.event('accept',{device2:true}),f.callee,now+3),true);
});
test('invitation binding, increasing sequences and role checks prevent cross-call actions', () => {
  const f=fixture();
  assert.equal(f.state.receive(f.event('ringing',{sequence:2}),f.callee,now+2),true);
  assert.equal(f.state.receive(f.event('accept'),f.callee,now+3),false);
  assert.equal(f.state.receive(f.event('accept',{sequence:3,invitation:'ff'.repeat(32)}),f.callee,now+3),false);
  assert.equal(f.state.receive(f.event('accept',{sequence:3,media:'video'}),f.callee,now+3),false);
  assert.equal(f.state.receive(f.event('accept',{sequence:3}),f.callee,now+3),true);
  assert.throws(()=>f.event('accept',{record:f.caller}),/Unauthorized/);
  assert.throws(()=>c.signCallControl({...JSON.parse(f.event('accept')),kind:'cancel'},seed(5),now+2),/Invalid/);
});

test('blocking a peer still saves our hangup locally and prevents network delivery',async()=>{
 const f=fixture(),x=runtimePair(f);assert.equal(await x.runtimes[0].submit(f.invite),true);
 x.block(0);assert.equal(await x.runtimes[0].submit(f.event('cancel')),true);
 assert.equal((await session(f,x.stores[0]).snapshot(now+10)).status,'cancelled');
 assert.equal(await x.runtimes[0].drain(JSON.parse(f.invite),x.peers[1]),0);assert.equal(x.sent[0].length,0);
});

test('expired selection outbox cannot be mistaken for a recipient acknowledgment',async()=>{
 const f=fixture(),store=memoryStore(),call=session(f,store),accept=f.event('accept'),selected=selection(f,accept);
 await call.begin(f.invite,f.caller,now);await call.receive(accept,f.callee,now+1);await call.receive(selected,f.caller,now+1);
 assert.deepEqual(await call.pendingEvents(f.caller,f.b.id,now+60001),[]);
 assert.equal(await call.selectionAcknowledged(f.b.id,now+60001),false);
 const receipt=delivery.signCallControlReceipt(JSON.parse(selected),f.callee,seed(5),now+2);
 assert.equal(await call.recordReceipt(receipt,f.callee,now+2),true);
 assert.equal(await call.selectionAcknowledged(f.b.id,now+60001),true);
 assert.equal(await call.selectionAcknowledged(f.b2.id,now+60001),false);
});

const relayModule=load('callControlRelay');
function courierFixture(f) {
 const device=p.publicDevice(seed(11),seed(12)), record=p.issueRecord(seed(10),[device],now);
 const peer={account:record.account,device:device.id,instance:'cc'.repeat(32),expiresAt:now+60000};
 let clock=now+2, live=true;
 const pins=new Map([f.caller,f.callee,record].map(r=>[r.account,r]));
 const blocked=new Set();
 const d={records:{read:async a=>pins.get(a)??null},now:()=>clock,current:()=>live,blocked:a=>blocked.has(a)};
 const relay=relayModule.createCallControlRelay(d);
 const sender={...peer,account:f.caller.account,device:f.a.id}, recipient={...peer,account:f.callee.account,device:f.b.id};
 return {relay,d,peer,sender,recipient,pins,blocked,time:t=>{clock=t;},stop:()=>{live=false;}};
}
test('relayed invitation authenticates original sender and persists before signing acknowledgment',async()=>{
 const f=fixture(),x=courierFixture(f),r=receiverDelivery(f,{records:x.d.records});
 assert.equal(await r.api.receive(f.invite,x.peer),null);
 const receipt=await r.api.receiveRelayed(f.invite,x.peer);
 assert.ok(delivery.verifyCallControlReceipt(receipt,JSON.parse(f.invite),f.callee,now+2));
 assert.equal((await r.r.snapshot(now+2)).status,'ringing');
 assert.ok(await r.api.receiveRelayed(f.invite,x.peer));
 assert.equal(JSON.parse(await r.store.read()).entries.length,1);
});
test('relayed admission rejects forged sender, unknown or revoked courier and blocked caller',async()=>{
 const f=fixture(),x=courierFixture(f);let saves=0;
 const r=receiverDelivery(f,{records:x.d.records,blocked:x.d.blocked,commit:async()=>{saves++;return true;}});
 assert.equal(await r.api.receiveRelayed(JSON.stringify({...JSON.parse(f.invite),media:'video'}),x.peer),null);
 assert.equal(await r.api.receiveRelayed(f.invite,{...x.peer,device:f.b.id}),null);
 x.blocked.add(f.caller.account);assert.equal(await r.api.receiveRelayed(f.invite,x.peer),null);x.blocked.clear();
 x.pins.delete(x.peer.account);assert.equal(await r.api.receiveRelayed(f.invite,x.peer),null);
 assert.equal(saves,0);
});
test('relayed admission does not acknowledge after courier revocation during persistence',async()=>{
 const f=fixture(),x=courierFixture(f),r=receiverDelivery(f,{records:x.d.records,commit:async()=>{x.pins.delete(x.peer.account);return true;}});
 assert.equal(await r.api.receiveRelayed(f.invite,x.peer),null);
});
test('ordinary courier forwards exact signed events and deletes delivered payload, retaining only receipt',async()=>{
 const f=fixture(),x=courierFixture(f),r=receiverDelivery(f,{records:x.d.records});
 assert.equal(await x.relay.put(f.invite,f.b.id,x.sender),true);
 assert.deepEqual(await x.relay.pending(x.recipient),[f.invite]);
 assert.deepEqual(await x.relay.pending(x.sender),[]);
 const receipt=await r.api.receiveRelayed(f.invite,x.peer);
 assert.equal(await x.relay.acknowledge(receipt,x.recipient),true);
 assert.deepEqual(await x.relay.pending(x.recipient),[]);
 assert.equal(await x.relay.put(f.invite,f.b.id,x.sender),true);
 assert.deepEqual(await x.relay.pending(x.recipient),[]);
 assert.deepEqual(await x.relay.receipts(x.sender),[receipt]);
 assert.deepEqual(await x.relay.receipts({...x.sender,device:f.b.id}),[]);
 x.time(now+60000);x.relay.sweep();assert.deepEqual(await x.relay.receipts({...x.sender,expiresAt:now+90000}),[]);
});
test('courier rejects impersonation, wrong-device acknowledgments and selected-device misrouting',async()=>{
 const f=fixture(),x=courierFixture(f);
 assert.equal(await x.relay.put(f.invite,f.b.id,x.peer),false);
 assert.equal(await x.relay.put(f.invite,f.a.id,x.sender),false);
 assert.equal(await x.relay.put(selection(f,f.event('accept')),f.b2.id,x.sender),false);
 assert.equal(await x.relay.put(f.invite,f.b.id,x.sender),true);
 const bad=delivery.signCallControlReceipt(JSON.parse(f.invite),f.callee,seed(7),now+2);
 assert.equal(await x.relay.acknowledge(bad,x.recipient),false);
 assert.deepEqual(await x.relay.pending(x.recipient),[f.invite]);
 x.pins.delete(f.caller.account);assert.deepEqual(await x.relay.pending(x.recipient),[]);
});
test('courier capacity is bounded per sender and released on expiry; stopped relay cannot accept work',async()=>{
 const f=fixture(),x=courierFixture(f);
 for(let i=0;i<17;i++) {
  const raw=c.signCallControl({...f.fields,callId:i.toString(16).padStart(64,'0')},seed(2),now);
  assert.equal(await x.relay.put(raw,f.b.id,x.sender),i<16);
 }
 assert.equal((await x.relay.pending(x.recipient)).length,8);
 x.time(now+60000);x.relay.sweep();x.time(now+2);
 assert.equal(await x.relay.put(f.invite,f.b.id,x.sender),true);
 x.relay.stop();assert.deepEqual(await x.relay.pending(x.recipient),[]);
 assert.equal(await x.relay.put(f.invite,f.b.id,x.sender),false);
});

test('relay endpoint isolates devices, bounds responses, and lets sender retire received receipts',async()=>{
 const f=fixture(),x=courierFixture(f),endpoint=relayModule.createCallRelayEndpoint(x.relay);
 const request=async(operation,fields={},peer=x.sender)=>JSON.parse(await endpoint(JSON.stringify({version:1,operation,...fields}),peer));
 assert.deepEqual(await request('put',{raw:f.invite,targetDevice:f.b.id}),{accepted:true});
 assert.deepEqual(await request('pending',{},x.recipient),{raw:f.invite});
 assert.deepEqual(await request('pending',{extra:true},x.recipient),{});
 const receipt=delivery.signCallControlReceipt(JSON.parse(f.invite),f.callee,seed(5),now+2);
 assert.deepEqual(await request('acknowledge',{raw:receipt},x.recipient),{accepted:true});
 assert.deepEqual(await request('receipts'),{raw:receipt});
 const fields={event:c.callControlDigest(JSON.parse(f.invite)),targetDevice:f.b.id};
 assert.deepEqual(await request('forget',fields,x.recipient),{accepted:false});
 assert.deepEqual(await request('forget',fields),{accepted:true});
 assert.deepEqual(await request('receipts'),{raw:null});
 assert.equal(await endpoint('x'.repeat(13001),x.sender),'{}');
});

const pumpModule=load('callRelayPump');
function pumpPair(f) {
 const x=courierFixture(f),stores=[memoryStore(),memoryStore()],participants=[f.caller,f.callee],devices=[f.a,f.b];
 const endpoint=relayModule.createCallRelayEndpoint(x.relay),requests=[],runtimes=[],pumps=[];
 let clock=now+2,live=true;
 for(let i=0;i<2;i++) {
  const who=participants[i],device=devices[i],peer=i?x.recipient:x.sender;
  const rt=runtime.createCallControlRuntime({account:who.account,device:device.id,store:stores[i],records:x.d.records,
   now:()=>clock,current:()=>live,blocked:()=>false,courierBlocked:()=>false,
   signReceipt:async(e,t)=>delivery.signCallControlReceipt(e,who,seed(i?5:2),t),send:async()=>{throw Error('No direct path');}});
  runtimes.push(rt);
  pumps.push(pumpModule.createCallRelayPump({account:who.account,device:device.id,store:stores[i],records:x.d.records,
   now:()=>clock,current:()=>live,blocked:()=>false,peers:()=>[x.peer],direct:()=>[],
   list:async()=>{const saved=await stores[i].read();return saved?[JSON.parse(JSON.parse(saved).entries[0].raw)]:[];},
   request:async(p,raw)=>{requests.push({i,operation:JSON.parse(raw).operation});return endpoint(raw,peer);},receive:rt.receiveRelayed}));
 }
 return {...x,stores,runtimes,pumps,requests,step:async()=>{clock+=2000;x.time(clock);await pumps[0].tick();await pumps[1].tick();},time:()=>clock,lock:()=>{live=false;}};
}
test('relay pumps persist recipient receipt before retiring courier proof and survive endpoint reopening',async()=>{
 const f=fixture(),x=pumpPair(f);
 assert.equal(await x.runtimes[0].submit(f.invite),true);
 for(let i=0;i<9;i++)await x.step();
 assert.equal((await recipient(f,x.stores[1]).snapshot(x.time())).status,'ringing');
 assert.deepEqual(await session(f,x.stores[0]).pendingEvents(f.caller,f.b.id,x.time()),[]);
 assert.ok(x.requests.some(r=>r.operation==='forget'));
 assert.deepEqual(await x.relay.receipts(x.sender),[]);
 // Re-open from the same journal: the peer's proof is durable, not a volatile pump flag.
 assert.deepEqual(await durable.createDurableCallerCallControl(x.stores[0],f.caller.account,f.fields.callId).pendingEvents(f.caller,f.b.id,x.time()),[]);
 x.pumps.forEach(p=>p.stop());const count=x.requests.length;await x.step();assert.equal(x.requests.length,count);
});
test('a courier deposit is never counted as recipient delivery',async()=>{
 const f=fixture(),x=pumpPair(f);await x.runtimes[0].submit(f.invite);x.pumps[1].stop();
 for(let i=0;i<6;i++)await x.step();
 assert.ok(x.requests.some(r=>r.operation==='put'));
 assert.deepEqual(await session(f,x.stores[0]).pendingEvents(f.caller,f.b.id,x.time()),[f.invite]);
 assert.equal(await x.stores[1].read(),null);
 x.lock();const count=x.requests.length;await x.step();assert.equal(x.requests.length,count);
});
test('courier eligibility is independent of caller contact permissions',async()=>{
 const f=fixture(),x=courierFixture(f);
 const receiver=receiverDelivery(f,{records:x.d.records,blocked:account=>account!==f.caller.account,courierBlocked:()=>false});
 assert.ok(await receiver.api.receiveRelayed(f.invite,x.peer));
 const blocked=receiverDelivery(f,{records:x.d.records,blocked:()=>true,courierBlocked:()=>false});
 assert.equal(await blocked.api.receiveRelayed(f.invite,x.peer),null);
});

test('relay pump prevents overlap and discards an in-flight response after locking',async()=>{
 const f=fixture(),x=courierFixture(f);let live=true,release,requests=0,received=0;
 const pump=pumpModule.createCallRelayPump({account:f.callee.account,device:f.b.id,store:memoryStore(),records:x.d.records,
  current:()=>live,now:()=>now+2,blocked:()=>false,peers:()=>[x.peer],direct:()=>[],list:async()=>[],
  request:async()=>{requests++;return new Promise(r=>release=r);},receive:async()=>{received++;return 'bad';}});
 const pending=pump.tick();await new Promise(r=>setImmediate(r));await pump.tick();assert.equal(requests,1);
 live=false;release(JSON.stringify({raw:f.invite}));await pending;assert.equal(received,0);assert.equal(requests,1);
});

const wake=load('callWakeProtocol');
test('compact call wake verifies with pinned public identity without unlocking signing keys',()=>{
 const f=fixture(),data=wake.createCallWake(f.invite,f.b.id,now);
 assert.ok(data);assert.ok(Buffer.byteLength(JSON.stringify(data))<3500);assert.equal(JSON.parse(data.event).record,undefined);
 assert.equal(wake.callWakeSender(data),f.caller.account);
 assert.deepEqual(JSON.parse(wake.verifyCallWake(data,f.caller,f.callee.account,f.b.id,now)),JSON.parse(f.invite));
 for(const bad of [{...data,targetDevice:f.b2.id},{...data,record:'00'.repeat(32)},{...data,event:JSON.stringify({...JSON.parse(data.event),media:'video'})}])
  assert.equal(wake.verifyCallWake(bad,f.caller,f.callee.account,f.b.id,now),null);
 assert.equal(wake.verifyCallWake(data,f.caller,f.callee.account,f.b.id,now+60000),null);
 assert.equal(wake.verifyCallWake(data,f.caller,f.caller.account,f.b.id,now),null);
 assert.equal(wake.createCallWake(f.event('accept'),f.a.id,now+2),null);
 assert.ok(wake.createCallWake(f.event('cancel'),f.b.id,now+2));
});

test('journal samples its live clock after queued reads without accepting a real clock rollback',async()=>{
 const f=fixture(),store=memoryStore();let clock=now;
 const call=durable.createDurableCallerCallControl(store,f.caller.account,f.fields.callId,()=>clock);
 await call.begin(f.invite,f.caller,clock);clock=now+20;await call.snapshot(now+20);
 assert.equal((await call.snapshot(now)).status,'ringing');
 clock=now-1;await assert.rejects(call.snapshot(now+100),/Invalid call clock/);
});

test('history retirement waits for terminal state and every signed delivery deadline',async()=>{
 const f=fixture(),store=memoryStore(),call=durable.createDurableCallerCallControl(store,f.caller.account,f.fields.callId);
 await call.begin(f.invite,f.caller,now);let raw=await store.read();
 assert.equal(durable.canArchiveCallJournal(raw,now),false);
 assert.equal(durable.canArchiveCallJournal(raw,now+60001),true,'unanswered expired call can retire');
 await call.receive(f.event('cancel'),f.caller,now+1);raw=await store.read();
 assert.equal(durable.canArchiveCallJournal(raw,now+2),false,'cancellation still needs delivery');
 assert.equal(durable.canArchiveCallJournal(raw,now+60001),true);
 const bad=JSON.parse(raw);bad.entries[0].raw=bad.entries[0].raw.replace('voice','video');
 assert.equal(durable.canArchiveCallJournal(JSON.stringify(bad),now+60001),false);
 assert.equal(durable.canArchiveCallJournal(raw,now-1),false);
});
