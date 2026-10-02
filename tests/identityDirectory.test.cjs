const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
function loader(mocks={}){const cache=new Map();function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/'+name+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>mocks[p]??(p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p)),out);cache.set(name,out);return out;}return load;}
const load=loader(),p=load('identityProtocol'),dir=load('identityDirectory'),{createIdentityDirectoryReplication}=load('identityDirectoryReplication');
const time=1800000000000,random=()=>new Uint8Array(crypto.randomBytes(32));
function identity(){const root=random(),device=p.publicDevice(random(),random());return {root,device,record:p.issueRecord(root,[device],time),history:[]};}
const packet=a=>({record:a.record,history:a.history});
const put=a=>JSON.stringify({domain:dir.DIRECTORY_DOMAIN,operation:'put',packet:packet(a)});
const lookup=a=>JSON.stringify({domain:dir.DIRECTORY_DOMAIN,operation:'get',account:a.record.account});
function store(){let rows=[],tail=Promise.resolve();return {get rows(){return structuredClone(rows);},transaction(change){const result=tail.then(()=>{const copy=structuredClone(rows);const value=change(copy);rows=copy;return value;});tail=result.catch(()=>{});return result;}};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const status=async(promise)=>JSON.parse(await promise).status;

test('only the signed owner can publish; public lookup and identical republication survive service restart',async()=>{
 const a=identity(),b=identity(),s=store(),service=()=>dir.createIdentityDirectory({store:s,now:()=>time,current:()=>true});
 assert.equal(await status(service().receive(b.record.account,put(a))),'rejected');assert.equal(s.rows.length,0);
 assert.equal(await status(service().receive(a.record.account,put(a))),'stored');
 const found=JSON.parse(await service().receive(b.record.account,lookup(a)));assert.equal(found.status,'found');assert.equal(p.recordDigest(found.packet.record),p.recordDigest(a.record));
 assert.equal(await status(service().receive(a.record.account,put(a))),'stored');assert.equal(s.rows.length,1);
 const tampered=JSON.parse(put(a));tampered.packet.record.devices[0].signing='00'.repeat(32);
 assert.equal(await status(service().receive(a.record.account,JSON.stringify(tampered))),'rejected');
});

test('stale records and competing branches cannot replace the stored revision, even after lease expiry',async()=>{
 const a=identity(),old=packet(a),s=store();let now=time;
 const service=dir.createIdentityDirectory({store:s,now:()=>now,current:()=>true});await service.receive(a.record.account,put(a));
 a.record=p.issueRecord(a.root,[a.device],time+1,a.record);a.history=[old.record];now++;
 assert.equal(await status(service.receive(a.record.account,put(a))),'stored');
 const branch={record:p.issueRecord(a.root,[p.publicDevice(random(),random())],time+1,old.record),history:[old.record]};
 assert.equal(await status(service.receive(a.record.account,put(branch))),'conflict');
 now+=dir.DIRECTORY_LEASE+1;assert.equal(await status(service.receive(a.record.account,lookup(a))),'not-found');
 assert.equal(await status(service.receive(a.record.account,put(old))),'stale');assert.equal(s.rows[0].record.revision,1);
 assert.equal(await status(service.receive(a.record.account,put(a))),'stored');
});

test('skipped revisions need authenticated ancestry; duplicate publication cannot strip retained history',async()=>{
 const a=identity(),genesis=a.record,s=store();const service=dir.createIdentityDirectory({store:s,now:()=>time+5,current:()=>true});
 await service.receive(a.record.account,put(a));const next=p.issueRecord(a.root,[a.device],time+1,genesis);
 a.record=p.issueRecord(a.root,[a.device],time+2,next);
 assert.equal(await status(service.receive(a.record.account,put(a))),'missing-history');
 a.history=[genesis,next];assert.equal(await status(service.receive(a.record.account,put(a))),'stored');
 a.history=[];assert.equal(await status(service.receive(a.record.account,put(a))),'stored');assert.equal(s.rows[0].history.length,2);
});

test('storage confirmations wait for commit; failure or lock during commit never confirms a copy',async()=>{
 const a=identity(),gate=deferred();let current=true,entered=false,done=false;
 const service=dir.createIdentityDirectory({now:()=>time,current:()=>current,store:{transaction:async change=>{const result=change([]);entered=true;await gate.promise;return result;}}});
 const pending=service.receive(a.record.account,put(a)).then(r=>{done=true;return r;});while(!entered)await new Promise(r=>setImmediate(r));assert.equal(done,false);
 current=false;gate.resolve();assert.equal(await status(pending),'rejected');
 const failing=dir.createIdentityDirectory({now:()=>time,current:()=>true,store:{transaction:async change=>{change([]);throw Error('Disk failure');}}});
 assert.equal(await status(failing.receive(a.record.account,put(a))),'rejected');
});

test('oversized requests and bounded concurrency cannot cause unbounded queued work',async()=>{
 const a=identity(),gate=deferred();let calls=0;
 const service=dir.createIdentityDirectory({now:()=>time,current:()=>true,store:{transaction:async change=>{calls++;await gate.promise;return change([]);}}});
 assert.equal(await status(service.receive(a.record.account,'x'.repeat(13001))),'rejected');assert.equal(calls,0);
 const pending=Array.from({length:8},()=>service.receive(a.record.account,lookup(a)));
 assert.equal(await status(service.receive(a.record.account,lookup(a))),'rejected');assert.equal(calls,8);gate.resolve();await Promise.all(pending);
});

test('full directories retain prior revision anchors and still allow existing owners to renew',async()=>{
 const a=identity(),rows=Array.from({length:dir.DIRECTORY_LIMIT},()=>{const r=identity();return {...packet(r),availableUntil:time+100};});
 const retained=rows[0],service=dir.createIdentityDirectory({now:()=>time,current:()=>true,store:{transaction:async f=>f(rows)}});
 assert.equal(await status(service.receive(a.record.account,put(a))),'full');assert.equal(rows.length,dir.DIRECTORY_LIMIT);
 assert.equal(await status(service.receive(retained.record.account,put(retained))),'stored');
});

function cluster(){const own=identity(),hosts=Array.from({length:5},()=>identity().record.account),stores=new Map(),services=new Map();let now=time,peers=[...hosts],active=packet(own);
 for(const host of hosts){const s=store();stores.set(host,s);services.set(host,dir.createIdentityDirectory({store:s,now:()=>now,current:()=>true}));}
 const requests=[];const worker=createIdentityDirectoryReplication({own:()=>active,peers:()=>peers,now:()=>now,request:(peer,raw)=>{requests.push(peer);return services.get(peer).receive(own.record.account,raw);}});
 return {own,hosts,stores,services,worker,requests,setPeers:p=>peers=p,setOwn:p=>active=p,advance:n=>now+=n};}

test('three distinct replicas persist the owner record and an ordinary replacement takes over after disconnection',async()=>{
 const c=cluster();c.setPeers([c.hosts[0],c.hosts[0],...c.hosts]);await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,3);assert.equal(c.requests.length,3);
 c.setPeers(c.hosts.slice(1));assert.equal(c.worker.snapshot().confirmed,2);await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,3);assert.equal(c.stores.get(c.hosts[3]).rows.length,1);
 c.advance(dir.DIRECTORY_LEASE+1);assert.equal(c.worker.snapshot().confirmed,0);await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,3);
});

