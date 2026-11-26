const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{DatabaseSync}=require('node:sqlite');
const {load,fixture}=require('./helpers/attachment.cjs');
test('old local jobs remain stored without starving or replacing current work',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const sql={execSync:s=>db.exec(s),execAsync:async s=>db.exec(s),getAllAsync:async(s,...p)=>db.prepare(s).all(...p),getFirstAsync:async(s,...p)=>db.prepare(s).get(...p)??null,getFirstSync:(s,...p)=>db.prepare(s).get(...p)??null,runAsync:async(s,...p)=>db.prepare(s).run(...p),withTransactionAsync:async fn=>{db.exec('BEGIN');try{await fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentJobs.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>sql}:n==='./attachmentChanges'?{attachmentChanged(){}}:load(n.slice(2)),out);
 const store=out.createMobileAttachmentJobs(),f=fixture(),owner=f.ids[0].record.account;
 await store.list(owner);
 const insert=db.prepare('INSERT INTO jobs(owner,digest,revision,raw) VALUES(?,?,?,?)');
 for(let i=0;i<130;i++)insert.run(owner,i.toString(16).padStart(64,'0'),0,JSON.stringify({descriptor:{manifest:{version:3}}}));
 assert.deepEqual(await store.list(owner),[]);await store.retire(owner,()=>true);
 assert.equal(await store.get(owner,'0'.repeat(64)),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n,130);
 insert.run(owner,'f'.repeat(64),0,JSON.stringify({descriptor:{manifest:{version:5}}}));
 await assert.rejects(store.list(owner),/Invalid attachment job/);
});

test('5000 archived transfers cannot block new work, completion or expiry retirement',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const sql={execSync:s=>db.exec(s),execAsync:async s=>db.exec(s),getAllAsync:async(s,...p)=>db.prepare(s).all(...p),getFirstAsync:async(s,...p)=>db.prepare(s).get(...p)??null,getFirstSync:(s,...p)=>db.prepare(s).get(...p)??null,runAsync:async(s,...p)=>db.prepare(s).run(...p)};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/mobileAttachmentJobs.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo-sqlite'?{openDatabaseAsync:async()=>sql}:n==='./attachmentChanges'?{attachmentChanged(){}}:load(n.slice(2)),out);
 const f=fixture(17),a=load('attachmentProtocol'),owner=f.ids[0].record.account;let clock=f.manifest.created;let store=out.createMobileAttachmentJobs(()=>clock);await store.list(owner);
 const make=(n,phase='queued')=>{const manifest={...f.manifest,id:n.toString(16).padStart(64,'0')};return {version:1,owner,direction:'outgoing',digest:a.attachmentDigest(manifest),descriptor:{manifest,key:Buffer.from(f.key).toString('hex'),checksum:require('crypto').createHash('sha256').update(f.plain).digest('hex'),name:'fixture.bin',mime:'application/octet-stream'},revision:0,phase,cursor:0,relay:null,next:0,failures:0,receipt:null,custodians:[],acknowledged:[]};};
 const insert=db.prepare('INSERT INTO finished_jobs(owner,digest,revision,raw) VALUES(?,?,?,?)');for(let n=1;n<=5000;n++){const j=make(n,'complete');insert.run(owner,j.digest,0,JSON.stringify(j));}
 const j=make(5001);assert.equal(await store.save(j,null,()=>true),true);assert.equal(await store.save({...j,phase:'complete',revision:1},0,()=>true),true);
 const expiring=make(5002);assert.equal(await store.save(expiring,null,()=>true),true);clock=f.manifest.expires+1;await store.retire(owner,()=>true);
 store=out.createMobileAttachmentJobs(()=>clock);assert.deepEqual(await store.list(owner),[]);assert.equal((await store.get(owner,j.digest)).phase,'complete');assert.equal((await store.get(owner,expiring.digest)).phase,'expired');assert.equal(db.prepare('SELECT COUNT(*) n FROM finished_jobs').get().n,5002);assert.equal((await store.get(owner,make(1).digest)).phase,'complete');
 clock=f.manifest.created;const cap=load('attachmentSchedule').ATTACHMENT_ACTIVE_JOB_LIMIT,active=db.prepare('INSERT INTO jobs(owner,digest,revision,raw) VALUES(?,?,?,?)');for(let n=6000;n<6000+cap;n++){const item=make(n);active.run(owner,item.digest,0,JSON.stringify(item));}
 assert.equal((await store.list(owner)).length,cap);const waiting=make(9000);assert.equal(await store.save(waiting,null,()=>true),false);const finishing=make(6000);assert.equal(await store.save({...finishing,phase:'complete',revision:1},0,()=>true),true);assert.equal(await store.save(waiting,null,()=>true),true);assert.equal((await store.list(owner)).length,cap);

});

