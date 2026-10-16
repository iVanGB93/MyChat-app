const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,now}=require('./helpers/attachment.cjs'),p=load('identityProtocol'),g=load('groupCustodyProtocol'),c=load('custodyProtocol'),s=load('groupCustodyService');
const random=async n=>new Uint8Array(crypto.randomBytes(n));
async function fixture(){const ids=[];for(let i=0;i<5;i++){const signingSeed=await random(32),encryptionSeed=await random(32),device=p.publicDevice(signingSeed,encryptionSeed);ids.push({signingSeed,encryptionSeed,device,record:p.issueRecord(await random(32),[device],now)});}const records={read:async account=>ids.find(i=>i.record.account===account)?.record??null};
const job=await g.sealGroupCustody({...ids[0],id:'ab'.repeat(32),text:'one encrypted group message',recipients:ids.slice(1,3).map((r,i)=>({record:r.record,device:r.device.id,id:String(i+1).repeat(64),metadata:JSON.stringify({slot:i})})),now,random});
let rows=[],time=now,fail=false,wakes=0;const store={async transaction(fn){const next=structuredClone(rows),out=fn(next);s.validateGroupCustodyRows(next);if(fail)throw Error('disk failed');rows=next;return out;}};
const create=()=>s.createGroupCustodyService({owner:ids[3].record.account,store,records,now:()=>time,current:()=>true,stored:async()=>{wakes++;}});let service=create();const request=async(i,q)=>JSON.parse(await service.receive(ids[i].record.account,JSON.stringify(q)));const deposit=async()=>{assert.equal((await request(0,{operation:'group-begin',payload:job.payload})).status,'staged');for(const packet of job.grants)assert.equal((await request(0,{operation:'group-grant',id:job.payload.id,packet})).status,'staged');return request(0,{operation:'group-commit',sender:job.payload.sender,id:job.payload.id,digest:g.groupCustodyDigest(job.payload)});};
return {ids,records,job,request,deposit,rows:()=>rows,fail:v=>fail=v,wakes:()=>wakes,expire:()=>time+=c.CUSTODY_TTL,restart:()=>service=create()};}

