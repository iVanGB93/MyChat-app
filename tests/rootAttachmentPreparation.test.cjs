const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),crypto=require('node:crypto');
const {load,fixture,now}=require('./helpers/attachment.cjs'),a=load('attachmentProtocol');
function setup(t,{shortRead=false,failWrite=false,nativeFileHash}={}){
 const f=fixture(2*65536+17),data=new Map(),directories=new Set(),calls={read:0,write:0,open:0,close:0},buffers=[];
 const path=args=>args.map(v=>typeof v==='string'?v:v.uri).join('/');
 class Directory{
  constructor(...args){this.uri=path(args);}get exists(){return directories.has(this.uri);}create(){directories.add(this.uri);}
  delete(){for(const key of data.keys())if(key.startsWith(this.uri+'/'))data.delete(key);directories.delete(this.uri);}
 }
 class File{
  constructor(...args){this.uri=path(args);}get exists(){return data.has(this.uri);}get size(){return data.get(this.uri)?.length??0;}
  create(){data.set(this.uri,new Uint8Array());}delete(){data.delete(this.uri);}
  write(value){data.set(this.uri,typeof value==='string'?Buffer.from(value):Uint8Array.from(value));}
  textSync(){return Buffer.from(data.get(this.uri)).toString();}
  move(target){data.set(target.uri,data.get(this.uri));data.delete(this.uri);this.uri=target.uri;}
  open(){calls.open++;const file=this;return {offset:0,
   readBytes(n){calls.read++;const result=data.get(file.uri).slice(this.offset,this.offset+n-(shortRead?1:0));this.offset+=result.length;buffers.push(result);return result;},
   writeBytes(bytes){calls.write++;buffers.push(bytes);if(failWrite&&file.uri.endsWith('/ciphertext'))throw Error('disk full');const old=data.get(file.uri),next=new Uint8Array(Math.max(old.length,this.offset+bytes.length));next.set(old);next.set(bytes,this.offset);this.offset+=bytes.length;data.set(file.uri,next);},
   close(){calls.close++;}};
  }
 }
 const identity=f.ids[0],localAccount={status:()=>({account:identity.record.account}),publicRecord:()=>identity.record,callDevice:()=>identity.device.id,
  signAttachment:fields=>a.signAttachmentManifest(fields,identity.signingSeed,identity.record,now)};
 const out={};new Function('require','exports','Date',ts.transpileModule(fs.readFileSync('src/services/identity/rootAttachmentFiles.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText)(name=>name==='expo-file-system'?{File,Directory,Paths:{document:'own'}}:name.includes('axonic-nearby')?{default:{identityRandomBytes:async()=>Buffer.from(f.key).toString('hex'),...(nativeFileHash?{attachmentFileSha256:(...args)=>nativeFileHash(...args,data)}:{})}}:name==='./localAccount'?{localAccount}:name.startsWith('./')?load(name.slice(2)):require(name),out,{now:()=>now});
 const input={id:f.manifest.id,name:'test.png',mime:'image/png',recipient:f.ids[1].record,current:()=>true};
 out.rootAttachmentSource(identity.record.account,input.id).write(f.plain);
 return {...f,out,input,data,calls,buffers};
}
test('batched preparation preserves each encrypted chunk, checksum and proof with bounded native calls',async t=>{
 const f=setup(t),d=await f.out.prepareRootAttachment(f.input),owner=f.ids[0].record.account,digest=a.attachmentDigest(d.manifest);
 assert.equal(f.calls.read,3);assert.equal(f.calls.write,6,'one plain and one encrypted write per 64 KiB batch');assert.equal(f.calls.open,f.calls.close);
 assert(f.buffers.every(b=>b.every(v=>v===0)),'temporary batch buffers are cleared');
 assert.equal(d.checksum,crypto.createHash('sha256').update(f.plain).digest('hex'));
 assert.deepEqual(Buffer.from(f.data.get(f.out.rootAttachmentFile(owner,digest).uri)),Buffer.from(f.plain));
 for(let i=0;i<Math.ceil(f.plain.length/4096);i++){
  const chunk=await f.out.readRootAttachmentChunk({owner,digest,descriptor:d},i);
  assert.equal(chunk.ciphertext,a.encryptAttachmentChunk(d.manifest,i,f.plain.slice(i*4096,(i+1)*4096),f.key));
  assert.equal(a.verifyAttachmentChunk(d.manifest,chunk),true);
 }
});
test('short source reads and write failures never publish prepared attachment files',async t=>{
 for(const options of [{shortRead:true},{failWrite:true}]){
  const f=setup(t,options);await assert.rejects(f.out.prepareRootAttachment(f.input),/source changed|disk full/);
  assert.equal(f.calls.open,f.calls.close);assert(f.buffers.every(b=>b.every(v=>v===0)));
  assert(![...f.data.keys()].some(p=>p.includes('/files/')||p.endsWith('/descriptor.json')));
 }
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
