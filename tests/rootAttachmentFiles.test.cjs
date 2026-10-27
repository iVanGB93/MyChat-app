const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load,fixture}=require('./helpers/attachment.cjs');
function setup(size=9001,options={}){
 const data=new Map(),path=args=>args.map(a=>typeof a==='string'?a:a.uri).join('/');
 class Directory{constructor(...args){this.uri=path(args);}create(){}}
 const io={opens:0,writes:0,closes:0},writtenBuffers=[];
 class File{constructor(...args){this.uri=path(args);}get exists(){return data.has(this.uri);}get size(){return data.get(this.uri)?.length??0;}create(){data.set(this.uri,new Uint8Array(0));}delete(){data.delete(this.uri);}write(bytes){data.set(this.uri,typeof bytes==='string'?Buffer.from(bytes):Uint8Array.from(bytes));}textSync(){return Buffer.from(data.get(this.uri)).toString();}move(to){data.set(to.uri,data.get(this.uri));data.delete(this.uri);this.uri=to.uri;}open(){io.opens++;const file=this;return {offset:0,readBytes(n){const bytes=data.get(file.uri).slice(this.offset,this.offset+n);this.offset+=bytes.length;return bytes;},writeBytes(bytes){writtenBuffers.push(bytes);io.writes++;const old=data.get(file.uri),next=new Uint8Array(Math.max(old.length,this.offset+bytes.length));next.set(old);next.set(bytes,this.offset);data.set(file.uri,next);this.offset+=bytes.length;},close(){io.closes++;}};}}
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentFiles.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='expo-file-system'?{File,Directory,Paths:{document:'own'}}:name.includes('axonic-nearby')?{default:options.native??{}}:name==='./sharedMediaFile'&&options.media?options.media:name==='./localAccount'?{}:name.startsWith('./')?load(name.slice(2)):require(name),out);
 const f=fixture(size),job={owner:f.manifest.recipient,digest:load('attachmentProtocol').attachmentDigest(f.manifest),descriptor:{manifest:f.manifest,checksum:crypto.createHash('sha256').update(f.plain).digest('hex')}};
 const final=out.rootAttachmentFile(job.owner,job.digest),partial=new File(final.uri.replace(/content$/,'partial'));
 return {...f,out,job,final,partial,data,io,writtenBuffers};
}
test('download publication requires full size and readback checksum',async()=>{
 const f=setup();f.partial.write(f.plain);await f.out.commitRootAttachmentFile(f.job,()=>true);assert(f.final.exists);assert(!f.partial.exists);
 await f.out.commitRootAttachmentFile(f.job,()=>true);assert(f.final.exists);
});

