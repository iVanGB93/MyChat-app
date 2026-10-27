const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol');
function setup(t,{shortRead=false,failWrite=false,failCopy=false,nativeStagedHash,nativeFileHash,nativeBatch,nativeLeaf,nativeSourceHashes,nativeEncrypt,bytes=2*65536+17}={}){
 const f=fixture(bytes),data=new Map(),directories=new Set(),calls={read:0,write:0,open:0,close:0,copy:0},buffers=[];
 const path=args=>args.map(v=>typeof v==='string'?v:v.uri).join('/');
 class Directory{
  constructor(...args){this.uri=path(args);}get parentDirectory(){return new Directory(this.uri.slice(0,this.uri.lastIndexOf('/')));}list(){return [...directories].filter(p=>p.startsWith(this.uri+'/')&&!p.slice(this.uri.length+1).includes('/')).map(p=>new Directory(p));}get exists(){return directories.has(this.uri)||[...data.keys()].some(p=>p.startsWith(this.uri+'/'));}create(){directories.add(this.uri);}
  delete(){for(const key of data.keys())if(key.startsWith(this.uri+'/'))data.delete(key);directories.delete(this.uri);}
 }
 class File{
  constructor(...args){this.uri=path(args);}get exists(){return data.has(this.uri);}get size(){return data.get(this.uri)?.length??0;}
  create(){data.set(this.uri,new Uint8Array());}delete(){data.delete(this.uri);}
  write(value){data.set(this.uri,typeof value==='string'?Buffer.from(value):Uint8Array.from(value));}
  textSync(){return Buffer.from(data.get(this.uri)).toString();}
  move(target){data.set(target.uri,data.get(this.uri));data.delete(this.uri);this.uri=target.uri;}
  copy(target){calls.copy++;if(!data.has(this.uri))throw Error('Missing source');data.set(target.uri,Uint8Array.from(data.get(this.uri)));if(failCopy)throw Error('copy failed');}
  open(){calls.open++;const file=this;return {offset:0,
   readBytes(n){calls.read++;const result=data.get(file.uri).slice(this.offset,this.offset+n-(shortRead?1:0));this.offset+=result.length;buffers.push(result);return result;},
   writeBytes(bytes){calls.write++;buffers.push(bytes);if(failWrite&&file.uri.endsWith('/ciphertext'))throw Error('disk full');const old=data.get(file.uri),next=new Uint8Array(Math.max(old.length,this.offset+bytes.length));next.set(old);next.set(bytes,this.offset);this.offset+=bytes.length;data.set(file.uri,next);},
   close(){calls.close++;}};
  }
 }
 const identity=f.ids[0],localAccount={status:()=>({state:'unlocked',account:identity.record.account}),publicRecord:()=>identity.record,callDevice:()=>identity.device.id,
  signAttachment:fields=>a.signAttachmentManifest(fields,identity.signingSeed,identity.record,now)};
 const dependency=name=>name==='./sharedMediaFile'&&nativeSourceHashes?{...load('sharedMediaFile'),sharedMediaNative:{hashBlocks:(...args)=>nativeSourceHashes(...args,data)}}:load(name.slice(2));
 let randomCalls=0;const out={};new Function('require','exports','Date',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentFiles.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='expo-file-system'?{File,Directory,Paths:{document:'own'}}:name.includes('axonic-nearby')?{default:{...(nativeEncrypt?{attachmentEncryptBlock:nativeEncrypt}:{}),...(nativeLeaf?{attachmentSha256:nativeLeaf}:{}),identityRandomBytes:async()=>Buffer.from(randomCalls++%2===0?f.key:f.signer).toString('hex'),...(nativeStagedHash?{attachmentStagedFileSha256:(...args)=>nativeStagedHash(...args,data)}:{}),...(nativeBatch?{attachmentPrepareStreamBlock:(...args)=>nativeBatch(...args,data)}:{}),...(nativeFileHash?{attachmentFileSha256:(...args)=>nativeFileHash(...args,data)}:{})}}:name==='./localAccount'?{localAccount}:name.startsWith('./')?dependency(name):require(name),out,{now:()=>now});
 const input={id:f.manifest.id,name:'test.png',mime:'image/png',recipient:f.ids[1].record,current:()=>true};
 out.rootAttachmentSource(identity.record.account,input.id).write(f.plain);
 return {...f,out,input,data,calls,buffers,localAccount};
}
for(const mode of ['ok','bad-count','bad-checksum','bad-size','locked'])test(`native source hashes preserve validation: ${mode}`,async t=>{
 let calls=0;
 const f=setup(t,{bytes:3_000_017,nativeSourceHashes:async(uri,bytes,data)=>{
  calls++;const value=data.get(uri),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  const result={bytes,checksum:hash(value),blocks:[hash(value.slice(0,3_000_000)),hash(value.slice(3_000_000))]};
  if(mode==='bad-count')result.blocks.pop();if(mode==='bad-checksum')result.checksum='0'.repeat(64);if(mode==='bad-size')result.bytes--;if(mode==='locked')f.localAccount.status=()=>({state:'locked'});
  return result;
 }});
 const d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest),job={owner,digest,descriptor:d};
 const invoke=()=>f.out.readRootAttachmentChunks(job,0,1);
 if(mode==='ok'){
  const [chunk]=await invoke();assert(a.verifyAttachmentChunk(d.manifest,chunk));assert.deepEqual(Buffer.from(a.decryptAttachmentChunk(d.manifest,chunk,f.key)),Buffer.from(f.plain.slice(0,3_000_000)));
 }else{await assert.rejects(invoke());assert(![...f.data.keys()].some(p=>p.endsWith('0.block')));}
 assert.equal(calls,1);
});