test('fewer replicas do not block publication; failed storage does not count and another peer is tried',async()=>{
 const c=cluster();c.setPeers(c.hosts.slice(0,2));await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,2);
 c.setPeers(c.hosts);c.services.set(c.hosts[2],{receive:async()=>{throw Error('Disk unavailable');}});await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,3);assert.equal(c.stores.get(c.hosts[3]).rows.length,1);
});

test('forged confirmations, wrong digests, and late replies after locking never count',async()=>{
 const a=identity(),host=identity().record.account,gate=deferred();let active=packet(a),calls=0;
 const worker=createIdentityDirectoryReplication({own:()=>active,peers:()=>[host],now:()=>time,request:()=>{calls++;return gate.promise;}});
 const tick=worker.tick();await worker.tick();assert.equal(calls,1);active=null;worker.invalidate();gate.resolve(JSON.stringify({domain:dir.DIRECTORY_DOMAIN,status:'stored',account:a.record.account,digest:p.recordDigest(a.record),until:time+100}));await tick;assert.equal(worker.snapshot().confirmed,0);
 for(const override of [{digest:'00'.repeat(32)},{domain:'wrong'},{account:host},{until:time+dir.DIRECTORY_LEASE+30_001},{until:time}]){
 const w=createIdentityDirectoryReplication({own:()=>packet(a),peers:()=>[host],now:()=>time,request:async()=>JSON.stringify({domain:dir.DIRECTORY_DOMAIN,status:'stored',account:a.record.account,digest:p.recordDigest(a.record),until:time+100,...override})});await w.tick();assert.equal(w.snapshot().confirmed,0);}
});

