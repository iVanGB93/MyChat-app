const assert=require('node:assert/strict');
const test=require('node:test');
const {load,fixture,now}=require('./helpers/attachment.cjs');
const {savedAttachmentPresentation,chatMediaPresentation,localMediaFromDescriptor}=load('savedAttachmentPresentation');
const {createRootChatLedger,encodeRootMessage}=load('rootChatLedger');

const repeat=digit=>digit.repeat(64);
const account=digit=>'axonic:1:'+repeat(digit);
const sender=account('2'),recipient=account('4');
const manifest={version:4,id:repeat('1'),sender,senderDevice:repeat('3'),recipient,recipientDevice:repeat('5'),
 created:1700000000000,expires:1700000001000,bytes:4200,root:repeat('6'),checksum:repeat('7'),signature:'9'.repeat(128)};
const message={id:manifest.id,peer:sender,direction:'incoming',status:'delivered',retiredAttachment:{manifest,name:'photo.jpg',mime:'image/jpeg',caption:'Saved photo'}};

test('an expired v4 delivery resolves to the private or gallery lookup key used by 1.1.58',()=>{
 const result=savedAttachmentPresentation(message,recipient);
 assert.deepEqual(result,{name:'photo.jpg',mime:'image/jpeg',bytes:4200,caption:'Saved photo',digest:'4ae5dc63701c299232190af91e60fb97612949f555c830bb32053ed447c1361f'});
 assert.equal(message.attachment,undefined);
 const cachedPage={...message,attachment:message.retiredAttachment,retiredAttachment:undefined};
 assert.equal(chatMediaPresentation(cachedPage,recipient).fileKey,result.digest);
});

test('group slot metadata preserves the original sender-side grant lookup key',()=>{
 const outgoing={...message,direction:'outgoing',peer:recipient,retiredAttachment:{...message.retiredAttachment,manifest:{...manifest,shared:{id:repeat('8'),count:3,slot:1}}}};
 assert.equal(savedAttachmentPresentation(outgoing,sender).digest,'511dcdb82bcc772be5a293bc222ca14b9f9dcb0dee0bb8f206c6966fa69c2b85');
});

test('wrong account, deleted rows, active transfers and malformed retired media do not resolve',()=>{
 assert.equal(savedAttachmentPresentation(message,account('0')),undefined);
 assert.equal(savedAttachmentPresentation({...message,deleted:true},recipient),undefined);
 assert.equal(savedAttachmentPresentation({...message,attachment:{manifest:{...manifest,version:5}}},recipient),undefined);
 assert.equal(savedAttachmentPresentation({...message,retiredAttachment:{...message.retiredAttachment,manifest:{...manifest,signature:'bad'}}},recipient),undefined);
});

test('private media commits its local file key on both phones without putting it on the wire',async()=>{
 const f=fixture(128),a=f.manifest.sender,b=f.manifest.recipient;
 const descriptor={manifest:f.manifest,name:'photo.jpg',mime:'image/jpeg',caption:'Saved photo',key:Buffer.from(f.key).toString('hex'),checksum:require('node:crypto').createHash('sha256').update(f.plain).digest('hex')};
 const history=owner=>{
  let raw=null;
  return ()=>createRootChatLedger({owner,current:()=>true,now:()=>now,read:async()=>raw,write:async value=>{raw=value;},verifyAttachment:async()=>true,localMedia:localMediaFromDescriptor});
 };
 const reopenSender=history(a),reopenReceiver=history(b);
 const sender=reopenSender(),receiver=reopenReceiver();
 await sender.configure(b,{accepted:true});
 await sender.enqueueAttachment(descriptor);
 const [sent]=(await reopenSender().snapshot()).messages;
 const packet=encodeRootMessage(sent);
 assert.deepEqual(sent.localMedia,localMediaFromDescriptor(descriptor));
 assert(!packet.includes('fileKey'));
 assert(!packet.includes(sent.localMedia.fileKey));
 assert.equal(await receiver.receive(a,descriptor.manifest.id,packet),true);
 const [received]=(await reopenReceiver().snapshot()).messages;
 assert.deepEqual(received.localMedia,sent.localMedia);
 assert.deepEqual(chatMediaPresentation({...received,attachment:undefined,retiredAttachment:undefined},b),sent.localMedia);
 assert.equal(chatMediaPresentation({...received,deleted:true},b),undefined);
});
