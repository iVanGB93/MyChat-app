const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs'),{createProfileRecovery}=load('profileRecovery');
const a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64),c='axonic:1:'+'c'.repeat(64);
const flush=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};
function fixture(t){t.mock.timers.enable({apis:['setTimeout']});let active=true,peers=[b,c],offers=[b,c],calls=[],knownCalls=0,success=true;const state={version:1,messages:[],contacts:[{account:b,accepted:true,blocked:false,alias:''}]};const worker=createProfileRecovery({owner:()=>active?a:null,state:async()=>state,peers:()=>peers,offerPeers:()=>offers,remember:async()=>{},known:async()=>{knownCalls++;return null;},request:async(peer)=>calls.push({peer,legacy:true}),send:async(peer,raw)=>{calls.push({peer,raw});return success;}});t.after(()=>worker.stop());return {worker,state,calls,knownCalls:()=>knownCalls,setSuccess:v=>success=v,setPeers:v=>peers=v,setOffers:v=>offers=v,lock:()=>active=false,step:async(ms=0)=>{t.mock.timers.tick(ms);await flush();}};}

test('avatar sync runs only on events, skips unrelated routers, and compares again on reconnect',async t=>{
 const f=fixture(t);f.worker.changed();await f.step();assert.equal(f.calls.length,1);assert.equal(f.calls[0].peer,b);
 await f.step(60*60*1000);assert.equal(f.calls.length,1);f.worker.changed();await f.step();assert.equal(f.calls.length,1);
 f.worker.connected(b);await f.step();assert.equal(f.calls.length,2);assert.equal(f.knownCalls(),0);
 f.state.contacts.push({account:c,accepted:true,blocked:false,alias:''});f.worker.changed();await f.step();assert.equal(f.calls.length,3);assert.equal(f.calls[2].peer,c);
});
test('failed announcements have bounded retries and lock cancels scheduled work',async t=>{
 const f=fixture(t);f.setSuccess(false);f.worker.changed();await f.step();await f.step(2000);await f.step(2000);await f.step(600000);assert.equal(f.calls.length,3);
 f.worker.connected(b);f.lock();f.worker.invalidate();await f.step(600000);assert.equal(f.calls.length,3);
});
test('legacy peers get a version request on connection, not periodic polling',async t=>{
 const f=fixture(t);f.setOffers([]);f.worker.connected(b);await f.step();assert.equal(f.calls.length,1);assert(f.calls[0].legacy);
 await f.step(3600000);assert.equal(f.calls.length,1);f.worker.connected(b);await f.step();assert.equal(f.calls.length,2);
});
test('thrown transport failures cannot create an endless retry timer',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const worker=createProfileRecovery({owner:()=>a,state:async()=>({version:1,messages:[],contacts:[{account:b,accepted:true,blocked:false}]}),peers:()=>[b],offerPeers:()=>[b],remember:async()=>{},known:async()=>null,request:async()=>{},send:async()=>{calls++;throw Error('closed');}});t.after(()=>worker.stop());
 worker.changed();for(const ms of [0,2000,2000,3600000]){t.mock.timers.tick(ms);await flush();}assert.equal(calls,3);
});
