const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name.startsWith('./')?load(name.slice(2).replace(/\.ts$/,'')):require(name),out);cache.set(name,out);return out;}
const p=load('identityProtocol'),{createPeerIdentityResolver}=load('peerIdentityResolver'),now=1800000000000;
const seed=()=>new Uint8Array(crypto.randomBytes(32));
function identity(){const root=seed(),device=p.publicDevice(seed(),seed());return {root,record:p.issueRecord(root,[device],now),device};}
const found=(record,history=[])=>({status:'found',queried:1,answered:1,rejected:0,sources:[],packet:{record,history}});
const missing=status=>({status,queried:0,answered:0,rejected:0,sources:[]});
function fixture(initial=null){let pin=initial,live=true,reads=0,writes=0,queries=0,waits=0,time=now,reply=missing('unavailable'),fail=false;
 const records={read:async()=>{reads++;return pin;},compareAndSet:async(account,digest,next,history)=>{writes++;if(fail||(pin?p.recordDigest(pin):null)!==digest||p.compareRecord(next,pin,time,history)!=='accept')return false;pin=JSON.parse(JSON.stringify(next));return true;}};
 const resolver=createPeerIdentityResolver({records,current:()=>live,now:()=>time,lookup:async account=>{queries++;return typeof reply==='function'?reply(account):reply;},wait:async()=>{waits++;}});
 return {resolver,records,setReply:r=>reply=r,setLive:v=>live=v,setTime:v=>time=v,setPin:v=>pin=v,fail:v=>fail=v,pin:()=>pin,stats:()=>({reads,writes,queries,waits})};
}
test('verified stored device keys remain usable with no online directory replicas',async()=>{
 const a=identity(),f=fixture(a.record),result=await f.resolver.resolve(a.record.account);assert.equal(result.status,'found');assert.equal(result.source,'stored');assert.equal(f.stats().queries,0);assert.equal(f.stats().writes,0);
});
test('a routed directory result is validated and durably pinned before operational use',async()=>{
 const a=identity(),f=fixture();f.setReply(found(a.record));const result=await f.resolver.resolve(a.record.account);assert.equal(result.status,'found');assert.equal(result.source,'directory');assert.equal(f.stats().writes,1);assert.equal(p.recordDigest(f.pin()),p.recordDigest(a.record));
 const next=await f.resolver.resolve(a.record.account);assert.equal(next.source,'stored');assert.equal(f.stats().queries,1);
});
test('expired cached keys cannot authorize delivery and remain ancestry anchors for renewal',async()=>{
 const a=identity(),f=fixture(a.record);f.setTime(a.record.expiresAt+1);assert.equal((await f.resolver.resolve(a.record.account)).status,'unavailable');
 const next=p.issueRecord(a.root,[a.device],a.record.expiresAt+1,a.record);f.setTime(a.record.expiresAt+30001);f.setReply(found(next,[a.record]));assert.equal((await f.resolver.resolve(a.record.account)).status,'found');assert.equal(f.pin().revision,1);
});
test('concurrent requests for one peer share acquisition and a single pin write',async()=>{
 const a=identity(),f=fixture();let release;f.setReply(()=>new Promise(resolve=>release=resolve));const first=f.resolver.resolve(a.record.account),second=f.resolver.resolve(a.record.account);assert.equal(first,second);await new Promise(resolve=>setImmediate(resolve));release(found(a.record));assert.equal((await first).status,'found');assert.equal(f.stats().writes,1);
});
test('another directory lookup being busy is retried within a fixed bound',async()=>{
 const a=identity(),f=fixture();f.setReply(()=>f.stats().queries<3?missing('busy'):found(a.record));assert.equal((await f.resolver.resolve(a.record.account)).status,'found');assert.equal(f.stats().waits,2);
 const stuck=fixture();stuck.setReply(missing('busy'));assert.equal((await stuck.resolver.resolve(a.record.account)).status,'busy');assert.equal(stuck.stats().queries,9);assert.equal(stuck.stats().waits,8);
});
test('tampered signatures, wrong addresses and malformed directory packets never become pins',async()=>{
 const a=identity(),other=identity();for(const packet of [found({...a.record,signature:'00'.repeat(64)}),found(other.record),{...found(a.record),packet:{record:a.record,history:[],private:'forbidden'}}]){const f=fixture();f.setReply(packet);assert.equal((await f.resolver.resolve(a.record.account)).status,'invalid');assert.equal(f.stats().writes,0);assert.equal(f.pin(),null);}
 const corrupted=fixture({...a.record,signature:'00'.repeat(64)});assert.equal((await corrupted.resolver.resolve(a.record.account)).status,'invalid');assert.equal(corrupted.stats().queries,0);
});
test('a lock/unlock cancellation cannot pin or return the result of the interrupted lookup',async()=>{
 const a=identity(),f=fixture();let release;f.setReply(()=>new Promise(resolve=>release=resolve));const pending=f.resolver.resolve(a.record.account);await new Promise(resolve=>setImmediate(resolve));f.setLive(false);f.resolver.invalidate();f.setLive(true);release(found(a.record));assert.equal((await pending).status,'cancelled');assert.equal(f.stats().writes,0);
});
test('newer, conflicting or disconnected signed ancestry learned during lookup blocks old replies',async()=>{
 const a=identity(),next=p.issueRecord(a.root,[a.device],now+1,a.record),fork=p.issueRecord(a.root,[p.publicDevice(seed(),seed())],now+1,a.record);
 for(const [anchor,packet,status] of [[next,found(a.record),'stale'],[next,found(fork,[a.record]),'conflict'],[a.record,found(p.issueRecord(a.root,[a.device],now+2,next)),'missing-history']]){
  const f=fixture();f.setReply(()=>{f.setPin(anchor);return packet;});assert.equal((await f.resolver.resolve(a.record.account)).status,status);assert.equal(f.stats().writes,0);
 }
});
test('storage failure or full capacity cannot be bypassed by a valid lookup response',async()=>{
 const a=identity(),f=fixture();f.fail(true);f.setReply(found(a.record));assert.equal((await f.resolver.resolve(a.record.account)).status,'unavailable');assert.equal(f.pin(),null);
 const failed=createPeerIdentityResolver({records:{read:async()=>{throw Error('disk');},compareAndSet:async()=>{throw Error('unexpected write');}},lookup:async()=>found(a.record),now:()=>now,current:()=>true});assert.equal((await failed.resolve(a.record.account)).status,'unavailable');
});
test('network conflict statuses are preserved; stopping and invalid input do no acquisition',async()=>{
 const a=identity();for(const status of ['conflict','missing-history','stale','not-found']){const f=fixture();f.setReply(missing(status));assert.equal((await f.resolver.resolve(a.record.account)).status,status);assert.equal(f.stats().writes,0);}
 const f=fixture();assert.equal((await f.resolver.resolve('bad')).status,'invalid');f.resolver.stop();assert.equal((await f.resolver.resolve(a.record.account)).status,'cancelled');assert.equal(f.stats().reads,0);
});
test('waiting media cannot flood directory requests and disconnect an otherwise healthy axon',async()=>{
 const a=identity(),f=fixture();f.setReply(missing('not-found'));
 for(let i=0;i<150;i++){f.setTime(now+i*200);assert.equal((await f.resolver.resolve(a.record.account)).status,'not-found');}
 assert.equal(f.stats().queries,1,'a 200ms attachment tick must not send 150 directory requests');
 f.setTime(now+30000);f.setReply(found(a.record));assert.equal((await f.resolver.resolve(a.record.account)).status,'found');assert.equal(f.stats().queries,2);
});
test('a newly authenticated stored pin bypasses the temporary missing-directory backoff',async()=>{
 const a=identity(),f=fixture();assert.equal((await f.resolver.resolve(a.record.account)).status,'unavailable');f.setPin(a.record);
 assert.equal((await f.resolver.resolve(a.record.account)).status,'found');assert.equal(f.stats().queries,1);
});
