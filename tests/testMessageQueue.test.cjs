const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const a='axonic:1:'+'aa'.repeat(32),b='axonic:1:'+'bb'.repeat(32),id='cc'.repeat(32);
function fixture(t) {
 const file=path.join(os.tmpdir(),`axonic-test-${require('crypto').randomUUID()}.db`);let database,fail=false;
 const open=()=>database=new DatabaseSync(file);open();
 t.after(()=>{database.close();for(const suffix of ['', '-wal','-shm']){const p=file+suffix;if(fs.existsSync(p))fs.unlinkSync(p);}});
 const tx={getFirstAsync:async(sql,...args)=>database.prepare(sql).get(...args)??null,
  getAllAsync:async(sql,...args)=>database.prepare(sql).all(...args),runAsync:async(sql,...args)=>database.prepare(sql).run(...args)};
 const sqlite={openDatabaseAsync:async()=>({...tx,execAsync:async sql=>database.exec(sql),withExclusiveTransactionAsync:async fn=>{
  database.exec('BEGIN IMMEDIATE');try{await fn(tx);if(fail)throw Error('simulated commit failure');database.exec('COMMIT');}catch(e){database.exec('ROLLBACK');throw e;}
 }})};
 function load(name){const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?sqlite:n==='./identityProtocol'?{validAccountId:x=>/^axonic:1:[0-9a-f]{64}$/.test(x)}:require(n),out);return out;}
 const create=load('testMessageStore').createTestMessageStore,queue=load('testMessageQueue').createTestMessageQueue;
 return {create,queue,reopen(){database.close();open();},fail(v){fail=v;}};
}
const row=(owner=a,peer=b,direction='out',text='synthetic probe')=>({owner,peer,direction,id,text,state:direction==='in'?'delivered':'pending',created:100,attempts:0,next:0});
test('real file database survives reopening, deduplicates atomically and rejects conflicting content',async t=>{
 const f=fixture(t),s=f.create();assert.equal(await s.put(row(),()=>true),true);
 const input=row(b,a,'in');assert.deepEqual(await Promise.all([s.put(input,()=>true),f.create().put(input,()=>true)]),[true,true]);
 assert.equal(await s.put({...input,text:'conflict'},()=>true),false);f.reopen();
 assert.equal((await f.create().list(b)).length,1);assert.equal((await f.create().list(a))[0].state,'pending');
 await s.clear(a);assert.equal((await s.list(a)).length,0);assert.equal((await s.list(b)).length,1);
});
test('failed commits cannot acknowledge delivery; cancellation and invalid input leave no rows',async t=>{
 const f=fixture(t),s=f.create();f.fail(true);await assert.rejects(s.put(row(b,a,'in'),()=>true),/commit failure/);
 assert.deepEqual(await s.list(b),[]);f.fail(false);assert.equal(await s.put(row(),()=>false),false);
 assert.equal(await s.put({...row(),text:'é'.repeat(1025)},()=>true),false);
 assert.equal(await s.put(row(),()=>true),true);
});
test('receipt loss and worker restart retry the same ID and leave exactly one durable recipient row',async t=>{
 const f=fixture(t);let now=100,loss=true,attempts=0,owner=a;const store=f.create();
 const receiver=f.queue({store,owner:()=>b,allowed:p=>p===a,randomId:async()=>id,now:()=>now,send:async()=>false});
 const deps={store,owner:()=>owner,allowed:p=>p===b,randomId:async()=>id,now:()=>now,send:async(peer,text,key)=>{attempts++;assert.equal(key,id);const saved=await receiver.receive({from:a,id:key,text});return saved&&!loss;}};
 let sender=f.queue(deps);assert.equal(await sender.enqueue(b,'synthetic probe'),id);await sender.tick();
 assert.equal((await store.list(a))[0].state,'pending');assert.equal((await store.list(b)).length,1);
 await sender.tick();assert.equal(attempts,1,'backoff');sender.stop();f.reopen();now+=6000;loss=false;sender=f.queue({...deps,store:f.create()});await sender.tick();
 assert.equal(attempts,2);assert.equal((await store.list(a))[0].state,'delivered');assert.equal((await store.list(b)).length,1);
});
test('lock invalidates late receipt; re-unlock requires consent and can recover the pending message',async t=>{
 const f=fixture(t),store=f.create();let owner=a,allowed=true,release,now=100,sends=0;
 const q=f.queue({store,owner:()=>owner,allowed:()=>allowed,randomId:async()=>id,now:()=>now,send:()=>{sends++;return new Promise(r=>release=r);}});
 await q.enqueue(b,'probe');const running=q.tick();while(!release)await new Promise(r=>setImmediate(r));
 owner=null;allowed=false;q.invalidate();owner=a;release(true);await running;
 assert.equal((await store.list(a))[0].state,'pending');await q.tick();assert.equal(sends,1);
 allowed=true;const retry=q.tick();while(sends<2)await new Promise(r=>setImmediate(r));release(true);await retry;
 assert.equal((await store.list(a))[0].state,'delivered');
});
test('storage bounds reject new entries while preserving duplicate receipts at capacity',async t=>{
 const f=fixture(t),s=f.create();for(let i=0;i<200;i++)assert.equal(await s.put({...row(b,a,'in'),id:i.toString(16).padStart(64,'0')},()=>true),true);
 assert.equal(await s.put(row(b,a,'in'),()=>true),false);
 assert.equal(await s.put({...row(b,a,'in'),id:'0'.repeat(64)},()=>true),true);
 assert.equal((await s.list(b)).length,200);
});
