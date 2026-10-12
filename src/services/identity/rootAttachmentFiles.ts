import {Directory,File,Paths} from 'expo-file-system';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {validAccountId,verifyRecord,type IdentityRecord} from './identityProtocol';
import {attachmentDigest,ATTACHMENT_CHUNK_BYTES,ATTACHMENT_MAX_BYTES,ATTACHMENT_TTL,encryptAttachmentChunkBytes,attachmentLeaf,buildAttachmentTree,verifyAttachmentManifest,type AttachmentManifest} from './attachmentProtocol';
import {AttachmentFileReset,validAttachmentDescriptor,type AttachmentDescriptor,type AttachmentJob} from './attachmentTransfer';
import {validAttachmentRange} from './attachmentBatch';
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
function folder(owner:string,id:string,staging=false){
 if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid attachment path');
 return new Directory(Paths.document,'axonic-own-attachments-v1',owner.slice(9),staging?'staging':'files',id);
}
// Transfer verification and forwarding require seekable app-owned files. MediaStore
// URIs are not supported by Expo's synchronous File handles.
export const rootAttachmentFile=(owner:string,digest:string)=>new File(folder(owner,digest),'content');
export const rootAttachmentPartial=(owner:string,digest:string)=>new File(folder(owner,digest),'partial');
/** Expiring, attempt-owned directories make a crashed stream reclaimable without
 * ever deleting a chat's committed file or another live attempt's partial file. */
