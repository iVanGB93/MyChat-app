const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const code = ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(n => n.startsWith('./') ? load(n.slice(2).replace(/\.(js|ts)$/, '')) : require(n), exports);
  cache.set(name, exports); return exports;
}
const p=load('identityProtocol'), c=load('callControlProtocol'), m=load('callMediaProtocol');
const durable=load('durableCallControl'), session=load('callMediaSession');
const now=1800000000000, seed=n=>new Uint8Array(32).fill(n);
async function fixture(confirm=true) {
  const devices=[p.publicDevice(seed(2),seed(3)),p.publicDevice(seed(5),seed(6)),p.publicDevice(seed(7),seed(8))];
  const records=[p.issueRecord(seed(1),[devices[0]],now),p.issueRecord(seed(4),devices.slice(1),now)];
  const fields={record:records[0],callId:'ab'.repeat(32),caller:records[0].account,callee:records[1].account,
    callerDevice:devices[0].id,media:'voice',kind:'invite',invitation:null,sequence:0,issuedAt:now,expiresAt:now+60000};
  const invite=c.signCallControl(fields,seed(2),now), invitation=c.callControlDigest(JSON.parse(invite));
  const accept=c.signCallControl({...fields,record:records[1],kind:'accept',invitation,sequence:1},seed(5),now);
  const acceptance=c.callControlDigest(JSON.parse(accept));
  const selected=c.signCallControl({...fields,kind:'selected',invitation,sequence:1,selectedDevice:devices[1].id,acceptance},seed(2),now);
  const values=[null,null], stores=values.map((_,i)=>({read:async()=>values[i],
    compareAndSet:async(o,id,b,a)=>{if(values[i]!==b)return false;values[i]=a;return true;}}));
  const calls=[durable.createDurableCallerCallControl(stores[0],records[0].account,fields.callId),
    durable.createDurableRecipientCallControl(stores[1],records[1].account,fields.callId,devices[1].id)];
  for(const call of calls){assert.equal(await call.begin(invite,records[0],now),true);
    assert.equal(await call.receive(accept,records[1],now),true);
    if(confirm)assert.equal(await call.receive(selected,records[0],now),true);}
  let time=now, blocked=false, current=true;
  const instances=['11'.repeat(32),'22'.repeat(32)], received=[[],[]];
  const options=i=>({invite:JSON.parse(invite),account:records[i].account,device:devices[i].id,instance:instances[i],
    peer:{account:records[1-i].account,device:devices[1-i].id,instance:instances[1-i],expiresAt:now+60000},
    store:stores[i],readRecord:async a=>records.find(r=>r.account===a)??null,
    now:()=>time,current:()=>current,blocked:()=>blocked,received:e=>received[i].push(e)});
  const sessions=[0,1].map(i=>session.createCallMediaSession(options(i)));
  const raw=(i,change={})=>m.signCallMediaSignal({record:records[i],callId:fields.callId,invitation,acceptance,
    target:records[1-i].account,targetDevice:devices[1-i].id,sourceInstance:instances[i],targetInstance:instances[1-i],
    sequence:1,issuedAt:now,expiresAt:now+30000,kind:i?'answer':'offer',
    data:{type:i?'answer':'offer',sdp:'v=0\r\n'},...change},seed(i?5:2),now);
  return {raw,records,devices,sessions,received,calls,fields,invitation,values,options,
    setTime:t=>{time=t;},block:()=>{blocked=true;},lock:()=>{current=false;}};
}
test('media signature binds call, acceptance, target device and both axon instances',async()=>{
  const f=await fixture(),raw=f.raw(0),event=JSON.parse(raw);
  assert.ok(m.verifyCallMediaSignal(raw,f.records[0],now));
  for(const change of [{callId:'cc'.repeat(32)},{acceptance:'dd'.repeat(32)},{targetDevice:f.devices[2].id},
    {sourceInstance:'33'.repeat(32)},{targetInstance:'33'.repeat(32)},{data:{type:'offer',sdp:'tampered'}}]){
    assert.equal(m.verifyCallMediaSignal(JSON.stringify({...event,...change}),f.records[0],now),null);
  }
  assert.equal(m.verifyCallMediaSignal(raw,f.records[1],now),null);
  assert.equal(m.verifyCallMediaSignal(raw,f.records[0],now+30000),null);
  assert.throws(()=>f.raw(0,{data:{type:'offer',sdp:'x'.repeat(9001)}}));
  assert.throws(()=>f.raw(0,{data:{type:'offer',sdp:'v=0',unsigned:true}}));
});
test('confirmed devices exchange offer, answer and bounded ICE; replay is rejected',async()=>{
  const f=await fixture();
  assert.equal(await f.sessions[1].receive(f.raw(0)),true);
  assert.equal(await f.sessions[1].receive(f.raw(0)),false);
  assert.equal(await f.sessions[0].receive(f.raw(1)),true);
  assert.equal(await f.sessions[1].receive(f.raw(0,{sequence:2,kind:'ice-candidate',
    data:{candidate:'candidate:1 1 UDP 1 127.0.0.1 1234 typ host',sdpMid:'0',sdpMLineIndex:0}})),true);
  assert.deepEqual(f.received.map(x=>x.map(e=>e.kind)),[['answer'],['offer','ice-candidate']]);
  assert.equal(f.values.some(v=>v.includes('candidate:1')),false,'SDP/ICE is never journaled');
});
test('no media before durable selection or after terminal cancellation',async()=>{
  const unconfirmed=await fixture(false);
  assert.equal(await unconfirmed.sessions[1].receive(unconfirmed.raw(0)),false);
  const f=await fixture();
  const cancel=c.signCallControl({...f.fields,kind:'cancel',invitation:f.invitation,sequence:2},seed(2),now);
  await f.calls[1].receive(cancel,f.records[0],now);
  assert.equal(await f.sessions[1].receive(f.raw(0)),false);
});
test('signed wrong call, selection, role, session or target never reaches media',async()=>{
  const f=await fixture();
  for(const change of [{callId:'cc'.repeat(32)},{acceptance:'dd'.repeat(32)},
    {targetDevice:f.devices[2].id},{sourceInstance:'33'.repeat(32)},{targetInstance:'33'.repeat(32)},
    {kind:'answer',data:{type:'answer',sdp:'v=0'}}])assert.equal(await f.sessions[1].receive(f.raw(0,change)),false);
  assert.equal(await f.sessions[1].receive(f.raw(0)),true,'invalid events do not consume sequence');
});
test('block, expired signal, lock and stop reject pending delivery',async()=>{
  for(const action of ['block','lock']){const f=await fixture();f[action]();assert.equal(await f.sessions[1].receive(f.raw(0)),false);}
  const f=await fixture();f.setTime(now+30000);assert.equal(await f.sessions[1].receive(f.raw(0)),false);
  const g=await fixture();let release;
  const s=session.createCallMediaSession({...g.options(1),readRecord:()=>new Promise(r=>{release=r;})});
  const pending=s.receive(g.raw(0));await Promise.resolve();s.stop();release(g.records[0]);
  assert.equal(await pending,false);assert.equal(g.received[1].length,0);
});
test('bounded queue serializes simultaneous duplicate signals',async()=>{
  const f=await fixture();
  assert.deepEqual(await Promise.all(Array.from({length:8},()=>f.sessions[1].receive(f.raw(0)))),
    [true,false,false,false,false,false,false,false]);
  assert.equal(f.received[1].length,1);
});

