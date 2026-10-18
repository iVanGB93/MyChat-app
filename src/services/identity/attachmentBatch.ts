import {fromByteArray,toByteArray} from 'base64-js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {ATTACHMENT_CHUNK_BYTES,ATTACHMENT_MAX_BYTES,verifyAttachmentChunk,type AttachmentManifest,type AttachmentChunk,type AttachmentLeafHash} from './attachmentProtocol.ts';

export const ATTACHMENT_BATCH_CHUNKS=128; // 512 KiB of plaintext, existing encryption unchanged.
export const ATTACHMENT_BULK_FRAME_BYTES=850_000;
/** Transport admission only; the custody endpoint checks manifest bounds,
 * canonical encoding and every proof before its atomic commit. */
export function isAttachmentUploadBatchRequest(raw:string){
 try{const r=JSON.parse(raw);return r?.version===1&&r.operation==='put-batch'
  &&Object.keys(r).sort().join(',')==='count,data,digest,index,operation,version'
  &&typeof r.digest==='string'&&/^[a-f0-9]{64}$/.test(r.digest)
  &&Number.isSafeInteger(r.index)&&r.index>=0&&Number.isSafeInteger(r.count)&&r.count>=1&&r.count<=ATTACHMENT_BATCH_CHUNKS
  &&typeof r.data==='string'&&r.data.length<=ATTACHMENT_BULK_FRAME_BYTES-1024;
 }catch{return false;}
}
export function validAttachmentRange(m:AttachmentManifest,start:number,count:number){
 return Number.isSafeInteger(m.bytes)&&m.bytes>0&&m.bytes<=ATTACHMENT_MAX_BYTES&&Number.isSafeInteger(start)&&start>=0
  &&Number.isSafeInteger(count)&&count>=1&&count<=ATTACHMENT_BATCH_CHUNKS&&start+count<=Math.ceil(m.bytes/ATTACHMENT_CHUNK_BYTES);
}
function layout(m:AttachmentManifest,start:number,count:number){
 if(!validAttachmentRange(m,start,count))throw Error('Invalid attachment batch range');
 const depth=Math.ceil(Math.log2(Math.ceil(m.bytes/ATTACHMENT_CHUNK_BYTES)));
 const length=Math.min(count*ATTACHMENT_CHUNK_BYTES,m.bytes-start*ATTACHMENT_CHUNK_BYTES)+count*(16+32*depth);
 return {depth,length};
}
/** Binary ciphertext/proofs in a canonical base64 envelope for the text transport.
 * No plaintext, new encryption format, or unauthenticated replacement for proofs. */
export function packAttachmentBatch(m:AttachmentManifest,start:number,chunks:AttachmentChunk[],hashLeaf?:AttachmentLeafHash){
 const {length}=layout(m,start,chunks.length),bytes=new Uint8Array(length);let offset=0;
 for(let n=0;n<chunks.length;n++){
  const chunk=chunks[n];if(chunk.index!==start+n||!verifyAttachmentChunk(m,chunk,hashLeaf))throw Error('Invalid attachment batch chunk');
  for(const hex of [chunk.ciphertext,...chunk.proof]){const part=hexToBytes(hex);bytes.set(part,offset);offset+=part.length;}
 }
 return fromByteArray(bytes);
}
/** Only decodes bounded framing. Caller must verify each proof/AEAD before storing bytes. */
export function unpackAttachmentBatch(m:AttachmentManifest,start:number,count:number,encoded:unknown):AttachmentChunk[]{
 const {depth,length}=layout(m,start,count);
 if(typeof encoded!=='string'||encoded.length!==4*Math.ceil(length/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw Error('Invalid attachment batch encoding');
 const bytes=toByteArray(encoded);if(bytes.length!==length||fromByteArray(bytes)!==encoded)throw Error('Noncanonical attachment batch');
 let offset=0;const take=(n:number)=>{const hex=bytesToHex(bytes.subarray(offset,offset+n));offset+=n;return hex;};
 return Array.from({length:count},(_,n)=>{const index=start+n,ciphertext=take(Math.min(ATTACHMENT_CHUNK_BYTES,m.bytes-index*ATTACHMENT_CHUNK_BYTES)+16);
  return {index,ciphertext,proof:Array.from({length:depth},()=>take(32))};});
}