test('shared group ciphertext opens only with each intended device grant',async()=>{const f=await fixture();assert(await g.verifyGroupCustodyJob(f.job,f.records,now));
for(let i=0;i<2;i++){const identity=f.ids[i+1],e=f.job.grants[i],grant=c.openCustody(e,identity.record.account,identity.signingSeed,identity.encryptionSeed);assert.deepEqual(g.openGroupCustody(f.job.payload,e,grant),{text:'one encrypted group message',metadata:JSON.stringify({slot:i})});assert.throws(()=>c.openCustody(e,f.ids[4].record.account,f.ids[4].signingSeed,f.ids[4].encryptionSeed),/Wrong/);}
});
test('tampered content, recipient list, grants and signatures are rejected',async()=>{const f=await fixture();for(const change of [j=>j.payload.ciphertext='00'+j.payload.ciphertext.slice(2),j=>j.payload.recipients[0].recipient=f.ids[4].record.account,j=>j.payload.recipients.reverse(),j=>j.grants[0].recipient=f.ids[4].record.account,j=>j.grants[1]=j.grants[0],j=>j.payload.signature='00'.repeat(64)]){const job=structuredClone(f.job);change(job);assert.equal(await g.verifyGroupCustodyJob(job,f.records,now),false);assert.equal((await f.request(0,{operation:'group-begin',payload:job.payload})).status,await g.verifyGroupCustodyPayload(job.payload,f.records,now)?'staged':'rejected');}});
test('atomic handoff, offline recipient, restart, independent receipts and final payload cleanup',async()=>{const f=await fixture(),{job,ids}=f;assert.equal((await f.deposit()).status,'held');await new Promise(r=>setImmediate(r));assert.equal(f.wakes(),2);
const first=await f.request(1,{operation:'group-poll',exclude:[]});assert.equal(first.packet.id,job.grants[0].id);assert.equal((await f.request(4,{operation:'group-poll',exclude:[]})).packet,null);
const receipt=c.signCustodyReceipt(first.packet,ids[1].signingSeed,ids[1].encryptionSeed);assert.equal((await f.request(1,{operation:'group-receipt',id:job.payload.id,packet:receipt})).status,'accepted');assert(f.rows()[0].payload,'offline recipient keeps the one shared payload');assert(f.rows()[0].recipients[0].grant,'retain the encrypted grant for bounded replica recovery until all recipients acknowledge');
f.restart();const second=await f.request(2,{operation:'group-poll',exclude:[]});assert.equal(second.payload.ciphertext,job.payload.ciphertext);const r2=c.signCustodyReceipt(second.packet,ids[2].signingSeed,ids[2].encryptionSeed);assert.equal((await f.request(2,{operation:'group-receipt',id:job.payload.id,packet:r2})).status,'accepted');assert.equal(f.rows()[0].payload,null);
for(const r of [receipt,r2]){const polled=await f.request(0,{operation:'group-poll',exclude:[]});assert.equal(polled.packet.id,r.id);assert.equal((await f.request(0,{operation:'group-consume',sender:job.payload.sender,id:job.payload.id,messageId:r.id,digest:r.digest})).status,'accepted');}
assert.equal((await f.request(0,{operation:'group-poll',exclude:[]})).packet,null);assert.equal(f.rows().length,0,'fully consumed jobs release storage and sender quota');
});
test('incomplete or failed commits never claim network storage',async()=>{const f=await fixture();await f.request(0,{operation:'group-begin',payload:f.job.payload});assert.equal((await f.request(0,{operation:'group-commit',sender:f.job.payload.sender,id:f.job.payload.id,digest:g.groupCustodyDigest(f.job.payload)})).status,'incomplete');assert.equal((await f.request(1,{operation:'group-poll',exclude:[]})).packet,null);for(const packet of f.job.grants)await f.request(0,{operation:'group-grant',id:f.job.payload.id,packet});f.fail(true);assert.equal((await f.request(0,{operation:'group-commit',sender:f.job.payload.sender,id:f.job.payload.id,digest:g.groupCustodyDigest(f.job.payload)})).status,'rejected');assert.equal(f.rows()[0].accepted,false);assert.equal(f.wakes(),0);});
test('signed job can be copied by another neuron without giving it plaintext or receipt authority',async()=>{const f=await fixture();assert.equal((await f.request(4,{operation:'group-begin',payload:f.job.payload})).status,'staged');for(const packet of f.job.grants)await f.request(4,{operation:'group-grant',id:f.job.payload.id,packet});assert.equal((await f.request(4,{operation:'group-commit',sender:f.job.payload.sender,id:f.job.payload.id,digest:g.groupCustodyDigest(f.job.payload)})).status,'held');const forged=c.signCustodyReceipt(f.job.grants[0],f.ids[1].signingSeed,f.ids[1].encryptionSeed);assert.equal((await f.request(4,{operation:'group-receipt',id:f.job.payload.id,packet:forged})).status,'rejected');});
test('expired job cannot remain queued or be replayed',async()=>{const f=await fixture();await f.deposit();f.expire();assert.equal((await f.request(1,{operation:'group-poll',exclude:[]})).packet,null);assert.equal(f.rows().length,0);assert.equal((await f.request(0,{operation:'group-begin',payload:f.job.payload})).status,'rejected');});

test('bounded group polling reaches a fourth relay and receives its offline delivery',async()=>{
 const f=await fixture(),module=load('groupCustodyCourier'),recipient=f.ids[1];let time=now,received=0,acked=false;
 const relays=[0,2,3,4].map(i=>f.ids[i].record.account),polled=[];
 const courier=module.createGroupCustodyCourier({owner:()=>recipient.record.account,now:()=>time,records:f.records,allowed:()=>true,compatible:async()=>true,relays:()=>[...relays,relays[0]],own:{},store:{},seal:async()=>{throw Error('Not sending');},held:async()=>{},confirm:async()=>false,
 request:async(peer,raw)=>{const q=JSON.parse(raw);if(q.operation==='group-receipt'){acked=true;return JSON.stringify({status:'accepted'});}polled.push(peer);return JSON.stringify(peer===relays[3]&&!acked?{status:'ok',job:f.job.payload.id,packet:f.job.grants[0],payload:f.job.payload}:{status:'ok',packet:null});},
 receive:async(packet,payload)=>{assert.equal(g.openGroupCustody(payload,packet,c.openCustody(packet,recipient.record.account,recipient.signingSeed,recipient.encryptionSeed)).text,'one encrypted group message');received++;return c.signCustodyReceipt(packet,recipient.signingSeed,recipient.encryptionSeed);}});
 await courier.tick();assert.equal(received,0);assert.equal(polled.length,3);
 time+=5000;await courier.tick();assert.equal(received,1);assert(acked);assert.equal(new Set(polled).size,4);
});

