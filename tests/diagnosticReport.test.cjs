const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(path,deps={}){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>{if(deps[n])return deps[n];throw Error(n);});return out;}
const status=load('src/services/identity/rootMessageStatus.ts');
const report=load('src/services/diagnosticReport.ts',{'./identity/rootMessageStatus':status});
const journal=load('src/services/diagnosticJournal.ts');
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
});
test('wake projection allowlists keys and rejects oversized report output',()=>{
 const w=report.summarizeWakeForReport({private:{work:{remoteGatewayCalls:3,token:42},outcomes:{retry:2,'private-identity':4},pendingSample:[{peer:'secret'}]}});
 assert.equal(w.private.work.remoteGatewayCalls,3);assert(!JSON.stringify(w).includes('secret'));assert(!JSON.stringify(w).includes('token'));assert.throws(()=>report.serializeDiagnosticReport({text:'x'.repeat(65536)}));
});
