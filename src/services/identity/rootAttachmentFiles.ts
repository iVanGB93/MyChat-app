import {attachmentContentChanged} from './attachmentChanges';
import {Directory,File,Paths} from 'expo-file-system';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {validAccountId,verifyRecord,type IdentityRecord} from './identityProtocol';
import {attachmentChunkAAD,attachmentDigest,attachmentChecksumCommitment,attachmentBlockBytes,ATTACHMENT_MAX_BYTES,ATTACHMENT_TTL,encryptAttachmentChunkBytes,attachmentBlockPublicKey,signAttachmentBlock,verifyAttachmentChunk,verifyAttachmentManifest,type AttachmentManifest} from './attachmentProtocol';
import {AttachmentFileReset,validAttachmentDescriptor,type AttachmentDescriptor,type AttachmentJob} from './attachmentTransfer';
import {validAttachmentRange} from './attachmentBatch';
import {SharedMediaFile,sharedMediaNative,isSharedMediaUri} from './sharedMediaFile';
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
// Same canonical leaf JSON and SHA-256 as the protocol implementation. Avoid
// hashing multi-megabyte hex strings on Hermes when the native primitive exists.
const hashLeaf=Native?.attachmentSha256?(value:string)=>Native!.attachmentSha256!(value):undefined;
function checkPath(owner:string,id:string){
 if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid attachment path');
}
function folder(owner:string,id:string,staging=false){
 checkPath(owner,id);
 return new Directory(Paths.document,'axonic-own-attachments-v1',owner.slice(9),staging?'staging':'files',id);
}
// Partial transfers are private. Completed media can use a MediaStore reference
// with a native read-only seekable descriptor, without a private replica.
function sharedFolder(owner:string,id:string){return new Directory(folder(owner,id).parentDirectory.parentDirectory,'shared',id);}
function readSharedReference(link:File){if(!link.exists)return null;const value=JSON.parse(link.textSync());if(Object.keys(value).join(',')!=='id'||typeof value.id!=='string'||!/^[a-f0-9]{64}$/.test(value.id))throw Error('Invalid shared attachment reference');return value.id as string;}
function sharedReference(directory:Directory){return readSharedReference(new File(directory,'shared.json'));}
function payloadFolder(owner:string,digest:string){const directory=folder(owner,digest),shared=sharedReference(directory);return shared?sharedFolder(owner,shared):directory;}
function privateAttachmentFile(owner:string,digest:string){
 checkPath(owner,digest);
 // Resolve from the known account root instead of constructing directories and
 // walking native parentDirectory getters for every rendered media bubble.
 // Read the link afresh: shared ownership/path and file availability can change.
 const root=Paths.document,account=owner.slice(9);
 const shared=readSharedReference(new File(root,'axonic-own-attachments-v1',account,'files',digest,'shared.json'));
 return new File(root,'axonic-own-attachments-v1',account,shared?'shared':'files',shared??digest,'content');
}
export function rootAttachmentFile(owner:string,digest:string):File|SharedMediaFile{
 const privateFile=privateAttachmentFile(owner,digest),link=new File(privateFile.uri.replace(/content$/,'media.json'));
 if(link.exists){const value=JSON.parse(link.textSync());if(typeof value.uri!=='string'||!isSharedMediaUri(value.uri))throw Error('Invalid media reference');return new SharedMediaFile(value.uri);}
 return privateFile;
}
export async function hashRootAttachmentFile(owner:string,digest:string,bytes:number){
 const file=rootAttachmentFile(owner,digest);
 if(file instanceof SharedMediaFile){if(!file.exists||file.size!==bytes)throw Error('Attachment removed or changed');return sharedMediaNative!.sha256(file.uri);}
 try{return await Native!.attachmentFileSha256!(owner,digest,true,bytes);}
 catch(error){
  // Export may adopt the verified file into MediaStore while the native hash
  // is queued. Resolve again only after that canonical handoff; never recreate
  // a deleted file or treat a failed private read as successful verification.
  const adopted=rootAttachmentFile(owner,digest);
  if(!(adopted instanceof SharedMediaFile))throw error;
  if(!adopted.exists||adopted.size!==bytes)throw Error('Attachment removed or changed');
  return sharedMediaNative!.sha256(adopted.uri);
 }
}
/** Verify first, persist the canonical reference, then discard only the verified
 * private duplicate. A crash before deletion is recoverable on the next pass.
 * Missing shared media is never restored from the obsolete private replica. */
