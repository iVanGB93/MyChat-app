// Isolated benchmark codec. Never imported by the app, persisted in its ledger,
// or negotiated with real peers. Derive algorithms from the current source;
// separate every authentication domain by the experimental chunk size.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const sizes=[4096,16384,65536,262144],batchBytes=262144;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function source(size){
 if(!sizes.includes(size))throw Error('Unapproved experimental chunk size');
 const original=fs.readFileSync(path.join(root,'src/services/identity/attachmentProtocol.ts'),'utf8');
 const batch=fs.readFileSync(path.join(root,'src/services/identity/attachmentBatch.ts'),'utf8');
 if(original.split('export const ATTACHMENT_CHUNK_BYTES=4096;').length!==2)throw Error('Chunk source drift');
 const protocol=original.replace('export const ATTACHMENT_CHUNK_BYTES=4096;',`export const ATTACHMENT_CHUNK_BYTES=${size};`)
  .replaceAll('axonic-attachment-',`axonic-exp-${size}-attachment-`);
 const compile=s=>ts.transpileModule(s,{compilerOptions:{module:1,target:1,downlevelIteration:true}}).outputText;
 return {size,batchBytes,batchCount:batchBytes/size,protocol:compile(protocol),batch:compile(batch),
  sourceSha256:hash(original),batchSourceSha256:hash(batch),experimentSha256:hash(protocol)};
}
function load(size){
 const s=source(size),protocol={},batch={};
 const identity=require('../../tests/helpers/attachment.cjs').load('identityProtocol');
 new Function('require','exports',s.protocol)(n=>n==='./identityProtocol.ts'?identity:require(n),protocol);
 new Function('require','exports',s.batch)(n=>n==='./attachmentProtocol.ts'?protocol:require(n),batch);
 return {...s,protocol,batch,identity};
}
function fixture(size,bytes,version=1){
 const a=load(size),now=Date.now(),random=n=>new Uint8Array(crypto.randomBytes(n));
 const ids=[0,1].map(()=>{const seed=random(32),device=a.identity.publicDevice(seed,random(32));return {seed,record:a.identity.issueRecord(random(32),[device],now),device};});
 const key=random(32),plain=random(bytes),fields={version,id:crypto.randomBytes(32).toString('hex'),sender:ids[0].record.account,senderDevice:ids[0].device.id,recipient:ids[1].record.account,recipientDevice:ids[1].device.id,created:now,expires:now+3600000,bytes,...(version===2?{shared:{id:crypto.randomBytes(32).toString('hex'),count:2,slot:0}}:{})};
 const start=performance.now(),checksum=hash(plain),encrypted=[],leaves=[];
 for(let i=0;i<Math.ceil(bytes/size);i++){const value=a.protocol.encryptAttachmentChunk(fields,i,plain.subarray(i*size,Math.min(bytes,(i+1)*size)),key);encrypted.push(value);leaves.push(a.protocol.attachmentLeaf(i,value));}
 const tree=a.protocol.buildAttachmentTree(leaves),manifest=a.protocol.signAttachmentManifest({...fields,root:tree.root},ids[0].seed,ids[0].record,now);
 const chunks=encrypted.map((ciphertext,index)=>({index,ciphertext,proof:tree.proof(index)}));
 return {a,now,key,plain,ids,manifest,chunks,checksum,preparationMs:performance.now()-start};
}
module.exports={sizes,batchBytes,source,load,fixture};
