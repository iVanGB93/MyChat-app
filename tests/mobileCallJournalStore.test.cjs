const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ts = require('typescript'), { DatabaseSync } = require('node:sqlite');
test('mobile journal SQL preserves CAS, ownership and state across database reopen', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'axonic-call-sql-'));
  const filename = path.join(folder, 'calls.db');
  let database, inventory, tail=Promise.resolve(), transactionOpen=false;
  const read=(s,...args)=>database.prepare(s).get(...args)??null;
  const sql = {
    execAsync: async s => { database.exec(s); },
    getFirstAsync: async (s,...args) => { if(transactionOpen)throw Error('database is locked');return read(s,...args); },
    getAllAsync:async(s,...args)=>database.prepare(s).all(...args),
    runAsync: async (s,...args) => database.prepare(s).run(...args),
    withExclusiveTransactionAsync(change) {
      const result=tail.then(async()=>{
        database.exec('BEGIN IMMEDIATE');
        transactionOpen=true;
        try { await change({...sql,getFirstAsync:async(s,...args)=>read(s,...args)}); database.exec('COMMIT'); }
        catch(e) { database.exec('ROLLBACK'); throw e; }
        finally {transactionOpen=false;}
      }); tail=result.catch(()=>{}); return result;
    },
  };
  function openStore() {
    const code=ts.transpileModule(fs.readFileSync('src/services/identity/mobileCallJournalStore.ts','utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    const exports={};
    new Function('require','exports',code)(name=>{
      if(name==='expo-sqlite')return {openDatabaseAsync:async()=>{database=new DatabaseSync(filename);return sql;}};
      if(name==='./durableCallControl')return {canArchiveCallJournal:raw=>raw==='retired-test-journal'};
      if(name==='./identityProtocol')return {validAccountId:v=>typeof v==='string'&&/^axonic:1:[0-9a-f]{64}$/.test(v)};
      throw Error(name);
    },exports);
    inventory=exports.listMobileCallJournals;return exports.createMobileCallJournalStore();
  }
  try {
    const owner='axonic:1:'+'ab'.repeat(32), other='axonic:1:'+'cd'.repeat(32), id='ef'.repeat(32);
    let store=openStore();
    assert.equal(await store.compareAndSet(owner,id,null,'initial'),true);
    assert.equal(await store.read(other,id),null);
    const results=await Promise.all([store.compareAndSet(owner,id,'initial','winner-a'),store.compareAndSet(owner,id,'initial','winner-b'),store.read(owner,id)]);
    assert.equal(results.slice(0,2).filter(Boolean).length,1);
    const saved=await store.read(owner,id);
    database.close(); store=openStore();
    assert.equal(await store.read(owner,id),saved);
    const first={record:{account:owner},callId:id,kind:'invite',expiresAt:10};
    const journal=JSON.stringify({owner,callId:id,entries:[{raw:JSON.stringify(first)}]});
    assert.equal(await store.compareAndSet(owner,id,saved,journal),true);
    assert.equal((await inventory(owner)).length,1);
    assert.equal((await inventory(owner,10)).length,0,'expired history must not consume retry slots');
    const ending=JSON.stringify({owner,callId:id,entries:[{raw:JSON.stringify(first)},{raw:JSON.stringify({...first,kind:'end',expiresAt:30})}]});
    assert.equal(await store.compareAndSet(owner,id,journal,ending),true);
    assert.equal((await inventory(owner,20)).length,1,'a new hangup remains eligible after invitation expiry');
    assert.equal(await store.compareAndSet(owner,id,null,'reset'),false);
    await assert.rejects(store.compareAndSet(owner,id,ending,'x'.repeat(800001)),/Oversized/);
    assert.equal(await store.read(owner,id),ending);
    for(let n=0;n<63;n++)assert.equal(await store.compareAndSet(owner,n.toString(16).padStart(64,'0'),null,'retired-test-journal'),true);
    assert.equal(await store.compareAndSet(owner,'99'.repeat(32),null,'new-live'),true);
    assert.equal(read('SELECT COUNT(*) AS total FROM call_history').total,63);
    assert.equal(read('SELECT COUNT(*) AS total FROM call_journal').total,2);
    assert.equal(await store.compareAndSet(owner,'0'.repeat(64),null,'resurrect'),false);
    assert.equal(await store.read(owner,id),ending,'unverified or active journals are retained');
  } finally {
    database?.close();
    assert.equal(path.dirname(folder),fs.realpathSync(os.tmpdir()));
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
