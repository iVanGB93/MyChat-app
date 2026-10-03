const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const exportsObject={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/services/identity/callRetryScheduler.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exportsObject);
const {createCallRetryScheduler}=exportsObject;
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
