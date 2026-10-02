const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const p=load('identityProtocol'),{createIdentityDirectoryLookup}=load('identityDirectoryLookup'),{DIRECTORY_DOMAIN,DIRECTORY_LEASE}=load('identityDirectory');
const time=1800000000000,random=()=>new Uint8Array(crypto.randomBytes(32));
function identity(){const root=random(),device=p.publicDevice(random(),random());return {root,device,record:p.issueRecord(root,[device],time),history:[]};}
const packet=a=>({record:a.record,history:a.history});const found=a=>JSON.stringify({domain:DIRECTORY_DOMAIN,status:'found',packet:packet(a),until:time+DIRECTORY_LEASE});
const empty=()=>JSON.stringify({domain:DIRECTORY_DOMAIN,status:'not-found'});
function fixture(replies,anchor=null){const peers=replies.map(()=>identity().record.account);let current=true,pin=anchor,reads=0;const resolver=createIdentityDirectoryLookup({pins:{read:async()=>{reads++;return pin;}},current:()=>current,peers:()=>peers,now:()=>time,request:async peer=>{const r=replies[peers.indexOf(peer)];return typeof r==='function'?r():r;}});return{resolver,peers,setCurrent:v=>current=v,setPin:v=>pin=v,reads:()=>reads};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('multiple signed copies yield a read-only result without requiring three or writing a trust pin',async()=>{
 const a=identity(),f=fixture([found(a),found(a),null]);const result=await f.resolver.lookup(a.record.account);
 assert.equal(result.status,'found');assert.equal(result.sources.length,2);assert.equal(result.rejected,1);assert.equal(result.queried,3);assert.equal(p.recordDigest(result.packet.record),p.recordDigest(a.record));
});
test('one conflicting valid signature defeats an arbitrary majority of matching replicas',async()=>{
 const a=identity(),genesis=a.record;a.record=p.issueRecord(a.root,[a.device],time+1,genesis);a.history=[genesis];
 const fork={record:p.issueRecord(a.root,[p.publicDevice(random(),random())],time+1,genesis),history:[genesis]};
 const f=fixture([found(a),found(a),found(a),found(fork)]);const r=await f.resolver.lookup(a.record.account);assert.equal(r.status,'conflict');assert.equal(r.packet,undefined);
});
test('valid signed records with a history gap remain unresolved',async()=>{
 const a=identity(),genesis=a.record,next=p.issueRecord(a.root,[a.device],time+1,genesis);a.record=p.issueRecord(a.root,[a.device],time+2,next);
 const f=fixture([found(a)],genesis);assert.equal((await f.resolver.lookup(a.record.account)).status,'missing-history');
});
test('individually signed intermediate records can fill bounded ancestry across replicas',async()=>{
 const a=identity(),genesis=a.record,next=p.issueRecord(a.root,[a.device],time+1,genesis);a.record=p.issueRecord(a.root,[a.device],time+2,next);
 const f=fixture([found(a),found({record:next,history:[]})],genesis);const r=await f.resolver.lookup(a.record.account);
 assert.equal(r.status,'found');assert.equal(r.packet.history.length,2);assert.equal(p.compareRecord(r.packet.record,genesis,time,r.packet.history),'accept');assert.equal(r.sources.length,1);
});
test('a newer local pin prevents accepting older network data',async()=>{
 const a=identity(),next=p.issueRecord(a.root,[a.device],time+1,a.record),f=fixture([found(a)],next);
 assert.equal((await f.resolver.lookup(a.record.account)).status,'stale');
});
test('a contradictory signed ancestor is a conflict even when the highest revisions differ',async()=>{
 const a=identity(),genesis=a.record,branch=p.issueRecord(a.root,[p.publicDevice(random(),random())],time+1,genesis);
 const first=p.issueRecord(a.root,[a.device],time+1,genesis);a.record=p.issueRecord(a.root,[a.device],time+2,first);a.history=[genesis,first];
 assert.equal((await fixture([found(a),found({record:branch,history:[genesis]})]).resolver.lookup(a.record.account)).status,'conflict');
});
test('wrong identities, tampered signatures, expired leases and oversized replies are rejected',async()=>{
 const a=identity(),wrong=identity(),tampered=JSON.parse(found(a));tampered.packet.record.signature='00'.repeat(64);
 const expired=JSON.parse(found(a));expired.until=time+100;
 const f=fixture([found(wrong),JSON.stringify(tampered),JSON.stringify(expired),'x'.repeat(13001),empty()]);const r=await f.resolver.lookup(a.record.account);
 assert.equal(r.status,'not-found');assert.equal(r.answered,1);assert.equal(r.rejected,4);assert.equal(r.packet,undefined);
});
test('lock followed by unlock cannot revive an old lookup; concurrent calls are bounded',async()=>{
 const a=identity(),gate=deferred(),f=fixture([()=>gate.promise]);const first=f.resolver.lookup(a.record.account);
 assert.equal((await f.resolver.lookup(a.record.account)).status,'busy');f.setCurrent(false);f.resolver.invalidate();f.setCurrent(true);gate.resolve(found(a));
 assert.equal((await first).status,'cancelled');assert.equal(f.reads(),0);
});
test('the local pin is reread after network replies, rather than retaining an earlier revision',async()=>{
 const a=identity(),gate=deferred(),f=fixture([()=>gate.promise],a.record),pending=f.resolver.lookup(a.record.account);
 f.setPin(p.issueRecord(a.root,[a.device],time+1,a.record));gate.resolve(found(a));assert.equal((await pending).status,'stale');
});
test('duplicate peers count once, at most ten peers are queried, and invalid input does no work',async()=>{
 const a=identity(),peers=Array.from({length:12},()=>identity().record.account);let calls=0;
 const resolver=createIdentityDirectoryLookup({pins:{read:async()=>null},current:()=>true,peers:()=>[peers[0],...peers],now:()=>time,request:async()=>{calls++;return found(a);}});
 assert.equal((await resolver.lookup('invalid')).status,'invalid');assert.equal(calls,0);
 const r=await resolver.lookup(a.record.account);assert.equal(r.queried,10);assert.equal(r.sources.length,10);assert.equal(calls,10);
 resolver.stop();assert.equal((await resolver.lookup(a.record.account)).status,'cancelled');
});
test('failed local storage cannot be bypassed by otherwise valid network responses',async()=>{
 const a=identity(),resolver=createIdentityDirectoryLookup({pins:{read:async()=>{throw Error('Disk error');}},current:()=>true,peers:()=>[identity().record.account],now:()=>time,request:async()=>found(a)});
 assert.equal((await resolver.lookup(a.record.account)).status,'unavailable');
});
