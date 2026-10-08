const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}

const p=load('identityProtocol'),{checkRecoveryRecord}=load('recoveryDiscovery');
const now=1800000000000,random=()=>new Uint8Array(crypto.randomBytes(32));
const owner=()=>{const root=random(),device=p.publicDevice(random(),random());return{root,device,record:p.issueRecord(root,[device],now)};};
const raw=a=>JSON.stringify({version:1,record:a.record,history:a.history??[]});
const found=a=>({status:'found',sources:['peer'],packet:{record:a.record,history:a.history??[]}});
test('recovery accepts a signed descendant of the saved checkpoint but final check rejects changes',async()=>{
 const a=owner(),next={record:p.issueRecord(a.root,[a.device],now+1,a.record),history:[a.record]};
 const result=await checkRecoveryRecord(raw(a),async()=>found(next),()=>now);
 assert.equal(result.revision,1);assert.equal(JSON.parse(result.raw).record.account,a.record.account);
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>found(next),()=>now,true),/changed/);
 assert.equal((await checkRecoveryRecord(raw(next),async()=>found(next),()=>now,true)).revision,1);
});
test('every unresolved lookup blocks recovery, even when a packet is included',async()=>{
 const a=owner();for(const status of ['conflict','missing-history','stale','not-found','unavailable','cancelled','busy','invalid'])
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>({...found(a),status}),()=>now),new RegExp(status));
});
test('untrusted lookup responses cannot bypass signatures, target identity, ancestry or expiry',async()=>{
 const a=owner(),first=p.issueRecord(a.root,[a.device],now+1,a.record),second=p.issueRecord(a.root,[a.device],now+2,first);
 const newer={record:second,history:[]};
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>found(newer),()=>now),/missing-history/);
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>found(owner()),()=>now),/invalid/);
 const bad=structuredClone(a);bad.record.signature='00'.repeat(64);
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>found(bad),()=>now),/invalid/);
 await assert.rejects(checkRecoveryRecord(raw(a),async()=>found(a),()=>a.record.expiresAt+1),/invalid/);
 await assert.rejects(checkRecoveryRecord(raw({record:first}),async()=>found(a),()=>now),/stale/);
 const fork={record:p.issueRecord(a.root,[p.publicDevice(random(),random())],now+1,a.record)};
 await assert.rejects(checkRecoveryRecord(raw({record:first}),async()=>found(fork),()=>now),/conflict/);
});
test('invalid checkpoint is rejected before contacting a peer',async()=>{
 let requests=0;for(const raw of ['bad','null','{}','x'.repeat(12001)])await assert.rejects(checkRecoveryRecord(raw,async()=>{requests++;},()=>now));assert.equal(requests,0);
});

test('word-only recovery sends only the derived account and refuses missing or mismatched records',async()=>{
 const vault=load('identityVault'),{findRecoveryRecord}=load('recoveryDiscovery');
 const created=await vault.createLocalIdentity(async n=>new Uint8Array(crypto.randomBytes(n)),now);
 const words=created.recoveryPhrase,record=created.identity.record;
 const raw=await findRecoveryRecord(words,async account=>{
   assert.equal(account,record.account);assert(!account.includes(words));
   return found({record,history:[]});
 },()=>now);
 assert.equal(JSON.parse(raw).record.account,record.account);
 await assert.rejects(findRecoveryRecord(words,async()=>({...found({record}),status:'not-found'}),()=>now),/unavailable/);
 await assert.rejects(findRecoveryRecord(words,async()=>found(owner()),()=>now),/match/);
 const bad=structuredClone(record);bad.signature='00'.repeat(64);
 await assert.rejects(findRecoveryRecord(words,async()=>found({record:bad}),()=>now),/Invalid/);
 let requests=0;await assert.rejects(findRecoveryRecord('wrong words',async()=>{requests++;},()=>now));assert.equal(requests,0);
 vault.destroyIdentity(created.identity);
});
