const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exportsObject={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/callRetryScheduler.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exportsObject);
const {createCallRetryScheduler}=exportsObject;
test('historical journals settle across bounded passes and wake only on a new event',async()=>{
 let clock=0,reads=0,drains=0;
 const rows=Array.from({length:9},(_,i)=>({callId:String(i),caller:'self',callee:'peer'}));
 const s=createCallRetryScheduler({account:'self',current:()=>true,now:()=>clock,list:async()=>{reads++;return rows;},
 peers:()=>[{account:'peer',device:'d',instance:'i',expiresAt:999999}],pending:async()=>false,drain:async()=>{drains++;return 0;}});
 for(let i=0;i<4;i++){await s.tick();clock+=2000;}
 assert.equal(s.nextDeadline(),Infinity);assert.equal(drains,0);
 s.changed();assert.equal(s.nextDeadline(),0);await s.tick();assert(reads>0);
});
test('unknown outbox retains retry and mid-read journal changes cannot be lost',async()=>{
 let pending=true,changed=false;
 const s=createCallRetryScheduler({account:'self',current:()=>true,now:()=>100,list:async()=>[{callId:'c',caller:'self',callee:'peer'}],
 peers:()=>[{account:'peer',expiresAt:9999}],pending:async()=>{if(!changed){changed=true;s.changed();return false;}return pending?undefined:false;},drain:async()=>0});
 await s.tick();assert.equal(s.nextDeadline(),0);await s.tick();assert.equal(s.nextDeadline(),2100);
 pending=false;s.changed();await s.tick();assert.equal(s.nextDeadline(),Infinity);
});
test('disconnected calls wait for topology event rather than a two-second timer',async()=>{
 const s=createCallRetryScheduler({account:'self',current:()=>true,now:()=>100,list:async()=>[{callId:'c',caller:'self',callee:'peer'}],peers:()=>[],drain:async()=>0});
 await s.tick();assert.equal(s.nextDeadline(),Infinity);s.changed();assert.equal(s.nextDeadline(),0);
});
test('scheduler fairly rotates bounded batches and resumes on a newly connected peer',async()=>{
 let clock=100,peers=[],seen=[];
 const rows=Array.from({length:7},(_,i)=>({callId:String(i),caller:'self',callee:'peer'}));
 const s=createCallRetryScheduler({account:'self',current:()=>true,now:()=>clock,list:async()=>rows,peers:()=>peers,
  drain:async(row)=>{seen.push(row.callId);return 0;}});
 await s.tick();assert.equal(seen.length,0);
 peers=[{account:'peer',device:'test',instance:'test',expiresAt:10000}];clock+=2000;
 await s.tick();assert.equal(seen.length,4);
 await s.tick();assert.equal(seen.length,4);
 clock+=2000;await s.tick();assert.equal(new Set(seen).size,7);
});
test('scheduler prevents overlap and stops queued work after a session ends',async()=>{
 let release,active=true,drains=0;
 const s=createCallRetryScheduler({account:'self',current:()=>active,now:()=>100,
  list:()=>new Promise(r=>release=r),peers:()=>[{account:'peer',expiresAt:10000}],drain:async()=>{drains++;return 0;}});
 const first=s.tick();await s.tick();active=false;
 release([{callId:'1',caller:'self',callee:'peer'}]);await first;assert.equal(drains,0);
 s.stop();await s.tick();assert.equal(drains,0);
});
test('scheduler releases busy state after storage failure and retries after backoff',async()=>{
 let clock=100,fail=true,drains=0;
 const s=createCallRetryScheduler({account:'self',current:()=>true,now:()=>clock,
 list:async()=>{if(fail)throw Error('disk');return [{callId:'1',caller:'peer',callee:'self'}];},
 peers:()=>[{account:'peer',expiresAt:10000}],drain:async()=>{drains++;return 0;}});
 await assert.rejects(s.tick(),/disk/);fail=false;await s.tick();assert.equal(drains,0);
 clock+=2000;await s.tick();assert.equal(drains,1);
});
