const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const {relayInventory,relayInventoryPage,relayPacketDetails}=load('relayInventory'),{attachmentDigest,attachmentContentDigest}=load('attachmentProtocol');
const owner='owner',sender='sender',recipient='recipient',secret='NEVER_EXPOSE_THIS';
test('foreign relay projection is allowlisted, read-only, and separates expired markers from payloads',()=>{
 const row={sender,recipient,id:'id',digest:'digest',recipientDevice:secret,expires:now-1,packet:{kind:'envelope',created:now-100,ciphertext:secret,nonce:secret,signature:secret}};
 const input=[row,{...row,id:'marker',packet:null},{...row,id:'own-in',recipient:owner},{...row,id:'own-out',sender:owner}];
 const before=JSON.stringify(input),result=relayInventory(owner,now,input,[],[],[]);
 assert.equal(result.rows.length,2);assert(result.rows.every(r=>r.state.startsWith('expired')));
 assert(!JSON.stringify(result).includes(secret));assert.equal(JSON.stringify(input),before);
 assert(result.rows.some(r=>r.kind==='message cleanup marker'));
});
test('group metadata shows each foreign recipient and shared data without ciphertext or own destinations',()=>{
 const group={sender,id:'group',digest:'group-digest',expires:now+1,accepted:false,source:'source-relay',replicated:'replica-relay',payload:{ciphertext:secret},recipients:[
  {id:'grant',digest:'g',recipient,grant:{ciphertext:secret},receipt:null,consumed:false},
  {id:'receipt',digest:'r',recipient:'other',grant:null,receipt:{signature:secret},consumed:false},
  {id:'self',digest:'s',recipient:owner,grant:{},receipt:null,consumed:false}]};
 const result=relayInventory(owner,now,[],[group],[],[]);
 assert.deepEqual(result.rows.map(r=>r.kind).sort(),['group grant','group receipt','group shared payload']);
 assert(result.rows.every(r=>r.source==='source-relay'&&r.replicatedTo==='replica-relay'));
 assert(!JSON.stringify(result).includes(secret));assert(!result.rows.some(r=>r.recipient===owner));
});
test('media reports actual held chunk metadata once, separately from checkpoints and receipts',()=>{
 const f=fixture(),m=f.manifest,content=attachmentContentDigest(m),row={manifest:m,digest:attachmentDigest(m),received:3,receipt:{signature:secret}};
 const chunks=[{digest:content,chunkCount:1,firstChunk:2,lastChunk:2,storedBytes:1234,raw:secret}];
 const result=relayInventory(owner,now,[],[],[row],chunks);
 assert.equal(result.rows.length,2);const c=result.rows.find(r=>r.kind==='encrypted media chunks');
 assert.equal(c.chunkCount,1);assert.equal(c.storedBytes,1234);assert.equal(c.firstChunk,2);
 assert.equal(result.rows.find(r=>r.kind==='media receipt / manifest').checkpointChunks,3);
 assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes(m.signature));
 assert.equal(relayInventory(m.sender,now,[],[],[row],chunks).rows.length,0);
 assert.equal(relayInventory(m.recipient,now,[],[],[row],chunks).rows.length,0);
});
test('RAM cache is allowlisted and pagination reaches every entry without mutation',()=>{
 const calls=Array.from({length:121},(_,i)=>({key:'call:'+i,id:String(i),kind:'call-control event',state:'held',sender,recipient,expiresAt:now+1,raw:secret}));
 const snapshot=relayInventory(owner,now,[],[],[],[],calls),ids=[];
 for(let offset=0;offset!==null;){const page=relayInventoryPage(snapshot,offset);ids.push(...page.rows.map(r=>r.key));offset=page.next;}
 assert.equal(ids.length,121);assert.equal(new Set(ids).size,121);assert(!JSON.stringify(snapshot).includes(secret));
 assert(snapshot.rows.every(r=>r.storage==='memory'));assert.throws(()=>relayInventoryPage(snapshot,-1));assert.throws(()=>relayInventoryPage(snapshot,0,101));
 assert(relayPacketDetails(snapshot.rows[0]).some(r=>r.label==='Expires'));
});
