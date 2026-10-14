/** Shared ciphertext with individually sealed device grants. V1 custody receipts
 * still acknowledge one recipient; the signed payload commits to the full list. */
import {ed25519} from '@noble/curves/ed25519.js';
import {xchacha20poly1305} from '@noble/ciphers/chacha.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes,utf8ToBytes} from '@noble/hashes/utils.js';
import {publicDevice,validAccountId,verifyRecord,type IdentityRecord} from './identityProtocol.ts';
import {custodyDigest,sealCustody,parseCustody,verifyCustody,CUSTODY_TTL,type CustodyEnvelope} from './custodyProtocol.ts';
import type {IdentityRecordStore} from './identityAdmission.ts';
export const GROUP_CUSTODY_BYTES=60000;
type Recipient={id:string;recipient:string;recipientDevice:string;digest:string};
export interface GroupCustodyPayload {version:1;id:string;sender:string;senderDevice:string;created:number;expires:number;nonce:string;ciphertext:string;recipients:Recipient[];signature:string}
export interface GroupCustodyJob {payload:GroupCustodyPayload;grants:CustodyEnvelope[]}
const hex=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length===n*2&&/^[a-f0-9]+$/.test(v);
const encode=(v:unknown)=>utf8ToBytes(JSON.stringify(v));
const header=(p:GroupCustodyPayload)=>['axonic-group-custody-v1',p.version,p.id,p.sender,p.senderDevice,p.created,p.expires,p.nonce];
const contentDigest=(p:GroupCustodyPayload)=>bytesToHex(sha256(encode([...header(p),p.ciphertext])));
const signed=(p:GroupCustodyPayload)=>encode([...header(p),p.ciphertext,p.recipients.map(r=>[r.id,r.recipient,r.recipientDevice,r.digest])]);
export const groupCustodyDigest=(p:GroupCustodyPayload)=>bytesToHex(sha256(encode([bytesToHex(signed(p)),p.signature])));
export function validGroupCustodyPayload(value:unknown,now:number):value is GroupCustodyPayload{
 const p=value as GroupCustodyPayload;
 return !!p&&Object.keys(p).sort().join(',')==='ciphertext,created,expires,id,nonce,recipients,sender,senderDevice,signature,version'
 &&p.version===1&&hex(p.id,32)&&validAccountId(p.sender)&&hex(p.senderDevice,32)&&hex(p.nonce,24)&&hex(p.signature,64)
 &&Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(p.created)&&p.created>=0&&p.created<=now+30000
 &&Number.isSafeInteger(p.expires)&&p.expires>now&&p.expires>p.created&&p.expires-p.created<=CUSTODY_TTL&&p.expires<=now+CUSTODY_TTL
 &&typeof p.ciphertext==='string'&&p.ciphertext.length>=34&&p.ciphertext.length<=4128&&/^(?:[a-f0-9]{2})+$/.test(p.ciphertext)
 &&Array.isArray(p.recipients)&&p.recipients.length>=2&&p.recipients.length<=9
 &&p.recipients.every(r=>r&&Object.keys(r).sort().join(',')==='digest,id,recipient,recipientDevice'&&hex(r.id,32)&&hex(r.digest,32)&&validAccountId(r.recipient)&&r.recipient!==p.sender&&hex(r.recipientDevice,32))
 &&new Set(p.recipients.map(r=>r.recipient)).size===p.recipients.length&&new Set(p.recipients.map(r=>r.id)).size===p.recipients.length;
}
export async function verifyGroupCustodyPayload(p:GroupCustodyPayload,records:IdentityRecordStore,now:number){
 try{if(!validGroupCustodyPayload(p,now))return false;const record=await records.read(p.sender),device=record?.devices.find(v=>v.id===p.senderDevice);
 return !!record&&record.account===p.sender&&verifyRecord(record,now)&&!!device&&ed25519.verify(hexToBytes(p.signature),signed(p),hexToBytes(device.signing),{zip215:false});}catch{return false;}
}
export function matchesGroupGrant(p:GroupCustodyPayload,e:CustodyEnvelope){return e.sender===p.sender&&e.senderDevice===p.senderDevice&&e.created===p.created&&e.expires===p.expires&&p.recipients.some(r=>r.id===e.id&&r.recipient===e.recipient&&r.recipientDevice===e.recipientDevice&&r.digest===custodyDigest(e));}
export async function verifyGroupCustodyJob(job:GroupCustodyJob,records:IdentityRecordStore,now:number){
 try{if(!job||Object.keys(job).sort().join(',')!=='grants,payload'||JSON.stringify(job).length>GROUP_CUSTODY_BYTES||!await verifyGroupCustodyPayload(job.payload,records,now)
 ||!Array.isArray(job.grants)||job.grants.length!==job.payload.recipients.length||new Set(job.grants.map(e=>e.id)).size!==job.grants.length)return false;
 for(const e of job.grants)if(!parseCustody(JSON.stringify(e),now)||!matchesGroupGrant(job.payload,e)||!await verifyCustody(e,records,now))return false;
 return true;}catch{return false;}
}
/** Encrypt the common body once. Individually sealed grants contain only the
 * content key and small per-recipient fields, never another copy of the body. */
