const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load}=require('./helpers/attachment.cjs');
const {createDirectAttachmentStream,DIRECT_FRAME_BYTES}=load('directAttachmentStream');
const digest='a'.repeat(64),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function pair(t,size=524287,options={}){
 const source=crypto.randomBytes(size),expected={digest,bytes:size,checksum:hash(source)},parts=[];
 let a,b,active=true,clock=0,pos=0,discarded=0,readClosed=0,writeClosed=0;
 const wait=()=>new Promise(setImmediate),errors=[];
 const deliver=(target,data)=>queueMicrotask(()=>target.receive(typeof data==='string'?data:data.slice().buffer).catch(e=>errors.push(e)));
 const common={expected,live:()=>active,now:()=>clock,wait,close(){},discard(){discarded++;parts.length=0;}};
 a=createDirectAttachmentStream({...common,role:'send',hash:async()=>expected.checksum,
  reader:()=>({read:n=>{const v=new Uint8Array(source.subarray(pos,pos+n));pos+=n;return v;},close:()=>readClosed++}),
  send:data=>deliver(b,data)});
 b=createDirectAttachmentStream({...common,role:'receive',authorize:options.authorize,consumed:options.consumed,
  writer:()=>({write:v=>parts.push(Buffer.from(v)),close:()=>writeClosed++}),
  hash:async()=>options.hash?options.hash():hash(Buffer.concat(parts)),send:data=>deliver(a,data)});
 t.after(()=>{a.abort('test cleanup');b.abort('test cleanup');});
 return {a,b,source,parts,errors,start:()=>{void b.start();return a.start();},
  revoke:()=>active=false,advance:n=>clock+=n,stats:()=>({discarded,readClosed,writeClosed})};
}
for(const size of [1,16384,16385,524287,2097151])test(`direct stream verifies ${size} bytes including tail`,async t=>{
 const f=pair(t,size);await f.start();await f.b.done;
 assert.deepEqual(Buffer.concat(f.parts),f.source);assert.deepEqual(f.stats(),{discarded:0,readClosed:1,writeClosed:1});assert.deepEqual(f.errors,[]);
});
test('receiver checksum failure cannot complete and removes partial data',async t=>{
 const f=pair(t,17000,{hash:()=> '0'.repeat(64)});void f.start().catch(()=>{});
 await assert.rejects(f.b.done,/checksum/);assert.equal(f.stats().discarded,1);assert.equal(f.parts.length,0);
});
test('account invalidation closes idle sessions without further network traffic',async t=>{
 const f=pair(t);void f.b.start();f.revoke();await assert.rejects(f.b.done,/revoked/);assert.equal(f.stats().discarded,1);
});
test('receiver waiting for offer times out and cleans its attempt',async t=>{
 const f=pair(t);void f.b.start();f.advance(15001);await assert.rejects(f.b.done,/timeout/);
});
test('late hash completion after cancellation cannot emit completion',async t=>{
 let release,entered=false;const gate=new Promise(r=>release=r);
 const f=pair(t,17,{hash:async()=>{entered=true;await gate;return hash(f.source);}});void f.start().catch(()=>{});
 while(!entered)await new Promise(setImmediate);f.b.abort('cancelled');release();
 await assert.rejects(f.b.done,/cancelled/);await new Promise(setImmediate);assert.equal(f.stats().discarded,1);
});
for(const mutation of [m=>({...m,digest:'b'.repeat(64)}),m=>({...m,bytes:m.bytes+1}),m=>({...m,checksum:'b'.repeat(64)}),m=>({...m,extra:true})])
test('offer must exactly match the authorized chat attachment',async t=>{
 const f=pair(t,17);void f.b.start();
 await assert.rejects(f.b.receive(JSON.stringify(mutation({kind:'start',digest,bytes:17,checksum:hash(f.source)}))));
 await assert.rejects(f.b.done);assert.equal(f.stats().writeClosed,0);
});
test('unsolicited or oversized binary data is rejected before writing',async t=>{
 const f=pair(t);void f.b.start();await assert.rejects(f.b.receive(new ArrayBuffer(DIRECT_FRAME_BYTES+1)),/bound/);
 await assert.rejects(f.b.done);assert.equal(f.parts.length,0);
});
test('premature completion is rejected',async t=>{
 const f=pair(t);void f.a.start().catch(()=>{});
 await assert.rejects(f.a.receive(JSON.stringify({kind:'complete',digest,bytes:f.source.length,checksum:hash(f.source)})));
 await assert.rejects(f.a.done);assert.equal(f.stats().readClosed,0);
});
test('no file is opened and no bytes sent until native admission completes',async t=>{
 let release,entered=false;const gate=new Promise(r=>release=r);
 const f=pair(t,524287,{authorize:async()=>{entered=true;await gate;}});const pending=f.start();
 while(!entered)await new Promise(setImmediate);
 assert.equal(f.parts.length,0);assert.equal(f.stats().readClosed,0);release();await pending;
 assert.deepEqual(Buffer.concat(f.parts),f.source);
});
test('native credit is replenished only for successfully written prefixes',async t=>{
 const offsets=[];const f=pair(t,524287,{consumed:async offset=>{assert.equal(Buffer.concat(f.parts).length,offset);offsets.push(offset);}});
 await f.start();assert.deepEqual(offsets,[131072,262144,393216]);
});
test('native admission rejection fails without writing',async t=>{
 const f=pair(t,17000,{authorize:async()=>{throw Error('Native admission refused');}});void f.start().catch(()=>{});
 await assert.rejects(f.b.done,/Native admission refused/);assert.equal(f.parts.length,0);assert.equal(f.stats().writeClosed,0);
});
