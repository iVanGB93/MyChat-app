const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
function fixture(mode,appState='active',route){
 const timers=[],events=[];let committedListener,historyReads=0,release,lookupCount=0,prepares=0,listener,writeListener,locked=false,revision=0,workerDeps,receiptCommitted;
 const gate=new Promise(r=>release=r),owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64);
 const selection={id:'c'.repeat(64),peer,name:'test',mime:'image/jpeg',failed:false};
 let rows=[selection];
 if(mode==='lookup-two')rows.push({...selection,id:'2'.repeat(64),peer:'axonic:1:'+'3'.repeat(64)});
 if(mode==='group'){selection.shared={id:'d'.repeat(64),count:2,slot:0};selection.group={id:'e'.repeat(64),revision:1,messageId:'f'.repeat(64)};rows.push({...selection,id:'1'.repeat(64),peer:'axonic:1:'+'2'.repeat(64),shared:{...selection.shared,slot:1}});}
 const incoming={manifest:{expires:Date.now()+60000}};
 const snapshot={contacts:[{account:peer,accepted:true}],messages:[{peer,status:'pending',direction:'incoming',attachment:incoming}]};
 if(mode==='admission-failure')snapshot.messages.unshift({...snapshot.messages[0],attachment:{...incoming,invalid:true}});
 if(mode==='group')snapshot.groups=[{id:selection.group.id,accepted:true,members:[owner,peer,rows[1].peer]}];
 const worker={enqueue:async(descriptor,direction)=>{if(descriptor.invalid){events.push('admission-failed');throw Error('Attachment identity mismatch');}if(mode==='save-failure'&&direction==='outgoing')throw Error('Storage unavailable');events.push(direction);},receive:async()=>workerDeps.allowed(peer)?'ready':'rejected',tick:async()=>{events.push('tick');return false;},invalidate(){},stop(){},cancel(){},retry(){}};
 const deps={
 './rootChatLedger':{assertAttachmentFits(){if(mode==='caption')throw Error('Attachment description is too large; shorten the caption');}},
 '../../../modules/axonic-nearby':{default:route?{identityRandomBytes(){},attachmentFileSha256(){},attachmentStageStream(){}}:undefined},
 './rootAttachmentStreams':{createRootAttachmentStreams:()=>({pull:async()=>{events.push('rtc');return route.rtcResult;},stop(){}})},
 './wssAttachmentStreams':{createWssAttachmentStreams:()=>({pull:async()=>{events.push('wss');return route.wssResult;},stop(){}})},
 'react-native':{AppState:{currentState:appState}},
 './attachmentSchedule':require('./helpers/attachment.cjs').load('attachmentSchedule'),
 './attachmentRouteSelection':require('./helpers/attachment.cjs').load('attachmentRouteSelection'),
 './attachmentChanges':{attachmentChanged(){}},
 '../../modules/storage/chatStore':{ownChatRevision:()=>revision,subscribeOwnChatWrites:f=>{writeListener=f;return()=>{};}},
 '../workPump':{createWorkPump:d=>{const out={};new Function('exports','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/services/workPump.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,f=>{timers.push(f);return f;},f=>{const i=timers.indexOf(f);if(i>=0)timers.splice(i,1);});return out.createWorkPump(d);}},
 './localAccount':{localAccount:{status:()=>({account:owner,state:locked?'locked':'unlocked'}),subscribe:f=>{listener=f;return()=>{};}}},
 './localRootChat':{subscribeRootChatCommitted:f=>{committedListener=f;return()=>{committedListener=null;};},localRootChat:()=>({snapshot:async()=>snapshot,attachmentRevisionSnapshot:async readRevision=>{historyReads++;return {state:snapshot,revision:readRevision()};},enqueueAttachment:async()=>events.push('publish'),enqueueAttachments:async items=>{assert.equal(items.length,2);assert.equal(prepares,2);events.push('publish-batch');}})},
 './attachmentPolicy':{...require('./helpers/attachment.cjs').load('attachmentPolicy'),indexAttachmentPolicy:()=>()=>true},
 './attachmentTiming':{createAttachmentTiming:()=>({measure:(_s,f)=>f(),snapshot:()=>({})})},
 './rootMediaExport':{startRootMediaExport:()=>({stop(){},wake(){}})},
 './identityRecordStore':{createMobileIdentityRecordStore:()=>({read:async p=>mode==='lookup'||mode==='lookup-two'&&p===peer?null:{}})},
 './rootGroups':{validGroupContext:()=>true,rootGroupAllowed:()=>true},
 './identityProtocol':{validAccountId:()=>true,verifyRecord:()=>true},
 './mobileAttachmentJobs':{createMobileAttachmentJobs:(_now,_measure,onReceipt)=>{receiptCommitted=onReceipt;return {};}},
 './attachmentTransfer':{createAttachmentTransfer:d=>{workerDeps=d;return worker;}},
 './rootAttachmentFiles':{rootAttachmentFile:()=>({exists:false}),prepareRootAttachment:async()=>{prepares++;await gate;return incoming;},removeRootAttachmentSource:()=>events.push('remove')},
 '@react-native-async-storage/async-storage':{default:{getItem:async()=>JSON.stringify(rows),setItem:async(_k,s)=>rows=JSON.parse(s)}},
 };
 const selections={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentSelections.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},selections);deps['./rootAttachmentSelections']=selections;
 const out={};new Function('require','exports','setTimeout','clearTimeout','__DEV__',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>deps[n]??{},out,f=>{timers.push(f);return f;},()=>{},false);
 const runtime=out.startRootAttachmentRuntime({...(route?{streams:{available:()=>route.rtcReady},wss:{peer:()=>({device:route.device??'device'})}}:{}),peers:()=>[],request:async()=>null,lookup:async()=>{lookupCount++;await gate;}});
 const pump=async()=>{assert(timers.length);timers.shift()();for(let n=0;n<12;n++)await new Promise(setImmediate);};
 return {runtime,events,pump,release,deps,receipt:()=>receiptCommitted(),complete:(job,current=()=>true)=>workerDeps.completed(job,current),pull:()=>workerDeps.connections.directStream({descriptor:{manifest:{sender:peer,senderDevice:'device'}}},async()=>true),historyReads:()=>historyReads,commitBlocked(){snapshot.contacts[0].blocked=true;revision++;writeListener(owner);committedListener(owner,revision,snapshot);},change(){revision++;writeListener(owner);},block(){snapshot.contacts[0].blocked=true;revision++;},lock(){locked=true;listener();},lookupCount:()=>lookupCount,prepares:()=>prepares,rows:()=>rows};
}
test('outgoing receipt completion does not require the deleted source; incoming and invalid receipts remain held',async t=>{
 const f=fixture('lookup');t.after(()=>{f.runtime.stop();f.release();});let verified=0,accept=true;
 f.deps['./localRootChat'].localRootChat=()=>({attachmentComplete:async()=>{verified++;return accept;}});
 const job={owner:'owner',digest:'digest',direction:'outgoing',receipt:{},descriptor:{manifest:{id:'id',sender:'sender',recipient:'recipient'}}};
 await f.complete(job);assert.equal(verified,1);
 await assert.rejects(f.complete({...job,direction:'incoming'}),/Own attachment unavailable/);assert.equal(verified,1);
 accept=false;await assert.rejects(f.complete(job),/Attachment chat receipt unavailable/);assert.equal(verified,2);
 await assert.rejects(f.complete({...job,receipt:null}),/Attachment chat receipt unavailable/);assert.equal(verified,2);
 await assert.rejects(f.complete(job,()=>false),/Account locked/);assert.equal(verified,2);
});
for(const [route,expected,result] of [
 [{rtcReady:false,wssResult:true,rtcResult:true},['wss'],true],
 [{rtcReady:true,wssResult:true,rtcResult:true},['rtc'],true],
 [{rtcReady:false,wssResult:'unavailable',rtcResult:true},['wss','rtc'],true],
 [{rtcReady:false,wssResult:false,rtcResult:true},['wss'],false],
 [{rtcReady:false,device:'other-device',rtcResult:'unavailable',wssResult:'unavailable'},['rtc','wss'],'unavailable'],
])test(`stream selection respects readiness and fallback: ${JSON.stringify(route)}`,async t=>{
 const f=fixture('lookup','active',route);t.after(()=>{f.runtime.stop();f.release();});
 assert.equal(await f.pull(),result);assert.deepEqual(f.events,expected);
});
for(const mode of ['lookup','prepare'])test(`pending ${mode} cannot block incoming transfers or start duplicate work`,async t=>{
 const f=fixture(mode);t.after(()=>{f.runtime.stop();f.release();});
 await f.pump();await f.pump();await f.pump();
 assert.equal(f.events.filter(x=>x==='incoming').length,1,'unchanged descriptors are reconciled once, not every burst');assert.equal(f.events.filter(x=>x==='tick').length,3);
 assert.equal(mode==='lookup'?f.lookupCount():f.prepares(),1);
 f.release();await new Promise(setImmediate);await f.pump();
 if(mode==='lookup')assert.equal(f.lookupCount(),1,'lookup retries are backed off');
 else {assert.equal(f.events.filter(x=>x==='publish').length,1);assert.equal(f.rows().length,0);assert(f.events.indexOf('outgoing')<f.events.indexOf('publish'),'serving job exists before announcing the descriptor');}
});

test('durable state handoff avoids a new history read and applies a new contact block',async t=>{
 const f=fixture('lookup');t.after(()=>{f.runtime.stop();f.release();});await f.pump();
 const reads=f.historyReads();f.commitBlocked();await f.pump();
 assert.equal(f.historyReads(),reads);assert.equal(await f.runtime.receive('{}',{}),'rejected');
});

test('a committed chat change reconciles new descriptors on the next wake',async t=>{
 const f=fixture('lookup');t.after(()=>{f.runtime.stop();f.release();});await f.pump();f.change();await f.pump();
 assert.equal(f.events.filter(x=>x==='incoming').length,2);
});

test('background committed-message events run without a frame timer and coalesce safely',async t=>{
 const f=fixture('lookup','background');t.after(()=>{f.runtime.stop();f.release();});
 // No fake timer is fired: background frame timers are deliberately suspended.
 f.change();f.runtime.wake();f.runtime.wake();
 for(let n=0;n<20;n++)await new Promise(setImmediate);
 assert.equal(f.events.filter(x=>x==='incoming').length,1);
 assert.equal(f.events.filter(x=>x==='tick').length,2,'one additional wake publishes the durable waiting reason');
 assert.equal(f.lookupCount(),1);
 f.commitBlocked();for(let n=0;n<20;n++)await new Promise(setImmediate);
 assert.equal(await f.runtime.receive('{}',{}),'rejected');
 f.runtime.stop();const count=f.events.length;f.runtime.wake();
 for(let n=0;n<5;n++)await new Promise(setImmediate);
 assert.equal(f.events.length,count);
});
test('locking during preparation cannot publish or remove a staged attachment',async t=>{
 const f=fixture('prepare');t.after(()=>f.runtime.stop());await f.pump();f.lock();f.release();
 for(let n=0;n<6;n++)await new Promise(setImmediate);
 assert(!f.events.includes('publish'));assert(!f.events.includes('remove'));assert.equal(f.rows().length,1);
});

 test('group descriptors stay unpublished until all recipients finish preparation',async t=>{
 const f=fixture('group');t.after(()=>f.runtime.stop());await f.pump();await f.pump();
 assert(!f.events.includes('publish'));assert(!f.events.includes('publish-batch'));assert.equal(f.rows().length,2);
 f.release();for(let n=0;n<20;n++)await new Promise(setImmediate);
 assert.equal(f.events.filter(e=>e==='publish-batch').length,1);assert.equal(f.events.filter(e=>e==='publish').length,0);
 assert.equal(f.rows().length,0);assert.equal(f.events.filter(e=>e==='outgoing').length,2);
 assert(f.events.lastIndexOf('outgoing')<f.events.indexOf('publish-batch'),'all recipient jobs exist before publishing the group');
 });

test('failed serving-job persistence cannot announce a descriptor',async t=>{
 const f=fixture('save-failure');t.after(()=>f.runtime.stop());await f.pump();f.release();
 for(let n=0;n<20;n++)await new Promise(setImmediate);
 assert(!f.events.includes('publish'));assert(!f.events.includes('remove'));assert.equal(f.rows().length,1);
});

test('serving refreshes policy before the first pump and immediately honors blocking',async t=>{
 const f=fixture('prepare');t.after(()=>{f.release();f.runtime.stop();});
 assert.equal(await f.runtime.receive('request',{}),'ready');
 f.block();assert.equal(await f.runtime.receive('request',{}),'rejected');
 f.lock();assert.equal(await f.runtime.receive('request',{}),null);
});
test('read-only serving does not schedule another transfer scan but a committed receipt does',async t=>{
 const f=fixture('lookup','background');t.after(()=>{f.runtime.stop();f.release();});
 await f.pump();
 const scans=()=>f.events.filter(x=>x==='tick').length;
 const before=scans();
 assert.equal(await f.runtime.receive('request',{}),'ready');
 await new Promise(setImmediate);
 assert.equal(scans(),before);
 f.receipt();
 for(let step=0;step<12;step++)await new Promise(setImmediate);
 assert.equal(scans(),before+1);
});

test('missing identity is visible and lookup remains single flight',async t=>{
 const f=fixture('lookup');t.after(()=>{f.runtime.stop();f.release();});
 await f.pump();await f.pump();assert.equal(f.rows()[0].reason,'identity');assert.equal(f.lookupCount(),1);
});
test('blocked group member fails the whole preparation without partial publication',async t=>{
 const f=fixture('group');t.after(()=>{f.runtime.stop();f.release();});f.block();await f.pump();
 assert(f.rows().every(r=>r.failed&&r.reason==='audience'));assert(!f.events.includes('publish-batch'));assert.equal(f.rows().length,2);
});

test('unresolved recipient lookup does not monopolize preparation for another recipient',async t=>{
 const f=fixture('lookup-two');t.after(()=>{f.runtime.stop();f.release();});await f.pump();await f.pump();
 assert.equal(f.lookupCount(),1);assert.equal(f.prepares(),1,'another queued file can prepare before lookup resolves');
});
test('caption rejection saves an actionable failure before any serving job or message is published',async t=>{
 const f=fixture('caption');t.after(()=>{f.runtime.stop();f.release();});await f.pump();f.release();
 for(let i=0;i<20;i++)await new Promise(setImmediate);
 assert.equal(f.rows()[0].failed,true);assert.equal(f.rows()[0].reason,'caption');
 assert(!f.events.includes('outgoing'));assert(!f.events.includes('publish'));assert(!f.events.includes('remove'));
});

test('a failed descriptor admission cannot starve later descriptors or the transfer worker',async t=>{
 const f=fixture('admission-failure');t.after(()=>{f.runtime.stop();f.release();});
 await f.pump();
 assert.deepEqual(f.events.filter(x=>['admission-failed','incoming','tick'].includes(x)),['admission-failed','incoming','tick']);
});