async function coordinatedPair(routed=false,preserveIncoming=()=>false,routeAvailable=()=>true){
  const f=await fixture(),stores=[0,1].map(()=>{let v=null;return {read:async()=>v,compareAndSet:async(o,id,b,a)=>{if(v!==b)return false;v=a;return true;}};});
  const control=load('callControlRuntime'),delivery=load('callControlDelivery'),coordinator=load('neuronCallCoordinator');
  const peers=f.records.map((r,i)=>({account:r.account,device:f.devices[i].id,instance:String(i+1).repeat(64),expiresAt:now+60000}));
  const runtimes=[],coords=[],views=[null,null],contexts=peers.map((_,i)=>[{peer:peers[1-i],instance:peers[i].instance}]);
  const readRecord=async account=>f.records.find(r=>r.account===account)??null;
  for(let i=0;i<2;i++)runtimes.push(control.createCallControlRuntime({account:peers[i].account,device:peers[i].device,
    store:stores[i],records:{read:readRecord},now:()=>now,current:()=>true,blocked:()=>false,
    signReceipt:async e=>delivery.signCallControlReceipt(e,f.records[i],seed(i?5:2),now),
    send:async(a,d,raw)=>{const receipt=await runtimes[1-i].receive(raw,peers[i]);if(receipt)await coords[1-i].observe(JSON.parse(raw));return receipt;}}));
  const make=i=>coordinator.createNeuronCallCoordinator({account:peers[i].account,device:peers[i].device,store:stores[i],now:()=>now,current:()=>true,
    preserveIncoming,busy:()=>false,blocked:()=>false,lookup:()=>({user:1-i,name:'Test peer'}),resolve:async()=>({account:peers[1-i].account,name:'Test peer'}),
    readRecord,list:async()=>{const raw=await stores[i].read();return raw?[JSON.parse(JSON.parse(raw).entries[0].raw)]:[];},
    random:async()=>seed(31),sign:input=>c.signCallControl({...input,record:f.records[i]},seed(i?5:2),now),submit:runtimes[i].submit,
    signMedia:input=>m.signCallMediaSignal({...input,record:f.records[i]},seed(i?5:2),now),contexts:()=>contexts[i],
    ...(routed?{callRoute:()=>routeAvailable()?({expiresAt:now+60000}):null,sendRoutedMedia:raw=>coords[1-i].receiveRoutedMedia(raw)}:{}),
    sendMedia:(a,d,raw)=>coords[1-i].receiveMedia(raw,peers[i],peers[1-i].instance),changed:v=>{views[i]=v;}});
  coords.push(make(0),make(1));
  const drain=async i=>{const raw=await stores[i].read();return runtimes[i].drain(JSON.parse(JSON.parse(raw).entries[0].raw),peers[1-i]);};
  return {f,stores,coords,views,contexts,drain,reopen:i=>{coords[i].stop();coords[i]=make(i);}};
}
test('coordinator waits for selected receipt, exchanges media and ends both sides without Django',async()=>{
  const x=await coordinatedPair(),id=await x.coords[0].start(1,'voice');
  await x.drain(0);assert.equal(x.views[1].status,'ringing');
  assert.equal(await x.coords[1].accept(id),true);await x.drain(1);
  await x.coords[0].tick();assert.notEqual(x.views[0].status,'ready');
  await x.drain(0);await x.coords[0].tick();
  assert.equal(x.views[0].status,'ready');assert.equal(x.views[1].status,'ready');
  const received=[];x.views[1].transport.subscribe((kind,data)=>received.push({kind,data}));
  assert.equal(await x.views[0].transport.send('offer',{type:'offer',sdp:'v=0'}),true);
  assert.equal(received[0].kind,'offer');
  const old=x.views[0].transport;await x.coords[0].end(id);await x.drain(0);
  assert.equal(x.views[0].status,'ended');assert.equal(x.views[1].status,'ended');
  assert.equal(await old.send('offer',{type:'offer',sdp:'v=0'}),false);
});
test('restart cancels old calls and changed axon instances cannot reuse an active media session',async()=>{
  const x=await coordinatedPair(),id=await x.coords[0].start(1,'video');await x.drain(0);
  await x.coords[1].accept(id);await x.drain(1);await x.drain(0);await x.coords[0].tick();
  const old=x.views[0].transport;
  x.contexts[0]=[{...x.contexts[0][0],instance:'ff'.repeat(32)}];await x.coords[0].tick();
  assert.equal(x.views[0].status,'ended');assert.equal(await old.send('offer',{type:'offer',sdp:'v=0'}),false);
  const y=await coordinatedPair();await y.coords[0].start(1,'voice');await y.drain(0);
  y.reopen(0);await y.coords[0].tick();await y.drain(0);
  assert.equal(y.views[1].status,'ended');
});

