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

async function groupReplySetup(){
 const f=setup(),[sender,receiver]=f.ledgers,owner=f.manifest.sender,peer=f.manifest.recipient,third=f.ids[2].record.account,g='a1'.repeat(32),original='b1'.repeat(32),groups=load('rootGroups');
 await sender.createGroup(g,'c1'.repeat(32),'Family',[peer,third]);
 for(const packet of chat.pendingRootChat(await sender.snapshot(),owner).filter(p=>p.peer===peer))assert(await receiver.receive(owner,packet.id,packet.raw));
 await receiver.configureGroup(g,{accepted:true});
 const id=groups.rootGroupDeliveryId(original,owner);
 assert(await sender.receive(third,id,JSON.stringify(['axonic-root-group-text-v1',owner,id,{group:{id:g,revision:1,messageId:original},text:'Third member message'}])));
 return {...f,sender,receiver,owner,peer,third,g,groups,reply:{id:original,author:third},context:{id:g,revision:1,messageId:'d1'.repeat(32)}};
}
test('group image and voice replies quote a third member across wire, reload and duplicate delivery',async()=>{
 for(const [name,mime] of [['Photo.jpg','image/jpeg'],['Voice message.m4a','audio/mp4']]){
 const f=await groupReplySetup(),descriptor={...f.descriptor,name,mime};await f.sender.enqueueAttachment(descriptor,f.reply,f.context);
 const wire=chat.pendingRootChat(await f.sender.snapshot(),f.owner).find(p=>p.id===f.manifest.id).raw;
 assert.deepEqual(JSON.parse(wire)[3].reply,f.reply);assert(await f.receiver.receive(f.owner,f.manifest.id,wire));assert(await f.receiver.receive(f.owner,f.manifest.id,wire));
 const rows=(await f.receiver.snapshot()).messages.filter(m=>m.attachment);assert.equal(rows.length,1);assert.deepEqual(rows[0].reply,f.reply);assert.equal(rows[0].attachment.mime,mime);
 const changed=JSON.parse(wire);changed[3].reply.author=f.owner;assert.equal(await f.receiver.receive(f.owner,f.manifest.id,JSON.stringify(changed)),false);
 const extra=JSON.parse(wire);extra[3].reply.extra=true;assert.equal(await f.receiver.receive(f.owner,f.manifest.id,JSON.stringify(extra)),false);
 }
});
test('group attachments reject unavailable, wrong-author and deleted quote targets',async()=>{
 const f=await groupReplySetup();for(const reply of [{...f.reply,id:'e1'.repeat(32)},{...f.reply,author:f.peer}])await assert.rejects(f.sender.enqueueAttachment(f.descriptor,reply,f.context),/Original/);
 const action={group:{id:f.g,revision:1,messageId:'f1'.repeat(32)},target:f.reply,kind:'delete',revision:1,text:''},id=f.groups.rootGroupDeliveryId(action.group.messageId,f.owner,'action');
 assert(await f.sender.receive(f.third,id,JSON.stringify(['axonic-root-group-action-v1',f.owner,id,action])));
 await assert.rejects(f.sender.enqueueAttachment(f.descriptor,f.reply,f.context),/Original/);assert.equal((await f.sender.snapshot()).messages.filter(m=>m.attachment).length,0);
});
