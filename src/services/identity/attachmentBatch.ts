import {fromByteArray,toByteArray} from 'base64-js';
import type {AttachmentEncoding} from './attachmentEncoding.ts';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {attachmentBlockBytes,ATTACHMENT_MAX_BYTES,verifyAttachmentChunk,type AttachmentManifest,type AttachmentChunk,type AttachmentLeafHash} from './attachmentProtocol.ts';

export const ATTACHMENT_BATCH_CHUNKS=1; // Exactly one authenticated 3 MB block per envelope.
export const ATTACHMENT_BULK_FRAME_BYTES=850_000;
export const ATTACHMENT_STREAM_FRAME_BYTES=4_010_000; // One 3 MB ciphertext block + proof, base64 and bounded envelopes.
/** Transport admission only; the custody endpoint checks manifest bounds,
 * canonical encoding and every proof before its atomic commit. */
export function isAttachmentUploadBatchRequest(raw:string){
 try{const r=JSON.parse(raw);return r?.version===1&&r.operation==='put-batch'
  &&Object.keys(r).sort().join(',')==='count,data,digest,index,operation,version'
  &&typeof r.digest==='string'&&/^[a-f0-9]{64}$/.test(r.digest)
  &&Number.isSafeInteger(r.index)&&r.index>=0&&Number.isSafeInteger(r.count)&&r.count===1
  &&typeof r.data==='string'&&r.data.length<=ATTACHMENT_STREAM_FRAME_BYTES-1024;
 }catch{return false;}
}
export function validAttachmentRange(m:AttachmentManifest,start:number,count:number){
 return m.version===4&&Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=ATTACHMENT_MAX_BYTES&&Number.isSafeInteger(start)&&start>=0
  &&Number.isSafeInteger(count)&&count===1&&start+count<=Math.ceil(m.bytes/attachmentBlockBytes(m));
}
function layout(m:AttachmentManifest,start:number,count:number){
 if(!validAttachmentRange(m,start,count))throw Error('Invalid attachment batch range');
 const block=attachmentBlockBytes(m),depth=1;
 const length=Math.min(count*block,m.bytes-start*block)+count*(16+64*depth);
 return {depth,length};
}
/** Binary ciphertext/proofs in a canonical base64 envelope for the text transport.
 * No plaintext, new encryption format, or unauthenticated replacement for proofs. */
export function packAttachmentBatch(m:AttachmentManifest,start:number,chunks:AttachmentChunk[],hashLeaf?:AttachmentLeafHash,encoding?:AttachmentEncoding){
 const {length}=layout(m,start,chunks.length),bytes=new Uint8Array(length);let offset=0;
 for(let n=0;n<chunks.length;n++){
  const chunk=chunks[n];if(chunk.index!==start+n||!verifyAttachmentChunk(m,chunk,hashLeaf))throw Error('Invalid attachment batch chunk');
  for(const hex of [chunk.ciphertext,...chunk.proof]){const part=(encoding?.fromHex??hexToBytes)(hex);bytes.set(part,offset);offset+=part.length;}
 }
 return (encoding?.toBase64??fromByteArray)(bytes);
}
/** Only decodes bounded framing. Caller must verify each proof/AEAD before storing bytes. */
export function unpackAttachmentBatch(m:AttachmentManifest,start:number,count:number,encoded:unknown,encoding?:AttachmentEncoding):AttachmentChunk[]{
 const {depth,length}=layout(m,start,count);
 if(typeof encoded!=='string'||encoded.length!==4*Math.ceil(length/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Invalid attachment batch encoding');
 // Exact padding and zero unused tail bits establish canonical base64 without
 // re-encoding a multi-megabyte block just to compare it with the input.
 const padding=(3-length%3)%3,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 if((padding===0&&encoded.endsWith('='))||(padding===1&&(!encoded.endsWith('=')||encoded.endsWith('==')))
  ||(padding===2&&!encoded.endsWith('=='))
  ||(padding>0&&(alphabet.indexOf(encoded[encoded.length-padding-1])& (padding===2?15:3))!==0))throw Error('Noncanonical attachment batch');
 const bytes=(encoding?.fromBase64??toByteArray)(encoded);if(bytes.length!==length)throw Error('Noncanonical attachment batch');
 let offset=0;const take=(n:number)=>{const hex=(encoding?.toHex??bytesToHex)(bytes.subarray(offset,offset+n));offset+=n;return hex;};
 return Array.from({length:count},(_,n)=>{const index=start+n,ciphertext=take(Math.min(attachmentBlockBytes(m),m.bytes-index*attachmentBlockBytes(m))+16);
  return {index,ciphertext,proof:Array.from({length:depth},()=>take(64))};});
}
