import {Directory,File,Paths} from 'expo-file-system';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import {localAccount} from './localAccount';
import {validAccountId,verifyRecord,type IdentityRecord} from './identityProtocol';
import {attachmentDigest,ATTACHMENT_CHUNK_BYTES,ATTACHMENT_MAX_BYTES,ATTACHMENT_TTL,encryptAttachmentChunk,attachmentLeaf,buildAttachmentTree,verifyAttachmentManifest} from './attachmentProtocol';
import {AttachmentFileReset,validAttachmentDescriptor,type AttachmentDescriptor,type AttachmentJob} from './attachmentTransfer';
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
function folder(owner:string,id:string,staging=false){
 if(!validAccountId(owner)||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid attachment path');
 return new Directory(Paths.document,'axonic-own-attachments-v1',owner.slice(9),staging?'staging':'files',id);
}
export const rootAttachmentFile=(owner:string,digest:string)=>new File(folder(owner,digest),'content');
export const rootAttachmentSource=(owner:string,id:string)=>new File(folder(owner,id,true),'source');
export function removeRootAttachmentSource(owner:string,id:string){const directory=folder(owner,id,true);if(directory.exists)directory.delete();}
export function stageRootAttachmentSource(owner:string,id:string,uri:string){
 const source=new File(uri);if(!source.exists||!source.size||source.size>ATTACHMENT_MAX_BYTES)throw Error('Choose a file between 1 byte and 250 MiB');
 const directory=folder(owner,id,true);directory.create({intermediates:true,idempotent:true});
 const target=rootAttachmentSource(owner,id);if(target.exists)throw Error('Attachment already staged');source.copy(target);
}
function check(current:()=>boolean){if(!current())throw Error('Unlock your account to continue');}
/** Streams bounded chunks; original file names never become filesystem paths. */
export async function prepareRootAttachment(input:{id:string;name:string;mime:string;recipient:IdentityRecord;current():boolean}):Promise<AttachmentDescriptor>{
 const owner=localAccount.status().account,record=localAccount.publicRecord(),device=localAccount.callDevice();
 if(!owner||!record||!device||!verifyRecord(input.recipient,Date.now()))throw Error('Attachment identity unavailable');
 check(input.current);const directory=folder(owner,input.id,true),metadata=new File(directory,'descriptor.json');
 if(metadata.exists){const saved=JSON.parse(metadata.textSync());if(!validAttachmentDescriptor(saved)||saved.manifest.sender!==owner||saved.manifest.recipient!==input.recipient.account
  ||saved.manifest.senderDevice!==device||!verifyAttachmentManifest(saved.manifest,record,Date.now())||!rootAttachmentFile(owner,attachmentDigest(saved.manifest)).exists)throw Error('Prepared attachment expired or changed');return saved;}
 const source=rootAttachmentSource(owner,input.id),cipher=new File(directory,'ciphertext'),content=new File(directory,'content'),treeFile=new File(directory,'tree.json');
 if(!source.exists||source.size<1||source.size>ATTACHMENT_MAX_BYTES)throw Error('Attachment source unavailable');
 const key=hexToBytes(await Native!.identityRandomBytes!(32));let sourceHandle:ReturnType<File['open']>|undefined,cipherHandle:ReturnType<File['open']>|undefined,ownHandle:ReturnType<File['open']>|undefined;
 let committed=false,createdFinal:Directory|undefined;
 try{
  check(input.current);const now=Date.now(),fields={version:1 as const,id:input.id,sender:owner,senderDevice:device,recipient:input.recipient.account,recipientDevice:input.recipient.devices[0].id,created:now,expires:now+ATTACHMENT_TTL-30000,bytes:source.size};
  for(const file of [cipher,content,treeFile])if(file.exists)file.delete();cipher.create();content.create();
  sourceHandle=source.open();cipherHandle=cipher.open();ownHandle=content.open();const leaves:string[]=[],checksum=sha256.create();
  for(let index=0;index<Math.ceil(fields.bytes/ATTACHMENT_CHUNK_BYTES);index++){
   check(input.current);const plain=sourceHandle.readBytes(Math.min(ATTACHMENT_CHUNK_BYTES,fields.bytes-index*ATTACHMENT_CHUNK_BYTES));
   try{checksum.update(plain);ownHandle.writeBytes(plain);const encrypted=encryptAttachmentChunk(fields,index,plain,key);cipherHandle.writeBytes(hexToBytes(encrypted));leaves.push(attachmentLeaf(index,encrypted));}
   finally{plain.fill(0);}if(index%16===15)await pause();
  }
  sourceHandle.close();sourceHandle=undefined;cipherHandle.close();cipherHandle=undefined;ownHandle.close();ownHandle=undefined;check(input.current);
  const tree=buildAttachmentTree(leaves),manifest=localAccount.signAttachment({...fields,root:tree.root});
  const descriptor:AttachmentDescriptor={manifest,key:bytesToHex(key),checksum:bytesToHex(checksum.digest()),name:input.name,mime:input.mime};
  if(!validAttachmentDescriptor(descriptor))throw Error('Invalid file name or type');treeFile.write(JSON.stringify(leaves));
  const target=folder(owner,attachmentDigest(manifest));if(target.exists)throw Error('Attachment destination already exists');target.create({intermediates:true});createdFinal=target;
  for(const [file,name] of [[cipher,'ciphertext'],[content,'content'],[treeFile,'tree.json']] as const)file.move(new File(target,name));
  metadata.write(JSON.stringify(descriptor));committed=true;return descriptor;
 }finally{sourceHandle?.close();cipherHandle?.close();ownHandle?.close();key.fill(0);if(!committed){for(const file of [cipher,content,treeFile,metadata])if(file.exists)file.delete();if(createdFinal?.exists)createdFinal.delete();}}
}
const trees=new Map<string,ReturnType<typeof buildAttachmentTree>>();
export async function readRootAttachmentChunk(job:AttachmentJob,index:number){
 const directory=folder(job.owner,job.digest),cacheKey=job.owner+job.digest;
 let tree=trees.get(cacheKey);if(!tree){const leaves=JSON.parse(new File(directory,'tree.json').textSync());tree=buildAttachmentTree(leaves);
  if(tree.root!==job.descriptor.manifest.root)throw Error('Attachment tree changed');if(trees.size>=2)trees.clear();trees.set(cacheKey,tree);}
 const file=new File(directory,'ciphertext'),handle=file.open();
 try{handle.offset=index*(ATTACHMENT_CHUNK_BYTES+16);const length=Math.min(ATTACHMENT_CHUNK_BYTES,job.descriptor.manifest.bytes-index*ATTACHMENT_CHUNK_BYTES)+16;
  return {index,ciphertext:bytesToHex(handle.readBytes(length)),proof:tree.proof(index)};
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
 const handle=file.open(),checksum=sha256.create();
 try{for(let offset=0;offset<file.size;offset+=65536){check(current);const bytes=handle.readBytes(Math.min(65536,file.size-offset));try{checksum.update(bytes);}finally{bytes.fill(0);}await pause();}}
 finally{handle.close();}
 check(current);if(bytesToHex(checksum.digest())!==job.descriptor.checksum){if(final.exists)final.delete();throw new AttachmentFileReset('Attachment checksum failed');}
 if(!final.exists)partial.move(final);
}
