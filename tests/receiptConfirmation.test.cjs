const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/services/identity/receiptConfirmation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports_={};new Function('exports',code)(exports_);
function fixture(){let owner='recipient',now=100;const calls=[],events=[],waits=[];
 const receipt={recipient:'recipient',sender:'sender',id:'message',expires:1000};
 const tracker=exports_.createReceiptConfirmation({owner:()=>owner,now:()=>now,accepted:(...args)=>events.push(args),request:(peer,raw)=>{calls.push({peer,...JSON.parse(raw)});return new Promise((resolve,reject)=>waits.push({resolve,reject}));}});
 return {tracker,receipt,calls,events,waits,owner:v=>owner=v,time:v=>now=v};
}
test('direct delivery can return its signed receipt while confirmation waits; no early completion',async()=>{
 const f=fixture(),work=f.tracker.confirm(f.receipt,'relay');await Promise.resolve();
 assert.equal(f.tracker.complete('sender','message'),false);assert.deepEqual(f.events,[]);
 assert.equal(f.calls[0].operation,'receipt');
 f.waits[0].resolve('{"status":"accepted"}');await work;
 assert.equal(f.tracker.complete('sender','message'),true);assert.deepEqual(f.events,[['sender','message']]);
 assert.equal(f.tracker.complete('other','message'),false);
 f.time(1000);assert.equal(f.tracker.complete('sender','message'),false);
});
test('inline and direct confirmations coalesce and group identity is preserved',async()=>{
 const f=fixture(),a=f.tracker.confirm(f.receipt,'relay','group-id'),b=f.tracker.confirm(f.receipt,'relay','group-id');
 assert.equal(a,b);await Promise.resolve();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].operation,'group-receipt');assert.equal(f.calls[0].id,'group-id');
 f.waits[0].resolve('{"status":"accepted"}');await a;await f.tracker.confirm(f.receipt,'relay','group-id');assert.equal(f.calls.length,1);
});
for(const response of [null,'{}','garbage','{"status":"rejected"}','{"status":"retry"}'])test(`unaccepted receipt never completes: ${response}`,async()=>{
 const f=fixture(),a=f.tracker.confirm(f.receipt,'relay');await Promise.resolve();f.waits[0].resolve(response);await a;
 assert.equal(f.tracker.complete('sender','message'),false);assert.equal(f.events.length,0);
 const retry=f.tracker.confirm(f.receipt,'relay');await Promise.resolve();assert.equal(f.calls.length,2);f.waits[1].resolve('{"status":"accepted"}');await retry;assert.equal(f.events.length,1);
});
for(const change of ['stop','owner','expiry'])test(`late acceptance cannot revive stale recovery: ${change}`,async()=>{
 const f=fixture(),a=f.tracker.confirm(f.receipt,'relay');await Promise.resolve();
 if(change==='stop')f.tracker.stop();else if(change==='owner')f.owner('other');else f.time(1000);
 f.waits[0].resolve('{"status":"accepted"}');await a;assert.equal(f.events.length,0);assert.equal(f.tracker.complete('sender','message'),false);
});
