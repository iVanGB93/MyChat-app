const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const {createRootChatLedger,encodeRootChat}=load('rootChatLedger'),{rootChatView}=load('rootChatActions');
const owner='axonic:1:'+'a'.repeat(64),peer='axonic:1:'+'b'.repeat(64),id='1'.repeat(64);
function setup(account=owner,extra={}){let raw=null,clock=now;const deps={owner:account,current:()=>true,now:()=>clock,read:async()=>raw,write:async value=>{raw=value;},...extra};return {api:createRootChatLedger(deps),at:value=>clock=value,reopen:()=>createRootChatLedger(deps)};}
test('storage and delivery times survive restart, expiry and duplicate receipts',async()=>{
 const f=setup();await f.api.enqueue(peer,id,'hello');f.at(now+10);await f.api.networkStored(peer,id,now+100);
 f.at(now+20);await f.api.networkStored(peer,id,now+200);assert.equal((await f.reopen().snapshot()).messages[0].storedAt,now+10);
 f.at(now+300);await f.api.networkStored(peer,id,now+500);assert.equal((await f.api.snapshot()).messages[0].storedAt,now+10);
 f.at(now+400);await f.api.delivered(peer,id);f.at(now+450);await f.api.delivered(peer,id);
 assert.equal((await f.reopen().snapshot()).messages[0].deliveredAt,now+400);
});
test('incoming receipt time is local admission, not claimed sender creation time',async()=>{
 const f=setup();const wire=JSON.stringify(['axonic-root-text-v1',owner,id,'hello',now-500]);
 await f.api.receive(peer,id,wire);f.at(now+100);await f.api.receive(peer,id,wire);
 const m=(await f.reopen().snapshot()).messages[0];assert.equal(m.at,now-500);assert.equal(m.deliveredAt,now);
});
test('media timestamps wait for complete custody and full-file receipt',async()=>{
 const f=fixture(),m=f.manifest,descriptor={manifest:m,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'photo.jpg',mime:'image/jpeg'};
 const s=setup(m.sender,{verifyAttachment:async()=>true,verifyAttachmentReceipt:async()=>true});
 await s.api.enqueueAttachment(descriptor,undefined,undefined,now-500);assert.equal((await s.api.snapshot()).messages[0].queuedAt,now);s.at(now+10);await s.api.networkStored(m.recipient,m.id,now+1000);
 assert.equal((await s.api.snapshot()).messages[0].storedAt,undefined);
 s.at(now+20);await s.api.networkStored(m.recipient,m.id,now+1000,true);
 s.at(now+30);await s.api.delivered(m.recipient,m.id);
 let row=(await s.api.snapshot()).messages[0];assert.equal(row.storedAt,now+20);assert.equal(row.descriptorReceivedAt,now+30);assert.equal(row.deliveredAt,undefined);
 s.at(now+40);await s.api.attachmentComplete(m.recipient,m.id,'outgoing',{});s.at(now+50);await s.api.attachmentComplete(m.recipient,m.id,'outgoing',{});
 row=(await s.reopen().snapshot()).messages[0];assert.equal(row.deliveredAt,now+40);
});
test('private and group read timestamps use each recipient confirmation, not another member',()=>{
 const m={id,peer,direction:'outgoing',at:now,text:'hi',status:'delivered'},target={id,author:owner};
 const a={kind:'read',direction:'incoming',peer,target,at:now+10};
 assert.equal(rootChatView(owner,{messages:[m],actions:[a],contacts:[]}).messages[0].readAt,now+10);
 const group={id:'group',messageId:id};
 const result=rootChatView(owner,{messages:[{...m,group}],groupActions:[{...a,group},{...a,peer:'other',group,at:now+1}],contacts:[]});
 assert.equal(result.messages[0].readAt,now+10);
 assert.equal(rootChatView(owner,{messages:[m],contacts:[]}).messages[0].readAt,undefined);
});