test('selection waits for a recovering route before opening media',async()=>{
 const x=await coordinatedPair(),id=await x.coords[0].start(1,'video');await x.drain(0);
 const saved=x.contexts[0];x.contexts[0]=[];
 await x.coords[1].accept(id);await x.drain(1);await x.drain(0);await x.coords[0].tick();
 assert.equal(x.views[0].status,'connecting');
 x.contexts[0]=saved;await x.coords[0].tick();assert.equal(x.views[0].status,'ready');
});

test('decline ends ringing only when no other connected recipient device remains',async()=>{
 const x=await coordinatedPair(),id=await x.coords[0].start(1,'voice');await x.drain(0);
 await x.coords[1].end(id);await x.drain(1);assert.equal(x.views[0].status,'ended');
 const y=await coordinatedPair(),id2=await y.coords[0].start(1,'voice');await y.drain(0);
 y.contexts[0].push({...y.contexts[0][0],peer:{...y.contexts[0][0].peer,device:y.f.devices[2].id}});
 await y.coords[1].end(id2);await y.drain(1);assert.equal(y.views[0].status,'ringing');
});

test('call-bound routed signaling works without a direct axon and remains terminal after hangup',async()=>{
 const x=await coordinatedPair(true);x.contexts[0]=[];x.contexts[1]=[];
 const id=await x.coords[0].start(1,'voice');await x.drain(0);await x.coords[1].accept(id);await x.drain(1);await x.drain(0);await x.coords[0].tick();
 assert.equal(x.views[0].status,'ready');assert.equal(x.views[1].status,'ready');
 const incoming=[];x.views[1].transport.subscribe((kind,data)=>incoming.push(kind));
 assert.equal(await x.views[0].transport.send('offer',{type:'offer',sdp:'v=0'}),true);assert.deepEqual(incoming,['offer']);
 const transport=x.views[0].transport;await x.coords[0].end(id);await x.drain(0);assert.equal(await transport.send('offer',{type:'offer',sdp:'v=0'}),false);
});
test('media courier forwards only sender-owned signed signals and rejects expired or blocked traffic',async()=>{
 const f=await fixture(),forwarded=[];
 const relay=load('callMediaRelay').createCallMediaRelay({records:{read:async()=>f.records[0]},now:()=>now,current:()=>true,blocked:()=>false,
  forward:async(a,d,raw)=>{forwarded.push([a,d]);return f.sessions[1].receive(raw);}});
 const peer={account:f.records[0].account,device:f.devices[0].id,instance:'11'.repeat(32),expiresAt:now+60000};
 assert.equal(await relay(f.raw(0),{...peer,device:f.devices[1].id}),false);
 assert.equal(await relay(f.raw(0),peer),true);assert.equal(forwarded.length,1);
 assert.equal(await relay(f.raw(0),peer),false); // recipient replay gate
 assert.equal(await relay(f.raw(0),{...peer,expiresAt:now}),false);
});

