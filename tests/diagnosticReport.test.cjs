const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>{if(deps[n])return deps[n];throw Error(n);});return out;}
const status=load('src/services/identity/rootMessageStatus.ts');
const report=load('src/services/diagnosticReport.ts',{'./identity/rootMessageStatus':status});
const journal=load('src/services/diagnosticJournal.ts');

test('poll report whitelists numeric counters and distinguishes local passes from delivery',()=>{
 const result=report.summarizePollingForReport({private:{startedPasses:4,emptyPasses:3,itemPasses:1,peer:'secret',busySkips:NaN},group:{cooldownSkips:9,token:'secret'},pendingDerivations:1,owner:'secret'});
 assert.equal(result.private.emptyPasses,3);assert.equal(result.localWork.pendingDerivations,1);assert.equal(result.group.cooldownSkips,9);
 assert(!JSON.stringify(result).includes('secret'));assert(!('busySkips' in result.private));assert.match(result.scope,/not wire packets/);assert.match(result.scope,/not necessarily valid or delivered/);
 assert.equal(report.summarizePollingForReport(null).private,null);
});

test('chat timing separates read, derivation and layout without retaining private identifiers',()=>{
 const d=journal.createDiagnosticJournal(()=>1);for(const event of ['chat_history_read','chat_view_derived','private_chat_layout','group_chat_layout'])d.record(event,{milliseconds:23.4,peer:'secret',text:'private'});
 assert.equal(d.snapshot().events.length,4);assert(d.snapshot().events.every(e=>e.milliseconds===23));assert(!JSON.stringify(d.snapshot()).includes('secret'));assert(!JSON.stringify(d.snapshot().events).includes('private"'));assert.match(d.snapshot().scope,/not message paint/);
});
test('diagnostic journal is bounded, expires and rejects unknown text/identifiers',()=>{
 let now=1000;const d=journal.createDiagnosticJournal(()=>now);d.record('private text',{token:'secret'});assert.equal(d.snapshot().events.length,0);
 for(let i=0;i<200;i++)d.record('network_changed',{connected:2,account:'secret',milliseconds:NaN});
 const s=d.snapshot();assert.equal(s.events.length,128);assert.equal(s.droppedEvents,72);assert(!JSON.stringify(s).includes('secret'));s.events[0].event='modified';assert.notEqual(d.snapshot().events[0].event,'modified');
 now+=1800001;assert.equal(d.snapshot().events.length,0);d.clear();assert.equal(d.snapshot().droppedEvents,0);
});
test('report selects only configured unblocked AoNs, respecting connection ranking',()=>{
 const known=[{account:'a',name:'A'},{account:'b',name:'B'}];
 const connections=[{account:'untrusted',state:'connected',rank:1},{account:'b',state:'connected',rank:2},{account:'a',state:'connected',rank:3}];
 assert.equal(report.chooseReportRecipient(connections,known,[]).account,'b');assert.equal(report.chooseReportRecipient(connections,known,['b']).account,'a');
 assert.equal(report.chooseReportRecipient([],known,[]).connected,false);assert.throws(()=>report.chooseReportRecipient([],known,['a','b']));
});
test('message projection uses canonical stored/expired/media states without content or identities',()=>{
 const base={peer:'secret-peer',id:'secret-id',text:'secret-text',direction:'outgoing',at:0,status:'pending'};
 const s=report.summarizeReportMessages({messages:[{...base,networkStoredUntil:2000},{...base,attachment:{},descriptorDelivered:true,attachmentStoredUntil:500},{...base,status:'delivered',read:true,group:{id:'secret-group'}}]},1000);
 assert.equal(s.private.outgoing.stored,1);assert.equal(s.private.outgoing.pending,1);assert.equal(s.group.outgoing.read,1);assert.equal(s.incompleteMedia,1);assert(!JSON.stringify(s).includes('secret'));
 assert.equal(s.pendingEvidence.expiredStorageEvidence,1);assert.equal(s.pendingEvidence.mediaDescriptorKnownIncomplete,1);
 const old=report.summarizeReportMessages({messages:[base,{...base,deleted:true},{...base,direction:'incoming'}]},86400000);
 assert.equal(old.pendingEvidence.olderThanOneDay,1);assert.equal(old.pendingEvidence.olderThanOneHour,1);
 const media=report.summarizeReportMessages({messages:[{...base,attachment:{manifest:{expires:10}}},{...base,direction:'incoming',attachment:{manifest:{expires:30}}}]},20);
 assert.deepEqual(media.incompleteMediaEvidence,{expiredTransferAuthorization:1,liveTransferAuthorization:1,incoming:1,outgoing:1});
});
test('wake projection allowlists keys and rejects oversized report output',()=>{
 const w=report.summarizeWakeForReport({private:{work:{remoteGatewayCalls:3,token:42},outcomes:{retry:2,local_wake_verification_failed:1,'private-identity':4},pendingSample:[{peer:'secret'}]}});
 assert.equal(w.private.outcomes.local_wake_verification_failed,1);
 assert.equal(w.private.work.remoteGatewayCalls,3);assert(!JSON.stringify(w).includes('secret'));assert(!JSON.stringify(w).includes('token'));assert.throws(()=>report.serializeDiagnosticReport({text:'x'.repeat(65536)}));
});

