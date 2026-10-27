import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {hexToBytes,bytesToHex,utf8ToBytes} from '@noble/hashes/utils.js';
import {fromByteArray,toByteArray} from 'base64-js';

export interface StreamRecordCrypto {
 seal(key:Uint8Array,nonce:Uint8Array,aad:Uint8Array,plain:Uint8Array):Uint8Array;
 open(key:Uint8Array,nonce:Uint8Array,aad:Uint8Array,ciphertext:Uint8Array):Uint8Array;
}

/** Separate ephemeral record encryption, never the relay block key/nonce schedule.
 * Caller supplies a fresh cryptographically random 16-byte salt on EVERY attempt.
 * Transfer ID is receiver-chosen random 32 bytes; keys bind digest and direction.
 * Plaintext is not released until authentication and exact sequence checks pass.
 */
export function createWssStreamCipher(input:{key:string;digest:string;id:string;salt:Uint8Array;role:'send'|'receive';crypto?:StreamRecordCrypto}){
 const hex=(v:string)=>/^[a-f0-9]{64}$/.test(v);
 if(!hex(input.key)||!hex(input.digest)||!hex(input.id)||input.salt.length!==16)throw Error('Invalid stream binding');
 const direction=input.role==='send'?0:1,base=hexToBytes(input.key);
 const derive=(d:number)=>hkdf(sha256,base,hexToBytes(input.id),utf8ToBytes('axonic-wss-stream-v1:'+input.digest+':'+d),32);
 const outgoing=derive(direction),incoming=derive(1-direction);base.fill(0);
 const salt=bytesToHex(input.salt),digest=input.digest,id=input.id;
 // Per-attempt scratch is never shared with another stream. AEAD is synchronous;
 // ciphertext owns its bytes before this plaintext scratch is cleared/reused.
 const scratch=new Uint8Array(32769),outNonce=new Uint8Array(24);outNonce.set(input.salt);
 const outView=new DataView(outNonce.buffer);
 const header='{"salt":"'+salt+'","seq":';
 let remoteSalt:string|undefined,sendSequence=0,receiveSequence=0,closed=false;
 const nonce=(prefix:string,seq:number)=>{const n=new Uint8Array(24);n.set(hexToBytes(prefix));new DataView(n.buffer).setUint32(20,seq,false);return n;};
 const aad=(d:number,s:string,n:number)=>utf8ToBytes(JSON.stringify(['axonic-wss-stream-v1',digest,id,d,s,n]));
 const seal=(plain:Uint8Array,seq:number)=>input.crypto?input.crypto.seal(outgoing,outNonce,aad(direction,salt,seq),plain):xchacha20poly1305(outgoing,outNonce,aad(direction,salt,seq)).encrypt(plain);
 const open=(encrypted:Uint8Array,s:string,seq:number)=>input.crypto?input.crypto.open(incoming,nonce(s,seq),aad(1-direction,s,seq),encrypted):xchacha20poly1305(incoming,nonce(s,seq),aad(1-direction,s,seq)).decrypt(encrypted);
 return {
  seal(value:string|Uint8Array){
   if(closed||sendSequence>=100000)throw Error('Stream closed');
   const bytes=typeof value==='string'?utf8ToBytes(value):value;
   if(!bytes.length||bytes.length>(typeof value==='string'?1024:8192))throw Error('Stream record too large');
   const plain=scratch.subarray(0,bytes.length+1);plain[0]=typeof value==='string'?0:1;plain.set(bytes,1);
   const seq=sendSequence++;
   outView.setUint32(20,seq,false);
   // All fields are validated numeric/hex/base64; none require JSON escaping.
   // Preserve byte-for-byte v1 encoding without scanning the ciphertext again.
   try{return header+seq+',"data":"'+fromByteArray(seal(plain,seq))+'"}';}
   finally{plain.fill(0);}
  },
  open(raw:string):string|ArrayBuffer{
   if(closed||raw.length>12000||receiveSequence>=100000)throw Error('Invalid stream record');
   const p=JSON.parse(raw);
   if(!p||Object.keys(p).sort().join(',')!=='data,salt,seq'||typeof p.salt!=='string'||!/^[a-f0-9]{32}$/.test(p.salt)
    ||p.seq!==receiveSequence||remoteSalt!==undefined&&p.salt!==remoteSalt||typeof p.data!=='string'||p.data.length>10948
    ||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))throw Error('Invalid stream sequence');
   const ciphertext=toByteArray(p.data);
   if(ciphertext.length<18||ciphertext.length>8209||fromByteArray(ciphertext)!==p.data)throw Error('Invalid stream encoding');
   const plain=open(ciphertext,p.salt,p.seq);
   try{
    if(plain[0]!==0&&plain[0]!==1||plain[0]===0&&plain.length>1025)throw Error('Invalid stream payload');
    const value=plain[0]===0?new TextDecoder('utf-8',{fatal:true}).decode(plain.subarray(1)):plain.slice(1).buffer;
    remoteSalt=p.salt;receiveSequence++;return value;
   }finally{plain.fill(0);}
  },
  sealBinary(value:string|Uint8Array){
   if(closed||sendSequence>=100000)throw Error('Stream closed');
   const bytes=typeof value==='string'?utf8ToBytes(value):value;
   if(!bytes.length||bytes.length>(typeof value==='string'?1024:32768))throw Error('Stream record too large');
   const plain=scratch.subarray(0,bytes.length+1);plain[0]=typeof value==='string'?0:1;plain.set(bytes,1);
   const seq=sendSequence++;outView.setUint32(20,seq,false);
   try{const encrypted=seal(plain,seq);
    const frame=new Uint8Array(20+encrypted.length);frame.set(outNonce.subarray(0,16));new DataView(frame.buffer).setUint32(16,seq,false);frame.set(encrypted,20);return frame;
   }finally{plain.fill(0);}
  },
  openBinary(raw:Uint8Array):string|ArrayBuffer{
   if(closed||raw.length<38||raw.length>32805||receiveSequence>=100000)throw Error('Invalid binary stream record');
   const s=bytesToHex(raw.subarray(0,16)),seq=new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(16,false);
   if(seq!==receiveSequence||remoteSalt!==undefined&&s!==remoteSalt)throw Error('Invalid stream sequence');
   const plain=open(raw.subarray(20),s,seq);
   try{if(plain[0]!==0&&plain[0]!==1||plain[0]===0&&plain.length>1025)throw Error('Invalid stream payload');
    const value=plain[0]===0?new TextDecoder('utf-8',{fatal:true}).decode(plain.subarray(1)):plain.slice(1).buffer;
    remoteSalt=s;receiveSequence++;return value;
   }finally{plain.fill(0);}
  },
  close(){closed=true;outgoing.fill(0);incoming.fill(0);scratch.fill(0);outNonce.fill(0);},
 };
}
