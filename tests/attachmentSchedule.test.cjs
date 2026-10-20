const test=require('node:test'),assert=require('node:assert/strict');
const {attachmentWorkDelay}=require('./helpers/attachment.cjs').load('attachmentSchedule');
const job=(phase='queued',next=15000)=>({phase,next,descriptor:{manifest:{expires:60000}}});
test('empty and terminal transfer queues sleep without scheduled reads',()=>{
 assert.equal(attachmentWorkDelay([],10000,()=>true),Infinity);
 assert.equal(attachmentWorkDelay(['complete','expired','cancelled'].map(p=>job(p)),10000,()=>true),Infinity);
});
test('disconnected or blocked transfers wait for connection/policy events or expiry',()=>{
 assert.equal(attachmentWorkDelay([job()],10000,()=>false),50000);
 assert.equal(attachmentWorkDelay([job()],10000,()=>true),5000);
});
test('due retries yield rather than spin and future retries cannot postpone expiry',()=>{
 assert.equal(attachmentWorkDelay([job('queued',0)],10000,()=>true),500);
 assert.equal(attachmentWorkDelay([job('queued',90000)],10000,()=>true),50000);
});
