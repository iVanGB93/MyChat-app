const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/deliveryDiagnostics.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out);
test('rolling diagnostics start automatically, survive the old timeout, and clear without stopping',()=>{
 let now=0;const d=out.createDeliveryDiagnostics(()=>now,true);
 d.observe('a','pending','outgoing');now=16*60*1000;d.observe('a','delivered','outgoing');
 assert.equal(d.snapshot().events.length,2);assert.equal(d.snapshot().expiresAt,null);
 d.clear();assert.equal(d.snapshot().events.length,0);assert.equal(d.active(),true);
 d.observe('b','read','incoming');assert.equal(d.snapshot().events.length,1);
 now+=31*60*1000;assert.equal(d.snapshot().events.length,0);
});
test('rolling correlation capacity evicts old keys instead of disabling new observations',()=>{
 const d=out.createDeliveryDiagnostics(()=>0,true);
 for(let i=0;i<600;i++)d.observe('secret-'+i,'delivered','incoming');
 const s=d.snapshot();assert.equal(s.events.length,256);assert.equal(s.events.at(-1).trace,'m600');assert(!JSON.stringify(s).includes('secret-'));
});
test('capture is opt-in and exports all four states without correlation keys or reconstructed history',()=>{
 let now=1000;const d=out.createDeliveryDiagnostics(()=>now);const key='private-account:private-message-id';
 d.observe(key,'pending','outgoing');assert.equal(d.snapshot().events.length,0);d.start();
 for(const state of ['pending','stored','delivered','read']){d.observe(key,state,'outgoing',true);now+=100;}
 const s=d.snapshot();assert.deepEqual(s.events.map(e=>e.event),['pending','stored','delivered','read']);assert(s.events[0].initialObservation);assert(s.events.slice(1).every(e=>!e.initialObservation));assert(s.events.every(e=>e.trace==='m1'));assert(!JSON.stringify(s).includes('private-'));
 d.observe(key,'read','outgoing');assert.equal(d.snapshot().events.length,4);d.stop();d.observe(key,'pending','outgoing');assert.equal(d.snapshot().events.length,4);d.clear();assert.equal(d.snapshot().events.length,0);
});
test('capture handles skipped storage, expired custody, bounded memory and timeout honestly',()=>{
 let now=0;const d=out.createDeliveryDiagnostics(()=>now);d.start();d.observe('a','delivered','incoming');assert(d.snapshot().events[0].initialObservation);
 d.observe('b','stored','outgoing');d.observe('b','pending','outgoing');
 for(let i=0;i<300;i++)d.event('a','wake_verified','incoming');assert.equal(d.snapshot().events.length,256);assert(d.snapshot().droppedEvents>0);
 now=900001;const count=d.snapshot().events.length;d.event('a','notification_requested','incoming');assert.equal(d.snapshot().events.length,count);assert.equal(d.active(),false);
});
test('export snapshots cannot mutate retained observations and restarted captures get fresh aliases',()=>{
 const d=out.createDeliveryDiagnostics();d.start();d.observe('secret','stored','outgoing');d.snapshot().events[0].event='read';assert.equal(d.snapshot().events[0].event,'stored');d.start();assert.equal(d.snapshot().events.length,0);
});
test('individual message info uses the shared four-state resolver, not the raw transport flag',()=>{
 const source=fs.readFileSync('src/screens/chat/RootMessageInfoScreen.tsx','utf8').split('function MessageInfo(')[1].split('\nfunction ')[0];assert(source.includes('deliveryStatusLabel(rootMessageStatus(message,now))'));assert(source.includes('messageInfoDescription(message,now)'));assert(source.includes('useMessageStateClock(tracked)'));assert(!source.includes("message.status==='delivered'?'Delivered':'Pending'"));
});
