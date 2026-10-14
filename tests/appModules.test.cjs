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
 connectedPeers:()=>[b,c],blocked:peers=>events.push(['blocked',peers]),collect:async()=>events.push(['collect']),send:async(...args)=>{events.push(['send',...args]);return false;},
 resolve:async peer=>events.push(['resolve',peer]),deposit:async(...args)=>events.push(['deposit',...args]),...overrides});return {worker,events};}

test('failed messages back off while new messages and peer reconnection remain immediate',async()=>{
 const f=setup();let now=10000,peers=[],success=false;const sent=[];
 const first=await f.commands.sendText(b,'offline');const d=delivery(f,{now:()=>now,connectedPeers:()=>peers,send:async(peer,raw,id)=>{sent.push(id);return success;}});
 await d.worker.tick();assert.equal(sent.length,0);
 for(let i=0;i<10;i++)await d.worker.tick();assert.equal(sent.length,0);
 now+=2000;await d.worker.tick();assert.equal(sent.length,0);
 const next=await f.commands.sendText(c,'new');success=true;peers=[c];d.worker.wake(c,next);
 await until(async()=> (await f.ledger.snapshot()).messages.find(m=>m.id===next).status==='delivered');
 assert.equal(sent.at(-1),next);peers=[b];await d.worker.tick();
 assert.equal((await f.ledger.snapshot()).messages.find(m=>m.id===first).status,'delivered');d.worker.stop();
});
test('new message keeps priority after a disconnected first attempt without spinning during backoff',async()=>{
 const f=setup();for(let i=0;i<30;i++)await f.commands.sendText(c,'old pending');
 const id=await f.commands.sendText(b,'new after resume');let now=10000,ready=false;const sent=[];
 const d=delivery(f,{now:()=>now,send:async(peer,raw,key)=>{sent.push(key);return ready;}});
 d.worker.wake(b,id);await until(()=>d.worker.snapshot().attempts===1&&!d.worker.snapshot().busy);
 assert.deepEqual(sent,[id]);await new Promise(r=>setTimeout(r,20));assert.equal(d.worker.snapshot().attempts,1);
 now+=2000;ready=true;await d.worker.tick();assert.equal(sent[1],id);
 assert.equal((await f.ledger.snapshot()).messages.find(m=>m.id===id).status,'delivered');d.worker.stop();
});
test('UI text command persists a pending message without a network dependency',async()=>{const f=setup(),id=await f.commands.sendText(b,'offline');const s=await f.ledger.snapshot();assert.equal(s.messages[0].id,id);assert.equal(s.messages[0].status,'pending');assert.equal(s.messages[0].text,'offline');});
test('failed local persistence rejects the send instead of reporting success',async()=>{const f=setup();f.setFail(true);await assert.rejects(f.commands.sendText(b,'hello'),/disk/);assert.equal((await f.ledger.snapshot()).messages.length,0);});
test('lock or account switch during ID allocation cannot enqueue',async()=>{for(const owner of [null,c]){const f=setup();f.setRandom(async()=>{f.setOwner(owner);return '1'.repeat(64);});await assert.rejects(f.commands.sendText(b,'hello'),/Account changed/);f.setOwner(a);assert.equal((await f.ledger.snapshot()).messages.length,0);}});
test('stale UI owner rejects a send before allocating an ID',async()=>{const f=setup();f.setRandom(()=>{throw Error('must not allocate');});await assert.rejects(f.commands.sendText(b,'hello',undefined,c),/Unlock/);});
test('group creation and group sending use the same durable ledger commands',async()=>{const f=setup(),id=await f.commands.createGroup('Family',[b]);await f.commands.sendGroupText(id,'hello');const s=await f.ledger.snapshot();assert.equal(s.groups[0].name,'Family');assert.equal(s.messages[0].peer,b);assert.equal(s.messages[0].status,'pending');});
test('editing through a command retains the original message and queues an action',async()=>{const f=setup(),id=await f.commands.sendText(b,'original');await f.commands.act(b,{id,author:a},'edit','changed');const s=await f.ledger.snapshot();assert.equal(s.messages[0].text,'original');assert.equal(s.actions[0].kind,'edit');});
test('direct acknowledgement marks delivery without custody or key lookup',async()=>{const f=setup();await f.commands.sendText(b,'hello');const d=delivery(f,{send:async()=>true});await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');assert.ok(!d.events.some(e=>e[0]==='resolve'||e[0]==='deposit'));});

test('a stalled direct preparation falls back and late ACK cannot mark the message delivered',async()=>{
 const f=setup(),id=await f.commands.sendText(b,'stalled');let finish,sends=0,now=10000;
 const d=delivery(f,{now:()=>now,directTimeoutMs:10,send:()=>{sends++;return new Promise(r=>finish=r);}});
 await d.worker.tick();assert.equal(d.worker.snapshot().busy,false);assert.equal(d.worker.snapshot().directTimeouts,1);
 assert.equal(d.events.filter(e=>e[0]==='deposit').length,1);
 now+=2000;await d.worker.tick();assert.equal(sends,1);assert.equal(d.events.filter(e=>e[0]==='deposit').length,2);
 finish(true);await new Promise(r=>setImmediate(r));assert.equal((await f.ledger.snapshot()).messages.find(m=>m.id===id).status,'pending');
 assert.equal(d.worker.snapshot().directInFlight,0);d.worker.stop();
});
test('two stalled direct routes cannot block a third recipient custody handoff',async()=>{
 const f=setup(),other='axonic:1:'+'d'.repeat(64);for(const peer of [b,c,other])await f.commands.sendText(peer,'stalled');
 let sends=0;const releases=[];const d=delivery(f,{directTimeoutMs:10,connectedPeers:()=>[b,c,other],send:()=>{sends++;return new Promise(r=>releases.push(r));}});
 for(let i=0;i<3;i++)await d.worker.tick();assert.equal(sends,2);assert.equal(d.events.filter(e=>e[0]==='deposit').length,3);
 assert.equal(d.worker.snapshot().busy,false);d.worker.stop();for(const release of releases)release(false);
});

async function until(check){for(let n=0;n<100;n++){if(await check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('worker did not finish');}
test('outbox wake notification follows successful durable enqueue only',async()=>{
 let raw=null,fail=false;const queued=[];
 const ledger=createRootChatLedger({owner:a,current:()=>true,now:()=>1800000000000,read:async()=>raw,write:async v=>{if(fail)throw Error('disk');raw=v;},queued:(peer,id)=>{assert(JSON.parse(raw).messages.some(m=>m.id===id));queued.push([peer,id]);}});
 const id='1'.repeat(64);await ledger.enqueue(b,id,'hello');await ledger.enqueue(b,id,'hello');assert.deepEqual(queued,[[b,id]]);
 fail=true;await assert.rejects(ledger.enqueue(b,'2'.repeat(64),'failed'),/disk/);assert.equal(queued.length,1);
});
test('wake sends the newly queued message without a periodic tick and preserves older outbox work',async()=>{
 const f=setup();await f.commands.sendText(c,'older');const id=await f.commands.sendText(b,'now');const sent=[];
 const d=delivery(f,{send:async(peer,raw,id)=>{sent.push(id);return true;}});
 d.worker.wake(b,id);await until(async()=> (await f.ledger.snapshot()).messages.find(m=>m.id===id).status==='delivered');d.worker.stop();
 assert.deepEqual(sent,[id]);assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');
});
test('wake during an active send is retained without concurrent duplicate sends',async()=>{
 const f=setup(),first=await f.commands.sendText(b,'first');let release,active=0,peak=0;const sent=[];
 const d=delivery(f,{send:async(peer,raw,id)=>{active++;peak=Math.max(peak,active);sent.push(id);if(id===first)await new Promise(r=>release=r);active--;return true;}});
 d.worker.wake(b,first);await until(()=>!!release);const second=await f.commands.sendText(b,'second');d.worker.wake(b,second);release();
 await until(async()=> (await f.ledger.snapshot()).messages.every(m=>m.status==='delivered'));d.worker.stop();assert.deepEqual(sent,[first,second]);assert.equal(peak,1);
});
test('a thrown direct disconnect falls back during the same attempt',async()=>{
 const f=setup(),id=await f.commands.sendText(b,'hello'),d=delivery(f,{send:async()=>{throw Error('disconnected');}});
 d.worker.wake(b,id);await until(()=>d.events.some(e=>e[0]==='deposit'));d.worker.stop();assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');
});
test('stopping before a scheduled wake prevents sending',async()=>{
 const f=setup(),id=await f.commands.sendText(b,'hello');let sent=0;const d=delivery(f,{send:async()=>{sent++;return true;}});
 d.worker.wake(b,id);d.worker.stop();await new Promise(r=>setTimeout(r,10));assert.equal(sent,0);
});
test('custody deposit preserves pending status and the same wire ID',async()=>{const f=setup(),id=await f.commands.sendText(b,'hello');let now=10000;const d=delivery(f,{now:()=>now});await d.worker.tick();now+=2000;await d.worker.tick();const deposits=d.events.filter(e=>e[0]==='deposit');assert.equal(deposits.length,2);assert.equal(deposits[0][3],id);assert.deepEqual(deposits[0],deposits[1]);assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');});
test('overlapping delivery ticks send a message only once',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish,count=0;const d=delivery(f,{send:()=>{count++;return new Promise(r=>finish=r);}});const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));await d.worker.tick();assert.equal(count,1);finish(true);await first;});
test('invalidated delivery cannot acknowledge even after the same account unlocks',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish;const d=delivery(f,{send:()=>new Promise(r=>finish=r)});const first=d.worker.tick();while(!finish)await new Promise(r=>setImmediate(r));f.setOwner(null);d.worker.invalidate();f.setOwner(a);finish(true);await first;assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');});
test('background discovery releases delivery slots and stopping cannot send again',async()=>{const f=setup();await f.commands.sendText(b,'hello');let finish;const d=delivery(f,{connectedPeers:()=>[],resolve:()=>new Promise(r=>finish=r)});await d.worker.tick();await until(()=>!!finish);assert.equal(d.worker.snapshot().busy,false);assert.equal(d.events.filter(e=>e[0]==='deposit').length,1);d.worker.stop();finish();await new Promise(r=>setImmediate(r));assert.equal(d.events.filter(e=>e[0]==='deposit').length,1);});
test('network errors preserve the outbox and release the tick for retry',async()=>{const f=setup();await f.commands.sendText(b,'hello');let n=0,now=10000;const d=delivery(f,{now:()=>now,send:async()=>{if(++n<=1)throw Error('offline');return true;}});await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');now+=2000;await d.worker.tick();assert.equal((await f.ledger.snapshot()).messages[0].status,'delivered');});
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

test('disconnected recipient goes straight to custody without a direct attempt or discovery',async()=>{
 const f=setup(),id=await f.commands.sendText(b,'hello'),events=[];let sends=0,resolves=0;
 const d=delivery(f,{connectedPeers:()=>[],send:async()=>{sends++;return false;},resolve:async()=>{resolves++;},deposit:async(peer,raw,key)=>{events.push(key);return true;}});
 await d.worker.tick();assert.deepEqual(events,[id]);assert.equal(sends,0);assert.equal(resolves,0);assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');
});

test('blocking during the connected direct attempt cancels custody fallback',async()=>{
 const f=setup();await f.commands.sendText(b,'hello');let sends=0;
 const d=delivery(f,{send:async()=>{sends++;await f.ledger.configure(b,{blocked:true});return false;}});
 await d.worker.tick();assert.equal(sends,1);assert(!d.events.some(e=>e[0]==='deposit'));
});

test('discovery failure does not prevent encrypted custody with an existing identity',async()=>{
 const f=setup();await f.commands.sendText(b,'hello');const d=delivery(f,{resolve:async()=>{throw Error('discovery unavailable');}});
 await d.worker.tick();assert(d.events.some(e=>e[0]==='deposit'));assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');
});
test('an offline recipient does not block a newly queued connected conversation',async()=>{
 const f=setup();await f.commands.sendText(b,'offline');let release;
 const d=delivery(f,{send:async peer=>peer===c,deposit:()=>new Promise(r=>release=r)});
 const first=d.worker.tick();await until(()=>!!release);
 const id=await f.commands.sendText(c,'urgent');d.worker.wake(c,id);
 await until(async()=> (await f.ledger.snapshot()).messages.find(m=>m.id===id).status==='delivered');
 assert.equal((await f.ledger.snapshot()).messages[0].status,'pending');d.worker.stop();release();await first;
});
test('concurrent recipients remain bounded and a third queued recipient resumes when capacity returns',async()=>{
 const f=setup(),other='axonic:1:'+'d'.repeat(64),ids=[];for(const peer of [b,c,other])ids.push(await f.commands.sendText(peer,'hello'));
 const holds=new Map();let active=0,peak=0;
 const d=delivery(f,{connectedPeers:()=>[b,c,other],send:async peer=>{active++;peak=Math.max(peak,active);await new Promise(r=>holds.set(peer,r));active--;return true;}});
 for(let i=0;i<3;i++)d.worker.wake([b,c,other][i],ids[i]);
 await until(()=>holds.size===2);assert(!holds.has(other));holds.get(b)();await until(()=>holds.has(other));holds.get(c)();holds.get(other)();
 await until(async()=> (await f.ledger.snapshot()).messages.every(m=>m.status==='delivered'));d.worker.stop();assert.equal(peak,2);
});
test('group membership, group text, group reactions and direct edits share acknowledged direct delivery',async()=>{
 const f=setup(),group=await f.commands.createGroup('DEV test',[b,c]),groupText=await f.commands.sendGroupText(group,'group text');
 await f.commands.actGroup(group,{id:groupText,author:a},'reaction','👍');
 const text=await f.commands.sendText(b,'direct text');await f.commands.act(b,{id:text,author:a},'edit','edited');
 const sent=[],d=delivery(f,{send:async(peer,raw,id)=>{sent.push({peer,raw,id});return true;}});
 const pending=load('rootChatLedger').pendingRootChat;
 for(let i=0;i<20&&pending(await f.ledger.snapshot(),a).length;i++)await d.worker.tick();
 assert.equal(pending(await f.ledger.snapshot(),a).length,0);assert.equal(sent.length,8);
 assert(!d.events.some(e=>e[0]==='resolve'||e[0]==='deposit'));d.worker.stop();
});


test('shared handoff refreshes the whole audience after a direct attempt changes contact policy',async()=>{
 const f=setup();await f.commands.sendText(b,'selected');await f.commands.sendText(c,'withdrawn');let audience;
 const d=delivery(f,{connectedPeers:()=>[b],send:async()=>{await f.ledger.configure(c,{blocked:true});return false;},depositGroup:async messages=>{audience=messages.map(m=>m.peer);return true;}});
 await d.worker.tick();assert.deepEqual(audience,[b]);assert.equal(d.events.filter(e=>e[0]==='deposit').length,0);d.worker.stop();
});
