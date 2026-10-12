const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDirectStreamSession}=require('../scripts/experiments/direct-stream-session.cjs');
const id='ab'.repeat(32),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function pair(size,{tamper=false}={}){
 const plain=crypto.randomBytes(size),files=[new Map([[id,plain]]),new Map()],sessions=[],active=[true,true],wire=[],reads=[],handles=[0,0];
 for(let i=0;i<2;i++)sessions[i]=createDirectStreamSession({
  live:()=>active[i],now:()=>performance.now(),wait:()=>new Promise(setImmediate),close(){active[i]=false;},remove:id=>files[i].delete(id),
  hash:async(id,bytes)=>{assert.equal(files[i].get(id).length,bytes);return hash(files[i].get(id));},
  reader(id){let offset=0;handles[i]++;return {read(n){reads.push(n);const b=files[i].get(id).subarray(offset,offset+n);offset+=b.length;return b;},close(){handles[i]--;}};},
  writer(id){assert(!files[i].has(id));handles[i]++;files[i].set(id,Buffer.alloc(0));return {write(b){files[i].set(id,Buffer.concat([files[i].get(id),b]));},close(){handles[i]--;}};},
  send(value){let frame=value;if(typeof value!=='string'){const b=Uint8Array.from(value);if(tamper){tamper=false;b[0]^=1;}frame=b.buffer;}wire.push({side:i,frame});queueMicrotask(()=>sessions[1-i].receive(frame).catch(()=>{sessions[i].abort('Peer rejected');}));}
 });
 return {plain,files,sessions,active,wire,reads,handles};
}
for(const frame of [16384,65536])test('direct stream experiment verifies non-aligned file with bounded reads '+frame,async()=>{
 const f=pair(512*1024+17),result=await f.sessions[0].send(id,f.plain.length,frame);
 assert(result.verified);assert.deepEqual(f.files[1].get(id),f.plain);assert(f.reads.every(n=>n<=frame));assert.deepEqual(f.handles,[0,0]);
 assert.equal(f.wire.filter(x=>typeof x.frame==='string'&&JSON.parse(x.frame).kind==='start').length,1);
 assert.equal(f.wire.filter(x=>typeof x.frame==='string'&&JSON.parse(x.frame).kind==='complete').length,1);
 f.sessions.forEach(s=>s.abort('Test complete'));
});
test('direct stream rejects modified bytes without publishing completion',async()=>{
 const f=pair(65537,{tamper:true});await assert.rejects(f.sessions[0].send(id,f.plain.length,65536));
 assert(!f.files[1].has(id));assert(!f.wire.some(x=>typeof x.frame==='string'&&JSON.parse(x.frame).kind==='complete'));assert.deepEqual(f.handles,[0,0]);
});
test('direct stream refuses unauthenticated endpoints and invalid size',async()=>{
 const f=pair(1);f.active[0]=false;await assert.rejects(f.sessions[0].send(id,1,16384),/unavailable/);assert.equal(f.wire.length,0);
 await assert.rejects(f.sessions[1].receive(JSON.stringify({kind:'start',id,bytes:2**30,frameBytes:65536,hash:hash(f.plain)})),/offer/);assert.equal(f.files[1].size,0);
});
test('unexpected binary bytes and oversized frames close the experimental lane',async()=>{
 for(const size of [1,65537]){const f=pair(1);await assert.rejects(f.sessions[1].receive(new ArrayBuffer(size)));assert.equal(f.active[1],false);assert.equal(f.files[1].size,0);}
});
test('disconnect deletes only the incomplete receiving fixture',async()=>{
 const f=pair(100000);await f.sessions[1].receive(JSON.stringify({kind:'start',id,bytes:f.plain.length,frameBytes:65536,hash:hash(f.plain)})).catch(()=>{});
 f.sessions[1].abort('Disconnected');assert(!f.files[1].has(id));assert(f.files[0].has(id));
});
