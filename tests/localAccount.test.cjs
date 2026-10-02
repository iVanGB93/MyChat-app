const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();
function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
const {createLocalIdentityController}=load('localIdentityController');
const {createLocalAccountBiometrics}=load('localAccountBiometrics');
const {compareRecord}=load('identityProtocol');
const now=1800000000000,password='local test password only';
const random=async n=>new Uint8Array(crypto.randomBytes(n));
const derive=async(p,s)=>new Uint8Array(crypto.createHash('sha256').update(p).update(s).digest());
function fixture(overrides={}){const data={vault:null,secret:null};const storage={readVault:async()=>data.vault,writeVault:async v=>{data.vault=v;},readDeviceSecret:async()=>data.secret,writeDeviceSecret:async v=>{data.secret=v;},...overrides};return{data,storage,id:createLocalIdentityController(storage,random,()=>now,derive)};}
async function created(){const f=fixture();f.words=await f.id.beginCreate();await f.id.confirmBackup(f.words,password);return f;}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};

test('creation requires the exact backup, rejects a weak password, and survives cold unlock',async()=>{
 const f=fixture(),words=await f.id.beginCreate();assert.equal(f.data.vault,null);
 await assert.rejects(f.id.confirmBackup('wrong words',password),/do not match/);
 await assert.rejects(f.id.confirmBackup(words,'short'),/12 and 256/);assert.equal(f.data.vault,null);
 await f.id.confirmBackup(words,password);const account=f.id.status().account,packet=f.id.recoveryRecord();
 assert(!packet.includes(words));assert(!packet.includes(password));assert(!f.data.vault.includes(words));assert(!f.data.vault.includes(password));
 f.id.lock();assert.throws(()=>f.id.recoveryRecord(),/Unlock/);
 const reopened=createLocalIdentityController(f.storage,random,()=>now,derive);await reopened.inspect();
 assert.equal(reopened.status().state,'locked');await assert.rejects(reopened.unlock('incorrect password'));
 assert.equal(reopened.status().state,'locked');await reopened.unlock(password);assert.equal(reopened.status().account,account);reopened.lock();
});

test('recovery retains the root identity, replaces device keys, and proves ancestry to peers',async()=>{
 const original=await created(),record=original.id.publicRecord(),target=fixture();
 await target.id.restore(original.words,original.id.recoveryRecord(),password);
 assert.equal(target.id.status().state,'locked');await target.id.unlock(password);
 const restored=target.id.publicRecord(),packet=JSON.parse(target.id.recoveryRecord());
 assert.equal(restored.account,record.account);assert.equal(restored.revision,record.revision+1);
 assert.notEqual(restored.devices[0].id,record.devices[0].id);
 assert.equal(compareRecord(restored,record,now,packet.history),'accept');
 const saved=target.data.vault;await assert.rejects(target.id.restore(original.words,original.id.recoveryRecord(),password),/already exists/);assert.equal(target.data.vault,saved);
 original.id.lock();target.id.lock();
});

test('recovery rejects unrelated words, tampered records, and malformed ancestry without writing a vault',async()=>{
 const a=await created(),b=await created(),target=fixture(),packet=JSON.parse(a.id.recoveryRecord());
 await assert.rejects(target.id.restore(b.words,JSON.stringify(packet),password));assert.equal(target.data.vault,null);
 const changed=structuredClone(packet);changed.record.revision+=1;
 await assert.rejects(target.id.restore(a.words,JSON.stringify(changed),password));
 packet.history=[b.id.publicRecord()];await assert.rejects(target.id.restore(a.words,JSON.stringify(packet),password));
 assert.equal(target.data.vault,null);assert.equal(target.data.secret,null);a.id.lock();b.id.lock();
});

test('locking during recovery disk commit preserves a recoverable but locked vault',async()=>{
 const a=await created(),gate=deferred();let saved;
 const target=fixture({writeVault:async v=>{saved=v;await gate.promise;target.data.vault=v;}});
 const operation=target.id.restore(a.words,a.id.recoveryRecord(),password);
 while(!saved)await new Promise(r=>setImmediate(r));target.id.lock();gate.resolve();await operation;
 assert.equal(target.id.status().state,'locked');assert.equal(target.id.publicRecord(),null);
 await target.id.unlock(password);assert.equal(target.id.status().account,a.id.status().account);a.id.lock();target.id.lock();
});

test('failed device-secret storage cannot create an unusable vault',async()=>{
 const a=await created(),target=fixture({writeDeviceSecret:async()=>{throw Error('Keychain unavailable');}});
 await assert.rejects(target.id.restore(a.words,a.id.recoveryRecord(),password),/Keychain/);assert.equal(target.data.vault,null);assert.equal(target.id.publicRecord(),null);a.id.lock();
});