export async function adoptRootAttachmentExport(owner:string,digest:string,uri:string){
 if(!sharedMediaNative?.singleCopy)return;
 const privateFile=privateAttachmentFile(owner,digest);
 let changed=privateFile.exists;
 if(changed){await sharedMediaNative.adopt(privateFile.uri,uri);linkRootAttachmentExport(owner,digest,uri);}
 else {const canonical=rootAttachmentFile(owner,digest);if(!(canonical instanceof SharedMediaFile)||canonical.uri!==uri)return;}
 // Own relay ciphertext is a regenerable transport cache, never a second
 // permanent copy. Pending sibling grants can recreate it from verified media.
 // This does not touch the separate custody store for anyone else's packets.
 for(const entry of privateFile.parentDirectory.list())if(entry instanceof File&&/^\d+\.(block|proof)$/.test(entry.name)){entry.delete();changed=true;}
 if(changed)attachmentContentChanged();
}
function releaseSharedPayload(owner:string,id:string){
 const payload=sharedFolder(owner,id);if(!payload.exists)return;
 // A queued recipient still needs the prepared bytes even before it has a grant.
 if(new File(folder(owner,id,true),'shared-descriptor.json').exists)return;
 const files=folder(owner,id).parentDirectory;
 if(files.exists)for(const entry of files.list())if(entry instanceof Directory&&sharedReference(entry)===id)return;
 payload.delete();
}
/** Remove this grant's local media without breaking another recipient's transfer. */
export function removeRootAttachmentContent(owner:string,digest:string){
 const directory=folder(owner,digest),shared=sharedReference(directory);
 if(shared){new File(directory,'shared.json').delete();releaseSharedPayload(owner,shared);}
 else {const content=new File(directory,'content');if(content.exists)content.delete();}
 attachmentContentChanged();
}
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
 const file=rootAttachmentFile(owner,digest);if(file instanceof SharedMediaFile)return file.uri;
 const link=new File(folder(owner,digest),'export.json');
 try{if(link.exists){const value=JSON.parse(link.textSync());if(typeof value.uri==='string'&&isSharedMediaUri(value.uri))return value.uri as string;}}catch{}
 return null;
}
export function linkRootAttachmentExport(owner:string,digest:string,uri:string){
 if(!isSharedMediaUri(uri))throw Error('Invalid exported media URI');
 const directory=folder(owner,digest);directory.create({intermediates:true,idempotent:true});
 new File(directory,'export.json').write(JSON.stringify({uri}));
}
export const rootAttachmentSource=(owner:string,id:string)=>{const directory=folder(owner,id,true),shared=sharedReference(directory);return new File(shared?folder(owner,shared,true):directory,'source');};
export function removeRootAttachmentSource(owner:string,id:string){const directory=folder(owner,id,true);if(directory.exists)directory.delete();releaseSharedPayload(owner,id);}
export function stageRootAttachmentSource(owner:string,id:string,uri:string,sharedId?:string){
 const source=new File(uri);if(!source.exists||!source.size||source.size>ATTACHMENT_MAX_BYTES)throw Error('Choose a file between 1 byte and 250 MiB');
 const directory=folder(owner,id,true);directory.create({intermediates:true,idempotent:true});
 if(sharedId){const shared=folder(owner,sharedId,true);shared.create({intermediates:true,idempotent:true});const target=new File(shared,'source');if(!target.exists)source.copy(target);new File(directory,'shared.json').write(JSON.stringify({id:sharedId}));}
 else {const target=rootAttachmentSource(owner,id);if(target.exists)throw Error('Attachment already staged');source.copy(target);}
 const origin=new File(uri+'.axonic-origin.json');if(origin.exists){const value=JSON.parse(origin.textSync());if(typeof value.uri==='string'&&isSharedMediaUri(value.uri))new File(sharedId?folder(owner,sharedId,true):directory,'origin.json').write(JSON.stringify({uri:value.uri}));}
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
  if(!validAttachmentDescriptor(saved)||!saved.manifest.shared||saved.manifest.sender!==owner||saved.manifest.senderDevice!==device||saved.manifest.shared?.id!==input.shared!.id||saved.manifest.shared.count!==input.shared!.count||!verifyAttachmentManifest(saved.manifest,record,Date.now()))throw Error('Shared attachment expired or changed');
  const manifest=localAccount.signAttachment({...saved.manifest,id:input.id,recipient:input.recipient.account,recipientDevice:input.recipient.devices[0].id,shared:{...input.shared!}});
  const descriptor={...saved,manifest};if(!validAttachmentDescriptor(descriptor))throw Error('Invalid shared descriptor');
  const target=folder(owner,attachmentDigest(manifest)),source=payloadFolder(owner,attachmentDigest(saved.manifest));
  check(input.current);if(target.exists)throw Error('Attachment destination already exists');target.create({intermediates:true});
  try{
   const shared=sharedFolder(owner,input.shared!.id);
   // Older queued sends may have prepared the first grant in its own directory.
   if(!shared.exists){
    shared.create({intermediates:true});const moved:string[]=[];
    try{for(const name of ['content','relay-signing-key']){new File(source,name).move(new File(shared,name));moved.push(name);}new File(folder(owner,attachmentDigest(saved.manifest)),'shared.json').write(JSON.stringify({id:input.shared!.id}));}
    catch(error){for(const name of moved)new File(shared,name).move(new File(source,name));if(shared.exists)shared.delete();throw error;}
   }
   for(const name of ['content','relay-signing-key'])if(!new File(shared,name).exists)throw Error('Shared attachment unavailable');
   new File(target,'shared.json').write(JSON.stringify({id:input.shared!.id}));metadata.write(JSON.stringify(descriptor));return descriptor;
  }
  catch(error){if(target.exists)target.delete();throw error;}
 }
 const source=rootAttachmentSource(owner,input.id),content=new File(directory,'content'),signerFile=new File(directory,'relay-signing-key');
 if(!source.exists||source.size<1||source.size>ATTACHMENT_MAX_BYTES)throw Error('Attachment source unavailable');
 const key=hexToBytes(await Native!.identityRandomBytes!(32)),signer=hexToBytes(await Native!.identityRandomBytes!(32));
 let committed=false,createdFinal:Directory|undefined;
 try{
  check(input.current);const now=Date.now(),fields={version:4 as const,id:input.id,sender:owner,senderDevice:device,recipient:input.recipient.account,recipientDevice:input.recipient.devices[0].id,created:now,expires:now+ATTACHMENT_TTL-30000,bytes:source.size,...(input.shared?{shared:{...input.shared}}:{})};
  if(content.exists)content.delete();
  source.copy(content);check(input.current);if(content.size!==fields.bytes)throw Error('Attachment source changed');
  const checksum=Native?.attachmentStagedFileSha256?await Native.attachmentStagedFileSha256(owner,input.id,fields.bytes):await hashContent(content,fields.bytes,input.current);
  check(input.current);if(!/^[a-f0-9]{64}$/.test(checksum))throw Error('Invalid attachment checksum');
  // No ciphertext or encrypted-block commitments are produced on this path.
  const manifest=localAccount.signAttachment({...fields,checksum:attachmentChecksumCommitment(checksum,bytesToHex(key)),root:attachmentBlockPublicKey(signer)});
  const descriptor:AttachmentDescriptor={manifest,key:bytesToHex(key),checksum,name:input.name,mime:input.mime,...(input.caption?{caption:input.caption}:{})};
  if(!validAttachmentDescriptor(descriptor))throw Error('Invalid file name or type');
  signerFile.write(bytesToHex(signer));
  const target=folder(owner,attachmentDigest(manifest));if(target.exists)throw Error('Attachment destination already exists');target.create({intermediates:true});createdFinal=target;
  const payload=input.shared?sharedFolder(owner,input.shared.id):target;
  if(input.shared){if(payload.exists)throw Error('Shared attachment destination already exists');payload.create({intermediates:true});new File(target,'shared.json').write(JSON.stringify({id:input.shared.id}));}
  for(const [file,name] of [[content,'content'],[signerFile,'relay-signing-key']] as const)file.move(new File(payload,name));
  const origin=new File(input.shared?folder(owner,input.shared.id,true):directory,'origin.json');if(origin.exists)origin.copy(new File(payload,'origin.json'));
  if(sharedMetadata){folder(owner,input.shared!.id,true).create({intermediates:true,idempotent:true});sharedMetadata.write(JSON.stringify(descriptor));}
  metadata.write(JSON.stringify(descriptor));committed=true;return descriptor;
 }finally{key.fill(0);signer.fill(0);if(!committed){for(const file of [content,signerFile,metadata])if(file.exists)file.delete();if(createdFinal?.exists)createdFinal.delete();if(sharedMetadata?.exists)sharedMetadata.delete();if(input.shared)releaseSharedPayload(owner,input.shared.id);}}
}
async function hashContent(file:File|SharedMediaFile,bytes:number,current:()=>boolean,blocks?:string[]){
 if(!file.exists||file.size!==bytes)throw Error('Attachment source changed');
 if(blocks&&sharedMediaNative?.hashBlocks){
  check(current);const result=await sharedMediaNative.hashBlocks(file.uri,bytes);check(current);
  if(result.bytes!==bytes||!/^[a-f0-9]{64}$/.test(result.checksum)||!Array.isArray(result.blocks)
    ||result.blocks.length!==Math.ceil(bytes/3_000_000)||result.blocks.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))throw Error('Invalid native source hashes');
  blocks.push(...result.blocks);return result.checksum;
 }
 const handle=file.open(),hash=sha256.create();let blockHash=sha256.create();
 try{for(let offset=0;offset<bytes;){
  check(current);const length=Math.min(65536,bytes-offset,3_000_000-offset%3_000_000),plain=handle.readBytes(length);
  try{if(plain.length!==length)throw Error('Attachment source changed');hash.update(plain);if(blocks){blockHash.update(plain);if((offset+length)%3_000_000===0||offset+length===bytes){blocks.push(bytesToHex(blockHash.digest()));blockHash=sha256.create();}}}finally{plain.fill(0);}
  offset+=length;
  await pause();
 }}finally{handle.close();}
 check(current);return bytesToHex(hash.digest());
}
const blockReads=new Map<string,Promise<import('./attachmentProtocol').AttachmentChunk[]>>();
export async function readRootAttachmentChunk(job:AttachmentJob,index:number){
 return (await readRootAttachmentChunks(job,index,1))[0];
}
/** Relay-only materialization. Signed blocks are cached byte-for-byte; a direct
 * stream only opens content and never calls this function. Coalesce sibling
 * group grants so a single payload/index has one encryption operation at a time. */
