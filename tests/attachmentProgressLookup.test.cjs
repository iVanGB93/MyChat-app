const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/utils/attachment-progress.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
const {createAttachmentProgressLookup}=mod;
test('progress lookup preserves first match, missing jobs and exact progress object',()=>{
 const jobs=Object.freeze([Object.freeze({digest:'a',phase:'downloading',cursor:2}),Object.freeze({digest:'a',phase:'complete',cursor:4}),Object.freeze({digest:'b',phase:'paused',cursor:1})]);
 let calls=0;const lookup=createAttachmentProgressLookup(jobs,m=>{calls++;return m.digest;});
 for(const digest of ['a','b','missing'])assert.equal(lookup({digest}),jobs.find(j=>j.digest===digest));
 assert.equal(calls,3);
});
test('empty snapshots do not hash, updates replace progress and changed manifests are not stale',()=>{
 let calls=0;const digest=m=>{calls++;return m.key;};
 assert.equal(createAttachmentProgressLookup([],digest)({key:'a'}),undefined);assert.equal(calls,0);
 const first={digest:'a',cursor:1},second={digest:'b',cursor:2},m={key:'a'};
 const lookup=createAttachmentProgressLookup([first,second],digest);
 assert.equal(lookup(m),first);m.key='b';assert.equal(lookup(m),second);
 const updated={digest:'b',cursor:3};assert.equal(createAttachmentProgressLookup([updated],digest)(m),updated);
 assert.equal(createAttachmentProgressLookup([],digest)(m),undefined);
});
test('private and group v1/v2 manifests match the prior search with one hash per row',()=>{
 const {load,fixture}=require('./helpers/attachment.cjs'),{attachmentDigest}=load('attachmentProtocol');
 const f=fixture(4097),v1=f.manifest,v2={...v1,version:2,shared:{id:'ab'.repeat(32),count:2,slot:0}};
 const manifests=[v1,v2,{...v2,shared:{...v2.shared,slot:1}},{...v1,id:'cd'.repeat(32)}];
 const jobs=Array.from({length:100},(_,i)=>({digest:String(i),cursor:i}));
 jobs.push(...manifests.slice(0,3).map(m=>({digest:attachmentDigest(m),cursor:200})));
 let calls=0;const lookup=createAttachmentProgressLookup(jobs,m=>{calls++;return attachmentDigest(m);});
 for(const m of manifests)assert.equal(lookup(m),jobs.find(j=>j.digest===attachmentDigest(m)));
 assert.equal(calls,manifests.length);
});
