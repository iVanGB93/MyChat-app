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

test('recovery-word reveal reauthenticates the vault without replacing the live identity',async()=>{
 const f=await created(),account=f.id.status().account,record=f.id.publicRecord(),device=f.id.callDevice(),vault=f.data.vault;
 await assert.rejects(f.id.revealRecoveryWords('incorrect password',account));
 await assert.rejects(f.id.revealRecoveryWords(password,'other-account'),/Unlock/);
 assert.equal(await f.id.revealRecoveryWords(password,account),f.words);
 assert.equal(f.words.split(' ').length,12);
 assert.deepEqual(f.id.publicRecord(),record);assert.equal(f.id.callDevice(),device);assert.equal(f.data.vault,vault);
 f.id.lock();await assert.rejects(f.id.revealRecoveryWords(password,account),/Unlock/);
});
test('a lock while reveal is reading storage prevents recovery words from returning',async()=>{
 const f=await created(),account=f.id.status().account,gate=deferred();
 f.storage.readVault=()=>gate.promise;
 const work=f.id.revealRecoveryWords(password,account);f.id.lock();gate.resolve(f.data.vault);
 await assert.rejects(work,/interrupted/);
});
test('biometric reauthentication requires protected credential retrieval and does not unlock again',async()=>{
 let reads=0,unlocks=0,remembered=0;const b=createLocalAccountBiometrics({identity:{unlock:async()=>{unlocks++;},lock:()=>{},status:()=>({state:'unlocked'})},available:()=>true,read:async()=>{reads++;return password;},write:async()=>{},remove:async()=>{},onUnlocked:async()=>{remembered++;}});
 for(let i=0;i<2;i++)assert.equal(await b.authenticate(async secret=>{assert.equal(secret,password);return 'authenticated result';}),'authenticated result');
 assert.equal(reads,2);assert.equal(unlocks,0);assert.equal(remembered,0);
});
test('missing, cancelled and late biometric authorization never releases a protected result',async()=>{
 for(const read of [async()=>null,async()=>{throw Error('Cancelled');}]){let accessed=false;const b=createLocalAccountBiometrics({identity:{unlock:async()=>{},lock:()=>{},status:()=>({state:'unlocked'})},available:()=>true,read,write:async()=>{},remove:async()=>{}});await assert.rejects(b.authenticate(async()=>{accessed=true;}));assert.equal(accessed,false);}
 const gate=deferred(),b=createLocalAccountBiometrics({identity:{unlock:async()=>{},lock:()=>{},status:()=>({state:'unlocked'})},available:()=>true,read:async()=>password,write:async()=>{},remove:async()=>{}});
 const work=b.authenticate(()=>gate.promise);await Promise.resolve();b.lock();gate.resolve('sensitive result');await assert.rejects(work,/interrupted/);
});

test('six-character passwords support creation, cold unlock and recovery',async()=>{
 const f=fixture(),phrase=await f.id.beginCreate();await f.id.confirmBackup(phrase,'six123');
 const packet=f.id.recoveryRecord();f.id.lock();await f.id.unlock('six123');assert.equal(f.id.status().state,'unlocked');
 const recovered=fixture();await recovered.id.restore(phrase,packet,'new123');await recovered.id.unlock('new123');
 assert.equal(recovered.id.status().account,f.id.status().account);
});

test('device identity lookup avoids repeated curve work without surviving lock or bypassing busy state',async()=>{
 const f=await created(),protocol=load('identityProtocol'),original=protocol.publicDevice;
 let derivations=0;protocol.publicDevice=(...args)=>{derivations++;return original(...args);};
 try{
  const id=f.id.callDevice();assert.equal(id,f.id.publicRecord().devices[0].id);
  for(let i=0;i<100;i++)assert.equal(f.id.callDevice(),id);
  assert.equal(derivations,1);
  const inspecting=f.id.inspect();assert.equal(f.id.callDevice(),null);await inspecting;
  assert.equal(f.id.callDevice(),id);assert.equal(derivations,1);
  f.id.lock();assert.equal(f.id.callDevice(),null);
  await f.id.unlock(password);const before=derivations;
  assert.equal(f.id.callDevice(),id);assert.equal(derivations,before+1);
  const recovered=fixture();await recovered.id.restore(f.words,f.id.recoveryRecord(),password);
  assert.equal(recovered.id.callDevice(),null);await recovered.id.unlock(password);
  assert.notEqual(recovered.id.callDevice(),id);recovered.id.lock();
 }finally{protocol.publicDevice=original;f.id.lock();}
});

