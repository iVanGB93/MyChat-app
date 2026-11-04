const test=require('node:test'),assert=require('node:assert/strict');
const {createCallSpeakingMonitor}=require('../src/services/callSpeakingMonitor.ts');
const flush=()=>new Promise(r=>setImmediate(r));
test('speaking levels are scoped by direction, held briefly and released without continuous re-render',async()=>{
 let clock=0,rows=[],next,reads=0;const values=[];
 const m=createCallSpeakingMonitor({current:()=>true,now:()=>clock,stats:async()=>{reads++;return rows;},publish:(...v)=>values.push(v),schedule:fn=>(next=fn,1),cancel:()=>{next=null;}});
 rows=[{id:'a',type:'media-source',kind:'audio',audioLevel:.2},{id:'v',type:'inbound-rtp',kind:'video',audioLevel:1}];m.start();await flush();assert.deepEqual(values,[[true,false]]);
 rows=[];clock=250;next();await flush();assert.equal(values.length,1);
 clock=500;next();await flush();assert.deepEqual(values.at(-1),[false,false]);
 rows=[{id:'r',type:'inbound-rtp',kind:'audio',audioLevel:.1}];clock=750;next();await flush();assert.deepEqual(values.at(-1),[false,true]);
 m.stop();assert.equal(next,null);assert.equal(reads,4);
});
test('energy deltas work when audioLevel is absent; stop suppresses late stats',async()=>{
 let next,rows=[{id:'r',type:'inbound-rtp',kind:'audio',totalAudioEnergy:1,totalSamplesDuration:1}],resolve;const values=[];
 const m=createCallSpeakingMonitor({current:()=>true,stats:()=>resolve?new Promise(r=>{resolve=r;}):Promise.resolve(rows),publish:(...v)=>values.push(v),schedule:fn=>(next=fn,1),cancel:()=>{}});
 m.start();await flush();rows=[{...rows[0],totalAudioEnergy:1.04,totalSamplesDuration:2}];next();await flush();assert.deepEqual(values.at(-1),[false,true]);
 resolve=true;next();m.stop();const count=values.length;resolve(rows);await flush();assert.equal(values.length,count);
});