export async function readRootAttachmentChunks(job:AttachmentJob,index:number,count:number){
 const manifest=job.descriptor.manifest;
 if(!validAttachmentRange(manifest,index,count)||manifest.sender!==job.owner)throw Error('Invalid attachment read range');
 const directory=payloadFolder(job.owner,job.digest),cacheKey=directory.uri+':'+index;
 const existing=blockReads.get(cacheKey);if(existing)return existing;
 const task=materialize();blockReads.set(cacheKey,task);
 try{return await task;}finally{if(blockReads.get(cacheKey)===task)blockReads.delete(cacheKey);}
 async function materialize(){
  const current=()=>localAccount.status().account===job.owner&&localAccount.status().state==='unlocked';
  check(current);
  const cipher=new File(directory,index+'.block'),proof=new File(directory,index+'.proof');
  if(cipher.exists&&proof.exists){
   const bytes=cipher.open();let ciphertext:Uint8Array;
   try{const length=Math.min(attachmentBlockBytes(manifest),manifest.bytes-index*attachmentBlockBytes(manifest))+16;
    if(cipher.size!==length)throw Error('Attachment ciphertext truncated');ciphertext=bytes.readBytes(length);
   }finally{bytes.close();}
   const chunk={index,ciphertext:bytesToHex(ciphertext!),proof:[proof.textSync()]};
   if(!verifyAttachmentChunk(manifest,chunk,hashLeaf))throw Error('Attachment cached block changed');
   return [chunk];
  }
  const content=rootAttachmentFile(job.owner,job.digest);
  // One lazy checksum pass records local plaintext block hashes. Subsequent
  // blocks verify only their own bytes, not the entire file on every read.
  const sourceProof=new File(directory,'relay-source.json');let blocks:string[];
  if(sourceProof.exists){
   const saved=JSON.parse(sourceProof.textSync());blocks=saved.blocks;
   if(Object.keys(saved).sort().join(',')!=='blocks,checksum'||saved.checksum!==job.descriptor.checksum
    ||!Array.isArray(blocks)||blocks.length!==Math.ceil(manifest.bytes/attachmentBlockBytes(manifest))
    ||blocks.some(v=>typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))throw Error('Attachment source commitment changed');
  }else{
   blocks=[];const checksum=await hashContent(content,manifest.bytes,current,blocks);
   check(current);if(checksum!==job.descriptor.checksum||attachmentChecksumCommitment(checksum,job.descriptor.key)!==manifest.checksum)throw Error('Attachment source changed');
   sourceProof.write(JSON.stringify({checksum,blocks}));
  }
  if(!content.exists||content.size!==manifest.bytes)throw Error('Attachment source changed');
  const key=hexToBytes(job.descriptor.key);let signer:Uint8Array|undefined,handle:ReturnType<File['open']>|ReturnType<SharedMediaFile['open']>|undefined;
  let plain:Uint8Array|undefined,encrypted:Uint8Array|undefined;
  try{
   signer=hexToBytes(new File(directory,'relay-signing-key').textSync());handle=content.open();
   const block=attachmentBlockBytes(manifest);handle.offset=index*block;const length=Math.min(block,manifest.bytes-index*block);
   plain=handle.readBytes(length);if(plain.length!==length)throw Error('Attachment source changed');
   if(Native?.attachmentEncryptBlock){
    encrypted=await Native.attachmentEncryptBlock(plain,job.descriptor.key,blocks[index],attachmentChunkAAD(manifest,index));
    check(current);if(!(encrypted instanceof Uint8Array)||encrypted.length!==length+16)throw Error('Invalid native ciphertext');
   }else{
    if(bytesToHex(sha256(plain))!==blocks[index])throw Error('Attachment source changed');
    encrypted=encryptAttachmentChunkBytes(manifest,index,plain,key);
   }
   const chunk=signAttachmentBlock(manifest,index,bytesToHex(encrypted),signer,hashLeaf);
   check(current);cipher.write(encrypted);proof.write(chunk.proof[0]);return [chunk];
  }finally{handle?.close();key.fill(0);signer?.fill(0);plain?.fill(0);encrypted?.fill(0);}
 }
}
export async function writeRootAttachmentChunk(job:AttachmentJob,index:number,plain:Uint8Array,current:()=>boolean){
 return writeRootAttachmentChunks(job,index,[plain],current);
}
/** One bounded file open/stat/write/close per verified 3 MB block (or final tail).
 * No persistent handle/cache: replay, lock and restart use the same file checks. */
