const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/incomingMessageAdmission.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
const message={from:'sender',id:'id',text:'content'};
test('concurrent direct/poll admissions share storage and presentation but later retries use durable dedup',async()=>{
 let calls=0,release;const admit=out.createIncomingMessageAdmission({owner:()=> 'owner',receive:async()=>{calls++;await new Promise(r=>release=r);return true;}});
 const a=admit(message,'direct'),b=admit({...message},'poll');assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release();assert.equal(await a,true);assert.equal(await b,true);
 const next=admit(message);await Promise.resolve();assert.equal(calls,2);release();assert.equal(await next,true);
});
test('same ID with conflicting bytes never shares acceptance',async()=>{
 const calls=[];const admit=out.createIncomingMessageAdmission({owner:()=> 'owner',receive:async m=>{calls.push(m.text);return m.text==='content';}});
 assert.deepEqual(await Promise.all([admit(message),admit({...message,text:'different'})]),[true,false]);assert.equal(calls.length,2);
});
test('failed admission can retry; failures do not retain in-flight entries',async()=>{
 let calls=0;const admit=out.createIncomingMessageAdmission({owner:()=> 'owner',receive:async()=>{if(++calls===1)throw Error('storage');return true;}});
 await assert.rejects(admit(message),/storage/);assert.equal(await admit(message),true);
});
test('account changes invalidate results and never share old-account work',async()=>{
 let owner='a';const releases=[];const admit=out.createIncomingMessageAdmission({owner:()=>owner,receive:()=>new Promise(r=>releases.push(r))});
 const a=admit(message);await Promise.resolve();owner='b';const b=admit(message);await Promise.resolve();assert.notEqual(a,b);releases[0](true);releases[1](true);assert.deepEqual(await Promise.all([a,b]),[false,true]);owner=null;assert.equal(await admit(message),false);
});
