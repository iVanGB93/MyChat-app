const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load,fixture}=require('./helpers/attachment.cjs');
function setup(){
 const data=new Map(),path=args=>args.map(a=>typeof a==='string'?a:a.uri).join('/');
 class Directory{constructor(...args){this.uri=path(args);}}
 class File{constructor(...args){this.uri=path(args);}get exists(){return data.has(this.uri);}get size(){return data.get(this.uri)?.length??0;}delete(){data.delete(this.uri);}write(bytes){data.set(this.uri,Uint8Array.from(bytes));}move(to){data.set(to.uri,data.get(this.uri));data.delete(this.uri);this.uri=to.uri;}open(){const file=this;return {offset:0,readBytes(n){const bytes=data.get(file.uri).slice(this.offset,this.offset+n);this.offset+=bytes.length;return bytes;},close(){}};}}
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentFiles.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='expo-file-system'?{File,Directory,Paths:{document:'own'}}:name.includes('axonic-nearby')?{default:{}}:name==='./localAccount'?{}:name.startsWith('./')?load(name.slice(2)):require(name),out);
 const f=fixture(),job={owner:f.manifest.recipient,digest:load('attachmentProtocol').attachmentDigest(f.manifest),descriptor:{manifest:f.manifest,checksum:crypto.createHash('sha256').update(f.plain).digest('hex')}};
 const final=out.rootAttachmentFile(job.owner,job.digest),partial=new File(final.uri.replace(/content$/,'partial'));
 return {...f,out,job,final,partial};
}
test('download publication requires full size and readback checksum',async()=>{
 const f=setup();f.partial.write(f.plain);await f.out.commitRootAttachmentFile(f.job,()=>true);assert(f.final.exists);assert(!f.partial.exists);
 await f.out.commitRootAttachmentFile(f.job,()=>true);assert(f.final.exists);
});
test('wrong-size published file is removed so restart can recover instead of looping forever',async()=>{
 const f=setup();f.final.write([1]);await assert.rejects(f.out.commitRootAttachmentFile(f.job,()=>true),/size changed/);assert(!f.final.exists);
 f.partial.write(f.plain);await f.out.commitRootAttachmentFile(f.job,()=>true);assert.equal(f.final.size,f.plain.length);
});
test('wrong-checksum file cannot be published',async()=>{
 const f=setup();f.partial.write(new Uint8Array(f.plain.length));await assert.rejects(f.out.commitRootAttachmentFile(f.job,()=>true),/checksum failed/);assert(!f.final.exists);
});
test('lock prevents even damaged-file cleanup',async()=>{
 const f=setup();f.final.write([1]);await assert.rejects(f.out.commitRootAttachmentFile(f.job,()=>false),/Unlock/);assert(f.final.exists);
});