async function courierFixture(){
 const f=await fixture(),courierModule=load('groupCustodyCourier'),packing=load('groupCustodyMessages');let outbox=[],seals=0,relays=[f.ids[3].record.account],held=[],confirmed=[],requests=[];const own=new Map();
 const messages=f.ids.slice(1,3).map((r,i)=>({peer:r.record.account,id:String(i+1).repeat(64),raw:JSON.stringify(['axonic-root-group-text-v1',r.record.account,String(i+1).repeat(64),{text:'shared text',group:{id:'group-id',messageId:'logical-id'}},now])}));
 const courier=courierModule.createGroupCustodyCourier({owner:()=>f.ids[0].record.account,now:()=>now,records:f.records,allowed:()=>true,compatible:async()=>true,
 own:{get:async(o,id)=>own.get(id)??null,save:async(o,e)=>{const row={owner:o,id:e.id,envelope:e,relay:null};own.set(e.id,row);return row;}},
 store:{read:async()=>structuredClone(outbox),write:async(o,rows)=>{outbox=structuredClone(rows);}},relays:()=>relays,
 request:async(peer,raw)=>{const q=JSON.parse(raw);requests.push(q);return JSON.stringify(await f.request(0,q));},
 seal:async(id,text,recipients)=>{seals++;return g.sealGroupCustody({...f.ids[0],id,text,recipients,now,random});},receive:async()=>null,held:async e=>held.push(e.id),confirm:async r=>{confirmed.push(r.id);return true;}});
 return {...f,courier,messages,own,packing,outbox:()=>outbox,held,confirmed,requests,seals:()=>seals,setRelays:r=>relays=r};
}
test('normal group courier uploads common content once and reuses the signed job on retry',async()=>{
 const f=await courierFixture();assert.equal(await f.courier.deposit(f.messages,f.messages[0]),true);assert.equal(f.seals(),1);assert.equal(f.requests.filter(q=>q.operation==='group-begin').length,1);assert.equal(f.requests.filter(q=>q.operation==='group-grant').length,2);assert.deepEqual(f.held,f.messages.map(m=>m.id));
 const row=f.rows()[0],packet=await f.request(1,{operation:'group-poll',exclude:[]}),identity=f.ids[1];const opened=g.openGroupCustody(packet.payload,packet.packet,c.openCustody(packet.packet,identity.record.account,identity.signingSeed,identity.encryptionSeed));assert.equal(f.packing.joinGroupCustodyMessage(opened.text,opened.metadata,identity.record.account,packet.packet.id),f.messages[0].raw);
 assert.equal(await f.courier.deposit([f.messages[1]],f.messages[1]),true);assert.equal(f.seals(),1);assert.equal(f.requests.filter(q=>q.operation==='group-begin').length,1,'accepted retry checks status without resending the payload');assert.equal(f.requests.filter(q=>q.operation==='group-grant').length,2,'accepted retry does not upload any grants again');assert.equal(f.rows()[0].digest,row.digest);
});
test('single-recipient groups and existing legacy ciphertext retain the ordinary delivery path',async()=>{
 const f=await courierFixture();assert.equal(await f.courier.deposit([f.messages[0]],f.messages[0]),undefined);assert.equal(f.seals(),0);
 f.own.set(f.messages[0].id,{envelope:f.job.grants[0]});assert.equal(await f.courier.deposit(f.messages,f.messages[1]),undefined);assert.equal(f.seals(),0);
});
test('unrelated pending message to a custodian does not exclude it from group handoff',async()=>{
 const f=await courierFixture();const unrelated={peer:f.ids[3].record.account,id:'ff'.repeat(32),raw:'[]'};assert.equal(await f.courier.deposit([...f.messages,unrelated],f.messages[0]),true);
});
test('group sender collects independent receipts only after durable recipient acceptance',async()=>{
 const f=await courierFixture();await f.courier.deposit(f.messages,f.messages[0]);assert.equal(f.confirmed.length,0);
 for(let i=1;i<=2;i++){const response=await f.request(i,{operation:'group-poll',exclude:[]}),identity=f.ids[i];const receipt=c.signCustodyReceipt(response.packet,identity.signingSeed,identity.encryptionSeed);await f.request(i,{operation:'group-receipt',id:response.job,packet:receipt});}
 await f.courier.tick();assert.deepEqual(f.confirmed,f.messages.map(m=>m.id));assert.equal(f.outbox().length,0);assert.equal(f.rows().length,0);
});