test('a relayed decline leaves another authorized recipient device ringing',async()=>{
 const x=await coordinatedPair(true);x.contexts[0]=[];x.contexts[1]=[];
 const id=await x.coords[0].start(1,'voice');await x.drain(0);await x.coords[1].end(id);await x.drain(1);
 assert.equal(x.views[0].status,'ringing');
});

test('cached cryptographic success cannot authorize changed bytes, devices or expired records',async()=>{
 const f=await fixture(),raw=f.raw(0),event=JSON.parse(raw);
 assert.ok(m.verifyCallMediaSignal(raw,f.records[0],now));
 assert.ok(m.verifyCallMediaSignal(raw,f.records[0],now));
 assert.equal(m.verifyCallMediaSignal(JSON.stringify({...event,data:{type:'offer',sdp:'tampered'}}),f.records[0],now),null);
 assert.equal(m.verifyCallMediaSignal(JSON.stringify({...event,device:f.devices[1].id}),f.records[0],now),null);
 assert.equal(m.verifyCallMediaSignal(raw,f.records[0],now+30001),null);
 assert.equal(p.verifyRecord(f.records[0],f.records[0].expiresAt+1),false);
});

test('permission reattachment restores only a held incoming ringing invitation',async()=>{
 let held=null;const x=await coordinatedPair(false,id=>id===held);const id=await x.coords[0].start(1,'voice');await x.drain(0);held=id;
 x.reopen(1);await x.coords[1].ready();assert.equal(await x.coords[1].resumeIncoming(id),true);assert.equal(await x.coords[1].accept(id),true);
 await x.drain(1);await x.drain(0);await x.coords[0].tick();assert.equal(x.views[1].status,'ready');
 x.reopen(1);await x.coords[1].ready();assert.equal(await x.coords[1].resumeIncoming(id),false);
});
test('a cancelled invitation cannot be restored after a permission interruption',async()=>{
 let held=null;const x=await coordinatedPair(false,id=>id===held);const id=await x.coords[0].start(1,'voice');await x.drain(0);held=id;
 await x.coords[0].end(id);await x.drain(0);x.reopen(1);await x.coords[1].ready();assert.equal(await x.coords[1].resumeIncoming(id),false);
});