test('preparation signs content without producing ciphertext; blocks are encrypted on first read',async t=>{
 const f=setup(t),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest);
 assert.equal(d.manifest.version,4);assert.equal(f.calls.read,3);assert.equal(f.calls.write,0,'no ciphertext during preparation');assert(![...f.data.keys()].some(p=>p.endsWith('.block')));assert.equal(f.calls.open,f.calls.close);
 assert(f.buffers.every(b=>b.every(v=>v===0)),'temporary batch buffers are cleared');
 assert.equal(d.checksum,crypto.createHash('sha256').update(f.plain).digest('hex'));
 assert.deepEqual(Buffer.from(f.data.get(f.out.rootAttachmentFile(owner,digest).uri)),Buffer.from(f.plain));
 for(let i=0;i<Math.ceil(f.plain.length/3_000_000);i++){
  const chunk=await f.out.readRootAttachmentChunk({owner,digest,descriptor:d},i);
  assert.equal(chunk.ciphertext,a.encryptAttachmentChunk(d.manifest,i,f.plain.slice(i*3_000_000,(i+1)*3_000_000),f.key));
  assert.equal(a.verifyAttachmentChunk(d.manifest,chunk),true);
 }
});

test('batch reads use one file handle for 512 KiB and preserve tail, indexes and proofs',async t=>{
 const f=setup(t,{bytes:3_000_017}),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest),job={owner,digest,descriptor:d};
 const before={...f.calls};
 for(const [start,count] of [[0,1],[1,1],[0,1]]){
  const chunks=await f.out.readRootAttachmentChunks(job,start,count);assert.equal(chunks.length,count);
  for(const c of chunks){assert(a.verifyAttachmentChunk(d.manifest,c));assert.equal(crypto.createHash('sha256').update(a.decryptAttachmentChunk(d.manifest,c,f.key)).digest('hex'),crypto.createHash('sha256').update(f.plain.slice(c.index*3_000_000,(c.index+1)*3_000_000)).digest('hex'));}
 }
 assert.equal(f.calls.open,f.calls.close);
 for(const [index,count] of [[-1,1],[0,2],[2,1],[0,0]])await assert.rejects(f.out.readRootAttachmentChunks(job,index,count),/range/);
 const file=[...f.data.keys()].find(p=>p.includes('/files/')&&p.endsWith('1.block'));f.data.set(file,f.data.get(file).slice(0,-1));
 await assert.rejects(f.out.readRootAttachmentChunks(job,1,1),/truncated/);assert.equal(f.calls.open,f.calls.close);
});

