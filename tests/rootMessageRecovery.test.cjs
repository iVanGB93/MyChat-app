const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
test('background recovery drives delivery without relying on display-frame JS timers',async()=>{const f=fixture({nativeClock:true});await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().jsTimers,0);assert.ok(f.counts().ticks>1);assert.ok(f.counts().ticks<=20,'receipt observation must not pump the whole network every 300ms');assert.ok(f.counts().elapsed>=20000);assert.deepEqual(f.leases,[30000,0]);});
test('a durable inbox entry does not close the wake transport before the receipt exchange',async()=>{const f=fixture();await f.out.recoverRootMessage('own','peer','id',160000);assert.equal(f.counts().resumed,1);assert.ok(f.counts().elapsed>=20000);assert.ok(f.counts().elapsed<30000);assert.equal(f.counts().stopped,1);});
function fixture({state='unlocked',resume=false,native=true,fail=false,nativeClock=false,foreground=false,completeAfter=null,attachmentAfter=null,inlineFailure=false,inlineDelay=0,diagnosticFailure=false,stopFailure=false,waitDelay=0,sleepDelay=0,clockSamples=false,events=false,manualClock=false}={}){
 let now=100000,started=0,resumed=0,stopped=0,owner='own',inspects=0,initializes=0,ticks=0,jsTimers=0;const leases=[],inline=[];
 const app={currentState:foreground?'active':'background'};const diagnostics=[];let appliedDelay=0;
 const imports={'react-native':{AppState:app},'../../../modules/axonic-nearby':{default:native?{axonMessageWake:ms=>leases.push(ms),...(nativeClock?{axonMessageWait:async ms=>{app.currentState='background';now+=ms;}}:{})}:{}},'./localAccount':{startLocalAccount:async()=>{if(!owner)inspects++;if(state==='locked'){initializes++;if(resume)state='unlocked';}},localAccount:{status:()=>({state,account:owner}),inspect:async()=>{inspects++;}},localAccountSession:{initialize:async()=>{initializes++;if(resume)state='unlocked';}}},'../../composition/neuronRuntime':{startLocalAccountNetwork:()=>{started++;const resumedBefore=resumed;return {receiveWakeEnvelope:async e=>{inline.push(e);if(inlineFailure)throw Error("inline unavailable");return {};},resume:()=>resumed++,tick:()=>{ticks++;if(fail)throw Error('pump');},stop:()=>stopped++};}},'./localRootChat':{localRootChat:()=>({snapshot:async()=>{if(fail)throw Error('storage');return {messages:[{peer:'peer',id:'id',direction:'incoming'}]};}})}};
 imports['../mobileDeliveryDiagnostics']={deliveryDiagnosticEvent:(_a,_p,_i,event,details)=>{if(diagnosticFailure&&event==='recovery_finished')throw Error('diagnostic unavailable');diagnostics.push({event,details});}};
 if(nativeClock){imports['../../../modules/axonic-nearby'].default.axonMessageWait=async ms=>{app.currentState='background';now+=ms;if(!appliedDelay&&waitDelay){now+=waitDelay;appliedDelay=waitDelay;}};}
 if(clockSamples)imports['../../../modules/axonic-nearby'].default.axonClockSnapshot=()=>({elapsedMs:now,uptimeMs:now-(appliedDelay?sleepDelay:0),processCpuMs:100+(appliedDelay?7:0)});
 const subscribers={chat:new Set(),job:new Set(),account:new Set()},waits=[];
 if(events){
  imports['./localRootChat'].subscribeRootChatCommitted=f=>{subscribers.chat.add(f);return()=>subscribers.chat.delete(f);};
  imports['./mobileAttachmentJobs']={subscribeAttachmentJobProgress:f=>{subscribers.job.add(f);return()=>subscribers.job.delete(f);}};
  imports['./localAccount'].localAccount.subscribe=f=>{subscribers.account.add(f);return()=>subscribers.account.delete(f);};
 }
 if(manualClock)imports['../../../modules/axonic-nearby'].default.axonMessageWait=ms=>new Promise(resolve=>waits.push({ms,resolve}));
 const lease={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/services/identity/messageWakeLease.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(lease,n=>imports[n]);imports['./messageWakeLease']=lease;
 const originalStart=imports['../../composition/neuronRuntime'].startLocalAccountNetwork;
 imports['../../composition/neuronRuntime'].startLocalAccountNetwork=()=>{const network=originalStart();return {...network,...(attachmentAfter===null?{}:{attachmentRecoveryComplete:async()=>now-100000>=attachmentAfter}),receiveWakeEnvelope:async e=>{now+=inlineDelay;return network.receiveWakeEnvelope(e);},stop:()=>{network.stop();if(stopFailure)throw Error('stop failed');},recoveryComplete:(sender,id)=>sender==='peer'&&id==='id'&&completeAfter!==null&&now-100000>=completeAfter};};
 const out={};new Function('exports','require','Date','setTimeout',ts.transpileModule(fs.readFileSync('src/services/identity/rootMessageRecovery.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>imports[n],{now:()=>now},(cb,ms)=>{jsTimers++;now+=ms;queueMicrotask(cb);});
 return {out,leases,inline,diagnostics,waits,subscribers,advance:ms=>now+=ms,emit:()=>{for(const f of subscribers.job)f({owner:'own',id:'id',phase:'complete'});},counts:()=>({started,resumed,stopped,initializes,inspects,ticks,jsTimers,elapsed:now-100000}),change:()=>owner='other'};
}

test('slow inline persistence consumes the recovery budget without aborting the transaction or starting extra polling',async()=>{
 const f=fixture({nativeClock:true,inlineDelay:25000});await f.out.recoverRootMessage('own','peer','id',160000,undefined,{kind:'inline'});
 assert.equal(f.inline.length,1);assert.equal(f.counts().elapsed,25000);assert.equal(f.counts().resumed,0);assert.equal(f.counts().ticks,0);assert.equal(f.counts().stopped,1);assert.deepEqual(f.leases,[30000,0]);
 const d=f.diagnostics.at(-1).details;assert.equal(d.setupMs,25000);assert.equal(d.overrunMs,5000);assert.equal(d.reason,'deadline');
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

test('inline admission precedes connection resume but receipt recovery still runs',async()=>{
 const f=fixture({nativeClock:true,completeAfter:900}),envelope={kind:'envelope'},progress=[];
 await f.out.recoverRootMessage('own','peer','id',160000,m=>progress.push(m),envelope);
 assert.deepEqual(f.inline,[envelope]);assert(progress.includes('inline-persisted'));assert.equal(f.counts().resumed,1);assert.equal(f.counts().elapsed,900);
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
 assert(f.counts().elapsed>=20000&&f.counts().elapsed<21000);assert.equal(f.diagnostics.at(-1).details.reason,'deadline');assert.deepEqual(f.leases,[30000,0]);
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

test('event recovery preserves its deadline when no completion event arrives and reduces polling',async()=>{
 const f=fixture({events:true,nativeClock:true});await f.out.recoverRootMessage('own','peer','id',160000);
 assert.equal(f.counts().elapsed,20000);assert.equal(f.counts().ticks,20);assert.equal(f.counts().jsTimers,0);
 assert.equal(f.diagnostics.at(-1).details.reason,'deadline');
 for(const set of Object.values(f.subscribers))assert.equal(set.size,0);
});
