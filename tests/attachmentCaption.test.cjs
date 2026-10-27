const test=require('node:test'),assert=require('node:assert/strict');
const {load,fixture}=require('./helpers/attachment.cjs');
const {validAttachmentDescriptor,attachmentDescriptorFingerprint}=load('attachmentTransfer');
test('optional captions are bounded and included in replay identity without changing old descriptors',()=>{
 const f=fixture(32),plain={manifest:f.manifest,key:Buffer.from(f.key).toString('hex'),checksum:require('node:crypto').createHash('sha256').update(f.plain).digest('hex'),name:'photo.jpg',mime:'image/jpeg'};
 assert.equal(validAttachmentDescriptor(plain),true);
 assert.equal(validAttachmentDescriptor({...plain,caption:'Family photo'}),true);
 assert.notEqual(attachmentDescriptorFingerprint(plain),attachmentDescriptorFingerprint({...plain,caption:'Family photo'}));
 assert.equal(validAttachmentDescriptor({...plain,caption:'🙂'.repeat(401)}),false);
 assert.equal(validAttachmentDescriptor({...plain,caption:123}),false);
 assert.equal(validAttachmentDescriptor({...plain,extra:'ignored'}),false);
});
