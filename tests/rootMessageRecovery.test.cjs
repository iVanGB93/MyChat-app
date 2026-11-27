const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('background recovery drives delivery without relying on display-frame JS timers',async()=>{const f=fixture({nativeClock:true});await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().jsTimers,0);assert.ok(f.counts().ticks>1);assert.ok(f.counts().ticks<=20,'receipt observation must not pump the whole network every 300ms');assert.ok(f.counts().elapsed>=20000);assert.deepEqual(f.leases,[30000,0]);});
test('a durable inbox entry does not close the wake transport before the receipt exchange',async()=>{const f=fixture();await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().resumed,1);assert.ok(f.counts().elapsed>=20000);assert.ok(f.counts().elapsed<30000);assert.equal(f.counts().stopped,1);});
function fixture({state='unlocked',resume=false,native=true,fail=false,nativeClock=false,foreground=false,completeAfter=null,attachmentAfter=null,descriptorAfter=null,inlineFailure=false,inlineDelay=0,diagnosticFailure=false,stopFailure=false,waitDelay=0,sleepDelay=0,clockSamples=false,events=false,manualClock=false,jobStopAfter=Infinity,transferProgress=false,custodyObservations=[]}={}){
 let now=100000,started=0,resumed=0,stopped=0,owner='own',inspects=0,initializes=0,ticks=0,jsTimers=0;const leases=[],inline=[];
 const app={currentState:foreground?'active':'background'};const diagnostics=[];let appliedDelay=0;
 const imports={'react-native':{AppState:app},'../../../modules/axonic-nearby':{default:native?{messageRecoveryCurrent:()=>now-100000<jobStopAfter,axonMessageWake:ms=>leases.push(ms),...(nativeClock?{axonMessageWait:async ms=>{app.currentState='background';now+=ms;}}:{})}:{}},'./localAccount':{startLocalAccount:async()=>{if(!owner)inspects++;if(state==='locked'){initializes++;if(resume)state='unlocked';}},localAccount:{status:()=>({state,account:owner}),inspect:async()=>{inspects++;}},localAccountSession:{initialize:async()=>{initializes++;if(resume)state='unlocked';}}},'../../composition/neuronRuntime':{startLocalAccountNetwork:()=>{started++;const resumedBefore=resumed;return {receiveWakeEnvelope:async e=>{inline.push(e);if(inlineFailure)throw Error("inline unavailable");return {};},resume:()=>resumed++,tick:()=>{ticks++;if(fail)throw Error('pump');},stop:()=>stopped++};}},'./localRootChat':{localRootChat:()=>({snapshot:async()=>{if(fail)throw Error('storage');return {messages:[{peer:'peer',id:'id',direction:'incoming'}]};}})}};
 imports['../mobileDeliveryDiagnostics']={deliveryDiagnosticEvent:(_a,_p,_i,event,details)=>{if(diagnosticFailure&&event==='recovery_finished')throw Error('diagnostic unavailable');diagnostics.push({event,details});}};
 if(nativeClock){imports['../../../modules/axonic-nearby'].default.axonMessageWait=async ms=>{app.currentState='background';now+=ms;if(!appliedDelay&&waitDelay){now+=waitDelay;appliedDelay=waitDelay;}};}
 if(clockSamples)imports['../../../modules/axonic-nearby'].default.axonClockSnapshot=()=>({elapsedMs:now,uptimeMs:now-(appliedDelay?sleepDelay:0),processCpuMs:100+(appliedDelay?7:0)});
 const subscribers={chat:new Set(),job:new Set(),account:new Set(),receipt:new Set(),stream:new Set(),custody:new Set()},waits=[];
 imports['./custodyProtocol']={custodyDigest:packet=>packet.digest};
 if(custodyObservations.length){
  const wait=imports['../../../modules/axonic-nearby'].default.axonMessageWait;
  const pending=[...custodyObservations];
  imports['../../../modules/axonic-nearby'].default.axonMessageWait=async ms=>{
   await wait(ms);
   while(pending.length&&pending[0][0]<=now-100000){
    const [,relay,packet]=pending.shift();
    for(const emit of subscribers.custody)emit(packet,relay);
   }
  };
 }
 if(events){
  imports['./localRootChat'].subscribeRootChatCommitted=f=>{subscribers.chat.add(f);return()=>subscribers.chat.delete(f);};
  imports['./mobileAttachmentJobs']={subscribeAttachmentJobProgress:f=>{subscribers.job.add(f);return()=>subscribers.job.delete(f);},subscribeAttachmentReceiveProgress:f=>{subscribers.stream.add(f);return()=>subscribers.stream.delete(f);}};
  imports['./localAccount'].localAccount.subscribe=f=>{subscribers.account.add(f);return()=>subscribers.account.delete(f);};
 }
 if(transferProgress){
  const wait=imports['../../../modules/axonic-nearby'].default.axonMessageWait;
  let cursor=0;imports['../../../modules/axonic-nearby'].default.axonMessageWait=async ms=>{await wait(ms);const next=Math.floor((now-100000)/10000);if(next>cursor){cursor=next;if(transferProgress==='stream'){for(const f of subscribers.stream)f('own','id',cursor*65536);}else{for(const f of subscribers.job)f({owner:'own',id:'id',phase:'downloading',cursor});}}};
 }
 if(manualClock)imports['../../../modules/axonic-nearby'].default.axonMessageWait=ms=>new Promise(resolve=>waits.push({ms,resolve}));
 const lease={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/messageWakeLease.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(lease,n=>imports[n]);imports['./messageWakeLease']=lease;
 imports['./internetAxonTransport']={configuredWakeCustodian:account=>account==='relay'?{account}:undefined};
 const originalStart=imports['../../composition/neuronRuntime'].startLocalAccountNetwork;
 const routes=[];let inlinePending=false,resumedWhileInline=false;
 imports['../../composition/neuronRuntime'].startLocalAccountNetwork=scope=>{routes.push(scope);const network=originalStart();return {...network,snapshot:()=>({sessions:custodyObservations.length?[{account:'relay',state:'connected'}]:[]}),subscribeConnected:()=>()=>{},subscribeRecoveryCustody:f=>{subscribers.custody.add(f);return()=>subscribers.custody.delete(f);},resumeRecovery:()=>{resumedWhileInline||=inlinePending;network.resume();},hasRecoveredContent:async()=>completeAfter!==null&&now-100000>=completeAfter&&(attachmentAfter===null||now-100000>=attachmentAfter),subscribeRecovery:f=>{subscribers.receipt.add(f);return()=>subscribers.receipt.delete(f);},...(attachmentAfter===null?{}:{attachmentRecoveryState:async()=>descriptorAfter!==null&&now-100000<descriptorAfter?'descriptor-missing':now-100000>=attachmentAfter?'complete':'ready'}),receiveWakeEnvelope:async e=>{now+=inlineDelay;inlinePending=true;try{return await network.receiveWakeEnvelope(e);}finally{inlinePending=false;}},stop:()=>{network.stop();if(stopFailure)throw Error('stop failed');},recoveryComplete:(sender,id)=>sender==='peer'&&id==='id'&&completeAfter!==null&&now-100000>=completeAfter};};
 const out={};new Function('exports','require','Date','setTimeout',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageRecovery.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>imports[n],{now:()=>now},(cb,ms)=>{jsTimers++;now+=ms;queueMicrotask(cb);});
 const recover=out.recoverRootMessage;out.recoverRootMessage=(...args)=>{if(args.length<7)args[6]='relay';return recover(...args);};
 return {out,leases,inline,diagnostics,waits,subscribers,routes,advance:ms=>now+=ms,emitReceipt:(sender='peer',id='id')=>{for(const f of subscribers.receipt)f(sender,id);},emit:()=>{for(const f of subscribers.job)f({owner:'own',id:'id',phase:'complete'});},counts:()=>({started,resumed,resumedWhileInline,stopped,initializes,inspects,ticks,jsTimers,elapsed:now-100000}),change:()=>owner='other'};
}
test('background recovery uses only its custodian and returns a stall without broadening',async()=>{
 const quick=fixture({nativeClock:true,completeAfter:900});
 await quick.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay');
 assert.deepEqual(quick.routes,[{custodian:'relay'}]);
 const slow=fixture({nativeClock:true});
 assert.equal(await slow.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay',undefined,'job'),'stalled');
 assert.deepEqual(slow.routes,[{custodian:'relay'}]);assert(slow.counts().elapsed>=20000&&slow.counts().elapsed<21000);
 const missing=fixture({nativeClock:true});
 assert.equal(await missing.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,undefined),'route-unavailable');
 assert.deepEqual(missing.routes,[]);
 const foreground=fixture({nativeClock:true,foreground:true,completeAfter:900});
 await foreground.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay');
 assert.deepEqual(foreground.routes,[undefined]);
});

test('only independently polled, matching custody evidence promotes a stalled wake',async()=>{
 const trace='ab'.repeat(12),digest='verified-digest';
 const packet={sender:'peer',recipient:'own',id:'id',digest};
 for(const [observations,expected,count] of [
  [[[100,'relay',packet],[16000,'other',packet]],'stalled',1],
  [[[100,'relay',packet],[300,'relay',packet],[16000,'relay',{...packet,digest:'different'}]],'stalled',1],
  [[[100,'relay',packet],[16000,'relay',packet]],'confirmed-stalled',2],
 ]){
  const f=fixture({nativeClock:true,custodyObservations:observations});
  const result=await f.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay',undefined,'job',{digest,wakeTrace:trace});
  assert.equal(result,expected);
  assert.equal(f.diagnostics.at(-1).details.custodyPolls,count);
  assert.equal(f.diagnostics.at(-1).details.custodianConnected,true);
  assert.equal(f.diagnostics.at(-1).details.wakeTrace,trace);
  assert.equal(f.subscribers.custody.size,0);
 }
});

test('slow inline persistence consumes the recovery budget without aborting the transaction or starting extra polling',async()=>{
 const f=fixture({nativeClock:true,inlineDelay:25000});await f.out.recoverRootMessage('own','peer','id',160000,undefined,{kind:'inline'});
 assert.equal(f.inline.length,1);assert.equal(f.counts().elapsed,25000);assert.equal(f.counts().resumed,0);assert.equal(f.counts().ticks,0);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
 const d=f.diagnostics.at(-1).details;assert.equal(d.setupMs,25000);assert.equal(d.overrunMs,5000);assert.equal(d.reason,'deadline');assert.equal(d.waitReason,'setup');
});
test('diagnostic exceptions cannot strand recovery; a runtime stop exception still releases the native lease',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900,diagnosticFailure:true});await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
 const g=fixture({nativeClock:true,completeAfter:900,stopFailure:true});await assert.rejects(g.out.recoverRootMessage('own','peer','id',160000),/stop failed/);assert.deepEqual(g.leases,[30000,0]);
});
test('late background callback reports sleep separately from process-wide CPU without extending expired recovery',async()=>{
 const f=fixture({nativeClock:true,waitDelay:80000,sleepDelay:75000,clockSamples:true});await f.out.recoverRootMessage('own','peer','id',200000);
 const d=f.diagnostics.at(-1).details;assert.equal(d.milliseconds,80300);assert.equal(d.sleepMs,75000);assert.equal(d.processCpuMs,7);assert.equal(d.waitLagMs,80000);assert.equal(d.overrunMs,60300);assert.equal(f.counts().ticks,1);assert.equal(f.counts().stopped,1);
});
test('duplicate wake hints share one recovery lease and release their slot after completion',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),a=[],b=[];
 await Promise.all([f.out.recoverRootMessage('own','peer','id',160000,m=>a.push(m)),f.out.recoverRootMessage('own','peer','id',160000,m=>b.push(m))]);
 assert.equal(f.counts().started,1);assert.deepEqual(a,b);assert(a.includes('account-ready'));
 await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().started,2);
});
test('an inline payload following a metadata-only hint is not lost by coalescing',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),envelope={kind:'envelope'};
 await Promise.all([f.out.recoverRootMessage('own','peer','id',160000),f.out.recoverRootMessage('own','peer','id',160000,undefined,envelope)]);
 assert.equal(f.counts().started,2);assert.deepEqual(f.inline,[envelope]);
});
test('a routed repeat recovers even while an unroutable hint for the same message is pending',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900});
 const missing=f.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,undefined);
 const routed=f.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay');
 const duplicate=f.out.recoverRootMessage('own','peer','id',160000,undefined,undefined,'relay');
 assert.equal(routed,duplicate);
 assert.deepEqual(await Promise.all([missing,routed]),['route-unavailable',undefined]);
 assert.deepEqual(f.routes,[{custodian:'relay'}]);
 assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
});
test('a burst of 100 duplicate verified hints uses one lease and notifies every observer',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),observed=Array.from({length:100},()=>[]);
 await Promise.all(observed.map(events=>f.out.recoverRootMessage('own','peer','id',160000,m=>events.push(m))));
 assert.equal(f.counts().started,1);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
 assert(observed.every(events=>events.includes('account-ready')));
});
test('expired hints alongside active recovery do not start another transport lease',async()=>{
 const f=fixture({nativeClock:true});
 await Promise.all([f.out.recoverRootMessage('own','peer','first',160000),f.out.recoverRootMessage('own','peer','expired-in-queue',99999)]);
 assert.equal(f.counts().started,1);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
});
test('unlocked verified-wake recovery acquires a bounded native window and releases its transport lease',async()=>{const f=fixture();await f.out.recoverRootMessage('own','peer','id',160000);assert.deepEqual(f.leases,[30000,0]);assert.equal(f.counts().started,1);assert.equal(f.counts().stopped,1);});
test('confirmed receipt and drained work release the background lease early',async()=>{const f=fixture({nativeClock:true,completeAfter:900});await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().elapsed,900);assert.deepEqual(f.leases,[30000,0]);assert.equal(f.counts().stopped,1);});
test('locked or mismatched accounts and old native builds cannot access background transport',async()=>{for(const options of [{state:'locked'},{native:false}]){const f=fixture(options);await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().started,0);assert.deepEqual(f.leases,[]);}const f=fixture();f.change();await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().started,0);});
test('remembered session may resume; storage failure still releases native and runtime leases',async()=>{const resumed=fixture({state:'locked',resume:true});await resumed.out.recoverRootMessage('own','peer','id',160000);assert.equal(resumed.counts().initializes,1);assert.equal(resumed.counts().started,1);const f=fixture({fail:true});await assert.rejects(f.out.recoverRootMessage('own','peer','id',160000));assert.deepEqual(f.leases,[30000,0]);assert.equal(f.counts().stopped,1);});

