const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./helpers/attachment.cjs');
const empty={empty:true,item:false};
test('historical call rows settle across bounded relay passes; changes and unknown records retain recovery',async()=>{
 const f=require('./helpers/attachment.cjs').fixture(1),[owner,remote,relay]=f.ids;
 let now=1800000000000,known=true,reads=0;
 const peer={account:relay.record.account,device:relay.device.id,instance:'i',expiresAt:now+999999};
 const rows=Array.from({length:9},(_,i)=>({callId:i.toString(16).padStart(64,'0'),caller:owner.record.account,callee:remote.record.account}));
 const q=load('callRelayPump').createCallRelayPump({account:owner.record.account,device:owner.device.id,store:{read:async()=>{reads++;return null;}},
 now:()=>now,current:()=>true,eventDriven:()=>true,blocked:()=>false,direct:()=>[],peers:()=>[peer],list:async()=>rows,
 records:{read:async account=>known?f.ids.find(i=>i.record.account===account)?.record:null},request:async()=>'{"kind":"event","raw":null}'});
 for(let i=0;i<4;i++){await q.tick();now+=3000;}
 assert.equal(q.nextDeadline(),Infinity);assert.equal(reads,9);
 known=false;q.changed();await q.tick();assert(Number.isFinite(q.nextDeadline()),'unknown record must retry');
 known=true;q.changed();for(let i=0;i<4;i++){await q.tick();now+=3000;}assert.equal(q.nextDeadline(),Infinity);
 peer.instance='reconnected';assert(Number.isFinite(q.nextDeadline()));q.stop();
});
test('empty polls back off to 15s; items restore 5s, errors are not empty inboxes',()=>{
 let now=0;const p=load('relayPollSchedule').createRelayPollSchedule(()=>now);
 p.begin('a').finish(empty);now=4999;assert.equal(p.begin('a'),null);now=5000;p.begin('a').finish(empty);
 now=10000;assert.equal(p.begin('a'),null);now=15000;p.begin('a').finish(empty);
 now=29999;assert.equal(p.begin('a'),null);now=30000;p.begin('a').finish({empty:false,item:true});
 now=35000;p.begin('a').finish({empty:false,item:false});now=40000;assert(p.begin('a'));
 assert.equal(p.diagnostics().emptyPasses,3);assert.equal(p.diagnostics().itemPasses,1);assert.equal(p.diagnostics().unsuccessfulPasses,1);
});
test('wake during a flight stays immediate after completion without a duplicate flight',()=>{
 let now=0;const p=load('relayPollSchedule').createRelayPollSchedule(()=>now),flight=p.begin('a');
 p.resume();assert.equal(p.begin('a'),null);flight.finish(empty);const next=p.begin('a');assert(next);next.finish(empty);
 now=1000;assert(p.begin('a'));assert.equal(p.diagnostics().activePasses,1);
});
test('server retry is per relay, bounded, and reconnect removes the cooldown',()=>{
 let now=0;const p=load('relayPollSchedule').createRelayPollSchedule(()=>now);
 p.begin('a').finish({empty:false,item:false,retryAfterMs:999999});p.begin('b').finish(empty);
 now=5000;assert(p.begin('b'));assert.equal(p.begin('a'),null);p.resume('a');assert(p.begin('a'));
});
test('poll concurrency and inventory stay bounded and disconnected peers are released',()=>{
 let now=0;const p=load('relayPollSchedule').createRelayPollSchedule(()=>now,3);
 const flights=['a','b','c'].map(k=>p.begin(k));assert.equal(p.begin('d'),null);
 p.prune([]);assert.equal(p.diagnostics().activePasses,3);flights.forEach(f=>f.finish(empty));p.prune([]);
 assert.equal(p.diagnostics().trackedRelays,0);assert(p.begin('a'));
});
for(const kind of ['custodyCourier','groupCustodyCourier']){
 const create=kind==='custodyCourier'?'createCustodyCourier':'createGroupCustodyCourier';
 test(kind+' polls idle inbox less, wakes immediately, and never touches persistent stores',async()=>{
  let now=0,calls=0;const q=load(kind)[create]({owner:()=> 'synthetic',now:()=>now,relays:()=>['a','b'],request:async()=>{calls++;return '{"status":"ok","packet":null}';}});
  for(now=0;now<60000;now+=1000)await q.tick();assert.equal(calls,10);
  q.resume();await q.tick();assert.equal(calls,12);q.stop();await q.tick();assert.equal(calls,12);
 });
 test(kind+' healthy relay keeps progressing while another flight is stalled',async()=>{
  let now=0,release;const counts={a:0,b:0};const q=load(kind)[create]({owner:()=> 'synthetic',now:()=>now,relays:()=>['a','b'],request:async peer=>{counts[peer]++;if(peer==='a')await new Promise(r=>release=r);return '{"status":"ok","packet":null}';}});
  const flight=q.tick();for(let n=0;n<10;n++)await Promise.resolve();assert.deepEqual(counts,{a:1,b:1});
  now=5000;await q.tick();assert.deepEqual(counts,{a:1,b:2});release();await flight;q.stop();
 });
 test(kind+' server cooldown and thrown request do not delay another relay',async()=>{
  let now=0;const counts={a:0,b:0,c:0};const q=load(kind)[create]({owner:()=> 'synthetic',now:()=>now,relays:()=>['a','b','c'],request:async peer=>{counts[peer]++;if(peer==='a')return '{"status":"retry","retryAfterMs":60000}';if(peer==='c')throw Error('offline');return '{"status":"ok","packet":null}';}});
  await q.tick();now=5000;await q.tick();assert.deepEqual(counts,{a:1,b:2,c:2});q.stop();
 });
}
test('call fallback cadence stays 3s while inventory is shared and empty inventory skips record reads',async()=>{
 let now=0,reads=0,requests=0;const peers=['a','b'].map(account=>({account,device:'d',instance:'i',expiresAt:999999}));
 const q=load('callRelayPump').createCallRelayPump({account:'owner',device:'d',now:()=>now,current:()=>true,peers:()=>peers,list:async()=>{reads++;return [];},records:{read:()=>{throw Error('empty call inventory must not read identity');}},request:async()=>{requests++;return '{"kind":"event","raw":null}';}});
 for(now=0;now<60000;now+=1000)await q.tick();assert.equal(requests,40);assert.equal(reads,20);assert.equal(q.diagnostics().emptyPolls,40);q.stop();
});
test('call unknown/rejected replies are not mislabeled as empty inboxes',async()=>{
 let now=0;const peer={account:'a',device:'d',instance:'i',expiresAt:999999};
 for(const raw of ['{}','{"accepted":false}','null']){
  const q=load('callRelayPump').createCallRelayPump({account:'owner',device:'d',now:()=>now,current:()=>true,peers:()=>[peer],list:async()=>[],request:async()=>raw});
  await q.tick();assert.equal(q.diagnostics().emptyPolls,0);q.stop();
 }
});
test('call inbox sleeps after explicit empty response and wakes on an event or new session',async()=>{
 let now=0,requests=0;const peer={account:'a',device:'d',instance:'i',expiresAt:999999};
 const q=load('callRelayPump').createCallRelayPump({account:'owner',device:'d',now:()=>now,current:()=>true,eventDriven:()=>true,peers:()=>[peer],list:async()=>[],request:async()=>{requests++;return '{"kind":"event","raw":null}';}});
 await q.tick();assert.equal(q.nextDeadline(),Infinity);now=5000;await q.tick();assert.equal(requests,1);q.changed();await q.tick();assert.equal(requests,2);assert.equal(q.nextDeadline(),Infinity);peer.instance='new';assert(Number.isFinite(q.nextDeadline()));now+=3000;await q.tick();assert.equal(requests,3);q.stop();
});
test('call event racing the empty reply cannot leave the inbox asleep',async()=>{
 let release;const peer={account:'a',device:'d',instance:'i',expiresAt:999999};const q=load('callRelayPump').createCallRelayPump({account:'owner',device:'d',now:()=>0,current:()=>true,eventDriven:()=>true,peers:()=>[peer],list:async()=>[],request:async()=>{await new Promise(r=>release=r);return '{"kind":"event","raw":null}';}});
 const pass=q.tick();await new Promise(setImmediate);q.changed();release();await pass;assert(Number.isFinite(q.nextDeadline()));q.stop();
});
