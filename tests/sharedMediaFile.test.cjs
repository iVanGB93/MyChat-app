const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function setup(){
 const content=Uint8Array.from([1,2,3,4,5]),calls=[];let exists=true;
 const native={singleCopy:true,stat:()=>({exists,size:exists?content.length:0}),openRead:uri=>{calls.push(['open',uri]);return 7;},read:(id,offset,length)=>{calls.push(['read',id,offset,length]);return content.slice(offset,offset+length);},closeRead:id=>calls.push(['close',id])};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/sharedMediaFile.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(n=>n==='expo'?{requireOptionalNativeModule:()=>native}:{Platform:{OS:'android'}},out);
 return {out,calls,native,remove:()=>exists=false};
}
test('shared media streams the same gallery file read-only, seeking without private copies',()=>{
 const f=setup(),file=new f.out.SharedMediaFile('content://media/external/images/media/1');
 assert.equal(file.uri,file.contentUri);assert(file.exists);assert.equal(file.size,5);
 const reader=file.open();assert.deepEqual([...reader.readBytes(2)],[1,2]);reader.offset=4;assert.deepEqual([...reader.readBytes(2)],[5]);
 reader.close();reader.close();assert.throws(()=>reader.readBytes(1),/closed/);assert.equal(f.calls.filter(c=>c[0]==='close').length,1);
 assert.equal(reader.writeBytes,undefined);assert.equal(file.delete,undefined);
});
test('external deletion immediately reports unavailable; no private fallback is created',()=>{
 const f=setup(),file=new f.out.SharedMediaFile('content://media/external/video/media/2');assert(file.exists);f.remove();assert(!file.exists);assert.equal(file.size,0);assert.deepEqual(f.calls,[]);
});
test('old native clients cannot silently use an unsupported content reader',()=>{
 const f=setup();f.native.singleCopy=false;assert.throws(()=>new f.out.SharedMediaFile('content://media/1').open(),/Update/);
});