export function createRootStreamTemporary(owner:string,id:string){
 const directory=folder(owner,id);if(directory.exists)throw Error('Stream temporary collision');
 directory.create({intermediates:true});new File(directory,'stream-temporary-v1.json').write(JSON.stringify({expires:Date.now()+15*60*1000}));
 const file=new File(directory,'content');file.create();return file;
}
export function sweepRootStreamTemporaries(owner:string){
 const root=folder(owner,'0'.repeat(64)).parentDirectory;if(!root.exists)return;
 for(const entry of root.list()){
  if(!(entry instanceof Directory))continue;
  const marker=new File(entry,'stream-temporary-v1.json');if(!marker.exists)continue;
  try{const value=JSON.parse(marker.textSync());if(Object.keys(value).join(',')==='expires'&&Number.isSafeInteger(value.expires)&&value.expires<=Date.now())entry.delete();}catch{/* Never remove an unrecognized directory. */}
 }
}
export function rootAttachmentExportLink(owner:string,digest:string){
 const link=new File(folder(owner,digest),'export.json');
 try{if(link.exists){const value=JSON.parse(link.textSync());if(typeof value.uri==='string'&&/^content:\/\/media\//.test(value.uri))return value.uri as string;}}catch{}
 return null;
}
export function linkRootAttachmentExport(owner:string,digest:string,uri:string){
 if(!/^content:\/\/media\//.test(uri))throw Error('Invalid exported media URI');
 const directory=folder(owner,digest);directory.create({intermediates:true,idempotent:true});
 new File(directory,'export.json').write(JSON.stringify({uri}));
}
export const rootAttachmentSource=(owner:string,id:string)=>new File(folder(owner,id,true),'source');
export function removeRootAttachmentSource(owner:string,id:string){const directory=folder(owner,id,true);if(directory.exists)directory.delete();}
export function stageRootAttachmentSource(owner:string,id:string,uri:string){
 const source=new File(uri);if(!source.exists||!source.size||source.size>ATTACHMENT_MAX_BYTES)throw Error('Choose a file between 1 byte and 250 MiB');
 const directory=folder(owner,id,true);directory.create({intermediates:true,idempotent:true});
 const target=rootAttachmentSource(owner,id);if(target.exists)throw Error('Attachment already staged');source.copy(target);
}
function check(current:()=>boolean){if(!current())throw Error('Unlock your account to continue');}
/** Streams bounded chunks; original file names never become filesystem paths. */
export async function prepareRootAttachment(input:{id:string;name:string;mime:string;caption?:string;recipient:IdentityRecord;shared?:AttachmentManifest['shared'];current():boolean}):Promise<AttachmentDescriptor>{
 const owner=localAccount.status().account,record=localAccount.publicRecord(),device=localAccount.callDevice();
 if(!owner||!record||!device||!verifyRecord(input.recipient,Date.now()))throw Error('Attachment identity unavailable');
 check(input.current);const directory=folder(owner,input.id,true),metadata=new File(directory,'descriptor.json');
 if(metadata.exists){const saved=JSON.parse(metadata.textSync());if(!validAttachmentDescriptor(saved)||saved.manifest.sender!==owner||saved.manifest.recipient!==input.recipient.account
  ||saved.manifest.senderDevice!==device||!verifyAttachmentManifest(saved.manifest,record,Date.now())||!rootAttachmentFile(owner,attachmentDigest(saved.manifest)).exists)throw Error('Prepared attachment expired or changed');return saved;}
 const sharedMetadata=input.shared?new File(folder(owner,input.shared.id,true),'shared-descriptor.json'):null;
 if(sharedMetadata?.exists){
  const saved:AttachmentDescriptor=JSON.parse(sharedMetadata.textSync());
  if(!validAttachmentDescriptor(saved)||saved.manifest.version!==2||saved.manifest.sender!==owner||saved.manifest.senderDevice!==device||saved.manifest.shared?.id!==input.shared!.id||saved.manifest.shared.count!==input.shared!.count||!verifyAttachmentManifest(saved.manifest,record,Date.now()))throw Error('Shared attachment expired or changed');
  const manifest=localAccount.signAttachment({...saved.manifest,id:input.id,recipient:input.recipient.account,recipientDevice:input.recipient.devices[0].id,shared:{...input.shared!}});
  const descriptor={...saved,manifest};if(!validAttachmentDescriptor(descriptor))throw Error('Invalid shared descriptor');
  const target=folder(owner,attachmentDigest(manifest)),source=folder(owner,attachmentDigest(saved.manifest));
  check(input.current);if(target.exists)throw Error('Attachment destination already exists');target.create({intermediates:true});
  try{for(const name of ['ciphertext','content','tree.json']){check(input.current);new File(source,name).copy(new File(target,name));}metadata.write(JSON.stringify(descriptor));return descriptor;}
  catch(error){if(target.exists)target.delete();throw error;}
 }
 const source=rootAttachmentSource(owner,input.id),cipher=new File(directory,'ciphertext'),content=new File(directory,'content'),treeFile=new File(directory,'tree.json');
 if(!source.exists||source.size<1||source.size>ATTACHMENT_MAX_BYTES)throw Error('Attachment source unavailable');
 const key=hexToBytes(await Native!.identityRandomBytes!(32));let sourceHandle:ReturnType<File['open']>|undefined,cipherHandle:ReturnType<File['open']>|undefined;
 let committed=false,createdFinal:Directory|undefined;
 try{
  check(input.current);const now=Date.now(),fields={version:input.shared?2 as const:1 as const,id:input.id,sender:owner,senderDevice:device,recipient:input.recipient.account,recipientDevice:input.recipient.devices[0].id,created:now,expires:now+ATTACHMENT_TTL-30000,bytes:source.size,...(input.shared?{shared:{...input.shared}}:{})};
  for(const file of [cipher,content,treeFile])if(file.exists)file.delete();cipher.create();
  // Copy in native file code instead of bridging the plaintext back to Android
  // for every batch. Encrypt/hash this private copy so the published content is
  // exactly the bytes described by the manifest; retain source for retry.
  source.copy(content);check(input.current);if(content.size!==fields.bytes)throw Error('Attachment source changed');
  const nativeChecksum=Native?.attachmentStagedFileSha256?await Native.attachmentStagedFileSha256(owner,input.id,fields.bytes):null;
  check(input.current);if(nativeChecksum!==null&&!/^[a-f0-9]{64}$/.test(nativeChecksum))throw Error('Invalid attachment checksum');
  sourceHandle=content.open();cipherHandle=cipher.open();const leaves:string[]=[],checksum=nativeChecksum===null?sha256.create():null;
  // Batch native file calls, while retaining the exact 4-KiB encryption chunks,
  // nonce/AAD derivation and Merkle leaves used by older peers.
  for(let offset=0;offset<fields.bytes;offset+=16*ATTACHMENT_CHUNK_BYTES){
   check(input.current);const length=Math.min(16*ATTACHMENT_CHUNK_BYTES,fields.bytes-offset),plain=sourceHandle.readBytes(length);
   const encryptedBytes=new Uint8Array(length+16*Math.ceil(length/ATTACHMENT_CHUNK_BYTES));
   try{
    if(plain.length!==length)throw Error('Attachment source changed');
    checksum?.update(plain);let written=0;
    for(let at=0;at<plain.length;at+=ATTACHMENT_CHUNK_BYTES){
     check(input.current);const index=(offset+at)/ATTACHMENT_CHUNK_BYTES,bytes=encryptAttachmentChunkBytes(fields,index,plain.subarray(at,at+ATTACHMENT_CHUNK_BYTES),key);
     try{encryptedBytes.set(bytes,written);written+=bytes.length;leaves.push(attachmentLeaf(index,bytesToHex(bytes),Native?.attachmentSha256?value=>Native!.attachmentSha256!(value):undefined));}finally{bytes.fill(0);}
    }
    cipherHandle.writeBytes(encryptedBytes);
   }finally{plain.fill(0);encryptedBytes.fill(0);}
   await pause();
  }
  sourceHandle.close();sourceHandle=undefined;cipherHandle.close();cipherHandle=undefined;check(input.current);
  const tree=buildAttachmentTree(leaves),manifest=localAccount.signAttachment({...fields,root:tree.root});
  const descriptor:AttachmentDescriptor={manifest,key:bytesToHex(key),checksum:nativeChecksum??bytesToHex(checksum!.digest()),name:input.name,mime:input.mime,...(input.caption?{caption:input.caption}:{})};
  if(!validAttachmentDescriptor(descriptor))throw Error('Invalid file name or type');treeFile.write(JSON.stringify(leaves));
  const target=folder(owner,attachmentDigest(manifest));if(target.exists)throw Error('Attachment destination already exists');target.create({intermediates:true});createdFinal=target;
  for(const [file,name] of [[cipher,'ciphertext'],[content,'content'],[treeFile,'tree.json']] as const)file.move(new File(target,name));
  if(sharedMetadata){folder(owner,input.shared!.id,true).create({intermediates:true,idempotent:true});sharedMetadata.write(JSON.stringify(descriptor));}
  metadata.write(JSON.stringify(descriptor));committed=true;return descriptor;
 }finally{sourceHandle?.close();cipherHandle?.close();key.fill(0);if(!committed){for(const file of [cipher,content,treeFile,metadata])if(file.exists)file.delete();if(createdFinal?.exists)createdFinal.delete();if(sharedMetadata?.exists)sharedMetadata.delete();}}
}
const trees=new Map<string,ReturnType<typeof buildAttachmentTree>>();
export async function readRootAttachmentChunk(job:AttachmentJob,index:number){
 return (await readRootAttachmentChunks(job,index,1))[0];
}
/** Read one bounded wire batch in one native file operation; encryption/proofs stay per chunk. */
export async function readRootAttachmentChunks(job:AttachmentJob,index:number,count:number){
 const manifest=job.descriptor.manifest;
 if(!validAttachmentRange(manifest,index,count))throw Error('Invalid attachment read range');
 const directory=folder(job.owner,job.digest),cacheKey=job.owner+job.digest;
 let tree=trees.get(cacheKey);if(!tree){const leaves=JSON.parse(new File(directory,'tree.json').textSync());tree=buildAttachmentTree(leaves);
  if(tree.root!==job.descriptor.manifest.root)throw Error('Attachment tree changed');if(trees.size>=2)trees.clear();trees.set(cacheKey,tree);}
 const file=new File(directory,'ciphertext'),handle=file.open();
 try{handle.offset=index*(ATTACHMENT_CHUNK_BYTES+16);const length=Math.min(count*ATTACHMENT_CHUNK_BYTES,manifest.bytes-index*ATTACHMENT_CHUNK_BYTES)+count*16;
  const bytes=handle.readBytes(length);if(bytes.length!==length)throw Error('Attachment ciphertext truncated');
  return Array.from({length:count},(_,offset)=>{const at=offset*(ATTACHMENT_CHUNK_BYTES+16);
   return {index:index+offset,ciphertext:bytesToHex(bytes.subarray(at,Math.min(at+ATTACHMENT_CHUNK_BYTES+16,bytes.length))),proof:tree.proof(index+offset)};});
 }finally{handle.close();}
}
export async function writeRootAttachmentChunk(job:AttachmentJob,index:number,plain:Uint8Array,current:()=>boolean){
 check(current);const directory=folder(job.owner,job.digest);directory.create({intermediates:true,idempotent:true});const file=new File(directory,'partial');
 if(index===0){if(file.exists)file.delete();file.create();}
 if(!file.exists||file.size<index*ATTACHMENT_CHUNK_BYTES)throw new AttachmentFileReset('Download needs to restart');
 const handle=file.open();try{check(current);handle.offset=index*ATTACHMENT_CHUNK_BYTES;handle.writeBytes(plain);}finally{handle.close();}
}
export async function commitRootAttachmentFile(job:AttachmentJob,current:()=>boolean){
 check(current);
 const directory=folder(job.owner,job.digest),final=rootAttachmentFile(job.owner,job.digest),partial=new File(directory,'partial'),file=final.exists?final:partial;
 if(!file.exists||file.size!==job.descriptor.manifest.bytes){if(final.exists)final.delete();throw new AttachmentFileReset('Attachment size changed');}
 let digest:string;
 if(Native?.attachmentFileSha256){
  digest=await Native.attachmentFileSha256(job.owner,job.digest,final.exists,job.descriptor.manifest.bytes);
 }else{
  const handle=file.open(),checksum=sha256.create();
  try{for(let offset=0;offset<file.size;offset+=65536){check(current);const bytes=handle.readBytes(Math.min(65536,file.size-offset));try{checksum.update(bytes);}finally{bytes.fill(0);}await pause();}}
  finally{handle.close();}
  digest=bytesToHex(checksum.digest());
 }
 check(current);if(!/^[a-f0-9]{64}$/.test(digest)||digest!==job.descriptor.checksum){if(final.exists)final.delete();throw new AttachmentFileReset('Attachment checksum failed');}
 if(!final.exists)partial.move(final);
}