test('shared group preparation encrypts once and resumes independent recipient grants',async t=>{
 let hashes=0;
 const f=setup(t,{nativeStagedHash:async(owner,id,bytes,data)=>{
  hashes++;return crypto.createHash('sha256').update(data.get(`own/axonic-own-attachments-v1/${owner.slice(9)}/staging/${id}/content`)).digest('hex');
 }}),owner=f.ids[0].record.account;
 const shared={id:'ab'.repeat(32),count:2,slot:0};
 const first=await f.out.prepareRootAttachment({...f.input,shared});const reads=f.calls.read,writes=f.calls.write,copies=f.calls.copy;
 const next={...f.input,id:'cd'.repeat(32),recipient:f.ids[2].record,shared:{...shared,slot:1}};
 f.out.rootAttachmentSource(owner,next.id).write(f.plain);
 const second=await f.out.prepareRootAttachment(next);
 assert.equal(f.calls.read,reads);assert.equal(f.calls.write,writes,'no repeated chunk encryption/writes');
 assert.equal(first.key,second.key);assert.equal(first.checksum,second.checksum);assert.notEqual(a.attachmentDigest(first.manifest),a.attachmentDigest(second.manifest));
 assert.equal(a.attachmentContentDigest(first.manifest),a.attachmentContentDigest(second.manifest));
 assert.deepEqual(await f.out.prepareRootAttachment(next),second);
 assert.equal(f.calls.copy,copies,'no per-recipient payload copies');assert.equal(f.out.rootAttachmentFile(owner,a.attachmentDigest(first.manifest)).uri,f.out.rootAttachmentFile(owner,a.attachmentDigest(second.manifest)).uri);
 assert.equal(hashes,1,'reuse the prepared checksum across recipient grants and retries');
 assert.equal(second.manifest.version,4);
 for(let i=0;i<Math.ceil(f.plain.length/3_000_000);i++){
  const c=await f.out.readRootAttachmentChunk({owner,digest:a.attachmentDigest(second.manifest),descriptor:second},i);
  assert.equal(crypto.createHash('sha256').update(a.decryptAttachmentChunk(second.manifest,c,f.key)).digest('hex'),crypto.createHash('sha256').update(f.plain.slice(i*3_000_000,(i+1)*3_000_000)).digest('hex'));
 }
 f.out.removeRootAttachmentContent(owner,a.attachmentDigest(first.manifest));assert(f.out.rootAttachmentFile(owner,a.attachmentDigest(second.manifest)).exists,'another recipient retains the payload');
 f.out.removeRootAttachmentSource(owner,shared.id);f.out.removeRootAttachmentContent(owner,a.attachmentDigest(second.manifest));assert(![...f.data.keys()].some(p=>p.includes('/shared/')),'last reference releases payload');
});
test('short source reads and write failures never publish prepared attachment files',async t=>{
 for(const options of [{shortRead:true},{failCopy:true}]){
  const f=setup(t,options);await assert.rejects(f.out.prepareRootAttachment(f.input),/source changed|disk full|copy failed/);
  assert.equal(f.calls.open,f.calls.close);assert(f.buffers.every(b=>b.every(v=>v===0)));
  assert(![...f.data.keys()].some(p=>p.includes('/files/')||p.endsWith('/descriptor.json')));
 }
});

for(const mode of ['ok','error','malformed','locked'])test(`native preparation checksum keeps retry/publication boundaries: ${mode}`,async t=>{
 let active=true,seen=0;
 const f=setup(t,{nativeStagedHash:async(owner,id,bytes,data)=>{
  seen++;const file=data.get(`own/axonic-own-attachments-v1/${owner.slice(9)}/staging/${id}/content`);
  assert.equal(file.length,bytes);
  if(mode==='error')throw Error('hash failed');
  if(mode==='locked')active=false;
  return mode==='malformed'?'invalid':crypto.createHash('sha256').update(file).digest('hex');
 }});f.input.current=()=>active;
 if(mode==='ok'){
  const d=await f.out.prepareRootAttachment(f.input);
  assert.equal(d.checksum,crypto.createHash('sha256').update(f.plain).digest('hex'));
  const owner=f.ids[0].record.account,chunk=await f.out.readRootAttachmentChunk({owner,digest:a.attachmentDigest(d.manifest),descriptor:d},0);
  assert(a.verifyAttachmentChunk(d.manifest,chunk));
 }else{
  await assert.rejects(f.out.prepareRootAttachment(f.input));
  assert(![...f.data.keys()].some(p=>p.includes('/files/')||p.endsWith('/descriptor.json')||p.endsWith('/content')||p.endsWith('/ciphertext')));
 }
 assert.equal(seen,1);assert(f.out.rootAttachmentSource(f.ids[0].record.account,f.input.id).exists,'source retained for retry');assert.equal(f.calls.open,f.calls.close);
});
test('locking during a preparation yield closes handles and removes unpublished bytes',async t=>{
 const f=setup(t);let active=true;f.input.current=()=>active;setTimeout(()=>active=false,0);
 await assert.rejects(f.out.prepareRootAttachment(f.input),/Unlock/);assert.equal(f.calls.open,f.calls.close);
 assert(![...f.data.keys()].some(p=>p.includes('/files/')||p.endsWith('/descriptor.json')));
});