test('wake mismatch categories survive private and group report projection without private metadata',()=>{
 for(const kind of ['private','group']){const result=report.summarizeWakeForReport({[kind]:{outcomes:{local_silent_flag_binding_mismatch:4,signature:'secret',peer:'secret'}}});assert.equal(result[kind].outcomes.local_silent_flag_binding_mismatch,4);assert(!JSON.stringify(result).includes('secret'));}
});

test('wake pending observations preserve bounded retry evidence without identifiers or arbitrary reasons',()=>{
 for(const kind of ['private','group']){
  const row={requests:4,lastOutcome:'local_silent_flag_binding_mismatch',lastObservedAt:123,nextRetryAt:456,peer:'secret',id:'secret',signature:'secret'};
  const result=report.summarizeWakeForReport({[kind]:{pendingSample:Array.from({length:100},()=>row)}});
  assert.equal(result[kind].pendingSample.length,8);
  assert.deepEqual(result[kind].pendingSample[0],{requests:4,lastObservedAt:123,nextRetryAt:456,lastOutcome:'local_silent_flag_binding_mismatch'});
  assert(!JSON.stringify(result).includes('secret'));assert.match(result.scope,/eligibility, not a promised send time/);
  result[kind].pendingSample[0].requests=99;assert.equal(row.requests,4);
 }
 const malformed=report.summarizeWakeForReport({private:{pendingSample:[null,{requests:NaN,lastObservedAt:Infinity,nextRetryAt:-1,lastOutcome:'secret'},{requests:1.5,lastObservedAt:'123',nextRetryAt:null,lastOutcome:'validation'}]},group:{pendingSample:{peer:'secret'}}});
 assert.deepEqual(malformed.private.pendingSample,[{},{},{nextRetryAt:null,lastOutcome:'validation'}]);assert.deepEqual(malformed.group.pendingSample,[]);
 assert(!JSON.stringify(malformed).includes('secret'));
});
test('recovery timing exports bounded numeric evidence and fixed reasons only',()=>{
 const d=journal.createDiagnosticJournal(()=>1);d.record('recovery_finished',{milliseconds:80300,sleepMs:75000,processCpuMs:7,waitLagMs:80000,setupMs:20,overrunMs:60300,reason:'deadline',peer:'secret'});
 assert.equal(d.snapshot().events[0].sleepMs,75000);assert.equal(d.snapshot().events[0].reason,'deadline');
 d.record('recovery_finished',{sleepMs:-1,waitLagMs:Infinity,processCpuMs:NaN,setupMs:1e20,reason:'secret'});
 const row=d.snapshot().events[1];assert.equal(row.sleepMs,undefined);assert.equal(row.waitLagMs,undefined);assert.equal(row.processCpuMs,undefined);assert.equal(row.setupMs,86400000);assert(!JSON.stringify(d.snapshot()).includes('secret'));
 d.record('app_active',{sleepMs:1,reason:'deadline'});assert.equal(d.snapshot().events[2].sleepMs,undefined);
});
test('network-reset cancellations are separate from active pending or incomplete media',()=>{
 const s=report.summarizeReportMessages({networkResetAt:100,messages:[{direction:'outgoing',status:'pending',at:1,networkCancelledAt:100,attachment:{manifest:{expires:200}}}]},150);
 assert.equal(s.networkResetAt,100);assert.equal(s.private.outgoing.cancelled,1);assert.equal(s.private.outgoing.pending,0);assert.equal(s.incompleteMedia,0);assert.equal(s.oldestOwnPendingSeconds,null);assert.equal(s.incompleteMediaEvidence.outgoing,0);
});