export async function sealGroupCustody(d:{record:IdentityRecord;signingSeed:Uint8Array;encryptionSeed:Uint8Array;id:string;text:string;
 recipients:{record:IdentityRecord;device:string;id:string;metadata:string}[];now:number;random(n:number):Promise<Uint8Array>}):Promise<GroupCustodyJob>{
 if(!hex(d.id,32)||!d.text||utf8ToBytes(d.text).length>2048||d.recipients.length<2||d.recipients.length>9
 ||new Set(d.recipients.map(r=>r.record.account)).size!==d.recipients.length||new Set(d.recipients.map(r=>r.id)).size!==d.recipients.length)throw Error('Invalid group delivery');
 const key=await d.random(32),plain=utf8ToBytes(d.text);let nonce:Uint8Array|undefined;
 try{
 nonce=await d.random(24);
 if(key.length!==32||nonce.length!==24)throw Error('Invalid group randomness');
 const payload:GroupCustodyPayload={version:1,id:d.id,sender:d.record.account,senderDevice:publicDevice(d.signingSeed,d.encryptionSeed).id,created:d.now,expires:d.now+CUSTODY_TTL-30000,nonce:bytesToHex(nonce),ciphertext:'',recipients:[],signature:''};
 payload.ciphertext=bytesToHex(xchacha20poly1305(key,nonce,encode(header(payload))).encrypt(plain));
 const digest=contentDigest(payload),grants:CustodyEnvelope[]=[];
 for(const r of d.recipients){if(typeof r.metadata!=='string'||utf8ToBytes(r.metadata).length>1400)throw Error('Group recipient metadata too large');
 const text=JSON.stringify(['axonic-group-grant-v1',d.id,digest,bytesToHex(key),r.metadata]);
 const envelope=await sealCustody({...d,recipient:r.record,recipientDevice:r.device,id:r.id,text});
 // Reactions and edits must not create a new-message notification.
 try{if(JSON.parse(d.text)?.[0]==='axonic-root-group-action-v1')delete envelope.wakeSignature;}catch{}
 grants.push(envelope);}
 payload.recipients=grants.map(e=>({id:e.id,recipient:e.recipient,recipientDevice:e.recipientDevice,digest:custodyDigest(e)}));
 payload.signature=bytesToHex(ed25519.sign(signed(payload),d.signingSeed));
 if(!validGroupCustodyPayload(payload,d.now))throw Error('Invalid group payload');return {payload,grants};
 }finally{key.fill(0);nonce?.fill(0);plain.fill(0);}
}
/** Caller verifies the signed payload and grant before decrypting the grant with
 * its existing device key. No persistence or receipt is allowed on failure. */
export function openGroupCustody(p:GroupCustodyPayload,e:CustodyEnvelope,openedGrant:string){
 if(!matchesGroupGrant(p,e))throw Error('Group grant mismatch');const g=JSON.parse(openedGrant);
 if(!Array.isArray(g)||g.length!==5||g[0]!=='axonic-group-grant-v1'||g[1]!==p.id||g[2]!==contentDigest(p)||!hex(g[3],32)||typeof g[4]!=='string'||utf8ToBytes(g[4]).length>1400)throw Error('Invalid group grant');
 const key=hexToBytes(g[3]);let plain:Uint8Array|undefined;
 try{plain=xchacha20poly1305(key,hexToBytes(p.nonce),encode(header(p))).decrypt(hexToBytes(p.ciphertext));const text=new TextDecoder().decode(plain);
 if(!text||plain.length>2048||bytesToHex(utf8ToBytes(text))!==bytesToHex(plain))throw Error('Invalid group plaintext');return {text,metadata:g[4] as string};}
 finally{key.fill(0);plain?.fill(0);}
}