test('creation requires the exact backup, rejects a weak password, and survives cold unlock',async()=>{
 const f=fixture(),words=await f.id.beginCreate();assert.equal(f.data.vault,null);
 await assert.rejects(f.id.confirmBackup('wrong words',password),/do not match/);
 await assert.rejects(f.id.confirmBackup(words,'short'),/6 and 256/);assert.equal(f.data.vault,null);
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
test('sole entry registers neuron background handlers regardless of obsolete feature flags',()=>{
 const source=fs.readFileSync('index.ts','utf8');
 function run(flag){const calls=[];new Function('process','require',source)({env:{EXPO_PUBLIC_AXONIC_LOCAL_ACCOUNT:flag}},path=>{calls.push(path);return path.endsWith('crashReporting')?{configureCrashReporting:()=>calls.push('crash-init')}:path==='expo'?{registerRootComponent:()=>calls.push('registered')}:path.endsWith('rootBackgroundEntry')?{registerRootBackgroundHandlers:()=>calls.push('root-background')}:{default:{}};});return calls;}
 assert.deepEqual(run('1'),['./src/services/crashReporting','crash-init','./src/services/identity/rootBackgroundEntry','root-background','expo','./src/screens/LocalAccountApp','registered']);assert.deepEqual(run(undefined),run('1'));assert.deepEqual(run('0'),run('1'));
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
test('import retains the existing root and device while changing only local protection',async()=>{
 const source=await created(),target=fixture(),before=source.data.vault;
 const words=await target.id.beginImport(source.data.vault,password,source.data.secret);
 assert.equal(words,source.words);assert.equal(target.data.vault,null);
 await target.id.confirmBackup(words,'a different local password');
 assert.equal(target.id.status().account,source.id.status().account);
 assert.equal(target.id.callDevice(),source.id.callDevice());
 assert.equal(source.data.vault,before);
 target.id.lock();await target.id.unlock('a different local password');
 assert.equal(target.id.callDevice(),source.id.callDevice());
});
test('import refuses wrong protection or an occupied target without replacing either identity',async()=>{
 const source=await created(),target=fixture();
 await assert.rejects(target.id.beginImport(source.data.vault,'a wrong local password',source.data.secret));assert.equal(target.data.vault,null);
 const occupied=await created(),before=occupied.data.vault;
 await assert.rejects(occupied.id.beginImport(source.data.vault,password,source.data.secret));assert.equal(occupied.data.vault,before);
});

test('password change preserves identity/device/history and survives cold unlock; old password fails',async()=>{
 const f=await created(),account=f.id.status().account,device=f.id.callDevice(),record=f.id.recoveryRecord();
 await assert.rejects(f.id.changePassword('incorrect password','a new valid password'));
 await assert.rejects(f.id.changePassword(password,'short'));
 await f.id.changePassword(password,'a new valid password');assert.equal(f.id.callDevice(),device);assert.equal(f.id.recoveryRecord(),record);
 f.id.lock();const cold=createLocalIdentityController(f.storage,random,()=>now,derive);await cold.inspect();
 await assert.rejects(cold.unlock(password));await cold.unlock('a new valid password');assert.equal(cold.status().account,account);assert.equal(cold.callDevice(),device);cold.lock();
});
test('failed password change storage write retains the previous password',async()=>{
 const f=await created(),original=f.data.vault;
 const storage={...f.storage,writeVault:async()=>{throw Error('disk');}},broken=createLocalIdentityController(storage,random,()=>now,derive);
 await broken.inspect();await broken.unlock(password);await assert.rejects(broken.changePassword(password,'a new valid password'),/disk/);assert.equal(f.data.vault,original);
 broken.lock();f.id.lock();await f.id.unlock(password);f.id.lock();
});

test('device removal requires current password and exact account, then destroys access and blocks all reentry',async()=>{
 const f=await created();let intent=null;f.storage.beginRemoval=async account=>{intent=account;};const account=f.id.status().account;
 await assert.rejects(f.id.prepareDeviceRemoval('wrong password',account));assert.equal(intent,null);assert.equal(f.id.status().state,'unlocked');
 await assert.rejects(f.id.prepareDeviceRemoval(password,'axonic:1:'+'ab'.repeat(32)));assert.equal(intent,null);
 await f.id.prepareDeviceRemoval(password,account);assert.equal(intent,account);assert.equal(f.id.status().state,'locked');assert.equal(f.id.status().removalPending,true);assert.equal(f.id.publicRecord(),null);assert.equal(f.id.callDevice(),null);assert.throws(()=>f.id.recoveryRecord());
 await assert.rejects(f.id.unlock(password),/reopen/);await assert.rejects(f.id.beginCreate(),/reopen/);assert(f.data.vault);assert(f.data.secret);
});
test('ambiguous removal-journal failure locks without falsely deleting the vault',async()=>{
 const f=await created(),saved=f.data.vault;f.storage.beginRemoval=async()=>{throw Error('write unavailable');};await assert.rejects(f.id.prepareDeviceRemoval(password,f.id.status().account),/write unavailable/);assert.equal(f.data.vault,saved);assert.equal(f.id.publicRecord(),null);assert.equal(f.id.status().removalPending,true);
});