export async function writeRootAttachmentChunks(job:AttachmentJob,index:number,plain:Uint8Array[],current:()=>boolean){
 check(current);const manifest=job.descriptor.manifest,block=attachmentBlockBytes(manifest);
 if(!Array.isArray(plain)||!validAttachmentRange(manifest,index,plain.length)
  ||plain.some((bytes,n)=>!(bytes instanceof Uint8Array)||bytes.length!==Math.min(block,manifest.bytes-(index+n)*block)))throw Error('Invalid attachment write range');
 // The protocol admits exactly one block. File.writeBytes is synchronous:
 // borrow the verified caller buffer until it returns instead of allocating,
 // copying and clearing another 3 MB on the JS thread. The caller owns erasure.
 const buffer=plain[0];
 {  const directory=folder(job.owner,job.digest);directory.create({intermediates:true,idempotent:true});const file=new File(directory,'partial');
  check(current);if(index===0){if(file.exists)file.delete();file.create();}
  if(!file.exists||file.size<index*block)throw new AttachmentFileReset('Download needs to restart');
  const handle=file.open();try{check(current);handle.offset=index*block;handle.writeBytes(buffer);}finally{handle.close();}
 }
}
export async function commitRootAttachmentFile(job:AttachmentJob,current:()=>boolean){
 check(current);
 const published=rootAttachmentFile(job.owner,job.digest);
 if(published instanceof SharedMediaFile){if(!published.exists||published.size!==job.descriptor.manifest.bytes||await sharedMediaNative!.sha256(published.uri)!==job.descriptor.checksum)throw Error('Shared attachment removed or changed');check(current);return;}
 const directory=folder(job.owner,job.digest),final=published,partial=new File(directory,'partial'),file=final.exists?final:partial;
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
 if(!final.exists)partial.move(final);attachmentContentChanged();
}
