const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const protocol=load('attachmentProtocol'),chat=load('rootChatLedger');
function setup(){
 const f=fixture(),descriptor={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:crypto.createHash('sha256').update(f.plain).digest('hex'),name:'example.bin',mime:'application/octet-stream'};
 const ledgers=[0,1].map(i=>{let raw=null;return chat.createRootChatLedger({owner:f.ids[i].record.account,read:async()=>raw,write:async value=>{raw=value;},current:()=>true,now:()=>now,
 verifyAttachment:async(d,direction)=>protocol.verifyAttachmentManifest(d.manifest,f.ids[0].record,now)&&(direction==='incoming'?d.manifest.recipientDevice:d.manifest.senderDevice)===f.ids[i].device.id,
 verifyAttachmentReceipt:async(d,r)=>protocol.verifyAttachmentReceipt(r,d.manifest,f.ids[1].record,now)});});
 return {...f,descriptor,ledgers,wire:chat.encodeRootAttachment(f.manifest.recipient,f.manifest.id,descriptor),receipt:protocol.signAttachmentReceipt(f.manifest,f.ids[1].signingSeed,f.ids[1].record,now)};
}
test('descriptor acknowledgement never marks an attachment delivered; verified final receipt does',async()=>{
 const f=setup(),[sender,receiver]=f.ledgers,m=f.manifest;
 await sender.enqueueAttachment(f.descriptor);await sender.delivered(m.recipient,m.id);
 assert.equal((await sender.snapshot()).messages[0].status,'pending');assert.equal((await sender.snapshot()).messages[0].descriptorDelivered,true);
 assert(await receiver.receive(m.sender,m.id,f.wire));assert(await receiver.receive(m.sender,m.id,f.wire));
 assert.equal((await receiver.snapshot()).messages.length,1);assert.equal((await receiver.snapshot()).messages[0].status,'pending');
 for(const [ledger,peer,direction] of [[sender,m.recipient,'outgoing'],[receiver,m.sender,'incoming']]){
  assert.equal(await ledger.attachmentComplete(peer,m.id,direction,{...f.receipt,signature:'00'.repeat(64)}),false);
  assert(await ledger.attachmentComplete(peer,m.id,direction,f.receipt));assert.equal((await ledger.snapshot()).messages[0].status,'delivered');
 }
});
test('authenticated sender, signed device and immutable attachment description are enforced',async()=>{
 const f=setup(),[sender,receiver]=f.ledgers,m=f.manifest;
 assert.equal(await receiver.receive(f.ids[2].record.account,m.id,f.wire),false);
 const changed={...f.descriptor,manifest:{...m,recipientDevice:f.ids[2].device.id}};
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootAttachment(m.recipient,m.id,changed)),false);
 assert(await receiver.receive(m.sender,m.id,f.wire));
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootAttachment(m.recipient,m.id,{...f.descriptor,key:'00'.repeat(32)})),false);
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootChat(m.recipient,m.id,f.descriptor.name)),false);
 await sender.enqueueAttachment(f.descriptor);await assert.rejects(sender.enqueue(m.recipient,m.id,f.descriptor.name));
 await assert.rejects(sender.enqueueAttachment({...f.descriptor,name:'different.bin'}));
});
test('blocked attachment senders never enter own history',async()=>{
 const f=setup(),receiver=f.ledgers[1];await receiver.configure(f.manifest.sender,{blocked:true});
 assert.equal(await receiver.receive(f.manifest.sender,f.manifest.id,f.wire),false);assert.deepEqual((await receiver.snapshot()).messages,[]);
});

test('attachment replies retain verified reference through duplicate delivery and final receipt',async()=>{
 const f=setup(),[sender,receiver]=f.ledgers,m=f.manifest,original='a'.repeat(64),reply={id:original,author:m.sender};
 await sender.enqueue(m.recipient,original,'Original');
 await receiver.receive(m.sender,original,chat.encodeRootChat(m.recipient,original,'Original'));
 await sender.enqueueAttachment(f.descriptor,reply);
 const sent=(await sender.snapshot()).messages.find(v=>v.id===m.id),wire=chat.encodeRootMessage(sent);
 assert.equal(await receiver.receive(m.sender,m.id,wire),true);assert.equal(await receiver.receive(m.sender,m.id,wire),true);
 assert.deepEqual((await receiver.snapshot()).messages.find(v=>v.id===m.id).reply,reply);
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootAttachment(m.recipient,m.id,f.descriptor,{id:'b'.repeat(64),author:m.sender})),false);
 await assert.rejects(sender.enqueueAttachment(f.descriptor,{id:'b'.repeat(64),author:m.sender}));
 assert(await receiver.attachmentComplete(m.sender,m.id,'incoming',f.receipt));
 assert.equal((await receiver.snapshot()).messages.filter(v=>v.id===m.id).length,1);
});

test('forged attachment reply author and malformed reference cannot enter the inbox',async()=>{
 const f=setup(),m=f.manifest,receiver=f.ledgers[1];
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootAttachment(m.recipient,m.id,f.descriptor,{id:'a'.repeat(64),author:f.ids[2].record.account})),false);
 assert.equal(await receiver.receive(m.sender,m.id,chat.encodeRootAttachment(m.recipient,m.id,f.descriptor,{id:'bad',author:m.sender})),false);
 assert.equal((await receiver.snapshot()).messages.length,0);
});