test('foreground wake survives going to background and does not strand the next recovery',async()=>{const f=fixture({nativeClock:true,foreground:true});await Promise.all([f.out.recoverRootMessage('own','peer','first',160000),f.out.recoverRootMessage('own','peer','second',160000)]);assert.equal(f.counts().jsTimers,0);assert.equal(f.counts().started,2);assert.equal(f.counts().stopped,2);assert.deepEqual(f.leases,[30000,30000,0]);assert.ok(f.counts().elapsed>=20000);assert.ok(f.counts().elapsed<21000);});

test('inline admission overlaps custodian inbox startup and still requires receipt recovery',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),envelope={kind:'envelope'},progress=[];
 await f.out.recoverRootMessage('own','peer','id',160000,m=>progress.push(m),envelope);
 assert.deepEqual(f.inline,[envelope]);assert(progress.includes('inline-persisted'));assert.equal(f.counts().resumed,1);assert.equal(f.counts().resumedWhileInline,true);assert.equal(f.counts().elapsed,900);
 const locked=fixture({state:'locked'});await locked.out.recoverRootMessage('own','peer','id',160000,undefined,envelope);assert.equal(locked.inline.length,0);
 const failed=fixture({inlineFailure:true,nativeClock:true,completeAfter:900});await failed.out.recoverRootMessage('own','peer','id',160000,undefined,envelope);assert.equal(failed.counts().resumed,1);assert.equal(failed.counts().stopped,1);
});
test('a missing receipt cannot delay a different inline message or release its shared wake early',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),progress=[];
 await Promise.all([
  f.out.recoverRootMessage('own','peer','missing',160000),
  f.out.recoverRootMessage('own','peer','id',160000,m=>progress.push({m,elapsed:f.counts().elapsed}),{kind:'inline'})
 ]);
 assert(progress.some(p=>p.m==='inline-persisted'&&p.elapsed<900));
 assert.equal(f.leases.filter(ms=>ms===0).length,1);assert.equal(f.leases.at(-1),0);
 assert.equal(f.counts().started,2);assert.equal(f.counts().stopped,2);
 assert(f.counts().elapsed<21000);assert(f.counts().ticks<75);
});

