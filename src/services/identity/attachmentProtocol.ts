/** Encrypted attachment chunks shared by ordinary phone and hosted neurons. */
import {ed25519} from '@noble/curves/ed25519.js';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {validAccountId,verifyRecord,verifyPublicSignature,type IdentityRecord} from './identityProtocol.ts';

export const ATTACHMENT_CHUNK_BYTES=4096;
export const ATTACHMENT_MAX_BYTES=250*1024*1024;
export const ATTACHMENT_TTL=24*60*60*1000;
export interface AttachmentManifest {
 version:1;id:string;sender:string;senderDevice:string;recipient:string;recipientDevice:string;
 created:number;expires:number;bytes:number;root:string;signature:string;
}
export interface AttachmentChunk {index:number;ciphertext:string;proof:string[]}
export interface AttachmentReceipt {version:1;id:string;digest:string;recipient:string;device:string;expires:number;signature:string}
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length===n*2&&/^[a-f0-9]+$/.test(v);
const encode=(v:unknown[])=>utf8ToBytes(JSON.stringify(v));
const hash=(v:unknown[])=>bytesToHex(sha256(encode(v)));
const count=(bytes:number)=>Math.ceil(bytes/ATTACHMENT_CHUNK_BYTES);
const body=(m:AttachmentManifest)=>encode(['axonic-attachment-v1',m.version,m.id,m.sender,m.senderDevice,m.recipient,m.recipientDevice,m.created,m.expires,m.bytes,m.root]);
export const attachmentDigest=(m:AttachmentManifest)=>hash([bytesToHex(body(m)),m.signature]);
export function validAttachmentManifest(m:unknown,now:number):m is AttachmentManifest {
 const a=m as AttachmentManifest;
 return !!a&&Number.isSafeInteger(now)&&now>=0&&a.version===1&&hex(a.id,32)&&validAccountId(a.sender)&&validAccountId(a.recipient)&&a.sender!==a.recipient
  &&hex(a.senderDevice,32)&&hex(a.recipientDevice,32)&&hex(a.root,32)&&hex(a.signature,64)
  &&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=ATTACHMENT_MAX_BYTES
  &&Number.isSafeInteger(a.created)&&a.created>=0&&a.created<=now+30000&&Number.isSafeInteger(a.expires)
  &&a.expires>now&&a.expires>a.created&&a.expires-a.created<=ATTACHMENT_TTL&&a.expires<=now+ATTACHMENT_TTL;
}
export function signAttachmentManifest(fields:Omit<AttachmentManifest,'signature'>,seed:Uint8Array,record:IdentityRecord,now:number):AttachmentManifest {
 const m={...fields,signature:'00'.repeat(64)};
 if(!validAttachmentManifest(m,now)||!verifyRecord(record,now)||record.account!==m.sender
  ||!record.devices.some(d=>d.id===m.senderDevice&&d.signing===bytesToHex(ed25519.getPublicKey(seed))))throw Error('Invalid attachment owner');
 m.signature=bytesToHex(ed25519.sign(body(m),seed));return m;
}
export function verifyAttachmentManifest(m:unknown,record:IdentityRecord,now:number):m is AttachmentManifest {
 try{if(!validAttachmentManifest(m,now)||!verifyRecord(record,now)||record.account!==m.sender)return false;
  // Cache only the exact public signature result. Expiry, identity and current
  // device membership above are still checked for every chunk/request.
  const d=record.devices.find(d=>d.id===m.senderDevice);return !!d&&verifyPublicSignature(hexToBytes(m.signature),body(m),hexToBytes(d.signing),{zip215:false});
 }catch{return false;}
}
type ChunkContext=Pick<AttachmentManifest,'id'|'sender'|'recipient'|'recipientDevice'|'bytes'>;
function chunkContext(m:ChunkContext,index:number){
 if(!hex(m.id,32)||!validAccountId(m.sender)||!validAccountId(m.recipient)||m.sender===m.recipient||!hex(m.recipientDevice,32)
  ||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>ATTACHMENT_MAX_BYTES||!Number.isSafeInteger(index)||index<0||index>=count(m.bytes))throw Error('Invalid attachment chunk');
 const aad=encode(['axonic-attachment-chunk-v1',m.id,m.sender,m.recipient,m.recipientDevice,m.bytes,index]);
 return {aad,nonce:sha256(aad).slice(0,24),length:Math.min(ATTACHMENT_CHUNK_BYTES,m.bytes-index*ATTACHMENT_CHUNK_BYTES)};
}
/** A fresh random key per attachment is carried only inside the encrypted chat descriptor. */
export function encryptAttachmentChunk(m:ChunkContext,index:number,plain:Uint8Array,key:Uint8Array){
 const c=chunkContext(m,index);if(key.length!==32||plain.length!==c.length)throw Error('Invalid attachment bytes');
 return bytesToHex(xchacha20poly1305(key,c.nonce,c.aad).encrypt(plain));
}
export function decryptAttachmentChunk(m:AttachmentManifest,chunk:AttachmentChunk,key:Uint8Array){
 if(!verifyAttachmentChunk(m,chunk)||key.length!==32)throw Error('Invalid attachment proof');
 const c=chunkContext(m,chunk.index);return xchacha20poly1305(key,c.nonce,c.aad).decrypt(hexToBytes(chunk.ciphertext));
}
export function attachmentLeaf(index:number,ciphertext:string){
 if(!Number.isSafeInteger(index)||index<0||index>=count(ATTACHMENT_MAX_BYTES)||typeof ciphertext!=='string'
  ||ciphertext.length<34||ciphertext.length>(ATTACHMENT_CHUNK_BYTES+16)*2||!/^(?:[a-f0-9]{2})+$/.test(ciphertext))throw Error('Invalid attachment leaf');
 return hash(['axonic-attachment-leaf-v1',index,ciphertext]);
}
const parent=(a:string,b:string)=>hash(['axonic-attachment-branch-v1',a,b]);
/** Tree contains only ciphertext hashes: at most about 8 MiB for a 250 MiB file. */
export function buildAttachmentTree(leaves:string[]){
 if(!leaves.length||leaves.length>count(ATTACHMENT_MAX_BYTES)||!leaves.every(v=>hex(v,32)))throw Error('Invalid attachment tree');
 const levels=[leaves.slice()];while(levels.at(-1)!.length>1){const previous=levels.at(-1)!,next:string[]=[];
  for(let i=0;i<previous.length;i+=2)next.push(parent(previous[i],previous[i+1]??previous[i]));levels.push(next);}
 return {root:levels.at(-1)![0],proof(index:number){
  if(!Number.isSafeInteger(index)||index<0||index>=leaves.length)throw Error('Invalid chunk index');
  const proof:string[]=[];for(const level of levels.slice(0,-1)){proof.push(level[index^1]??level[index]);index=Math.floor(index/2);}return proof;
 }};
}
export function verifyAttachmentChunk(m:AttachmentManifest,chunk:AttachmentChunk):boolean {
 try{const c=chunkContext(m,chunk.index);
  if(!Array.isArray(chunk.proof)||chunk.proof.length!==Math.ceil(Math.log2(count(m.bytes)))||!chunk.proof.every(v=>hex(v,32))||!hex(chunk.ciphertext,c.length+16))return false;
  let digest=attachmentLeaf(chunk.index,chunk.ciphertext),index=chunk.index;
  for(const sibling of chunk.proof){digest=index%2?parent(sibling,digest):parent(digest,sibling);index=Math.floor(index/2);}return digest===m.root;
 }catch{return false;}
}
const receiptBody=(r:AttachmentReceipt)=>encode(['axonic-attachment-receipt-v1',r.version,r.id,r.digest,r.recipient,r.device,r.expires]);
/** Sign only after the receiver has durably stored and verified the complete file. */
export function signAttachmentReceipt(m:AttachmentManifest,seed:Uint8Array,record:IdentityRecord,now:number):AttachmentReceipt {
 const r:AttachmentReceipt={version:1,id:m.id,digest:attachmentDigest(m),recipient:m.recipient,device:m.recipientDevice,expires:m.expires,signature:'00'.repeat(64)};
 if(!validAttachmentManifest(m,now)||!verifyRecord(record,now)||record.account!==r.recipient||!record.devices.some(d=>d.id===r.device&&d.signing===bytesToHex(ed25519.getPublicKey(seed))))throw Error('Invalid attachment recipient');
 r.signature=bytesToHex(ed25519.sign(receiptBody(r),seed));return r;
}
export function verifyAttachmentReceipt(r:AttachmentReceipt,m:AttachmentManifest,record:IdentityRecord,now:number){
 try{if(!validAttachmentManifest(m,now)||!verifyRecord(record,now)||record.account!==m.recipient||r.version!==1||r.id!==m.id||r.digest!==attachmentDigest(m)
  ||r.recipient!==m.recipient||r.device!==m.recipientDevice||r.expires!==m.expires||!hex(r.signature,64))return false;
  const d=record.devices.find(d=>d.id===r.device);return !!d&&verifyPublicSignature(hexToBytes(r.signature),receiptBody(r),hexToBytes(d.signing),{zip215:false});
 }catch{return false;}
}
