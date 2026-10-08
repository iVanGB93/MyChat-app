const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load}=require('./helpers/attachment.cjs');
function moduleCode(name){const out={};new Function('exports','require',ts.transpileModule(fs.readFileSync('src/modules/messaging/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(out,n=>load(n.split('/').at(-1)));return out;}
const {createMessagingCommands}=moduleCode('commands'),{createMessageDelivery}=moduleCode('delivery'),{createCallCommands}=moduleCode('callCommands');
const {createRootChatLedger}=load('rootChatLedger');
const a='axonic:1:'+'a'.repeat(64),b='axonic:1:'+'b'.repeat(64),c='axonic:1:'+'c'.repeat(64);
function setup(){let owner=a,raw=null,counter=0,fail=false,random=async()=> (++counter).toString(16).padStart(64,'0');
 const ledger=createRootChatLedger({owner:a,current:()=>owner===a,now:()=>1800000000000,read:async()=>raw,write:async value=>{if(fail)throw Error('disk');raw=value;}});
 const commands=createMessagingCommands({owner:()=>owner,ledger:()=>ledger,randomId:()=>random()});
 return {ledger,commands,owner:()=>owner,setOwner:v=>owner=v,setRandom:v=>random=v,setFail:v=>fail=v};
}
function delivery(f,overrides={}){const events=[];const worker=createMessageDelivery({owner:f.owner,ledger:()=>f.ledger,
 blocked:peers=>events.push(['blocked',peers]),collect:async()=>events.push(['collect']),send:async(...args)=>{events.push(['send',...args]);return false;},
 resolve:async peer=>events.push(['resolve',peer]),deposit:async(...args)=>events.push(['deposit',...args]),...overrides});return {worker,events};}
test('UI text command persists a pending message without a network dependency',async()=>{const f=setup(),id=await f.commands.sendText(b,'offline');const s=await f.ledger.snapshot();assert.equal(s.messages[0].id,id);assert.equal(s.messages[0].status,'pending');assert.equal(s.messages[0].text,'offline');});
test('failed local persistence rejects the send instead of reporting success',async()=>{const f=setup();f.setFail(true);await assert.rejects(f.commands.sendText(b,'hello'),/disk/);assert.equal((await f.ledger.snapshot()).messages.length,0);});
test('lock or account switch during ID allocation cannot enqueue',async()=>{for(const owner of [null,c]){const f=setup();f.setRandom(async()=>{f.setOwner(owner);return '1'.repeat(64);});await assert.rejects(f.commands.sendText(b,'hello'),/Account changed/);f.setOwner(a);assert.equal((await f.ledger.snapshot()).messages.length,0);}});
test('stale UI owner rejects a send before allocating an ID',async()=>{const f=setup();f.setRandom(()=>{throw Error('must not allocate');});await assert.rejects(f.commands.sendText(b,'hello',undefined,c),/Unlock/);});
test('group creation and group sending use the same durable ledger commands',async()=>{const f=setup(),id=await f.commands.createGroup('Family',[b]);await f.commands.sendGroupText(id,'hello');const s=await f.ledger.snapshot();assert.equal(s.groups[0].name,'Family');assert.equal(s.messages[0].peer,b);assert.equal(s.messages[0].status,'pending');});
test('editing through a command retains the original message and queues an action',async()=>{const f=setup(),id=await f.commands.sendText(b,'original');await f.commands.act(b,{id,author:a},'edit','changed');const s=await f.ledger.snapshot();assert.equal(s.messages[0].text,'original');assert.equal(s.actions[0].kind,'edit');});
test('direct acknowledgement marks delivery without custody or key lookup',async()=>{const f=setup();await f.commands.sendText(b,'hello');const d=delivery(f,{send:async()=>true});await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');assert.ok(!d.events.some(e=>e[0]==='resolve'||e[0]==='deposit'));});
test('custody deposit preserves pending status and the same wire ID',async()=>{const f=setup(),id=await f.commands.sendText(b,'hello'),d=delivery(f);await d.worker.tick();await d.worker.tick();const deposits=d.events.filter(e=>e[0]==='deposit');assert.equal(deposits.length,2);assert.equal(deposits[0][3],id);assert.deepEqual(deposits[0],deposits[1]);assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');});
test('overlapping delivery ticks send a message only once',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish,count=0;const d=delivery(f,{send:()=>{count++;return new Promise(r=>finish=r);}});const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));await d.worker.tick();assert.equal(count,1);finish(true);await first;});
test('invalidated delivery cannot acknowledge even after the same account unlocks',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish;const d=delivery(f,{send:()=>new Promise(r=>finish=r)});const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));f.setOwner(null);d.worker.invalidate();f.setOwner(a);finish(true);await first;assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');});
test('stopping during key discovery prevents a late custody deposit',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish;const d=delivery(f,{resolve:()=>new Promise(r=>finish=r)});const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));d.worker.stop();finish();await first;assert.ok(!d.events.some(e=>e[0]==='deposit'));});
test('network errors preserve the outbox and release the tick for retry',async()=>{const f=setup();await f.commands.sendText(b,'hello');let n=0;const d=delivery(f,{send:async()=>{if(++n===1)throw Error('offline');return true;}});await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');});
test('blocked peers do not enter the transport or custody queue',async()=>{const f=setup();await f.commands.sendText(b,'hello');await f.ledger.configure(b,{blocked:true});const d=delivery(f);await d.worker.tick();assert.ok(!d.events.some(e=>e[0]==='send'));assert.deepEqual(d.events[0],['blocked',[b]]);});
function callFixture(){let owner=a,connected=true,resolve=async()=>({status:'found'}),started=0;const session={start:async()=>{started++;return 'call';}};let active=session;const calls=createCallCommands({owner:()=>owner,calls:()=>active,connected:()=>connected,readinessTimeoutMs:20,resolve:peer=>resolve(peer)});return {calls,setOwner:v=>owner=v,setConnected:v=>connected=v,setResolve:v=>resolve=v,setCalls:v=>active=v,started:()=>started};}
test('call startup waits for the permission-induced reconnect before starting once',async()=>{
 let connected=true,started=0,waits=0;
 const session={start:async()=>{started++;return 'call';}};
 const calls=createCallCommands({owner:()=>a,calls:()=>session,connected:()=>connected,resolve:async()=>({status:'found'}),wait:async()=>{waits++;connected=true;}});
 assert.equal(await calls.start(b,'voice',async()=>{connected=false;}),'call');assert.equal(waits,1);assert.equal(started,1);
});
test('switching accounts while waiting for a connection cancels call startup',async()=>{
 let owner=a,started=0;
 const session={start:async()=>{started++;return 'call';}};
 const calls=createCallCommands({owner:()=>owner,calls:()=>session,connected:()=>false,resolve:async()=>({status:'found'}),wait:async()=>{owner=b;}});
 await assert.rejects(calls.start(b,'voice',async()=>{}),/Account changed/);assert.equal(started,0);
});
test('call permission remains UI supplied while readiness belongs to messaging',async()=>{const f=callFixture();let permission=false;assert.equal(await f.calls.start(b,'video',async()=>{permission=true;}),'call');assert.ok(permission);assert.equal(f.started(),1);});
test('denied permission and missing axon cannot start a call',async()=>{const f=callFixture();await assert.rejects(f.calls.start(b,'voice',async()=>{throw Error('denied');}),/denied/);f.setConnected(false);await assert.rejects(f.calls.start(b,'voice',async()=>{}),/active axon/);assert.equal(f.started(),0);});
test('account or call runtime changes while resolving keys cancel initiation',async()=>{for(const mode of ['owner','runtime']){const f=callFixture();f.setResolve(async()=>{mode==='owner'?f.setOwner(c):f.setCalls(null);return {status:'found'};});await assert.rejects(f.calls.start(b,'video',async()=>{}),/Unlock/);assert.equal(f.started(),0);}});
test('invalid signed peer identity never starts a call',async()=>{const f=callFixture();f.setResolve(async()=>({status:'conflict'}));await assert.rejects(f.calls.start(b,'voice',async()=>{}),/signed identity/);assert.equal(f.started(),0);});
test('inbox polling continues while an unrelated outgoing custody deposit is stalled',async()=>{
 const f=setup();await f.commands.sendText(b,'offline recipient');let finish,polls=0,deposits=0;
 const d=delivery(f,{collect:async()=>{polls++;},deposit:()=>{deposits++;return new Promise(r=>finish=r);}});
 const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));
 await d.worker.tick();await d.worker.tick();
 assert.equal(polls,3);assert.equal(deposits,1);assert.equal(d.worker.snapshot().busy,true);
 finish();await first;
});
test('a stalled inbox poll does not duplicate polls or block direct outgoing delivery',async()=>{
 const f=setup();await f.commands.sendText(b,'hello');let finish,polls=0;
 const d=delivery(f,{collect:()=>{polls++;return new Promise(r=>finish=r);},send:async()=>true});
 const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));
 await d.worker.tick();assert.equal(polls,1);assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');
 finish();await first;assert.equal(d.worker.snapshot().collecting,false);
});
test('failed inbox polling retries independently and stop prevents further polls',async()=>{
 const f=setup();let polls=0;const d=delivery(f,{collect:async()=>{polls++;throw Error('offline');}});
 await d.worker.tick();await d.worker.tick();assert.equal(polls,2);
 d.worker.stop();await d.worker.tick();assert.equal(polls,2);
});

