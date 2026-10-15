const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const safety=require('./helpers/storageSafety.cjs');
test('failure bursts share a read and back off to 60 seconds, then reset on success',async()=>{
 let now=0,calls=0,fail=true;const gate=safety.createStorageReadGate(()=>now),work=async()=>{calls++;if(fail)throw Error('AXONIC_BACKUP_FAILED');return 'saved';};
 for(const delay of [2000,4000,8000,16000,32000,60000,60000]){
  const first=gate.read(work);assert.equal(first,gate.read(work));await assert.rejects(first);const count=calls;
  for(let i=0;i<10;i++)await assert.rejects(gate.read(work));assert.equal(calls,count);now+=delay;
 }
 fail=false;assert.equal(await gate.read(work),'saved');fail=true;await assert.rejects(gate.read(work));now+=2000;fail=false;assert.equal(await gate.read(work),'saved');
});
test('error labels never expose raw paths, accounts or SQL',()=>{
 assert.match(safety.storageErrorText(Error('AXONIC_BACKUP_FAILED /private/secret')),/safety backup/);
 assert.match(safety.storageErrorText(Error('AXONIC_STORAGE_FULL')),/Storage is full/);
 assert.match(safety.storageErrorText(Error('AXONIC_STORAGE_CORRUPT')),/automatic reset is disabled/);
 assert(!safety.storageErrorText(Error('private-secret-token')).includes('private-secret-token'));
});
test('a committed write detaches older reads and their errors cannot delay a fresh read',async()=>{
 let reject;const gate=safety.createStorageReadGate(()=>0);const old=gate.read(()=>new Promise((_,r)=>reject=r));await Promise.resolve();gate.invalidate();assert.equal(await gate.read(async()=>'fresh'),'fresh');reject(Error('old failure'));await assert.rejects(old);assert.equal(await gate.read(async()=>'newest'),'newest');
});
test('dependency patch is repeatable and rejects unknown library changes',()=>{
 const {patch,target}=require('../scripts/patch-async-storage-safety.cjs');const source=fs.readFileSync(target,'utf8'),patched=patch(source);
 assert.equal(patch(patched),patched);assert.throws(()=>patch(source+'\n// changed'));
 assert(!patched.includes('          deleteDatabase();'));assert(patched.includes('AXONIC_STORAGE_CORRUPT'));assert(patched.includes('64L * 1024L * 1024L'));
});
