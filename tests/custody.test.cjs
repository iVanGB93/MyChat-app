const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
function fixture(t){const databases=new Map(),cache=new Map(),opens=[];const random=n=>new Uint8Array(crypto.randomBytes(n));let now=1800000000000;
 const sqlite={openDatabaseAsync:async (name,options)=>{opens.push({name,options});let db=databases.get(name);if(!db){db=new DatabaseSync(':memory:');databases.set(name,db);}const tx={getAllAsync:async(s,...p)=>db.prepare(s).all(...p),getFirstAsync:async(s,...p)=>db.prepare(s).get(...p)??null,runAsync:async(s,...p)=>db.prepare(s).run(...p)};return {...tx,execAsync:async s=>db.exec(s),withExclusiveTransactionAsync:async f=>{db.exec('BEGIN IMMEDIATE');try{await f(tx);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};}};
 function load(n){if(cache.has(n))return cache.get(n);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${n}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(x=>x==='expo-sqlite'?sqlite:x.startsWith('./')?load(x.slice(2).replace(/\.ts$/,'')):require(x),out);cache.set(n,out);return out;}
 const p=load('identityProtocol'),protocol=load('custodyProtocol'),{createCustodyService}=load('custodyService'),{createMobileCustodyStore}=load('mobileCustodyStore');
 const ids=Array.from({length:4},()=>{const signingSeed=random(32),encryptionSeed=random(32),device=p.publicDevice(signingSeed,encryptionSeed);return {signingSeed,encryptionSeed,device,record:p.issueRecord(random(32),[device],now)};});
 const records={read:async account=>ids.find(x=>x.record.account===account)?.record??null};
 const store=createMobileCustodyStore(ids[1].record.account);let active=true;
 const service=()=>createCustodyService({owner:ids[1].record.account,store,records,now:()=>now,current:()=>active});
 const seal=(text='offline synthetic message',id=Buffer.from(random(32)).toString('hex'))=>protocol.sealCustody({...ids[0],recipient:ids[2].record,recipientDevice:ids[2].device.id,text,id,now,random});
 const request=async(s,i,operation,packet)=>JSON.parse(await s.receive(ids[i].record.account,JSON.stringify({operation,...(operation==='consume'?packet:{packet})})));
 t.after(()=>databases.forEach(d=>d.close()));return {ids,records,store,service,seal,request,protocol,load,random,now:()=>now,advance:ms=>now+=ms,expire:()=>now+=protocol.CUSTODY_TTL,stop:()=>active=false,databases,opens};
}
test('offline ciphertext survives custody reopen; recipient receipt deletes payload, sender consumption leaves only bounded tombstone',async t=>{
 const f=fixture(t),e=await f.seal();let relay=f.service();assert.equal((await f.request(relay,0,'deposit',e)).status,'held');
 assert.equal(JSON.stringify(await f.store.transaction(r=>r)).includes('offline synthetic message'),false);
 relay=f.service();const polled=await f.request(relay,2,'poll');assert.deepEqual(polled.packet,e);
 assert.equal(f.protocol.openCustody(e,f.ids[2].record.account,f.ids[2].signingSeed,f.ids[2].encryptionSeed),'offline synthetic message');
 assert.throws(()=>f.protocol.openCustody(e,f.ids[1].record.account,f.ids[1].signingSeed,f.ids[1].encryptionSeed));
 const receipt=f.protocol.signCustodyReceipt(e,f.ids[2].signingSeed,f.ids[2].encryptionSeed);
 assert.equal((await f.request(relay,2,'receipt',receipt)).status,'accepted');const saved=await f.store.transaction(r=>structuredClone(r));
 assert.equal(saved[0].packet.kind,'receipt');assert(!JSON.stringify(saved).includes(e.ciphertext));
 assert.equal((await f.request(relay,0,'poll')).packet.digest,f.protocol.custodyDigest(e));
 assert.equal((await f.request(relay,0,'consume',{id:e.id,digest:receipt.digest})).status,'accepted');
 assert.equal((await f.store.transaction(r=>r[0].packet)),null);
 assert.equal((await f.request(relay,0,'deposit',e)).status,'completed');f.expire();await relay.sweep();assert.equal((await f.store.transaction(r=>r.length)),0);
});
test('forged sender/receipt, wrong recipient and relay-to-relay deposit cannot mutate custody',async t=>{
 const f=fixture(t),s=f.service(),e=await f.seal();assert.equal((await f.request(s,3,'deposit',e)).status,'rejected');
 assert.equal((await f.request(s,0,'deposit',{...e,ciphertext:'00'+e.ciphertext.slice(2)})).status,'rejected');
 assert.equal((await f.request(s,0,'deposit',e)).status,'held');assert.equal((await f.request(s,3,'poll')).packet,null);
 const receipt=f.protocol.signCustodyReceipt(e,f.ids[2].signingSeed,f.ids[2].encryptionSeed);
 assert.equal((await f.request(s,3,'receipt',receipt)).status,'rejected');
 assert.equal((await f.request(s,2,'receipt',{...receipt,digest:'00'.repeat(32)})).status,'rejected');
 assert.equal((await f.request(s,0,'consume',{id:e.id,digest:receipt.digest})).status,'rejected');
 assert.equal((await f.store.transaction(r=>r[0].packet.kind)),'envelope');
});
test('immutable deposits, sender quotas, expiry and shutdown remain bounded',async t=>{
 const f=fixture(t),s=f.service(),e=await f.seal();assert.equal((await f.request(s,0,'deposit',e)).status,'held');
 assert.equal((await f.request(s,0,'deposit',e)).status,'held');assert.equal((await f.request(s,0,'deposit',await f.seal('conflict',e.id))).status,'rejected');
 for(let i=1;i<16;i++)assert.equal((await f.request(s,0,'deposit',await f.seal())).status,'held');
 assert.equal((await f.request(s,0,'deposit',await f.seal())).status,'full');
 f.stop();assert.equal((await f.request(s,0,'deposit',e)).status,'rejected');f.expire();await s.sweep();assert.equal(await f.store.transaction(r=>r.length),0);
});
test('custody exchanges use mutually authenticated Axons and preserve optional-feature compatibility',async t=>{
 const f=fixture(t),relay=f.service(),handlers=[],close=[],queued=[[],[]];let dead=false;
 const wire=i=>({send(raw){queueMicrotask(()=>handlers[1-i]?handlers[1-i](raw):queued[1-i].push(raw));},listen(h,c){handlers[i]=h;close[i]=c;queued[i].splice(0).forEach(h);return()=>{};},close(){if(dead)return;dead=true;close.forEach(c=>c?.());}});
 const store={...f.records,compareAndSet:async()=>true};const sessions=[0,1].map(i=>f.load('persistentAxon').createPersistentAxon({...f.ids[i],instance:f.random(32),random:async n=>f.random(n),store,now:f.now,current:()=>true,wire:wire(i),onClosed(){},onCustody:i===1?(raw,peer)=>relay.receive(peer.account,raw):undefined}));
 t.after(()=>sessions.forEach(s=>s.stop()));await Promise.all(sessions.map(s=>s.ready));
 const e=await f.seal();const result=JSON.parse(await sessions[0].custodyRequest(JSON.stringify({operation:'deposit',packet:e})));assert.equal(result.status,'held');
 assert.equal(await sessions[1].custodyRequest(JSON.stringify({operation:'poll'})),null,'client did not advertise custody');
});
test('revoked/expired signing identity, malformed packet and wrong signer lookup fail closed',async t=>{
 const f=fixture(t),e=await f.seal();assert.equal(await f.protocol.verifyCustody(e,{read:async()=>f.ids[3].record},f.now()),false);
 assert.equal(f.protocol.parseCustody(JSON.stringify({...e,expires:f.now()+f.protocol.CUSTODY_TTL+1}),f.now()),null);
 assert.equal(f.protocol.parseCustody(JSON.stringify({...e,signature:'00'}),f.now()),null);
 const device=f.ids[0].record.devices[0];f.ids[0].record.devices=[];
 assert.equal((await f.request(f.service(),0,'deposit',e)).status,'rejected');f.ids[0].record.devices=[device];
 f.expire();assert.equal(await f.protocol.verifyCustody(e,f.records,f.now()),false);
});
test('new custody envelopes tolerate a slower peer without extending expiry or accepting expired packets',async t=>{
 const f=fixture(t);f.advance(60_000);const e=await f.seal();
 assert.equal(await f.protocol.verifyCustody(e,f.records,f.now()-30_000),true);
 assert.equal(f.protocol.parseCustody(JSON.stringify(e),f.now()-30_001),null);
 assert.equal(f.protocol.parseCustody(JSON.stringify(e),e.expires),null);
 assert.equal(e.expires-e.created,f.protocol.CUSTODY_TTL-30_000);
});

test('no held confirmation escapes a failing storage transaction',async t=>{
 const f=fixture(t),e=await f.seal(),s=f.load('custodyService').createCustodyService({owner:f.ids[1].record.account,records:f.records,now:f.now,current:()=>true,
 store:{transaction:async change=>{change([]);throw Error('disk full');}}});
 assert.equal((await f.request(s,0,'deposit',e)).status,'rejected');
});

test('automatic courier reuses durable envelope, survives recreation, and only recipient receipt delivers',async t=>{
 const f=fixture(t),[a,hub,b]=f.ids,relay=f.service(),messages=f.load('testMessageStore').createTestMessageStore(),own=f.load('ownCustodyStore').createOwnCustodyStore();
 const id='e1'.repeat(32);await messages.put({owner:a.record.account,peer:b.record.account,direction:'out',id,text:'courier synthetic',state:'pending',created:f.now(),attempts:0,next:0},()=>true);
 let sealed=0,consumeLost=true;
 const deps=i=>({owner:()=>f.ids[i].record.account,allowed:()=>true,now:f.now,records:f.records,own,messages,relays:()=>[hub.record.account],
 request:async(_relay,raw)=>{if(i===0&&JSON.parse(raw).operation==='consume'&&consumeLost)return null;return relay.receive(f.ids[i].record.account,raw);},
 seal:async(record,device,key,text)=>{sealed++;return f.protocol.sealCustody({...f.ids[i],recipient:record,recipientDevice:device,id:key,text,now:f.now(),random:async n=>f.random(n)});},
 receive:async e=>{const text=f.protocol.openCustody(e,b.record.account,b.signingSeed,b.encryptionSeed);if(!await messages.put({owner:b.record.account,peer:e.sender,direction:'in',id:e.id,text,state:'delivered',created:f.now(),attempts:0,next:0},()=>true))return null;return f.protocol.signCustodyReceipt(e,b.signingSeed,b.encryptionSeed);}});
 const create=f.load('custodyCourier').createCustodyCourier;let sender=create(deps(0)),receiver=create(deps(2));
 await sender.deposit(b.record.account,'courier synthetic',id);const original=(await own.get(a.record.account,id)).envelope;
 assert.equal((await messages.list(a.record.account))[0].state,'pending');sender.stop();sender=create(deps(0));
 await sender.deposit(b.record.account,'courier synthetic',id);assert.equal(sealed,1);assert.deepEqual((await own.get(a.record.account,id)).envelope,original);
 await receiver.tick();await sender.tick();assert.equal((await messages.list(a.record.account))[0].state,'delivered');assert.equal((await messages.list(b.record.account)).length,1);
 assert.equal(await f.store.transaction(r=>r[0].packet.kind),'receipt');consumeLost=false;f.advance(61000);await sender.tick();assert.equal(await f.store.transaction(r=>r[0].packet),null);
});
test('courier cannot mark held/completed response delivered, reseal expired envelopes, or persist after locking',async t=>{
 const f=fixture(t),[a,hub,b]=f.ids,own=f.load('ownCustodyStore').createOwnCustodyStore();let owner=a.record.account,release,seals=0,updates=0;
 const deps={owner:()=>owner,allowed:()=>true,now:f.now,records:f.records,own,relays:()=>[hub.record.account],messages:{update:async()=>updates++,list:async()=>[]},
 request:async()=>JSON.stringify({status:'completed'}),receive:async()=>null,seal:async(_record,_device,key,text)=>{seals++;return f.seal(text,key);}};
 const q=f.load('custodyCourier').createCustodyCourier(deps);await q.deposit(b.record.account,'probe','01'.repeat(32));assert.equal(updates,0);f.expire();await q.deposit(b.record.account,'probe','01'.repeat(32));assert.equal(seals,1,'expired envelopes must not be resealed');
 const slow=f.load('custodyCourier').createCustodyCourier({...deps,seal:()=>new Promise(r=>release=r)});const pending=slow.deposit(b.record.account,'probe','02'.repeat(32));
 while(!release)await new Promise(r=>setImmediate(r));owner=null;slow.invalidate();release(await f.seal());await pending;assert.equal(await own.get(a.record.account,'02'.repeat(32)),null);
});
test('a full preferred relay yields to another connected custodian without resealing',async t=>{
 const f=fixture(t),[a,hub,b,backup]=f.ids,own=f.load('ownCustodyStore').createOwnCustodyStore(),calls=[];let seals=0;
 const q=f.load('custodyCourier').createCustodyCourier({owner:()=>a.record.account,allowed:()=>true,now:f.now,records:f.records,own,
 messages:{list:async()=>[],update:async()=>{}},relays:()=>[hub.record.account,backup.record.account],receive:async()=>null,
 request:async relay=>{calls.push(relay);return JSON.stringify({status:relay===hub.record.account?'full':'held'});},
 seal:async(_record,_device,id,text)=>{seals++;return f.seal(text,id);}});
 await q.deposit(b.record.account,'relay capacity test','03'.repeat(32));await q.deposit(b.record.account,'relay capacity test','03'.repeat(32));
 assert.deepEqual(calls,[hub.record.account,backup.record.account]);assert.equal(seals,1);
 assert.equal((await own.get(a.record.account,'03'.repeat(32))).relay,backup.record.account);
});

for(const failure of ['timeout','throw','malformed']) test(`an unresponsive preferred custodian yields after ${failure}`,async t=>{
 const f=fixture(t),[a,hub,b,backup]=f.ids,own=f.load('ownCustodyStore').createOwnCustodyStore(),calls=[];let seals=0;
 const q=f.load('custodyCourier').createCustodyCourier({owner:()=>a.record.account,allowed:()=>true,now:f.now,records:f.records,own,
 messages:{list:async()=>[],update:async()=>{throw Error('No receipt: cannot deliver');}},relays:()=>[hub.record.account,backup.record.account],receive:async()=>null,
 request:async relay=>{calls.push(relay);if(relay===hub.record.account){if(failure==='throw')throw Error('Disconnected');return failure==='timeout'?null:'invalid JSON';}return JSON.stringify({status:'held'});},
 seal:async(_record,_device,id,text)=>{seals++;return f.seal(text,id);}});
 const id='04'.repeat(32);
 await q.deposit(b.record.account,'unresponsive relay',id);f.advance(60001);await q.deposit(b.record.account,'unresponsive relay',id);
 assert.deepEqual(calls,[hub.record.account,backup.record.account]);assert.equal(seals,1);
 assert.equal((await own.get(a.record.account,id)).relay,backup.record.account);
});

test('custodian loss reuses ciphertext and a returning duplicate is receipted without a second inbox row',async t=>{
 const f=fixture(t),[a,hub,b,backup]=f.ids;
 const stores=[f.store,f.load('mobileCustodyStore').createMobileCustodyStore(backup.record.account)];
 const services=[f.service(),f.load('custodyService').createCustodyService({owner:backup.record.account,records:f.records,store:stores[1],now:f.now,current:()=>true})];
 const peers=[hub.record.account,backup.record.account];let available=[peers[0]],seals=0;
 const messages=f.load('testMessageStore').createTestMessageStore(),own=f.load('ownCustodyStore').createOwnCustodyStore(),id='05'.repeat(32),text='ordinary custodian failover';
 await messages.put({owner:a.record.account,peer:b.record.account,direction:'out',id,text,state:'pending',created:f.now(),attempts:0,next:0},()=>true);
 const deps=i=>({owner:()=>f.ids[i].record.account,allowed:()=>true,now:f.now,records:f.records,own,messages,relays:()=>available,
 request:(peer,raw)=>services[peers.indexOf(peer)].receive(f.ids[i].record.account,raw),
 seal:async(_r,_d,key,body)=>{seals++;return f.seal(body,key);},
 receive:async e=>{const body=f.protocol.openCustody(e,b.record.account,b.signingSeed,b.encryptionSeed);
 if(!await messages.put({owner:b.record.account,peer:e.sender,direction:'in',id:e.id,text:body,state:'delivered',created:f.now(),attempts:0,next:0},()=>true))return null;
 return f.protocol.signCustodyReceipt(e,b.signingSeed,b.encryptionSeed);}});
 const make=f.load('custodyCourier').createCustodyCourier,sender=make(deps(0)),receiver=make(deps(2));
 await sender.deposit(b.record.account,text,id);const original=(await own.get(a.record.account,id)).envelope;
 available=[peers[1]];await sender.deposit(b.record.account,text,id);
 assert.equal(seals,1);assert.deepEqual(await stores[1].transaction(r=>r[0].packet),original);
 await receiver.tick();assert.equal((await messages.list(b.record.account)).length,1);
 available=[peers[0]];f.advance(5001);await receiver.tick();
 assert.equal((await messages.list(b.record.account)).length,1);
 for(const store of stores)assert.equal(await store.transaction(r=>r[0].packet.kind),'receipt');
 available=peers;await sender.tick();f.advance(5001);await sender.tick();
 assert.equal((await messages.list(a.record.account))[0].state,'delivered');
 for(const store of stores)assert.equal(await store.transaction(r=>r[0].packet),null);
});

test('store factories retain one uncached native connection per database and isolate custody owners',async t=>{
 const f=fixture(t),owner=f.ids[1].record.account,other=f.ids[3].record.account;
 const create=f.load('mobileCustodyStore').createMobileCustodyStore;
 const packet=await f.seal();assert.equal((await f.request(f.service(),0,'deposit',packet)).status,'held');
 assert.equal(await create(owner).transaction(r=>r.length),1);
 assert.equal(await create(other).transaction(r=>r.length),0);
 for(const [module,factory,read] of [
  ['ownCustodyStore','createOwnCustodyStore',s=>s.get(owner,packet.id)],
  ['testMessageStore','createTestMessageStore',s=>s.list(owner)],
  ['identityRecordStore','createMobileIdentityRecordStore',s=>s.read(owner)]
 ]){const make=f.load(module)[factory];await Promise.all([read(make(f.now)),read(make(f.now))]);}
 assert.equal(f.opens.length,4);assert.equal(new Set(f.opens.map(o=>o.name)).size,4);
 for(const opened of f.opens)assert.deepEqual(opened.options,{useNewConnection:true});
});

function normalOutboxFixture(f) {
 const [sender,hub,recipient]=f.ids,owner=sender.record.account;
 let current=true,allowDelivery=true,direct=async()=>false,delivered=0;
 let message={id:'11111111-1111-4111-8111-111111111111',roomId:'22222222-2222-4222-8222-222222222222',content:'Normal encrypted outbox',createdAt:new Date(f.now()).toISOString()};
 const original={...message},own=f.load('ownCustodyStore').createOwnCustodyStore(),bindings=f.load('normalChatOutboxStore').createNormalChatOutboxStore();
 const boundary=f.load('normalChatBoundary').createNormalChatBoundary({owner:{user:14,account:owner},current:()=>current,now:f.now,
  peer:async room=>room===original.roomId?{user:18,account:recipient.record.account}:null,authorized:()=>current,
  readOutgoing:async()=>message,persist:async()=>false,delivered:async(_m,_p,guard)=>{if(!guard()||!allowDelivery)return false;delivered++;return true;}});
 const relay=f.service();let courier,outbox;
 const rebuild=()=>{
  courier?.stop();outbox?.stop();
  outbox=f.load('normalChatOutbox').createNormalChatOutbox({owner,current:()=>current,now:f.now,boundary,bindings,own,records:f.records,
   read:async()=>message,direct:(...args)=>direct(...args),deposit:async(...args)=>(await courier.deposit(...args))===true});
  courier=f.load('custodyCourier').createCustodyCourier({owner:()=>current?owner:null,allowed:()=>current,now:f.now,records:f.records,own,
   relays:()=>[hub.record.account],request:(_relay,raw)=>relay.receive(owner,raw),confirmReceipt:(r,guard)=>outbox.confirmReceipt(r,guard),receive:async()=>null,
   seal:async(record,device,id,text)=>f.protocol.sealCustody({...sender,recipient:record,recipientDevice:device,id,text,now:f.now(),random:async n=>f.random(n)})});
 };
 rebuild();
 return {original,owner,recipient,own,bindings,relay,boundary,rebuild,outbox:()=>outbox,courier:()=>courier,
  edit:()=>message={...message,content:'Changed after transmission'},allow:v=>allowDelivery=v,direct:fn=>direct=fn,
  delivered:()=>delivered,stop:()=>{current=false;outbox.stop();courier.stop();boundary.stop();}};
}

test('normal outbox survives recreation, reuses ciphertext and consumes receipt only after the original row confirms delivery',async t=>{
 const f=fixture(t),n=normalOutboxFixture(f);t.after(n.stop);
 assert.deepEqual(await n.outbox().attempt(n.original),{peerId:18,delivered:false});assert.equal(n.delivered(),0);
 const packet=await n.boundary.prepare(n.original),first=(await n.own.get(n.owner,packet.id)).envelope;
 const row=await n.bindings.find(n.owner,packet.id);assert.equal(row.messageId,n.original.id);assert(!JSON.stringify(row).includes(n.original.content));
 n.rebuild();assert.deepEqual(await n.outbox().attempt(n.original),{peerId:18,delivered:false});
 assert.deepEqual((await n.own.get(n.owner,packet.id)).envelope,first);
 const plaintext=f.protocol.openCustody(first,n.recipient.record.account,n.recipient.signingSeed,n.recipient.encryptionSeed);
 assert.equal(f.load('normalChatProtocol').decodeNormalChat(plaintext,f.now()).id,n.original.id);
 const receipt=f.protocol.signCustodyReceipt(first,n.recipient.signingSeed,n.recipient.encryptionSeed);
 assert.equal((await f.request(n.relay,2,'receipt',receipt)).status,'accepted');
 n.allow(false);await n.courier().tick();assert.equal(await f.store.transaction(r=>r[0].packet.kind),'receipt');assert.equal(n.delivered(),0);
 n.allow(true);f.advance(60001);await n.courier().tick();assert.equal(n.delivered(),1);assert.equal(await f.store.transaction(r=>r[0].packet),null);
});

test('normal receipt rejects tampering, stale content and stopped sessions without discarding relay evidence',async t=>{
 const f=fixture(t),n=normalOutboxFixture(f);t.after(n.stop);await n.outbox().attempt(n.original);
 const packet=await n.boundary.prepare(n.original),e=(await n.own.get(n.owner,packet.id)).envelope;
 const receipt=f.protocol.signCustodyReceipt(e,n.recipient.signingSeed,n.recipient.encryptionSeed);
 assert.equal(await n.outbox().confirmReceipt({...receipt,signature:'00'.repeat(64)}),false);
 n.edit();assert.equal(await n.outbox().confirmReceipt(receipt),false);assert.equal(n.delivered(),0);
 assert.equal(await n.outbox().attempt(n.original),null);n.stop();assert.equal(await n.outbox().confirmReceipt(receipt),false);
});

test('normal direct receipt confirms the original row and late direct completion after stop cannot deliver',async t=>{
 const f=fixture(t),n=normalOutboxFixture(f);t.after(n.stop);n.direct(async()=>true);
 assert.deepEqual(await n.outbox().attempt(n.original),{peerId:18,delivered:true});assert.equal(n.delivered(),1);
 let release;n.direct(()=>new Promise(r=>release=r));const pending=n.outbox().attempt(n.original);
 while(!release)await new Promise(r=>setImmediate(r));n.outbox().stop();release(true);
 assert.equal(await pending,null);assert.equal(n.delivered(),1);
});

test('normal outbox bindings reject changed payload digests and isolate cryptographic owners',async t=>{
 const f=fixture(t),n=normalOutboxFixture(f);t.after(n.stop);await n.outbox().attempt(n.original);
 const packet=await n.boundary.prepare(n.original),row=await n.bindings.find(n.owner,packet.id);
 assert.equal(await n.bindings.bind({...row,digest:'00'.repeat(32)},()=>true),false);
 assert.equal(await n.bindings.find(n.recipient.record.account,packet.id),null);
 assert.equal((await n.bindings.find(n.owner,packet.id)).digest,row.digest);
});

test('composed normal runtimes retry via an ordinary custodian and consume only verified delivery',async t=>{
 const f=fixture(t),[sender,relay,recipient]=f.ids,make=f.load('normalChatRuntime').createNormalChatRuntime;
 const own=f.load('ownCustodyStore').createOwnCustodyStore(),bindings=f.load('normalChatOutboxStore').createNormalChatOutboxStore();
 const hooks=new Map(),inbox=new Map();let delivered=false,pendingReads=0;
 const message={id:'11111111-1111-4111-8111-111111111111',roomId:'22222222-2222-4222-8222-222222222222',content:'Composed offline normal chat',createdAt:new Date(f.now()).toISOString()};
 const makeRuntime=(id,user,peer,peerUser)=>make({
  identity:{status:()=>({state:'unlocked',account:id.record.account}),
   sealCustody:(record,device,key,text)=>f.protocol.sealCustody({...id,recipient:record,recipientDevice:device,id:key,text,now:f.now(),random:f.random}),
   receiveCustody:async(e,records,persist)=>{
    if(!await f.protocol.verifyCustody(e,records,f.now()))return null;
    const text=f.protocol.openCustody(e,id.record.account,id.signingSeed,id.encryptionSeed);
    return await persist({from:e.sender,id:e.id,text})?f.protocol.signCustodyReceipt(e,id.signingSeed,id.encryptionSeed):null;
   }},
  records:f.records,own,bindings,custodyStore:f.load('mobileCustodyStore').createMobileCustodyStore(id.record.account),
  allowed:account=>account===peer.record.account,
  boundary:{owner:{user,account:id.record.account},current:()=>true,now:f.now,
   peer:async room=>room===message.roomId?{user:peerUser,account:peer.record.account}:null,authorized:()=>true,
   readOutgoing:async()=>user===14?message:null,
   persist:async(m,guard)=>{if(!guard())return false;inbox.set(m.id,m);return true;},
   delivered:async(_m,_p,guard)=>{if(!guard())return false;delivered=true;return true;}},
  pending:async()=>{if(user===14){pendingReads++;return delivered?[]:[message];}return [];},
  network:h=>{hooks.set(id.record.account,h);return {sendChatMessage:async()=>false,custodians:()=>[relay.record.account],
   custodyRequest:(_target,raw)=>relayService.receive(id.record.account,raw),tick(){},stop(){hooks.delete(id.record.account);}};}
 });
 const relayService=f.service(),a=makeRuntime(sender,14,recipient,18),b=makeRuntime(recipient,18,sender,14);
 t.after(()=>{a.stop();b.stop();});
 const settle=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setImmediate(r));}assert.fail('Runtime did not settle');};
 a.tick();await settle(async()=>!!(await f.store.transaction(rows=>rows[0]?.packet)));
 assert.equal(delivered,false);assert.equal(pendingReads,1);
 b.tick();await settle(async()=>await f.store.transaction(rows=>rows[0]?.packet?.kind==='receipt'));
 assert.equal(inbox.size,1);assert.equal(inbox.get(message.id).content,message.content);
 f.advance(5001);a.tick();await settle(async()=>delivered&&await f.store.transaction(rows=>rows[0]?.packet===null));
 assert.equal(pendingReads,1,'retry interval is independent of receipt polling');
 a.stop();assert.equal(await a.attempt(message),null);assert.equal(hooks.has(sender.record.account),false);
});

