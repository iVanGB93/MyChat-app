/** Encrypted attachment chunks shared by ordinary phone and hosted neurons. */
import {ed25519} from '@noble/curves/ed25519.js';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {validAccountId,verifyRecord,verifyPublicSignature,type IdentityRecord} from './identityProtocol.ts';
import type {AttachmentEncoding} from './attachmentEncoding.ts';

/** A whole file through 3 MB, then independently authenticated 3 MB blocks. */
export const ATTACHMENT_STREAM_BLOCK_BYTES=3_000_000;
export const attachmentBlockBytes=(m:{version?:number})=>{if(m.version!==4)throw Error('Unsupported attachment format');return ATTACHMENT_STREAM_BLOCK_BYTES;};
export const ATTACHMENT_MAX_BYTES=250*1024*1024;
export const ATTACHMENT_TTL=24*60*60*1000;
export interface AttachmentManifest {
 version:4;id:string;sender:string;senderDevice:string;recipient:string;recipientDevice:string;
 /** root is the sender-only block signing key's PUBLIC key; checksum is a
  * randomized commitment, not the plaintext file checksum. Both are signed. */
 created:number;expires:number;bytes:number;root:string;checksum:string;signature:string;
 shared?:{id:string;count:number;slot:number};
}
export interface AttachmentChunk {index:number;ciphertext:string;proof:string[]}
/** Trusted local SHA-256 implementation over the exact ASCII leaf serialization. */
export type AttachmentLeafHash=(canonical:string)=>string;
export interface AttachmentReceipt {version:1;id:string;digest:string;recipient:string;device:string;expires:number;signature:string}
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length===n*2&&/^[a-f0-9]+$/.test(v);
const encode=(v:unknown[])=>utf8ToBytes(JSON.stringify(v));
const hash=(v:unknown[])=>bytesToHex(sha256(encode(v)));
const count=(bytes:number)=>Math.ceil(bytes/ATTACHMENT_STREAM_BLOCK_BYTES);
const body=(m:AttachmentManifest)=>encode(['axonic-attachment-v4',m.version,m.id,m.sender,m.senderDevice,m.recipient,m.recipientDevice,m.created,m.expires,m.bytes,m.root,m.checksum,...(m.shared?[m.shared.id,m.shared.count,m.shared.slot]:[])]);
/** Hide the plaintext checksum from custodians; key and checksum stay in the
 * encrypted chat descriptor. Random per-file keys prevent public content correlation. */
