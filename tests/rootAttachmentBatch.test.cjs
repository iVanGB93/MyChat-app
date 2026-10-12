const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function fixture(){
 const rows=new Map(),staged=new Map(),removed=[];let seq=0,fail=false;const groupMessages=[],feedback=[];const status={account:'owner',state:'unlocked'};
 const out={};new Function('require','exports','setTimeout','clearTimeout',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentRuntime.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>{
  if(name.includes('async-storage'))return {default:{getItem:async k=>rows.get(k),setItem:async(k,v)=>rows.set(k,v)}};
  if(name.includes('axonic-nearby'))return {default:{identityRandomBytes:async()=>String(++seq).padStart(64,'0')}};
  if(name==='./rootMessageFeedback')return {publishRootMessageFeedback:event=>feedback.push(event)};
  if(name==='./localRootChat')return {localRootChat:()=>({snapshot:async()=>({messages:groupMessages})})};
  if(name==='./rootGroupActions')return {validGroupReply:r=>!!r&&/^[a-f0-9]{64}$/.test(r.id)&&['owner','peer','other'].includes(r.author),groupReplyAvailable:(state,owner,group,reply)=>state.messages.some(m=>m.group?.id===group&&m.group.messageId===reply.id&&m.peer===reply.author)};
  if(name==='./localAccount')return {localAccount:{status:()=>status,subscribe:()=>()=>{}}};
  if(name==='./attachmentTiming')return {createAttachmentTiming:()=>({snapshot:()=>({})})};
  if(name==='./identityRecordStore')return {createMobileIdentityRecordStore:()=>({})};
  if(name==='./mobileAttachmentJobs')return {createMobileAttachmentJobs:()=>({})};
  if(name==='./attachmentTransfer')return {createAttachmentTransfer:()=>({stop(){}})};
  if(name==='./rootMediaExport')return {startRootMediaExport:()=>({stop(){}})};
  if(name==='./identityProtocol')return {validAccountId:p=>['owner','peer','other'].includes(p)};
  if(name==='./rootAttachmentFiles')return {stageRootAttachmentSource:(owner,id,uri)=>{if(fail&&uri==='file://two')throw Error('Disk full');staged.set(id,uri);},removeRootAttachmentSource:(owner,id)=>{removed.push(id);staged.delete(id);}};
  return {};
 },out,()=>0,()=>{});
 return {out,rows,staged,status,groupMessages,feedback,fail:()=>fail=true,items:[{uri:'file://one',name:'One',mime:'image/jpeg',caption:'First'},{uri:'file://two',name:'Two',mime:'image/png'}]};
}
test('reviewed batch commits all selections together and preserves captions',async()=>{
 const f=fixture();await f.out.queueRootAttachmentBatch({owner:'owner',peer:'peer',items:f.items});
 const rows=JSON.parse([...f.rows.values()][0]);assert.equal(rows.length,2);assert.equal(rows[0].caption,'First');assert.equal(f.staged.size,2);
});

test('group sharing requires every recipient and a separate compatible custodian',async()=>{
 for(const capable of [[],['peer','relay'],['peer','other'],['peer','other','relay']]){
  const f=fixture(),runtime=f.out.startRootAttachmentRuntime({peers:()=>capable,sharedPeers:()=>capable,request:async()=>null});
  try{await f.out.queueRootAttachmentBatch({owner:'owner',peer:'',items:f.items,audience:{owner:'owner',peers:['peer','other'],group:{id:'g',revision:1}}});
   const rows=JSON.parse([...f.rows.values()][0]);
   if(capable.length===3){assert(rows.every(r=>r.shared));assert.equal(rows[0].shared.id,rows[1].shared.id);assert.notEqual(rows[0].shared.id,rows[2].shared.id);assert.deepEqual(rows.map(r=>r.shared.slot),[0,1,0,1]);}
   else assert(rows.every(r=>r.shared===undefined),'legacy/missing peer keeps the existing format');
  }finally{runtime.stop();}
 }
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

test('reviewed group media and voice staging preserve a third-member quote for every recipient',async()=>{
 const f=fixture(),reply={id:'a'.repeat(64),author:'other'},audience={owner:'owner',peers:['peer','other'],group:{id:'g',revision:1,messageId:'b'.repeat(64)},reply};
 f.groupMessages.push({peer:'other',group:{id:'g',messageId:reply.id}});
 await f.out.queueRootAttachmentBatch({owner:'owner',peer:'',items:f.items,audience,reply});
 let rows=JSON.parse([...f.rows.values()][0]);assert.equal(rows.length,4);assert(rows.every(row=>JSON.stringify(row.reply)===JSON.stringify(reply)));assert.equal(f.feedback.length,1);
 const voice=fixture();voice.groupMessages.push(...f.groupMessages);await voice.out.queueRootGroupAttachmentSource(audience,'file://voice','Voice message.m4a','audio/mp4');
 rows=JSON.parse([...voice.rows.values()][0]);assert.equal(rows.length,2);assert(rows.every(row=>row.reply.author==='other'&&row.group.messageId==='b'.repeat(64)));assert.equal(voice.feedback.length,1);
});
test('an unavailable group quote fails before any batch file is staged',async()=>{
 const f=fixture();await assert.rejects(f.out.queueRootAttachmentBatch({owner:'owner',peer:'',items:f.items,audience:{owner:'owner',peers:['peer'],group:{id:'g',revision:1}},reply:{id:'a'.repeat(64),author:'other'}}),/Original/);assert.equal(f.staged.size,0);assert.equal(f.feedback.length,0);
});
