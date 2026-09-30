const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const {createAccountIdentityLifecycle}=load('accountIdentityLifecycle'),{createAccountIdentityAccess}=load('accountIdentityStorage');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('switching owners immediately revokes the old lease and closes it before the next attach',async()=>{
 const events=[],leases=[];
 const life=createAccountIdentityLifecycle({create:owner=>({lock:()=>events.push(`lock${owner}`)}),unlock:async()=>{},
  attach:(owner,id,current)=>{events.push(`attach${owner}`);leases.push(current);return()=>events.push(`stop${owner}`);}});
 life.set(14,true);await life.settled();assert.equal(leases[0](),true);
 life.set(18,true);assert.equal(leases[0](),false);assert(events.includes('lock14'));await life.settled();
 assert(events.indexOf('stop14')<events.indexOf('attach18'));life.set(18,false);assert.equal(leases[1](),false);assert.equal(life.snapshot().state,'idle');
 life.stop();
});
test('background/foreground during unlock serializes opens and never attaches a stale identity',async()=>{
 let release,opens=0,attachments=0;const locks=[];
 const life=createAccountIdentityLifecycle({create:()=>{const n=++opens;return {lock:()=>locks.push(n)};},
  unlock:async()=>{if(opens===1)await new Promise(r=>release=r);},attach:()=>{attachments++;return()=>{};}});
 life.set(14,true);await turn();life.set(14,false);life.set(14,true);assert.equal(opens,1);assert(locks.includes(1));
 release();await life.settled();assert.equal(opens,2);assert.equal(attachments,1);life.stop();
});
test('failed opens stay fail-closed without a retry loop and can be explicitly retried',async()=>{
 let opens=0;const life=createAccountIdentityLifecycle({create:()=>({lock(){}}),unlock:async()=>{if(++opens===1)throw Error('Storage unavailable');},attach:()=>()=>{}});
 life.set(14,true);await life.settled();assert.equal(life.snapshot().state,'error');life.set(14,true);await life.settled();assert.equal(opens,1);
 life.retry();await life.settled();assert.equal(life.snapshot().state,'ready');life.stop();
});
function storageFixture(){
 const rows=new Map();const storage=owner=>{if(!rows.has(owner))rows.set(owner,{vault:null,secret:null,password:null});const s=rows.get(owner);
 return {readVault:async()=>s.vault,writeVault:async v=>{s.vault=v;},readDeviceSecret:async()=>s.secret,writeDeviceSecret:async v=>{s.secret=v;},
 readUnlockSecret:async()=>s.password,writeUnlockSecret:async v=>{s.password=v;}};};
 const access=createAccountIdentityAccess({storage,random:async n=>new Uint8Array(crypto.randomBytes(n)),now:()=>1800000000000,
 derive:async(p,s)=>new Uint8Array(crypto.createHash('sha256').update(p).update(s).digest())});return {rows,access};
}
test('device-bound vault survives cold reopening and separates different signed-in accounts',async()=>{
 const f=storageFixture(),a=f.access.create(14);await f.access.unlock(14,a,()=>true);const id=a.status().account;a.lock();
 const cold=f.access.create(14);await f.access.unlock(14,cold,()=>true);assert.equal(cold.status().account,id);cold.lock();
 const other=f.access.create(18);await f.access.unlock(18,other,()=>true);assert.notEqual(other.status().account,id);other.lock();
 assert.notEqual(f.rows.get(14).password,f.rows.get(18).password);
});
test('missing vault protection fails without replacing identity or writing a new password',async()=>{
 const f=storageFixture(),a=f.access.create(14);await f.access.unlock(14,a,()=>true);a.lock();const original=f.rows.get(14).vault;
 f.rows.get(14).password=null;const next=f.access.create(14);await assert.rejects(f.access.unlock(14,next,()=>true),/protection unavailable/);
 assert.equal(f.rows.get(14).vault,original);assert.equal(f.rows.get(14).password,null);assert.equal(next.status().state,'locked');
});
test('cancelled provisioning and cross-account controller use cannot create another account vault',async()=>{
 const f=storageFixture(),a=f.access.create(14);await assert.rejects(f.access.unlock(18,a,()=>true),/owner mismatch/);
 await assert.rejects(f.access.unlock(14,a,()=>false),/Account changed/);assert.equal(f.rows.get(14).vault,null);assert.equal(f.rows.has(18),false);
});