test('a new identity revision invalidates old confirmations and is replicated independently',async()=>{
 const c=cluster();await c.worker.tick();const old=c.own.record;c.own.record=p.issueRecord(c.own.root,[c.own.device],time+1,old);c.own.history=[old];c.advance(1);c.setOwn(packet(c.own));
 assert.equal(c.worker.snapshot().confirmed,0);await c.worker.tick();assert.equal(c.worker.snapshot().confirmed,3);assert.equal(c.stores.get(c.hosts[0]).rows[0].record.revision,1);
 c.worker.stop();assert.equal(c.worker.snapshot().confirmed,0);await c.worker.tick();assert.equal(c.requests.length,6);
});

test('SQLite adapter serializes instances and rolls back failures before acknowledging commit',async()=>{
 let data=null,fail=false,active=0,max=0;
 const database={execAsync:async()=>{},withExclusiveTransactionAsync:async fn=>{active++;max=Math.max(max,active);let next=data;try{await fn({getFirstAsync:async()=>next?{data:next}:null,runAsync:async(sql,value)=>{next=value;}});await new Promise(r=>setImmediate(r));if(fail)throw Error('Commit failed');data=next;}finally{active--;}}};
 const {createMobileIdentityDirectoryStore}=loader({'expo-sqlite':{openDatabaseAsync:async()=>database}})('mobileIdentityDirectoryStore');
 const stores=[createMobileIdentityDirectoryStore(()=>time),createMobileIdentityDirectoryStore(()=>time)];const a=identity(),b=identity();
 await Promise.all(stores.map((s,i)=>s.transaction(rows=>rows.push({...packet(i?b:a),availableUntil:time+100}))));assert.equal(max,1);assert.equal(JSON.parse(data).length,2);
 fail=true;await assert.rejects(stores[0].transaction(rows=>rows.splice(0,1)),/Commit failed/);assert.equal(JSON.parse(data).length,2);
});

test('unsigned extra fields cannot turn public identity storage into arbitrary payload storage',async()=>{
 const a=identity(),s=store(),service=dir.createIdentityDirectory({store:s,now:()=>time,current:()=>true});
 const request=JSON.parse(put(a));request.packet.record.untrustedExtra='not covered by the signature';
 assert.equal(await status(service.receive(a.record.account,JSON.stringify(request))),'rejected');assert.equal(s.rows.length,0);
});

test('replica clock skew is tolerated without counting the final uncertainty window',async()=>{
 const a=identity(),peer=identity().record.account;let now=time;
 const worker=createIdentityDirectoryReplication({own:()=>packet(a),peers:()=>[peer],now:()=>now,
 request:async()=>JSON.stringify({domain:dir.DIRECTORY_DOMAIN,status:'stored',account:a.record.account,digest:p.recordDigest(a.record),until:time+dir.DIRECTORY_LEASE+1000})});
 await worker.tick();assert.equal(worker.snapshot().confirmed,1);assert.equal(worker.snapshot().replicas[0].until,time+dir.DIRECTORY_LEASE-29000);
 now=time+dir.DIRECTORY_LEASE-29000;assert.equal(worker.snapshot().confirmed,0);
});
