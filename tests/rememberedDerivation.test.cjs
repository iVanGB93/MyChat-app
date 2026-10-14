const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),ts=require('typescript'),cache=new Map();
function load(name){
 if(cache.has(name))return cache.get(name);
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p.startsWith('./')?load(p.slice(2).replace(/\.(js|ts)$/,'')):require(p),out);
 cache.set(name,out);return out;
}
const {createRememberedDerivation}=load('rememberedDerivation'),vault=load('identityVault');
const random=n=>new Uint8Array(crypto.randomBytes(n)),password='synthetic test password';
const fast=async(p,s)=>new Uint8Array(crypto.createHash('sha256').update(p).update(s).digest());
test('remembered key opens the unchanged scrypt vault, retaining device and ciphertext authentication',async()=>{
 let calls=0;const d=createRememberedDerivation(async(p,s)=>{calls++;return new Uint8Array(crypto.scryptSync(p,s,32,{N:131072,r:8,p:1,maxmem:160*1024*1024}));});
 const now=Date.now(),{identity}=await vault.createLocalIdentity(async n=>random(n),now),secret=random(32);
 const sealed=await vault.sealIdentity(identity,password,secret,async n=>random(n),now,d.derive),raw=JSON.stringify(sealed),saved=d.export(password);
 assert.ok(saved);assert.equal(calls,1);d.clear();
 const open=()=>vault.unlockIdentity(raw,password,secret,now,d.derive);
 const restored=await d.withSaved(password,saved,open);assert.deepEqual(restored.signingSeed,identity.signingSeed);assert.equal(calls,1);
 await assert.rejects(d.withSaved(password,saved,()=>vault.unlockIdentity(raw,password,random(32),now,d.derive)),/Unable to unlock/);
 const corrupt={...sealed,ciphertext:(sealed.ciphertext.startsWith('00')?'01':'00')+sealed.ciphertext.slice(2)};
 await assert.rejects(d.withSaved(password,saved,()=>vault.unlockIdentity(JSON.stringify(corrupt),password,secret,now,d.derive)));
 await assert.rejects(d.withSaved(password,{...saved,key:'00'.repeat(32)},open));assert.equal(d.export(password),undefined);
 // Cached material is never available to an explicit password attempt.
 await assert.rejects(vault.unlockIdentity(raw,'incorrect password',secret,now,d.derive));assert.equal(calls,2);
 vault.destroyIdentity(identity);vault.destroyIdentity(restored);secret.fill(0);d.clear();
});
test('salt changes, malformed caches, and explicit unlocks always use native derivation',async()=>{
 let calls=0;const d=createRememberedDerivation(async(p,s)=>{calls++;return fast(p,s);}),salt=random(32);
 const first=await d.derive(password,salt),saved=d.export(password);first.fill(0);
 assert.notEqual(saved.key,'00'.repeat(32));assert.equal(d.export('different password'),undefined);
 for(const value of [null,{}, {...saved,version:2},{...saved,key:'bad'},{...saved,salt:'00'.repeat(32)}])await d.withSaved(password,value,()=>d.derive(password,salt));
 assert.equal(calls,6);await d.derive(password,salt);assert.equal(calls,7);
 await d.withSaved(password,saved,()=>d.derive('different password',salt));assert.equal(calls,8);d.clear();assert.equal(d.export(password),undefined);
});
test('clearing during native work prevents late secret retention; overlapping resumes are rejected',async()=>{
 let release;const gate=new Promise(r=>release=r),d=createRememberedDerivation(async()=>{await gate;return new Uint8Array(32).fill(1);});
 const work=d.withSaved(password,null,()=>d.derive(password,random(32)));
 await assert.rejects(d.withSaved(password,null,async()=>{}),/already running/);d.clear();release();(await work).fill(0);
 assert.equal(d.export(password),undefined);
});