test('verified blocks use one file operation per block and remain replayable',async()=>{
 const f=setup(6_000_001),parts=Array.from({length:3},(_,i)=>f.plain.slice(i*3_000_000,(i+1)*3_000_000));
 for(let i=0;i<parts.length;i++)await f.out.writeRootAttachmentChunks(f.job,i,[parts[i]],()=>true);assert.deepEqual(f.io,{opens:3,writes:3,closes:3});
 assert.deepEqual(Buffer.from(f.data.get(f.partial.uri)),Buffer.from(f.plain));
 parts.forEach((part,i)=>assert.strictEqual(f.writtenBuffers[i],part,'write must borrow the verified block without copying'));
 assert.deepEqual(Buffer.concat(parts.map(p=>Buffer.from(p))),Buffer.from(f.plain),'caller buffers remain intact');
 for(let i=1;i<parts.length;i++)await f.out.writeRootAttachmentChunks(f.job,i,[parts[i]],()=>true);
 assert.deepEqual(Buffer.from(f.data.get(f.partial.uri)),Buffer.from(f.plain));
 assert(parts.some(p=>p.some(b=>b!==0)),'adapter must not erase caller-owned input');
 await f.out.commitRootAttachmentFile(f.job,()=>true);assert.equal(f.final.size,f.plain.length);
});
test('batch writer rejects malformed ranges and lock before changing existing bytes',async()=>{
 const f=setup();f.partial.write(f.plain);const saved=Buffer.from(f.plain);
 for(const [index,parts] of [[-1,[new Uint8Array(4096)]],[0,[]],[0,[new Uint8Array(1)]],[3,[new Uint8Array(4096)]],[0,Array(33).fill(new Uint8Array(4096))]])await assert.rejects(f.out.writeRootAttachmentChunks(f.job,index,parts,()=>true),/Invalid/);
 await assert.rejects(f.out.writeRootAttachmentChunks(f.job,0,[f.plain.slice(0,4096)],()=>false),/Unlock/);
 assert.deepEqual(Buffer.from(f.data.get(f.partial.uri)),saved);assert.equal(f.io.writes,0);
});
test('batch writer detects missing prefixes instead of creating holes',async()=>{
 const f=setup(6_000_001);await assert.rejects(f.out.writeRootAttachmentChunks(f.job,1,[f.plain.slice(3_000_000,6_000_000)],()=>true),/restart/);assert(!f.partial.exists);
 await f.out.writeRootAttachmentChunk(f.job,0,f.plain.slice(0,3_000_000),()=>true);
 await f.out.writeRootAttachmentChunks(f.job,1,[f.plain.slice(3_000_000,6_000_000)],()=>true);
 await f.out.writeRootAttachmentChunks(f.job,2,[f.plain.slice(6_000_000)],()=>true);
 await f.out.commitRootAttachmentFile(f.job,()=>true);assert.equal(f.final.size,f.plain.length);
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

test('gallery export records its location without replacing the seekable chat file',()=>{
 const f=setup();f.final.write(f.plain);f.out.linkRootAttachmentExport(f.job.owner,f.job.digest,'content://media/external/images/media/1');
 assert.equal(f.out.rootAttachmentExportLink(f.job.owner,f.job.digest),'content://media/external/images/media/1');
 assert.equal(f.out.rootAttachmentFile(f.job.owner,f.job.digest).uri,f.final.uri);assert.equal(f.final.size,f.plain.length);
 assert.throws(()=>f.out.linkRootAttachmentExport(f.job.owner,f.job.digest,'file:///other'),/Invalid/);
});

test('direct path resolution preserves private and shared paths without caching links or existence',()=>{
 const f=setup(),owner=f.job.owner,digest=f.job.digest,base=`own/axonic-own-attachments-v1/${owner.slice(9)}`,link=`${base}/files/${digest}/shared.json`,shared='ab'.repeat(32);
 assert.equal(f.out.rootAttachmentFile(owner,digest).uri,`${base}/files/${digest}/content`);
 f.data.set(link,Buffer.from(JSON.stringify({id:shared})));
 const file=f.out.rootAttachmentFile(owner,digest);assert.equal(file.uri,`${base}/shared/${shared}/content`);assert.equal(file.exists,false);
 f.data.set(file.uri,Buffer.from('synthetic'));assert.equal(f.out.rootAttachmentFile(owner,digest).exists,true);
 f.data.delete(file.uri);assert.equal(f.out.rootAttachmentFile(owner,digest).exists,false);
 f.data.set(link,Buffer.from(JSON.stringify({id:'cd'.repeat(32)})));assert.equal(f.out.rootAttachmentFile(owner,digest).uri,`${base}/shared/${'cd'.repeat(32)}/content`);
 f.data.delete(link);assert.equal(f.out.rootAttachmentFile(owner,digest).uri,`${base}/files/${digest}/content`);
 const other=f.manifest.sender;assert.notEqual(f.out.rootAttachmentFile(other,digest).uri,f.out.rootAttachmentFile(owner,digest).uri);
});

test('optimized file lookup still rejects invalid accounts, digests and shared references',()=>{
 const f=setup(),owner=f.job.owner,digest=f.job.digest,link=`own/axonic-own-attachments-v1/${owner.slice(9)}/files/${digest}/shared.json`;
 for(const invalid of ['../other','',digest.toUpperCase(),digest+'/content'])assert.throws(()=>f.out.rootAttachmentFile(owner,invalid),/Invalid attachment path/);
 for(const invalid of ['other',owner+'/../other'])assert.throws(()=>f.out.rootAttachmentFile(invalid,digest),/Invalid attachment path/);
 for(const value of [{id:'../other'},{id:'ab'.repeat(32),extra:true},{id:4},{},null]){
  f.data.set(link,Buffer.from(JSON.stringify(value)));assert.throws(()=>f.out.rootAttachmentFile(owner,digest));
 }
 f.data.set(link,Buffer.from('broken json'));assert.throws(()=>f.out.rootAttachmentFile(owner,digest));
});

test('canonical media reference wins over a crash-leftover private copy, even if shared media is missing',()=>{
 const f=setup(),owner=f.job.owner,digest=f.job.digest,uri='content://media/external_primary/images/media/3';
 f.final.write(f.plain);f.data.set(f.final.uri.replace(/content$/,'media.json'),Buffer.from(JSON.stringify({uri})));
 assert.equal(f.out.rootAttachmentFile(owner,digest).uri,uri);
 assert.equal(f.out.rootAttachmentFile(owner,digest).exists,false,'no fallback to private bytes after external deletion');
 assert.equal(f.out.rootAttachmentExportLink(owner,digest),uri);
});
test('all group recipient references resolve the same canonical media file',()=>{
 const f=setup(),owner=f.job.owner,other='bc'.repeat(32),shared='de'.repeat(32),base=`own/axonic-own-attachments-v1/${owner.slice(9)}`;
 for(const id of [f.job.digest,other])f.data.set(`${base}/files/${id}/shared.json`,Buffer.from(JSON.stringify({id:shared})));
 const uri='content://media/external_primary/video/media/4';f.data.set(`${base}/shared/${shared}/media.json`,Buffer.from(JSON.stringify({uri})));
 for(const id of [f.job.digest,other])assert.equal(f.out.rootAttachmentFile(owner,id).uri,uri);
});
test('canonical reference rejects a remote URL instead of opening it',()=>{
 const f=setup();f.data.set(f.final.uri.replace(/content$/,'media.json'),Buffer.from(JSON.stringify({uri:'https://example.invalid/media'})));
 assert.throws(()=>f.out.rootAttachmentFile(f.job.owner,f.job.digest),/Invalid media/);
});

for(const mode of ['adopted','unchanged','deleted','wrong-size'])test('hash re-resolves only a verified export handoff: '+mode,async()=>{
 let f,sharedReads=0;const failure=Error('private file unavailable');
 class SharedMediaFile{constructor(uri){this.uri=uri;}get exists(){return mode!=='deleted';}get size(){return mode==='wrong-size'?2:9001;}}
 const media={SharedMediaFile,isSharedMediaUri:uri=>uri.startsWith('content://media/'),sharedMediaNative:{sha256:async()=>{sharedReads++;return crypto.createHash('sha256').update(f.plain).digest('hex');}}};
 f=setup(9001,{media,native:{attachmentFileSha256:async()=>{
  if(mode!=='unchanged'){f.data.set(f.final.uri.replace(/content$/,'media.json'),Buffer.from(JSON.stringify({uri:'content://media/external/file/1'})));f.data.delete(f.final.uri);}
  throw failure;
 }}});f.final.write(f.plain);
 const hash=f.out.hashRootAttachmentFile(f.job.owner,f.job.digest,9001);
 if(mode==='adopted')assert.equal(await hash,f.job.descriptor.checksum);
 else await assert.rejects(hash,mode==='unchanged'?e=>e===failure:/removed or changed/);
 assert.equal(sharedReads,mode==='adopted'?1:0);
});