test('runtime shutdown cancels an asynchronous pending-row scan before any network send',async t=>{
 const f=fixture(t),id=f.ids[0];let release,sends=0,closed=0;
 const runtime=f.load('normalChatRuntime').createNormalChatRuntime({identity:{status:()=>({state:'unlocked',account:id.record.account})},
  records:f.records,own:f.load('ownCustodyStore').createOwnCustodyStore(),bindings:f.load('normalChatOutboxStore').createNormalChatOutboxStore(),
  custodyStore:{transaction:async fn=>fn([])},allowed:()=>true,
  boundary:{owner:{user:14,account:id.record.account},current:()=>true,now:f.now,peer:async()=>null,authorized:()=>true,
   readOutgoing:async()=>null,persist:async()=>false,delivered:async()=>false},
  pending:()=>new Promise(r=>release=r),network:()=>({sendChatMessage:async()=>{sends++;return true;},custodians:()=>[],custodyRequest:async()=>null,tick(){},stop(){closed++;}})});
 runtime.tick();runtime.tick();while(!release)await new Promise(r=>setImmediate(r));runtime.stop();release([{id:'cancelled'}]);await new Promise(r=>setImmediate(r));
 runtime.stop();assert.equal(sends,0);assert.equal(closed,1);
});

test('normal background retry waits for the custody poll slot and cancels cleanly during polling',async t=>{
 for(const stopDuringPoll of [false,true]){
  const f=fixture(t),id=f.ids[0];let release,polls=0,scans=0;
  const runtime=f.load('normalChatRuntime').createNormalChatRuntime({identity:{status:()=>({state:'unlocked',account:id.record.account})},
   records:f.records,own:f.load('ownCustodyStore').createOwnCustodyStore(),bindings:f.load('normalChatOutboxStore').createNormalChatOutboxStore(),
   custodyStore:{transaction:async fn=>fn([])},allowed:()=>true,
   boundary:{owner:{user:14,account:id.record.account},current:()=>true,now:f.now,peer:async()=>null,authorized:()=>true,
    readOutgoing:async()=>null,persist:async()=>false,delivered:async()=>false},
   pending:async()=>{scans++;return [];},network:()=>({sendChatMessage:async()=>false,custodians:()=>[f.ids[1].record.account],
    custodyRequest:()=>{polls++;return new Promise(r=>release=r);},tick(){},stop(){}})});
  t.after(()=>runtime.stop());runtime.tick();runtime.tick();await new Promise(r=>setImmediate(r));
  assert.equal(polls,1);assert.equal(scans,0,'retry must wait until poll releases the request slot');
  if(stopDuringPoll)runtime.stop();release(JSON.stringify({status:'ok',packet:null}));await new Promise(r=>setImmediate(r));
  assert.equal(scans,stopDuringPoll?0:1);runtime.stop();
 }
});