test('bounded replica serves recipients after primary loss without needing the sender online',async()=>{
 const f=await fixture();await f.deposit();let replicaRows=[],admitted=null;
 const replicaRecords={read:async account=>account===f.ids[0].record.account?admitted:f.records.read(account),compareAndSet:async(account,old,record)=>{if(admitted||old!==null||account!==record.account||!p.verifyRecord(record,now))return false;admitted=record;return true;}};
 const replica=s.createGroupCustodyService({owner:f.ids[4].record.account,records:replicaRecords,now:()=>now,current:()=>true,store:{async transaction(fn){const next=structuredClone(replicaRows),value=fn(next);s.validateGroupCustodyRows(next);replicaRows=next;return value;}}});
 // Reopen the primary against its persisted rows, then replicate through the same wire operations.
 const primary=s.createGroupCustodyService({owner:f.ids[3].record.account,records:f.records,now:()=>now,current:()=>true,store:{async transaction(fn){return fn(f.rows());}}});
 let uploads=0;await primary.replicate([f.ids[4].record.account],async(peer,raw)=>{if(JSON.parse(raw).operation==='group-begin')uploads++;return replica.receive(f.ids[3].record.account,raw);});
 assert.equal(admitted?.account,f.ids[0].record.account,'replica learns the signed sender record without a prior direct connection');assert.equal(uploads,1);assert.equal(replicaRows.length,1);assert.equal(replicaRows[0].accepted,true);assert.equal(replicaRows[0].payload.ciphertext,f.job.payload.ciphertext);
 for(let i=1;i<=2;i++){const result=JSON.parse(await replica.receive(f.ids[i].record.account,JSON.stringify({operation:'group-poll',exclude:[]})));assert.equal(result.packet.recipient,f.ids[i].record.account);const receipt=c.signCustodyReceipt(result.packet,f.ids[i].signingSeed,f.ids[i].encryptionSeed);assert.equal(JSON.parse(await replica.receive(f.ids[i].record.account,JSON.stringify({operation:'group-receipt',id:result.job,packet:receipt}))).status,'accepted');}
 assert.equal(replicaRows[0].payload,null);assert(replicaRows[0].recipients.every(r=>r.grant===null));
 let chained=false;await replica.replicate([f.ids[3].record.account],async()=>{chained=true;return null;});assert.equal(chained,false,'replicas never create an unbounded replication chain');
});
test('maximum audience and payload fit the authenticated control response limit',async()=>{
 const f=await fixture(),recipients=[];for(let i=0;i<9;i++){const signingSeed=await random(32),encryptionSeed=await random(32),device=p.publicDevice(signingSeed,encryptionSeed),record=p.issueRecord(await random(32),[device],now);recipients.push({record,device:device.id,id:crypto.randomBytes(32).toString('hex'),metadata:'m'.repeat(1400)});}
 const job=await g.sealGroupCustody({...f.ids[0],id:'cd'.repeat(32),text:'t'.repeat(2048),recipients,now,random});
 assert(JSON.stringify(job).length<=g.GROUP_CUSTODY_BYTES);assert(JSON.stringify({status:'ok',job:job.payload.id,payload:job.payload,packet:job.grants[0]}).length<=16000);
 assert(JSON.stringify({version:1,kind:'response',id:1,body:JSON.stringify({status:'ok',job:job.payload.id,payload:job.payload,packet:job.grants[0]})}).length<20000);
});

test('group edits and reactions reuse the common body without issuing new-message wake hints',async()=>{
 const f=await fixture(),packing=load('groupCustodyMessages');
 const raw=JSON.stringify(['axonic-root-group-action-v1',f.ids[1].record.account,'11'.repeat(32),{group:{id:'aa'.repeat(32),messageId:'bb'.repeat(32),revision:1},target:{id:'cc'.repeat(32),author:f.ids[0].record.account},kind:'edit',revision:1,text:'Edited once'}]);
 const parts=packing.splitGroupCustodyMessage(raw);assert(parts);assert.equal(packing.joinGroupCustodyMessage(parts.text,parts.metadata,f.ids[1].record.account,'11'.repeat(32)),raw);
 const job=await g.sealGroupCustody({...f.ids[0],id:'dd'.repeat(32),text:parts.text,recipients:f.ids.slice(1,3).map((r,i)=>({record:r.record,device:r.device.id,id:String(i+1).repeat(64),metadata:parts.metadata})),now,random});
 assert(job.grants.every(e=>e.wakeMode==='silent'&&!!e.wakeSignature));assert(await g.verifyGroupCustodyJob(job,f.records,now));
});

test('replication cannot pin a supplied identity unless it verifies the exact group payload',async()=>{
 const f=await fixture();let writes=0;const records={read:async()=>null,compareAndSet:async()=>{writes++;return true;}};
 const service=s.createGroupCustodyService({owner:f.ids[4].record.account,records,now:()=>now,current:()=>true,store:{async transaction(){throw Error('Must reject before storage');}}});
 const payload=structuredClone(f.job.payload);payload.signature='00'.repeat(64);
 assert.equal(JSON.parse(await service.receive(f.ids[3].record.account,JSON.stringify({operation:'group-begin',payload,record:f.ids[0].record}))).status,'rejected');assert.equal(writes,0);
});