test('message receipt does not end recovery while its attachment remains pending',async()=>{
 const f=fixture({nativeClock:true,completeAfter:300,attachmentAfter:2400});await f.out.recoverRootMessage('own','peer','id',160000);
 assert.equal(f.counts().elapsed,2400);assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');assert.deepEqual(f.leases,[30000,0]);
});
test('pending media cannot extend the bounded recovery lease indefinitely',async()=>{
 const f=fixture({nativeClock:true,completeAfter:300,attachmentAfter:60000});await f.out.recoverRootMessage('own','peer','id',160000);
 assert(f.counts().elapsed>=20000&&f.counts().elapsed<21000);assert.equal(f.diagnostics.at(-1).details.reason,'deadline');assert.equal(f.diagnostics.at(-1).details.waitReason,'attachment');assert.deepEqual(f.leases,[30000,0]);
});

test('terminal checkpoint event completes recovery without waiting for the native safety timer',async()=>{
 const f=fixture({events:true,nativeClock:true,manualClock:true,completeAfter:100,attachmentAfter:100});
 const work=f.out.recoverRootMessage('own','peer','id',160000);
 for(let n=0;n<20;n++)await Promise.resolve();assert.equal(f.waits.length,1);assert.equal(f.waits[0].ms,1000);
 f.advance(100);f.emit();await work;
 assert.equal(f.counts().elapsed,100);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
 for(const set of Object.values(f.subscribers))assert.equal(set.size,0);
 f.waits[0].resolve();await Promise.resolve();assert.equal(f.counts().stopped,1);
});

