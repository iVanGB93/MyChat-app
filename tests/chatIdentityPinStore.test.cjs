const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
function fixture(t){const db=new DatabaseSync(':memory:'),cache=new Map();let afterInsert=()=>{};
 const tx={getFirstAsync:async(s,...p)=>db.prepare(s).get(...p)??null,runAsync:async(s,...p)=>{const r=db.prepare(s).run(...p);afterInsert();return r;}};
 const sqlite={openDatabaseAsync:async()=>({...tx,execAsync:async s=>db.exec(s),withExclusiveTransactionAsync:async f=>{db.exec('BEGIN IMMEDIATE');try{await f(tx);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}})};
 function load(name){if(cache.has(name))return cache.get(name);const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(`src/services/identity/${name}.ts`,'utf8'),{compilerOptions:{module:1,target:9}}).outputText)(p=>p==='expo-sqlite'?sqlite:p.startsWith('./')?load(p.slice(2).replace(/\.ts$/,'')):require(p),out);cache.set(name,out);return out;}
 t.after(()=>db.close());return {create:load('chatIdentityPinStore').createChatIdentityPinStore,db,afterInsert:fn=>afterInsert=fn};
}
const a='axonic:1:'+'a1'.repeat(32),b='axonic:1:'+'b2'.repeat(32);
test('immutable pins survive store recreation, isolate owners, and reject numeric aliases',async t=>{
 const f=fixture(t),s=f.create(14);assert.equal(await s.pin(18,a,()=>true),true);
 assert.equal(await f.create(14).read(18),a);assert.equal(await f.create(27).read(18),null);
 assert.equal(await s.pin(18,b,()=>true),false);assert.equal(await s.pin(22,a,()=>true),false);
 assert.equal(await f.create(27).pin(18,b,()=>true),true);assert.equal(await s.read(18),a);
});
test('concurrent conflicting initial pins serialize and cannot replace the winner',async t=>{
 const f=fixture(t);assert.deepEqual(await Promise.all([f.create(14).pin(18,a,()=>true),f.create(14).pin(18,b,()=>true)]),[true,false]);
});
test('logout before transaction commit rolls back a new pin',async t=>{
 const f=fixture(t);let active=true;f.afterInsert(()=>active=false);
 assert.equal(await f.create(14).pin(18,a,()=>active),false);assert.equal(await f.create(14).read(18),null);
});
test('pin capacity preserves existing trust while refusing new bindings',async t=>{
 const f=fixture(t),s=f.create(14);assert.equal(await s.pin(18,a,()=>true),true);
 const insert=f.db.prepare('INSERT INTO chat_identity_pins VALUES(?,?,?)');
 for(let i=0;i<255;i++)insert.run(14,100+i,'axonic:1:'+i.toString(16).padStart(64,'0'));
 assert.equal(await s.pin(400,b,()=>true),false);assert.equal(await s.pin(18,a,()=>true),true);assert.equal(await s.read(18),a);
});
