const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 const rows=new Map(),staged=new Map(),removed=[];let seq=0,fail=false;const status={account:'owner',state:'unlocked'};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name.includes('async-storage'))return {default:{getItem:async k=>rows.get(k),setItem:async(k,v)=>rows.set(k,v)}};
  if(name.includes('axonic-nearby'))return {default:{identityRandomBytes:async()=>String(++seq).padStart(64,'0')}};
  if(name==='./localAccount')return {localAccount:{status:()=>status}};
  if(name==='./identityProtocol')return {validAccountId:p=>['owner','peer','other'].includes(p)};
  if(name==='./rootAttachmentFiles')return {stageRootAttachmentSource:(owner,id,uri)=>{if(fail&&uri==='file://two')throw Error('Disk full');staged.set(id,uri);},removeRootAttachmentSource:(owner,id)=>{removed.push(id);staged.delete(id);}};
  return {};
 },out);
 return {out,rows,staged,status,fail:()=>fail=true,items:[{uri:'file://one',name:'One',mime:'image/jpeg',caption:'First'},{uri:'file://two',name:'Two',mime:'image/png'}]};
}
test('reviewed batch commits all selections together and preserves captions',async()=>{
 const f=fixture();await f.out.queueRootAttachmentBatch({owner:'owner',peer:'peer',items:f.items});
 const rows=JSON.parse([...f.rows.values()][0]);assert.equal(rows.length,2);assert.equal(rows[0].caption,'First');assert.equal(f.staged.size,2);
});
test('later staging failure rolls back every file and publishes no partial batch',async()=>{
 const f=fixture();f.fail();await assert.rejects(f.out.queueRootAttachmentBatch({owner:'owner',peer:'peer',items:f.items}),/Disk full/);assert.equal(f.staged.size,0);assert.equal(f.rows.size,0);
});
test('each group item has a distinct shared message ID and independent per-recipient transfers',async()=>{
 const f=fixture();await f.out.queueRootAttachmentBatch({owner:'owner',peer:'',items:f.items,audience:{owner:'owner',peers:['peer','other'],group:{id:'g',revision:1}}});
 const rows=JSON.parse([...f.rows.values()][0]);assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.id)).size,4);assert.equal(rows[0].group.messageId,rows[1].group.messageId);assert.notEqual(rows[0].group.messageId,rows[2].group.messageId);
});
test('empty audience and account replacement cannot stage files',async()=>{
 for(const changed of [false,true]){const f=fixture();if(changed)f.status.account='other';await assert.rejects(f.out.queueRootAttachmentBatch({owner:'owner',peer:'peer',items:f.items,...(!changed?{audience:{owner:'owner',peers:[],group:{}}}:{})}));assert.equal(f.staged.size,0);}
});