test('early recovery events reuse the in-flight native safety timer',async()=>{
 const f=fixture({events:true,manualClock:true,completeAfter:500});
 const work=f.out.recoverRootMessage('own','peer','id',160000);
 const settle=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};
 await settle();
 for(let n=0;n<4;n++){f.advance(100);f.emit();await settle();}
 assert.equal(f.waits.length,1);
 f.advance(100);f.emit();
 await work;
 assert.equal(f.counts().stopped,1);
 f.waits[0].resolve();
});

test('event recovery preserves its deadline when no completion event arrives and reduces polling',async()=>{
 const f=fixture({events:true,nativeClock:true});await f.out.recoverRootMessage('own','peer','id',160000);
 assert.equal(f.counts().elapsed,20000);assert.equal(f.counts().ticks,20);assert.equal(f.counts().jsTimers,0);
 assert.equal(f.diagnostics.at(-1).details.reason,'deadline');
 for(const set of Object.values(f.subscribers))assert.equal(set.size,0);
});

test('accepted receipt event finishes recovery without waiting for the native safety timer',async()=>{
 const f=fixture({events:true,manualClock:true,completeAfter:100});const work=f.out.recoverRootMessage('own','peer','id',160000);
 for(let i=0;i<30&&!f.waits.length;i++)await Promise.resolve();assert.equal(f.waits.length,1);
 f.advance(100);f.emitReceipt('different','id');await Promise.resolve();assert.equal(f.counts().stopped,0);
 f.emitReceipt();await work;assert.equal(f.counts().elapsed,100);assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 for(const set of Object.values(f.subscribers))assert.equal(set.size,0);f.waits[0].resolve();
});

 test('Android job keeps target recovery alive past the old deadline and stops on completion',async()=>{
 const f=fixture({nativeClock:true,events:true,transferProgress:true,completeAfter:45000,attachmentAfter:48000});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert(f.counts().elapsed>=48000);assert(f.counts().elapsed<49000);assert.equal(f.counts().stopped,1);
 assert.equal(f.diagnostics.at(-1).details.budgetMs,120000);assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 });
 test('verified stream bytes keep a background download alive between durable checkpoints',async()=>{
 const f=fixture({nativeClock:true,events:true,transferProgress:'stream',completeAfter:1000,attachmentAfter:48000});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert.equal(f.counts().elapsed,48000);
 assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 });
 test('Android stopping a job releases its runtime without continuing network recovery',async()=>{
 const f=fixture({nativeClock:true,jobStopAfter:4500});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert(f.counts().elapsed<5500);assert.equal(f.counts().stopped,1);assert.equal(f.diagnostics.at(-1).details.reason,'job_stopped');
 const stopped=fixture({nativeClock:true,jobStopAfter:0});await stopped.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');assert.equal(stopped.counts().started,0);
 });
 test('Android jobs retain a finite deadline and never extend an expired wake',async()=>{
 const f=fixture({nativeClock:true,events:true,transferProgress:true});await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');assert.equal(f.counts().elapsed,120000);assert.equal(f.diagnostics.at(-1).details.reason,'deadline');
 const g=fixture({nativeClock:true});await g.out.recoverRootMessage('own','peer','id',105000,undefined,undefined,'relay',undefined,'job');assert(g.counts().elapsed<6000);
 });