function bioFixture(id, overrides={}){let saved=null,writes=0;const api=createLocalAccountBiometrics({identity:id,available:()=>true,read:async()=>saved,write:async p=>{saved=p;writes++;},remove:async()=>{saved=null;},...overrides});return{api,get saved(){return saved;},get writes(){return writes;}};}
test('biometric enrollment verifies the password; disabling leaves password unlock functional',async()=>{
 const f=await created(),bio=bioFixture(f.id);
 await assert.rejects(bio.api.enroll('incorrect password'));assert.equal(bio.saved,null);assert.equal(bio.writes,0);
 await bio.api.enroll(password);bio.api.lock();await bio.api.unlock();assert.equal(f.id.status().state,'unlocked');
 await bio.api.disable();bio.api.lock();await assert.rejects(bio.api.unlock(),/credential unavailable/);
 await f.id.unlock(password);assert.equal(f.id.status().state,'unlocked');f.id.lock();
});
test('cancelled or invalidated biometric credentials never unlock and permit password fallback',async()=>{
 const f=await created();f.id.lock();const bio=bioFixture(f.id,{read:async()=>{throw Error('User cancelled');}});
 await assert.rejects(bio.api.unlock(),/cancelled/);assert.equal(f.id.status().state,'locked');
 await f.id.unlock(password);f.id.lock();
});
test('backgrounding while an OS biometric prompt is pending rejects its late result',async()=>{
 const f=await created();f.id.lock();const gate=deferred(),bio=bioFixture(f.id,{read:()=>gate.promise});
 const pending=bio.api.unlock();await assert.rejects(bio.api.unlock(),/already running/);bio.api.lock();gate.resolve(password);
 await assert.rejects(pending,/interrupted/);assert.equal(f.id.status().state,'locked');assert.equal(f.id.publicRecord(),null);
});
test('backgrounding during biometric enrollment removes a late stored credential',async()=>{
 const f=await created(),gate=deferred();let writing=false,removed=false;
 const bio=bioFixture(f.id,{write:async()=>{writing=true;await gate.promise;},remove:async()=>{removed=true;}});
 const pending=bio.api.enroll(password);while(!writing)await new Promise(r=>setImmediate(r));bio.api.lock();gate.resolve();
 await assert.rejects(pending,/interrupted/);assert.equal(removed,true);assert.equal(f.id.status().state,'locked');
});
test('biometrics cannot bypass an unavailable device capability',async()=>{
 const f=await created(),bio=bioFixture(f.id,{available:()=>false});f.id.lock();
 await assert.rejects(bio.api.enroll(password),/Set up/);await assert.rejects(bio.api.unlock(),/unavailable/);assert.equal(f.id.status().state,'locked');
});
test('opt-in entry never initializes legacy delivery or authentication; default retains the original entry',()=>{
 const source=fs.readFileSync('index.ts','utf8');
 function run(flag){const calls=[];new Function('process','require',source)({env:{EXPO_PUBLIC_AXONIC_LOCAL_ACCOUNT:flag}},path=>{calls.push(path);return path==='expo'?{registerRootComponent:()=>calls.push('registered')}:{default:{}};});return calls;}
 assert.deepEqual(run('1'),['expo','./src/screens/LocalAccountApp','registered']);assert.deepEqual(run(undefined),['./legacyEntry']);
});


test('recovery checks the network before sealing and again before either storage write',async()=>{
 const original=await created(),target=fixture();let checks=0;
 await assert.rejects(target.id.restore(original.words,original.id.recoveryRecord(),password,async()=>{checks++;if(checks===2)throw Error('record changed');}),/record changed/);
 assert.equal(checks,2);assert.equal(target.data.vault,null);assert.equal(target.data.secret,null);
 original.id.lock();
});
test('background lock invalidates a pending recovery network check',async()=>{
 const original=await created(),target=fixture(),gate=deferred();let checked=false;
 const pending=target.id.restore(original.words,original.id.recoveryRecord(),password,async()=>{checked=true;await gate.promise;});
 while(!checked)await new Promise(r=>setImmediate(r));target.id.lock();gate.resolve();
 await assert.rejects(pending,/interrupted/);assert.equal(target.data.vault,null);assert.equal(target.data.secret,null);original.id.lock();
});
test('successful guarded recovery remains locked and checks twice',async()=>{
 const original=await created(),target=fixture();let checks=0;
 await target.id.restore(original.words,original.id.recoveryRecord(),password,async()=>{checks++;});
 assert.equal(checks,2);assert.equal(target.id.status().state,'locked');original.id.lock();
});
