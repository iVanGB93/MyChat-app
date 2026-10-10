const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const mod={};new Function('exports',ts.transpileModule(fs.readFileSync('src/modules/ui/sharedContent.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(mod);
test('shared text preserves content and does not duplicate the extracted URL',()=>{
 assert.deepEqual(mod.sharedItems({text:'Look https://example.com',webUrl:'https://example.com'}),[{text:'Look https://example.com'}]);
 assert.deepEqual(mod.sharedItems({webUrl:'https://example.com'}),[{text:'https://example.com'}]);
});
test('multiple local shared files retain their names, types and order',()=>{
 const files=[{path:'file:///cache/a.jpg',fileName:'a.jpg',mimeType:'image/jpeg',size:3},{path:'content://provider/b',fileName:'b.pdf',mimeType:'application/pdf'}];
 assert.deepEqual(mod.sharedItems({files}),files.map(f=>({uri:f.path,name:f.fileName,mime:f.mimeType})));
});
test('unsupported paths, oversize files, empty shares and excessive batches fail before sending',()=>{
 for(const input of [{},{files:[{path:'https://example.com/x'}]},{files:[{path:'file:///x',size:0}]},{files:[{path:'file:///x',size:251*1024*1024}]},{files:Array(5).fill({path:'file:///x'})}])assert.throws(()=>mod.sharedItems(input));
});
test('partial failure retries only remaining items and pins account and recipient',async()=>{
 const batch=mod.sharedBatch([{text:'a'},{text:'b'}]),sent=[];let fail=true;
 const enqueue=async item=>{if(item.text==='b'&&fail)throw Error('queue full');sent.push(item.text);};
 await assert.rejects(batch.send('owner','peer',()=>true,enqueue));assert.equal(batch.completed,1);
 await assert.rejects(batch.send('other','peer',()=>true,enqueue));await assert.rejects(batch.send('owner','other',()=>true,enqueue));
 fail=false;assert.equal(await batch.send('owner','peer',()=>true,enqueue),true);assert.deepEqual(sent,['a','b']);
});
test('locking mid-batch pauses remaining items and concurrent taps cannot duplicate sends',async()=>{
 const batch=mod.sharedBatch([{text:'a'},{text:'b'}]);let unlocked=true,release;const gate=new Promise(r=>release=r),sent=[];
 const send=batch.send('owner','peer',()=>unlocked,async item=>{sent.push(item.text);await gate;unlocked=false;});
 assert.equal(await batch.send('owner','peer',()=>true,async()=>assert.fail('duplicate')),false);release();await assert.rejects(send);assert.deepEqual(sent,['a']);assert.equal(batch.completed,1);
});
