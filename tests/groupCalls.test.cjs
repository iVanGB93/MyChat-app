const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {load}=require('./helpers/attachment.cjs');
const p=load('identityProtocol'),protocol=load('callControlProtocol'),delivery=load('callControlDelivery'),runtime=load('callControlRuntime'),pair=load('neuronCallCoordinator'),rooms=load('groupCallCoordinator'),roomApi=load('groupCallRoom'),media=load('callMediaProtocol');
const now=1800000000000,seed=n=>new Uint8Array(32).fill(n);
async function fixture(count=3,adHoc=false){
 let clock=now,allowed=true;
 const identities=Array.from({length:count},(_,i)=>i).map(i=>{const key=seed(2+i*3),device=p.publicDevice(key,seed(3+i*3)),record=p.issueRecord(seed(1+i*3),[device],clock);return {key,device,record};});
 const peers=identities.map((x,i)=>({account:x.record.account,device:x.device.id,instance:String(i+1).repeat(64),expiresAt:now+120000}));
 const group={id:'dd'.repeat(32),revision:1,members:peers.map(p=>p.account),accepted:true,blocked:false};
 const stores=peers.map(()=>{const rows=new Map();return {rows,read:async(o,id)=>rows.get(id)??null,compareAndSet:async(o,id,b,a)=>{if((rows.get(id)??null)!==b)return false;rows.set(id,a);return true;}};});
 const controls=[],coordinators=[],views=[],events=[];
 const readRecord=async a=>identities.find(x=>x.record.account===a)?.record??null;
 for(let i=0;i<count;i++)controls.push(runtime.createCallControlRuntime({account:peers[i].account,device:peers[i].device,store:stores[i],records:{read:readRecord},now:()=>clock,current:()=>true,blocked:()=>false,
  signReceipt:async e=>delivery.signCallControlReceipt(e,identities[i].record,identities[i].key,clock),
  send:async(a,d,raw)=>{const j=peers.findIndex(p=>p.account===a);const receipt=await controls[j].receive(raw,peers[i]);if(receipt){events.push(JSON.parse(raw));await coordinators[j].observe(JSON.parse(raw));}return receipt;}}));
 for(let i=0;i<count;i++)coordinators.push(rooms.createGroupCallCoordinator({account:peers[i].account,device:peers[i].device,now:()=>clock,current:()=>true,random:async()=>seed(90+i),changed:v=>{views[i]=v;},
  authorize:async r=>allowed&&(adHoc&&r.adHoc&&roomApi.validGroupCallRoom(r)&&r.members.includes(peers[i].account)||roomApi.groupCallMembershipMatches(r,group,peers[i].account))?'Family':null,
  factory:(id,changed,busy)=>pair.createNeuronCallCoordinator({account:peers[i].account,device:peers[i].device,store:stores[i],now:()=>clock,current:()=>true,busy,blocked:()=>false,
   lookup:a=>({user:a,name:a}),resolve:async a=>({account:a,name:a}),readRecord,list:async()=>[],random:async()=>seed(70+i),
   sign:input=>protocol.signCallControl({...input,record:identities[i].record},identities[i].key,clock),submit:controls[i].submit,
   signMedia:input=>media.signCallMediaSignal({...input,record:identities[i].record},identities[i].key,clock),
   contexts:()=>peers.filter((_,j)=>i!==j).map(peer=>({peer,instance:peers[i].instance})),
   sendMedia:(a,d,raw)=>coordinators[peers.findIndex(p=>p.account===a)].receiveMedia(raw,peers[i],peers.find(p=>p.account===a).instance),changed})}));
 const drain=async(i,target)=>{for(const raw of [...stores[i].rows.values()]){const e=JSON.parse(JSON.parse(raw).entries[0].raw),remote=e.caller===peers[i].account?e.callee:e.caller,j=peers.findIndex(p=>p.account===remote);if(target===undefined||target===j)await controls[i].drain(e,peers[j]);}};
 const pump=async()=>{for(let round=0;round<8;round++){for(let i=0;i<count;i++)await drain(i);for(const c of coordinators)await c.tick();}};
 const start=()=>coordinators[0].startGroup(group,'voice');
 return {identities,peers,group,stores,controls,coordinators,views,events,drain,pump,start,advance:n=>clock+=n,revoke:()=>allowed=false,stop:()=>coordinators.forEach(c=>c.stop())};
}
test('three participants negotiate all three signed pair legs only after local consent',async()=>{
 const f=await fixture();try{
  await f.start();await f.pump();
  assert.equal(f.views[1].status,'ringing');assert.equal(f.views[2].status,'ringing');
  assert.equal(f.events.filter(e=>e.kind==='accept').length,0);
  await f.coordinators[1].accept(f.views[1].id);await f.pump();
  assert.equal(f.views[2].status,'ringing');assert.equal(f.views[2].room.accepted,false);
  assert.equal(f.views[1].room.legs.filter(l=>l.status==='ready').length,1);
  await f.coordinators[2].accept(f.views[2].id);await f.pump();
  for(const v of f.views){assert.equal(v.status,'ready');assert.equal(v.room.legs.filter(l=>l.status==='ready').length,2);}
  const ids=new Set(f.views.flatMap(v=>v.room.legs.map(l=>l.id)));assert.equal(ids.size,3);
  const messages=[];const first=f.views[0].room.legs.find(l=>l.peerUser===f.peers[1].account),other=f.views[1].room.legs.find(l=>l.peerUser===f.peers[0].account);
  other.transport.subscribe((kind,data)=>messages.push({kind,data}));
  assert.equal(await first.transport.send('offer',{type:'offer',sdp:'v=0'}),true);assert.equal(messages.length,1);
  await f.coordinators[0].end(f.views[0].id);await f.pump();
  for(const i of [1,2])assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,1,'creator departure does not end remaining pair');
 }finally{f.stop();}
});
test('selected group members alone are invited and connected; outsiders and stale membership fail closed',async()=>{
 const f=await fixture();try{
  const selected={...f.group,members:[f.peers[0].account,f.peers[1].account]};
  await f.coordinators[0].startGroup(selected,'video');await f.pump();
  assert.equal(f.views[1].status,'ringing');assert.equal(f.views[2]??null,null);
  assert.equal(f.stores[2].rows.size,0,'unselected member receives no call journal');
  await f.coordinators[1].accept(f.views[1].id);await f.pump();
  for(const i of [0,1])assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,1);
  const room=f.views[0].room.descriptor;
  assert.equal(roomApi.groupCallMembershipMatches(room,f.group,f.peers[2].account),false,'uninvited member cannot join');
  assert.equal(roomApi.groupCallMembershipMatches(room,{...f.group,revision:2},f.peers[0].account),false);
  assert.equal(roomApi.groupCallMembershipMatches(room,{...f.group,members:[f.peers[0].account,f.peers[2].account]},f.peers[0].account),false);
 }finally{f.stop();}
});
test('out-of-order pair invitation cannot ring or autoaccept before creator invitation',async()=>{
 const f=await fixture();try{
  await f.start();const first=f.peers[1].account<f.peers[2].account?1:2,last=first===1?2:1;
  await f.drain(0,first);await f.coordinators[first].accept(f.views[first].id);
  await f.drain(first,last);assert.equal(f.views[last]??null,null);
  await f.drain(0,last);assert.equal(f.views[last].status,'ringing');
  await f.coordinators[last].accept(f.views[last].id);await f.pump();
  assert.equal(f.views[last].room.legs.filter(l=>l.status==='ready').length,2);
 }finally{f.stop();}
});
test('membership revocation closes all local legs and preserves journals',async()=>{
 const f=await fixture();try{await f.start();await f.pump();for(const i of [1,2])await f.coordinators[i].accept(f.views[i].id);await f.pump();
  const before=f.stores.map(s=>s.rows.size);f.revoke();await f.pump();for(const v of f.views)assert.equal(v.status,'ended');assert.deepEqual(f.stores.map(s=>s.rows.size),before);
 }finally{f.stop();}
});
test('group audience, room and pair ownership are covered by the signature',async()=>{
 const f=await fixture();try{await f.start();const raw=JSON.parse([...f.stores[0].rows.values()][0]).entries[0].raw,e=JSON.parse(raw);
  assert.ok(protocol.verifyCallControl(raw,f.identities[0].record,now));
  for(const change of [{id:'ea'.repeat(32)},{group:'ea'.repeat(32)},{revision:2},{creator:f.peers[1].account},{members:e.room.members.slice().reverse()}])assert.equal(protocol.verifyCallControl(JSON.stringify({...e,room:{...e.room,...change}}),f.identities[0].record,now),null);
  assert.equal(protocol.verifyCallControl(JSON.stringify({...e,room:undefined}),f.identities[0].record,now),null);
 }finally{f.stop();}
});
test('room expiry is terminal and does not create fresh invitations',async()=>{
 const f=await fixture();try{await f.start();await f.pump();f.advance(60001);await f.pump();assert.equal(f.views[0].status,'ended');assert.equal(f.stores[0].rows.size,2);}finally{f.stop();}
});
const captureExports={};new Function('exports',ts.transpileModule(fs.readFileSync('src/services/groupCallCapture.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(captureExports);
test('room capture is single-flight, shares mute state and stops once on room exit',async()=>{
 let acquired=0,stopped=0;const tracks=['audio','video'].map(kind=>({kind,enabled:true,stop:()=>stopped++})),stream={getTracks:()=>tracks};
 const c=captureExports.createGroupCallCapture(async()=>{acquired++;return stream;});
 c.mute(true);const [a,b]=await Promise.all([c.acquire(),c.acquire()]);assert.equal(acquired,1);assert.equal(a,b);assert.equal(tracks[0].enabled,false);c.cameraOff(true);assert.equal(tracks[1].enabled,false);c.stop();c.stop();assert.equal(stopped,2);await assert.rejects(c.acquire());
});
test('late native capture after hangup is disposed and cannot start media',async()=>{
 let release,stopped=0;const c=captureExports.createGroupCallCapture(()=>new Promise(r=>release=r));const pending=c.acquire();c.stop();release({getTracks:()=>[{kind:'audio',enabled:true,stop:()=>stopped++}]});await assert.rejects(pending);assert.equal(stopped,1);
});

 test('last remote departure closes the room on delivery without a scheduler tick',async()=>{
 const f=await fixture();try{
  await f.start();await f.pump();for(const i of [1,2])await f.coordinators[i].accept(f.views[i].id);await f.pump();
  await f.coordinators[0].end(f.views[0].id);await f.drain(0);
  assert.equal(f.views[1].status,'ready');assert.equal(f.views[2].status,'ready');
  await f.coordinators[1].end(f.views[1].id);await f.drain(1,2);
  assert.equal(f.views[2].status,'ended','last participant must close without tick');
 }finally{f.stop();}
 });

test('departed participant rejoins the existing mesh using fresh signed legs; no finished room is revived',async()=>{
 const f=await fixture();try{
  await f.start();await f.pump();for(const i of [1,2])await f.coordinators[i].accept(f.views[i].id);await f.pump();
  const room=f.views[0].room.descriptor,old=f.views[0].room.legs.map(l=>l.id);
  await f.coordinators[0].end(f.views[0].id);await f.pump();
  await f.coordinators[0].joinGroup(room,'voice');await f.pump();
  for(const v of f.views)assert.equal(v.room.legs.filter(l=>l.status==='ready').length,2);
  assert(f.views[0].room.legs.every(l=>!old.includes(l.id)));
  const delayed=f.events.find(e=>e.kind==='end'&&old.includes(e.callId));assert(delayed);
  for(const c of f.coordinators)await c.observe(delayed);
  for(const v of f.views)assert.equal(v.room.legs.filter(l=>l.status==='ready').length,2,'old terminal events cannot recreate retired legs');
  const invite=f.events.find(e=>e.rejoin&&e.kind==='invite');assert(invite);
  assert.equal(protocol.verifyCallControl(JSON.stringify({...invite,rejoin:'ab'.repeat(32)}),f.identities[0].record,now),null);
  for(let i=0;i<3;i++)await f.coordinators[i].end(f.views[i].id);await f.pump();
  // Another invited member tries to join after everybody left: no ringing/capture.
  await f.coordinators[1].joinGroup(room,'voice');await f.pump();
  assert.equal(f.views[0].status,'ended');assert.equal(f.views[2].status,'ended');assert.equal(f.views[1].status,'ended');
 }finally{f.stop();}
});

test('group call audience permits four participants and rejects five without limiting group membership',()=>{
 const members=[1,2,3,4,5].map(n=>'axonic:1:'+String(n).repeat(64));
 const room={id:'ab'.repeat(32),group:'cd'.repeat(32),revision:1,creator:members[0],creatorDevice:'ef'.repeat(32),members:members.slice(0,4)};
 assert.equal(roomApi.MAX_GROUP_CALL_PARTICIPANTS,4);assert(roomApi.validGroupCallRoom(room));
 assert.equal(roomApi.validGroupCallRoom({...room,members}),false);
 assert(roomApi.groupCallMembershipMatches(room,{id:room.group,revision:1,members,accepted:true,blocked:false},members[0]));
});

test('four users form six pair connections and a rejoin preserves the remaining mesh',async()=>{
 const f=await fixture(4);try{
  await f.start();await f.pump();for(const i of [1,2,3])await f.coordinators[i].accept(f.views[i].id);await f.pump();
  for(const v of f.views)assert.equal(v.room.legs.filter(l=>l.status==='ready').length,3);
  assert.equal(new Set(f.views.flatMap(v=>v.room.legs.map(l=>l.id))).size,6);
  const room=f.views[0].room.descriptor,remaining=f.views[1].room.legs.filter(l=>l.peerUser!==f.peers[0].account).map(l=>l.id);
  await f.coordinators[0].end(f.views[0].id);await f.pump();
  for(const i of [1,2,3])assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,2);
  await f.coordinators[0].joinGroup(room,'voice');await f.pump();
  for(const v of f.views)assert.equal(v.room.legs.filter(l=>l.status==='ready').length,3);
  assert(remaining.every(id=>f.views[1].room.legs.some(l=>l.id===id&&l.status==='ready')));
 }finally{f.stop();}
});

for(const kind of ['voice','video'])test(`private ${kind} expands without replacing either existing transport; new participants still consent`,async()=>{
 const f=await fixture(4,true);try{
  await f.coordinators[0].start(f.peers[1].account,kind);await f.pump();await f.coordinators[1].accept(f.views[1].id);await f.pump();
  const originals=f.views.slice(0,2).map(v=>({...v}));assert(originals.every(v=>v.status==='ready'));
  const descriptor=await f.coordinators[0].prepareExpansion(originals[0].id,f.peers.slice(2).map(p=>p.account));
  assert.equal(f.views[0].room,undefined,'prepare does not mutate or invite');
  assert.equal(await f.coordinators[1].adoptExpansion(originals[1].id,descriptor,f.peers[0].account),true);
  assert.equal(await f.coordinators[0].adoptExpansion(originals[0].id,descriptor,f.peers[0].account),true);await f.pump();
  for(const i of [0,1]){assert.equal(f.views[i].id,originals[i].id);assert.equal(f.views[i].transport,originals[i].transport);assert.equal(f.views[i].room.legs.find(l=>l.id===originals[i].id).transport,originals[i].transport);}
  for(const i of [2,3]){assert.equal(f.views[i].status,'ringing');assert.equal(f.views[i].room.accepted,false);await f.coordinators[i].accept(f.views[i].id);}
  await f.pump();for(const v of f.views)assert.equal(v.room.legs.filter(l=>l.status==='ready').length,3);
  assert.equal(f.events.filter(e=>e.kind==='end'&&e.callId===originals[0].id).length,0);
  const invite=f.events.find(e=>e.room?.adHoc&&e.kind==='invite');assert(invite);
  assert(protocol.verifyCallControl(JSON.stringify(invite),f.identities[0].record,now));
  assert.equal(protocol.verifyCallControl(JSON.stringify({...invite,room:{...invite.room,adHoc:undefined}}),f.identities[0].record,now),null);
  await f.coordinators[0].end(f.views[0].id);await f.pump();
  for(const i of [1,2,3])assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,2,'anchor departure preserves the remaining mesh');
 }finally{f.stop();}
});
test('declined expansion invite leaves original private connection intact',async()=>{
 const f=await fixture(3,true);try{
  await f.coordinators[0].start(f.peers[1].account,'voice');await f.pump();await f.coordinators[1].accept(f.views[1].id);await f.pump();const transport=f.views[0].transport,id=f.views[0].id;
  const r=await f.coordinators[0].prepareExpansion(id,[f.peers[2].account]);
  assert.equal(await f.coordinators[1].adoptExpansion(id,{...r,creator:f.peers[2].account},f.peers[2].account),false,'third party cannot expand an existing call');
  await f.coordinators[1].adoptExpansion(id,r,f.peers[0].account);await f.coordinators[0].adoptExpansion(id,r,f.peers[0].account);await f.pump();
  await f.coordinators[2].end(f.views[2].id);await f.pump();assert.equal(f.views[0].status,'ready');assert.equal(f.views[0].transport,transport);
  f.advance(65000);await f.pump();assert.equal(f.views[0].status,'ready');assert.equal(f.views[0].transport,transport);
 }finally{f.stop();}
});

for(const kind of ['voice','video'])test(`private ${kind} expands 2 -> 3 -> 4 sequentially without replacing connected legs`,async()=>{
 const f=await fixture(5,true);try{
  await f.coordinators[0].start(f.peers[1].account,kind);await f.pump();await f.coordinators[1].accept(f.views[1].id);await f.pump();
  const anchor=f.views[0].id;
  const first=await f.coordinators[0].prepareExpansion(anchor,[f.peers[2].account]);
  await f.coordinators[1].adoptExpansion(anchor,first,f.peers[0].account);
  await f.coordinators[0].adoptExpansion(anchor,first,f.peers[0].account);await f.pump();
  await f.coordinators[2].accept(f.views[2].id);await f.pump();
  const saved=f.views.slice(0,3).map(v=>v.room.legs.map(l=>({id:l.id,transport:l.transport})));
  const second=await f.coordinators[0].prepareExpansion(anchor,[f.peers[3].account]);
  assert.equal(second.members.length,4);assert.equal(f.views[0].room.descriptor.members.length,3);
  await assert.rejects(f.coordinators[1].prepareExpansion(anchor,[f.peers[3].account]));
  const thirdAnchor=f.views[2].room.legs.find(l=>l.peerUser===f.peers[0].account).id;
  assert.equal(await f.coordinators[2].adoptExpansion(thirdAnchor,{...second,creator:f.peers[1].account},f.peers[1].account),false);
  assert.equal(await f.coordinators[2].adoptExpansion(thirdAnchor,second,f.peers[0].account),true);
  assert.equal(await f.coordinators[1].adoptExpansion(anchor,second,f.peers[0].account),true);
  assert.equal(await f.coordinators[0].adoptExpansion(anchor,second,f.peers[0].account),true);await f.pump();
  assert.equal(f.views[3].status,'ringing','fourth participant still consents');
  await f.coordinators[3].accept(f.views[3].id);await f.pump();
  for(let i=0;i<4;i++){assert.equal(f.views[i].room.descriptor.members.length,4);assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,3);}
  for(let i=0;i<3;i++)for(const old of saved[i])assert.equal(f.views[i].room.legs.find(l=>l.id===old.id)?.transport,old.transport);
  assert.equal(new Set(f.views.slice(0,4).flatMap(v=>v.room.legs.map(l=>l.id))).size,6);
  await assert.rejects(f.coordinators[0].prepareExpansion(anchor,[f.peers[4].account]));
  assert.equal(f.views[4]??null,null);
  assert.equal(await f.coordinators[2].adoptExpansion(thirdAnchor,first,f.peers[0].account),false,'old audience cannot shrink updated room');
  await f.coordinators[2].end(f.views[2].id);await f.pump();
  for(const i of [0,1,3])assert.equal(f.views[i].room.legs.filter(l=>l.status==='ready').length,2,'old signed legs still deliver hangup after expansion');
 }finally{f.stop();}
});
