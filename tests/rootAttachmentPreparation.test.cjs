const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol');
function setup(t,{shortRead=false,failWrite=false,failCopy=false,nativeStagedHash,nativeFileHash,nativeBatch,bytes=2*65536+17}={}){
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
 const identity=f.ids[0],localAccount={status:()=>({account:identity.record.account}),publicRecord:()=>identity.record,callDevice:()=>identity.device.id,
  signAttachment:fields=>a.signAttachmentManifest(fields,identity.signingSeed,identity.record,now)};
 const out={};new Function('require','exports','Date',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentFiles.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='expo-file-system'?{File,Directory,Paths:{document:'own'}}:name.includes('axonic-nearby')?{default:{identityRandomBytes:async()=>Buffer.from(f.key).toString('hex'),...(nativeStagedHash?{attachmentStagedFileSha256:(...args)=>nativeStagedHash(...args,data)}:{}),...(nativeBatch?{attachmentPrepareBatch:(...args)=>nativeBatch(...args,data)}:{}),...(nativeFileHash?{attachmentFileSha256:(...args)=>nativeFileHash(...args,data)}:{})}}:name==='./localAccount'?{localAccount}:name.startsWith('./')?load(name.slice(2)):require(name),out,{now:()=>now});
 const input={id:f.manifest.id,name:'test.png',mime:'image/png',recipient:f.ids[1].record,current:()=>true};
 out.rootAttachmentSource(identity.record.account,input.id).write(f.plain);
 return {...f,out,input,data,calls,buffers};
}
test('batched preparation preserves each encrypted chunk, checksum and proof with bounded native calls',async t=>{
 const f=setup(t),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest);
 assert.equal(f.calls.read,3);assert.equal(f.calls.write,3,'one encrypted write per 64 KiB batch; plaintext is copied natively');assert.equal(f.calls.open,f.calls.close);
 assert(f.buffers.every(b=>b.every(v=>v===0)),'temporary batch buffers are cleared');
 assert.equal(d.checksum,crypto.createHash('sha256').update(f.plain).digest('hex'));
 assert.deepEqual(Buffer.from(f.data.get(f.out.rootAttachmentFile(owner,digest).uri)),Buffer.from(f.plain));
 for(let i=0;i<Math.ceil(f.plain.length/4096);i++){
  const chunk=await f.out.readRootAttachmentChunk({owner,digest,descriptor:d},i);
  assert.equal(chunk.ciphertext,a.encryptAttachmentChunk(d.manifest,i,f.plain.slice(i*4096,(i+1)*4096),f.key));
  assert.equal(a.verifyAttachmentChunk(d.manifest,chunk),true);
 }
});

test('batch reads use one file handle for 512 KiB and preserve tail, indexes and proofs',async t=>{
 const f=setup(t,{bytes:512*1024+17}),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest),job={owner,digest,descriptor:d};
 const before={...f.calls};
 for(const [start,count] of [[0,128],[128,1],[7,3]]){
  const chunks=await f.out.readRootAttachmentChunks(job,start,count);assert.equal(chunks.length,count);
  for(const c of chunks){assert(a.verifyAttachmentChunk(d.manifest,c));assert.deepEqual(a.decryptAttachmentChunk(d.manifest,c,f.key),f.plain.slice(c.index*4096,(c.index+1)*4096));}
 }
 assert.equal(f.calls.read-before.read,3);assert.equal(f.calls.open-before.open,3);assert.equal(f.calls.close-before.close,3);
 for(const [index,count] of [[-1,1],[0,129],[128,2],[0,0]])await assert.rejects(f.out.readRootAttachmentChunks(job,index,count),/range/);
 const file=[...f.data.keys()].find(p=>p.includes('/files/')&&p.endsWith('/ciphertext'));f.data.set(file,f.data.get(file).slice(0,-1));
 await assert.rejects(f.out.readRootAttachmentChunks(job,128,1),/truncated/);assert.equal(f.calls.open,f.calls.close);
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
 for(let i=0;i<Math.ceil(f.plain.length/4096);i++){
  const c=await f.out.readRootAttachmentChunk({owner,digest:a.attachmentDigest(second.manifest),descriptor:second},i);
  assert.deepEqual(a.decryptAttachmentChunk(second.manifest,c,f.key),f.plain.slice(i*4096,(i+1)*4096));
 }
 f.out.removeRootAttachmentContent(owner,a.attachmentDigest(first.manifest));assert(f.out.rootAttachmentFile(owner,a.attachmentDigest(second.manifest)).exists,'another recipient retains the payload');
 f.out.removeRootAttachmentSource(owner,shared.id);f.out.removeRootAttachmentContent(owner,a.attachmentDigest(second.manifest));assert(![...f.data.keys()].some(p=>p.includes('/shared/')),'last reference releases payload');
});
test('short source reads and write failures never publish prepared attachment files',async t=>{
 for(const options of [{shortRead:true},{failWrite:true},{failCopy:true}]){
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

for(const mode of ['ok','malformed','error','locked'])test('native batch preparation '+mode,async t=>{
 let active=true,calls=0;const f=setup(t,{bytes:524289,
 nativeStagedHash:async(owner,id,bytes,data)=>crypto.createHash('sha256').update(data.get('own/axonic-own-attachments-v1/'+owner.slice(9)+'/staging/'+id+'/content')).digest('hex'),
 nativeBatch:async(owner,id,key,bytes,start,aads,data)=>{calls++;assert(aads.length<=128);if(mode==='error')throw Error('native batch failed');if(mode==='malformed')return ['bad'];if(mode==='locked')active=false;
 const prefix='own/axonic-own-attachments-v1/'+owner.slice(9)+'/staging/'+id+'/',source=data.get(prefix+'content'),output=data.get(prefix+'ciphertext'),chunks=[],leaves=[];
 const {xchacha20poly1305}=require('@noble/ciphers/chacha.js');
 for(let n=0;n<aads.length;n++){const index=start+n,aad=Buffer.from(aads[n]),nonce=crypto.createHash('sha256').update(aad).digest().subarray(0,24),chunk=xchacha20poly1305(Buffer.from(key,'hex'),nonce,aad).encrypt(source.subarray(index*4096,(index+1)*4096));chunks.push(Buffer.from(chunk));leaves.push(a.attachmentLeafBytes(index,chunk));}
 data.set(prefix+'ciphertext',Buffer.concat([output,...chunks]));return leaves;
 }});f.input.current=()=>active;
 if(mode==='ok'){const d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest);assert.equal(calls,2);assert.equal(f.calls.read,0);for(const index of [0,127,128]){const chunk=await f.out.readRootAttachmentChunk({owner,digest,descriptor:d},index);assert.equal(chunk.ciphertext,a.encryptAttachmentChunk(d.manifest,index,f.plain.slice(index*4096,(index+1)*4096),f.key));}}
 else{await assert.rejects(f.out.prepareRootAttachment(f.input));assert(![...f.data.keys()].some(p=>p.includes('/files/')||p.endsWith('/ciphertext')||p.endsWith('/descriptor.json')));assert(f.out.rootAttachmentSource(f.ids[0].record.account,f.input.id).exists);}
});