for(const mode of ['native','fallback','wrong','error','locked'])test(`full-file read-back verification preserves publication checks: ${mode}`,async t=>{
 let current=true,seen=0;
 const nativeFileHash=mode==='fallback'?undefined:async(owner,digest,completed,bytes,data)=>{
  seen++;assert.equal(completed,false);const path=`own/axonic-own-attachments-v1/${owner.slice(9)}/files/${digest}/partial`;
  assert.equal(data.get(path).length,bytes);
  if(mode==='error')throw Error('native failure');
  if(mode==='locked')current=false;
  return mode==='wrong'?'0'.repeat(64):crypto.createHash('sha256').update(data.get(path)).digest('hex');
 };
 const f=setup(t,{nativeFileHash}),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest);
 const final=f.out.rootAttachmentFile(owner,digest).uri,partial=final.replace(/content$/,'partial');
 f.data.set(partial,f.data.get(final));f.data.delete(final);
 const verify=f.out.commitRootAttachmentFile({owner,digest,descriptor:d},()=>current);
 if(['wrong','error','locked'].includes(mode)){await assert.rejects(verify);assert.equal(f.data.has(final),false);assert.equal(f.data.has(partial),true);}
 else{await verify;assert.deepEqual(Buffer.from(f.data.get(final)),Buffer.from(f.plain));assert.equal(f.data.has(partial),false);}
 assert.equal(seen,mode==='fallback'?0:1);assert.equal(f.calls.open,f.calls.close);
});


test('group staging copies a source once and survives removing the first recipient before preparation',async t=>{
 const f=setup(t),owner=f.ids[0].record.account,shared={id:'ef'.repeat(32),count:2,slot:0},first='11'.repeat(32),second='22'.repeat(32);
 f.data.set('external',f.plain);f.out.stageRootAttachmentSource(owner,first,'external',shared.id);f.out.stageRootAttachmentSource(owner,second,'external',shared.id);
 assert.equal(f.calls.copy,1);assert.equal(f.out.rootAttachmentSource(owner,first).uri,f.out.rootAttachmentSource(owner,second).uri);
 f.out.removeRootAttachmentSource(owner,first);
 const descriptor=await f.out.prepareRootAttachment({...f.input,id:second,shared:{...shared,slot:1}});
 assert.equal(descriptor.checksum,crypto.createHash('sha256').update(f.plain).digest('hex'));
 const digest=a.attachmentDigest(descriptor.manifest);f.out.removeRootAttachmentContent(owner,digest);
 assert([...f.data.keys()].some(p=>p.includes('/shared/')),'pending selections pin the shared preparation');
 f.out.removeRootAttachmentSource(owner,second);f.out.removeRootAttachmentSource(owner,shared.id);
 assert(![...f.data.keys()].some(p=>p.includes('/shared/')),'last selection and grant release the data');
});

test('shared file references reject traversal instead of reading another location',t=>{
 const f=setup(t),owner=f.ids[0].record.account,digest='99'.repeat(32);
 f.data.set(`own/axonic-own-attachments-v1/${owner.slice(9)}/files/${digest}/shared.json`,Buffer.from(JSON.stringify({id:'../other'})));
 assert.throws(()=>f.out.rootAttachmentFile(owner,digest),/Invalid shared/);
});

test('native eager encryption is never invoked, including successful direct preparation',async t=>{
 let calls=0;const f=setup(t,{nativeStagedHash:async(owner,id,bytes,data)=>crypto.createHash('sha256').update(data.get('own/axonic-own-attachments-v1/'+owner.slice(9)+'/staging/'+id+'/content')).digest('hex'),
 nativeBatch:async()=>{calls++;throw Error('Eager encryption forbidden');}});
 const d=await f.out.prepareRootAttachment(f.input);assert.equal(calls,0);assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);
 assert(a.verifyAttachmentManifest(d.manifest,f.ids[0].record,now));
 assert(![...f.data.keys()].some(p=>p.endsWith('.block')||p.endsWith('/ciphertext')));
});
test('lazy block retry is byte identical, concurrent requests coalesce, and corrupted cache fails closed',async t=>{
 const f=setup(t),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,job={owner,digest:a.attachmentDigest(d.manifest),descriptor:d};
 const [a1,a2]=await Promise.all([f.out.readRootAttachmentChunk(job,0),f.out.readRootAttachmentChunk(job,0)]);
 assert.deepEqual(a1,a2);const reads=f.calls.read;
 assert.deepEqual(await f.out.readRootAttachmentChunk(job,0),a1);assert.equal(f.calls.read,reads+1);
 const block=[...f.data.keys()].find(p=>p.endsWith('0.block'));f.data.get(block)[0]^=1;
 await assert.rejects(f.out.readRootAttachmentChunk(job,0),/cached block changed/);
});
test('native leaf hashing preserves exact signed blocks and rejects cache tampering',async t=>{
 let hashes=0;
 const f=setup(t,{nativeLeaf:value=>{hashes++;return crypto.createHash('sha256').update(value,'utf8').digest('hex');}});
 const d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,job={owner,digest:a.attachmentDigest(d.manifest),descriptor:d};
 const chunk=await f.out.readRootAttachmentChunk(job,0);
 assert.equal(hashes,1);
 assert.deepEqual(chunk,a.signAttachmentBlock(d.manifest,0,a.encryptAttachmentChunk(d.manifest,0,f.plain,f.key),f.signer));
 assert.deepEqual(await f.out.readRootAttachmentChunk(job,0),chunk);assert.equal(hashes,2);
 const block=[...f.data.keys()].find(p=>p.endsWith('0.block'));f.data.get(block)[0]^=1;
 await assert.rejects(f.out.readRootAttachmentChunk(job,0),/cached block changed/);assert.equal(hashes,3);
});

