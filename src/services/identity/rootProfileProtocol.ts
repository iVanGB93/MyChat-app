import {ed25519} from '@noble/curves/ed25519.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {accountId,validAccountId,verifyPublicSignature} from './identityProtocol.ts';

// Private chat control traffic; never advertised in the public identity directory.
export const PROFILE_MAX_BYTES=16*1024,PROFILE_CHUNK_BYTES=640;
export type ProfileManifest={root:string;revision:number;hash:string;bytes:number;signature:string};
export type OwnProfile={manifest:ProfileManifest;data:string};
export type ProfilePart={manifest:ProfileManifest;index:number;data:string};
export type ProfileRequest={peer:string;id:string;known:string|null};
export type ProfileDelivery={peer:string;acked:number[]};
export type ProfileCache={current?:OwnProfile;pending?:{manifest:ProfileManifest;parts:(string|null)[]}};
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length===n&&/^[a-f0-9]*$/.test(v);
const body=(m:Omit<ProfileManifest,'signature'>)=>utf8ToBytes(JSON.stringify(['axonic-private-avatar-v1',m.root,m.revision,m.hash,m.bytes,'image/jpeg']));
export const profileHash=(bytes:Uint8Array)=>bytesToHex(sha256(bytes));
export const profileCount=(m:ProfileManifest)=>Math.max(1,Math.ceil(m.bytes/PROFILE_CHUNK_BYTES));
export function validProfileManifest(m:unknown,owner:string):m is ProfileManifest{
 try{const v=m as ProfileManifest;return !!v&&Object.keys(v).sort().join(',')==='bytes,hash,revision,root,signature'&&hex(v.root,64)&&accountId(v.root)===owner&&Number.isSafeInteger(v.revision)&&v.revision>0&&v.revision<=8640000000000000&&hex(v.hash,64)&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=PROFILE_MAX_BYTES&&hex(v.signature,128)&&verifyPublicSignature(hexToBytes(v.signature),body(v),hexToBytes(v.root),{zip215:false});}catch{return false;}
}
/** Reject oversized decoded images as well as oversized encoded files. */
export function validProfileJpeg(bytes:Uint8Array){
 if(!bytes.length)return true; // Signed removal.
 if(bytes.length>PROFILE_MAX_BYTES||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return false;
 let offset=2;
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)return false;while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];if(marker===217||marker===218)return false;
  const size=(bytes[offset]<<8)|bytes[offset+1];if(size<2||offset+size>bytes.length)return false;
  if([192,193,194].includes(marker)){const height=(bytes[offset+3]<<8)|bytes[offset+4],width=(bytes[offset+5]<<8)|bytes[offset+6];return size>=8&&width>0&&height>0&&width<=256&&height<=256;}
  offset+=size;
 }return false;
}
export function signProfile(data:Uint8Array,revision:number,rootSeed:Uint8Array):OwnProfile{
 if(!validProfileJpeg(data))throw Error('Choose a small JPEG avatar');
 const m={root:bytesToHex(ed25519.getPublicKey(rootSeed)),revision,hash:profileHash(data),bytes:data.length};
 const manifest={...m,signature:bytesToHex(ed25519.sign(body(m),rootSeed))};
 if(!validProfileManifest(manifest,accountId(m.root)))throw Error('Invalid avatar version');
 return {manifest,data:bytesToHex(data)};
}
export function validOwnProfile(p:unknown,owner:string):p is OwnProfile{
 try{const v=p as OwnProfile;return !!v&&validProfileManifest(v.manifest,owner)&&hex(v.data,v.manifest.bytes*2)&&profileHash(hexToBytes(v.data))===v.manifest.hash&&validProfileJpeg(hexToBytes(v.data));}catch{return false;}
}
export const profilePartId=(owner:string,peer:string,m:ProfileManifest,index:number)=>profileHash(utf8ToBytes(JSON.stringify(['axonic-avatar-part-v1',owner,peer,m.revision,m.hash,index])));
export function profilePackets(owner:string,peer:string,p:OwnProfile,acked:number[]){
 return Array.from({length:profileCount(p.manifest)},(_,index)=>{const id=profilePartId(owner,peer,p.manifest,index),part:ProfilePart={manifest:p.manifest,index,data:p.data.slice(index*PROFILE_CHUNK_BYTES*2,(index+1)*PROFILE_CHUNK_BYTES*2)};return {peer,id,index,raw:JSON.stringify(['axonic-avatar-part-v1',peer,id,part])};}).filter(p=>!acked.includes(p.index));
}
export function receiveProfilePart(cache:ProfileCache,from:string,owner:string,id:string,part:ProfilePart,now:number):ProfileCache|null{
 if(!part||Object.keys(part).sort().join(',')!=='data,index,manifest'||!validProfileManifest(part.manifest,from)||part.manifest.revision>now+300000||!validAccountId(owner))return null;
 const m=part.manifest,count=profileCount(m),length=Math.min(PROFILE_CHUNK_BYTES,Math.max(0,m.bytes-part.index*PROFILE_CHUNK_BYTES));
 if(!Number.isSafeInteger(part.index)||part.index<0||part.index>=count||!hex(part.data,length*2)||id!==profilePartId(from,owner,m,part.index))return null;
 const prior=cache.pending?.manifest??cache.current?.manifest;
 if(prior&&prior.revision>m.revision)return cache;
 if(prior?.revision===m.revision&&prior.hash!==m.hash)return null;
 if(cache.current?.manifest.revision===m.revision)return cache;
 const parts=cache.pending?.manifest.revision===m.revision?[...cache.pending.parts]:Array<string|null>(count).fill(null);
 if(parts[part.index]!==null&&parts[part.index]!==part.data)return null;
 parts[part.index]=part.data;
 if(parts.every(p=>p!==null)){const value={manifest:m,data:parts.join('')};return validOwnProfile(value,from)?{current:value}:null;}
 return {...cache,pending:{manifest:m,parts}};
}