test('Android media recovery waits for late custodian storage without a second push',async()=>{
 const f=fixture({nativeClock:true,events:true,completeAfter:5000,attachmentAfter:37000});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert.equal(f.counts().elapsed,37000);
 assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 assert.deepEqual(f.routes,[{custodian:'relay'}]);
});
test('a signed receipt and committed text release the Android job without a media descriptor',async()=>{
 const f=fixture({nativeClock:true,events:true,completeAfter:3000,attachmentAfter:0,descriptorAfter:Infinity});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert.equal(f.counts().elapsed,3000);
 assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 assert.equal(f.leases.at(-1),0);
});
test('an attachment that never arrives releases the Android job at its existing deadline',async()=>{
 const f=fixture({nativeClock:true,events:true,completeAfter:5000,attachmentAfter:130000});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert.equal(f.counts().elapsed,120000);
 assert.equal(f.diagnostics.at(-1).details.reason,'deadline');
 assert.equal(f.diagnostics.at(-1).details.waitReason,'attachment');
 assert.equal(f.diagnostics.at(-1).details.attachmentState,'ready');
 assert.equal(f.leases.at(-1),0);
});

test('a verified media descriptor keeps recovery alive while the relay receipt is delayed',async()=>{
 const f=fixture({nativeClock:true,events:true,descriptorAfter:5000,completeAfter:42000,attachmentAfter:37000});
 await f.out.recoverRootMessage('own','peer','id',300000,undefined,undefined,'relay',undefined,'job');
 assert.equal(f.counts().elapsed,42000);
 assert.equal(f.diagnostics.at(-1).details.reason,'receipt_complete');
 assert.deepEqual(f.routes,[{custodian:'relay'}]);
});