test('invalid native leaf result never publishes a cached block',async t=>{
 const f=setup(t,{nativeLeaf:()=> 'not-a-digest'}),d=await f.out.prepareRootAttachment(f.input);
 await assert.rejects(f.out.readRootAttachmentChunk({owner:f.ids[0].record.account,digest:a.attachmentDigest(d.manifest),descriptor:d},0),/Invalid attachment hash/);
 assert(![...f.data.keys()].some(p=>p.endsWith('.block')));
});

test('changed source never encrypts with the committed key',async t=>{
 const f=setup(t),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,job={owner,digest:a.attachmentDigest(d.manifest),descriptor:d};
 f.data.get(f.out.rootAttachmentFile(owner,job.digest).uri)[0]^=1;
 await assert.rejects(f.out.readRootAttachmentChunk(job,0),/source changed/);
 assert(![...f.data.keys()].some(p=>p.endsWith('.block')));
});

for(const size of [1_000_000,5_000_000,10_000_000])test('mobile direct preparation creates no relay ciphertext for '+size+' bytes',async t=>{
 const f=setup(t,{bytes:size,nativeStagedHash:async(owner,id,bytes,data)=>crypto.createHash('sha256').update(data.get('own/axonic-own-attachments-v1/'+owner.slice(9)+'/staging/'+id+'/content')).digest('hex'),
 nativeBatch:async()=>{throw Error('Direct path must not prepare ciphertext');}});
 const d=await f.out.prepareRootAttachment(f.input);
 assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);
 assert(![...f.data.keys()].some(p=>p.endsWith('.block')||p.endsWith('.proof')||p.endsWith('/ciphertext')));
 assert.equal(d.manifest.bytes,size);assert.equal(d.manifest.version,4);
 assert(a.verifyAttachmentManifest(d.manifest,f.ids[0].record,now));
 assert.equal(crypto.createHash('sha256').update(f.data.get(f.out.rootAttachmentFile(f.ids[0].record.account,a.attachmentDigest(d.manifest)).uri)).digest('hex'),d.checksum);
});

for(const mode of ['ok','bad-length','reject','locked'])test(`native block preparation preserves commit gates: ${mode}`,async t=>{
 let calls=0,expected;
 const f=setup(t,{nativeEncrypt:async(plain,key,hash,aad)=>{
  calls++;assert.equal(hash,crypto.createHash('sha256').update(plain).digest('hex'));
  assert.equal(aad,a.attachmentChunkAAD(expected.manifest,0));
  if(mode==='reject')throw Error('native failed');
  if(mode==='locked')f.localAccount.status=()=>({state:'locked'});
  return mode==='bad-length'?new Uint8Array(1):a.encryptAttachmentChunkBytes(expected.manifest,0,plain,Buffer.from(key,'hex'));
 }});
 expected=await f.out.prepareRootAttachment(f.input);
 const job={owner:expected.manifest.sender,digest:a.attachmentDigest(expected.manifest),descriptor:expected};
 if(mode==='ok'){
  const [chunk]=await f.out.readRootAttachmentChunks(job,0,1);
  assert.deepEqual(Buffer.from(a.decryptAttachmentChunk(expected.manifest,chunk,Buffer.from(expected.key,'hex'))),Buffer.from(f.plain));
 }else{
  await assert.rejects(f.out.readRootAttachmentChunks(job,0,1));
  assert.equal([...f.data.keys()].filter(k=>k.endsWith('/0.block')||k.endsWith('/0.proof')).length,0);
 }
 assert.equal(calls,1);
});