test('call-bound media survives a transient relay route gap',async()=>{
 let available=true;const x=await coordinatedPair(true,()=>false,()=>available),id=await x.coords[0].start(1,'voice');
 await x.drain(0);await x.coords[1].accept(id);await x.drain(1);await x.drain(0);await x.coords[0].tick();
 const transport=x.views[0].transport;available=false;await x.coords[0].tick();assert.equal(x.views[0].status,'ready');
 assert.equal(await transport.send('offer',{type:'offer',sdp:'v=0'}),false);
 available=true;await x.coords[0].tick();assert.equal(x.views[0].transport,transport);
});

test('fresh root-account runtime rings, accepts, signals media and blocks without numeric accounts',async()=>{
 const f=await fixture(),factory=load('rootAccountCalls'),delivery=load('callControlDelivery');
 let clock=now;const values=[null,null],blocked=[false,false],live=[true,true],views=[null,null],apps=[];
 const peers=f.records.map((r,i)=>({account:r.account,device:f.devices[i].id,instance:String(i+1).repeat(64),expiresAt:now+60000}));
 for(let i=0;i<2;i++){
  const record=f.records[i],signing=seed(i?5:2),other=1-i;
  const store={read:async()=>values[i],compareAndSet:async(o,id,b,a)=>{if(values[i]!==b)return false;values[i]=a;return true;}};
  apps.push(factory.createRootAccountCalls({
   identity:{status:()=>({account:record.account,state:'unlocked'}),callDevice:()=>peers[i].device,publicRecord:()=>record,
    signCall:input=>c.signCallControl({...input,record},signing,clock),signCallMedia:input=>m.signCallMediaSignal({...input,record},signing,clock),
    signCallReceipt:event=>delivery.signCallControlReceipt(event,record,signing,clock)},
   network:()=>({callPeers:()=>[peers[other]],mediaContexts:()=>[{peer:peers[other],instance:peers[i].instance}],
    relayPeers:()=>[],mediaRelayPeers:()=>[],callControlRequest:(a,d,raw)=>apps[other].receive(raw,peers[i]),
    callMediaRequest:(a,d,raw)=>apps[other].receiveMedia(raw,peers[i],peers[other].instance),
    sendRelayedMedia:raw=>apps[other].receiveRoutedMedia(raw,peers[i])}),
   records:{read:async id=>f.records.find(r=>r.account===id)??null},store,
   list:async()=>values[i]?[JSON.parse(JSON.parse(values[i]).entries[0].raw)]:[],
   current:()=>live[i],now:()=>clock,random:async()=>seed(31),
   contacts:async()=>[{account:peers[other].account,alias:'Local nickname',blocked:blocked[i]}],changed:v=>views[i]=v,
  }));
 }
 const id=await apps[0].coordinator.start(peers[1].account,'video');
 for(let n=0;n<2;n++){clock+=2100;await apps[0].tick();await apps[1].tick();}
 assert.equal(views[1].status,'ringing');assert.equal(views[1].peerUser,peers[0].account);
 assert.equal(views[1].peerName,'Local nickname');
 assert.equal(await apps[1].coordinator.accept(id),true);
 for(let n=0;n<3;n++){clock+=2100;await apps[1].tick();await apps[0].tick();}
 assert.equal(views[0].status,'ready');assert.equal(views[1].status,'ready');
 const received=[];views[1].transport.subscribe((kind,data)=>received.push(kind));
 assert.equal(await views[0].transport.send('offer',{type:'offer',sdp:'v=0'}),true);assert.deepEqual(received,['offer']);
 const old=views[0].transport;blocked[0]=true;clock+=2100;await apps[0].tick();
 assert.equal(views[0].status,'ended');assert.equal(await old.send('offer',{type:'offer',sdp:'v=0'}),false);
 await assert.rejects(apps[0].coordinator.start(peers[1].account,'voice'));
 live[1]=false;await assert.rejects(apps[1].receive('{}',peers[0]));
 for(const app of apps)app.stop();
});
