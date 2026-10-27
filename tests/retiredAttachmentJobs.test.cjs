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
 insert.run(owner,'f'.repeat(64),0,JSON.stringify({descriptor:{manifest:{version:4}}}));
 await assert.rejects(store.list(owner),/Invalid attachment job/);
});