export function attachmentChecksumCommitment(checksum:string,key:string){
 if(!hex(checksum,32)||!hex(key,32))throw Error('Invalid attachment checksum commitment');
 return hash(['axonic-attachment-checksum-v4',key,checksum]);
}
export const attachmentDigest=(m:AttachmentManifest)=>hash([bytesToHex(body(m)),m.signature]);
/** Ciphertext address only; access always requires a separately verified recipient grant. */
export const attachmentContentDigest=(m:AttachmentManifest)=>m.shared?hash(['axonic-attachment-content-v4',m.sender,m.senderDevice,m.shared.id,m.shared.count,m.created,m.expires,m.bytes,m.root,m.checksum]):attachmentDigest(m);
const validShared=(m:Pick<AttachmentManifest,'shared'>)=>m.shared===undefined||!!m.shared&&Object.keys(m.shared).sort().join(',')==='count,id,slot'&&hex(m.shared.id,32)&&Number.isSafeInteger(m.shared.count)&&m.shared.count>=1&&m.shared.count<=9&&Number.isSafeInteger(m.shared.slot)&&m.shared.slot>=0&&m.shared.slot<m.shared.count;
export function validAttachmentManifest(m:unknown,now:number):m is AttachmentManifest {
 const a=m as AttachmentManifest;
 return !!a&&a.version===4&&Number.isSafeInteger(now)&&now>=0&&validShared(a)&&hex(a.id,32)&&validAccountId(a.sender)&&validAccountId(a.recipient)&&a.sender!==a.recipient
  &&hex(a.senderDevice,32)&&hex(a.recipientDevice,32)&&hex(a.root,32)&&hex(a.checksum,32)&&hex(a.signature,64)
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
type ChunkContext=Pick<AttachmentManifest,'version'|'id'|'sender'|'recipient'|'recipientDevice'|'bytes'>&Partial<Pick<AttachmentManifest,'shared'|'senderDevice'>>;
function chunkLength(m:ChunkContext,index:number){
 if(m.version!==4||!hex(m.id,32)||!validAccountId(m.sender)||!validAccountId(m.recipient)||m.sender===m.recipient||!hex(m.recipientDevice,32)
  ||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>ATTACHMENT_MAX_BYTES||!Number.isSafeInteger(index)||index<0||index>=count(m.bytes))throw Error('Invalid attachment chunk');
 return Math.min(attachmentBlockBytes(m),m.bytes-index*attachmentBlockBytes(m));
}
/** Canonical authenticated bytes shared with the optional native preparer. */
export function attachmentChunkAAD(m:ChunkContext,index:number){
 chunkLength(m,index);
 if(m.shared!==undefined&&(!validShared(m)||!hex(m.senderDevice,32)))throw Error('Invalid shared attachment');
 return JSON.stringify(m.shared?['axonic-attachment-shared-block-v4',m.shared.id,m.sender,m.senderDevice,m.shared.count,m.bytes,index]:['axonic-attachment-block-v4',m.id,m.sender,m.recipient,m.recipientDevice,m.bytes,index]);
}
function chunkContext(m:ChunkContext,index:number){
 const length=chunkLength(m,index),aad=utf8ToBytes(attachmentChunkAAD(m,index));
 return {aad,nonce:sha256(aad).slice(0,24),length};
}
/** A fresh random key per attachment is carried only inside the encrypted chat descriptor. */
export function encryptAttachmentChunk(m:ChunkContext,index:number,plain:Uint8Array,key:Uint8Array,encoding?:AttachmentEncoding){
 return (encoding?.toHex??bytesToHex)(encryptAttachmentChunkBytes(m,index,plain,key));
}
/** File preparation keeps ciphertext binary; the wire format still uses hex. */
export function encryptAttachmentChunkBytes(m:ChunkContext,index:number,plain:Uint8Array,key:Uint8Array){
 const c=chunkContext(m,index);if(key.length!==32||plain.length!==c.length)throw Error('Invalid attachment bytes');
 return xchacha20poly1305(key,c.nonce,c.aad).encrypt(plain);
}
export function decryptAttachmentChunk(m:AttachmentManifest,chunk:AttachmentChunk,key:Uint8Array,hashLeaf?:AttachmentLeafHash,encoding?:AttachmentEncoding){
 if(!verifyAttachmentChunk(m,chunk,hashLeaf)||key.length!==32)throw Error('Invalid attachment proof');
 const c=chunkContext(m,chunk.index);return xchacha20poly1305(key,c.nonce,c.aad).decrypt((encoding?.fromHex??hexToBytes)(chunk.ciphertext));
}
/** Platform primitive only: authentication of the sender's block remains shared.
 * A native rejection never falls back to a different decryptor. */
export type AttachmentBlockDecrypt=(ciphertext:string,key:Uint8Array,aad:string)=>Promise<Uint8Array>;
export async function decryptAttachmentChunkAsync(m:AttachmentManifest,chunk:AttachmentChunk,key:Uint8Array,hashLeaf?:AttachmentLeafHash,encoding?:AttachmentEncoding,decrypt?:AttachmentBlockDecrypt){
 if(!decrypt)return decryptAttachmentChunk(m,chunk,key,hashLeaf,encoding);
 if(!verifyAttachmentChunk(m,chunk,hashLeaf)||key.length!==32)throw Error('Invalid attachment proof');
 const c=chunkContext(m,chunk.index),plain=await decrypt(chunk.ciphertext,key,attachmentChunkAAD(m,chunk.index));
 if(!(plain instanceof Uint8Array)||plain.length!==c.length){if(plain instanceof Uint8Array)plain.fill(0);throw Error('Invalid attachment plaintext');}
 return plain;
}
export function attachmentLeaf(index:number,ciphertext:string,hashLeaf?:AttachmentLeafHash){
 if(!Number.isSafeInteger(index)||index<0||index>=count(ATTACHMENT_MAX_BYTES)||typeof ciphertext!=='string'
  ||ciphertext.length<34||ciphertext.length>(ATTACHMENT_STREAM_BLOCK_BYTES+16)*2||ciphertext.length%2||!/^[a-f0-9]+$/.test(ciphertext))throw Error('Invalid attachment leaf');
 return hashAttachmentLeaf(index,ciphertext,hashLeaf);
}
/** Locally encrypted bytes need no hex parsing/validation round trip. The
 * canonical hash input is byte-for-byte identical to the network leaf format. */
export function attachmentLeafBytes(index:number,ciphertext:Uint8Array,hashLeaf?:AttachmentLeafHash){
 if(!Number.isSafeInteger(index)||index<0||index>=count(ATTACHMENT_MAX_BYTES)||!(ciphertext instanceof Uint8Array)
  ||ciphertext.length<17||ciphertext.length>ATTACHMENT_STREAM_BLOCK_BYTES+16)throw Error('Invalid attachment leaf');
 return hashAttachmentLeaf(index,bytesToHex(ciphertext),hashLeaf);
}
function hashAttachmentLeaf(index:number,ciphertext:string,hashLeaf?:AttachmentLeafHash){
 const fields=['axonic-attachment-leaf-v1',index,ciphertext];
 if(!hashLeaf)return hash(fields);
 const digest=hashLeaf(JSON.stringify(fields));if(!hex(digest,32))throw Error('Invalid attachment hash result');return digest;
}
/** v4 root is the per-file Ed25519 verification key, not a ciphertext Merkle
 * root. The independent random signing seed stays on the sender. A signed
 * checksum fixes the content before any relay ciphertext is generated.
 * Shared grants bind the same content context, never their recipient slot. */
export const attachmentBlockPublicKey=(seed:Uint8Array)=>bytesToHex(ed25519.getPublicKey(seed));
const blockSignatureBody=(m:AttachmentManifest,index:number,leaf:string)=>encode([
 'axonic-attachment-block-signature-v4',attachmentChunkAAD(m,index),
 m.created,m.expires,m.checksum,leaf
]);
export function signAttachmentBlock(m:AttachmentManifest,index:number,ciphertext:string,seed:Uint8Array,hashLeaf?:AttachmentLeafHash):AttachmentChunk {
 if(seed.length!==32||attachmentBlockPublicKey(seed)!==m.root||!hex(m.checksum,32)
  ||!hex(ciphertext,chunkLength(m,index)+16))throw Error('Invalid attachment block signer');
 return {index,ciphertext,proof:[bytesToHex(ed25519.sign(blockSignatureBody(m,index,attachmentLeaf(index,ciphertext,hashLeaf)),seed))]};
}
export function verifyAttachmentChunk(m:AttachmentManifest,chunk:AttachmentChunk,hashLeaf?:AttachmentLeafHash):boolean {
 try{
  const length=chunkLength(m,chunk.index);
  if(!hex(m.root,32)||!hex(m.checksum,32)||!Array.isArray(chunk.proof)||chunk.proof.length!==1
   ||!hex(chunk.proof[0],64)||!hex(chunk.ciphertext,length+16))return false;
  return verifyPublicSignature(hexToBytes(chunk.proof[0]),blockSignatureBody(m,chunk.index,attachmentLeaf(chunk.index,chunk.ciphertext,hashLeaf)),hexToBytes(m.root),{zip215:false});
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
