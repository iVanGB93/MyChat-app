import {createDirectAttachmentStream,type DirectAttachmentStreamAdapter} from './directAttachmentStream.ts';
import {createWssStreamCipher,type StreamRecordCrypto} from './wssStreamCipher.ts';
import {createStreamWake} from './streamWake.ts';
import type {createAttachmentTiming} from './attachmentTiming.ts';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import type {IdentityPeer} from './identityClient.ts';
import type {AttachmentJob} from './attachmentTypes.ts';
import type {WssStreamNetwork} from './attachmentConnections.ts';
export type {WssStreamNetwork} from './attachmentConnections.ts';

type Files=Pick<DirectAttachmentStreamAdapter,'reader'|'writer'|'hash'|'discard'>&{commit():Promise<void>};
type GuardFailure='none'|'runtime-stopped'|'policy-context'|'expired'|'peer-session'|'durable-lease';
export type WssStreamOutcome={role:'send'|'receive';result:'verified'|'failed';reason:'none'|'revoked'|'timeout'|'checksum'|'disconnected'|'invalid'|'other';guard:GuardFailure;bytes:number;binary:boolean;native:boolean;startedAt:number;milliseconds:number;firstRecordMs?:number;firstDataMs?:number};
/** Ephemeral own-recipient stream on the existing authenticated WSS session.
 * No relay-store writes; block fallback is owned by the existing transfer worker.
 * Binary peers use 32 KiB records and a 512 KiB credit window; text peers use
 * 8 KiB/64 KiB. These are transport records, not stored file blocks. At most one
 * send + one receive; yield every half-window for controls and UI work.
 */
export function createWssAttachmentStreams(d:WssStreamNetwork&{
 random(n:number):Promise<Uint8Array>;current(job:AttachmentJob):boolean;
 files(job:AttachmentJob,id:string,role:'send'|'receive'):Files;
 timing?:ReturnType<typeof createAttachmentTiming>;
 crypto?:StreamRecordCrypto;
 sleep?(milliseconds:number):Promise<unknown>|undefined;
 outcome?(value:WssStreamOutcome):void;
}){
 type Active={binary:boolean;id:string;peer:IdentityPeer;job:AttachmentJob;role:'send'|'receive';stream:ReturnType<typeof createDirectAttachmentStream>;cipher:ReturnType<typeof createWssStreamCipher>;done:Promise<boolean>;signal():void;observe(data:boolean):void};
 const active=new Map<string,Active>(),finished=new Map<string,number>();let stopped=false;
 const key=(p:IdentityPeer,id:string)=>p.account+':'+p.instance+':'+id;
 const remote=(job:AttachmentJob,role:'send'|'receive')=>{const m=job.descriptor.manifest;return {account:role==='send'?m.recipient:m.sender,device:role==='send'?m.recipientDevice:m.senderDevice};};
 async function begin(job:AttachmentJob,id:string,role:'send'|'receive',live:()=>Promise<boolean>){
  if(stopped||active.size>=2||[...active.values()].some(a=>a.role===role)||!/^[a-f0-9]{64}$/.test(id)||!d.current(job)||!await live())return null;
  const who=remote(job,role),peer=d.peer(who.account);if(!peer||peer.device!==who.device)return null;
  const binding=key(peer,id);if(active.has(binding)||finished.has(binding))return null;
  const salt=await d.random(16);
  if(stopped||!d.current(job)||!await live()||d.peer(peer.account)?.instance!==peer.instance||[...active.values()].some(a=>a.role===role))return null;
  const cipher=createWssStreamCipher({key:job.descriptor.key,digest:job.digest,id,salt,role,crypto:d.crypto});salt.fill(0);
  let files:Files;try{files=d.files(job,id,role);}catch(error){cipher.close();throw error;}let authorized=true;
  let guard:GuardFailure='none';
  const fail=(reason:GuardFailure)=>{if(guard==='none')guard=reason;authorized=false;return false;};
  const current=()=>!authorized?false:stopped?fail('runtime-stopped'):!d.current(job)?fail('policy-context'):job.descriptor.manifest.expires<=Date.now()?fail('expired'):d.peer(peer.account)?.instance!==peer.instance?fail('peer-session'):true;
  const validate=async()=>{if(!current())throw Error('WSS stream revoked');const valid=await live();if(!valid)fail('durable-lease');if(!current())throw Error('WSS stream revoked');};
  const wake=createStreamWake(d.sleep),signal=()=>wake.signal();
  const binary=!!d.sendBinary&&d.binary?.(peer.account,peer.instance)===true;
  const stream=createDirectAttachmentStream({role,frameBytes:binary?32768:8192,windowBytes:binary?524288:65536,
   expected:{digest:job.digest,bytes:job.descriptor.manifest.bytes,checksum:job.descriptor.checksum},live:current,now:Date.now,
   // Wait elapsed includes event-loop scheduling and concurrent receive work;
   // it overlaps streamOpen/streamWrite and must not be labeled network RTT.
   async wait(idle){if(d.timing)await d.timing.measure(idle?'streamIdleWait':'streamBurstYield',()=>wake.wait(idle));else await wake.wait(idle);await validate();},
   send(value){if(!current())throw Error('WSS stream disconnected');
    if(binary){const sealed=(d.timing?d.timing.measureSync('streamSeal',()=>cipher.sealBinary(value)):cipher.sealBinary(value)),frame=new Uint8Array(33+sealed.length);frame[0]=2;frame.set(hexToBytes(id),1);frame.set(sealed,33);if(!d.sendBinary?.(peer.account,peer.instance,frame))throw Error('WSS binary stream disconnected');}
    else if(!d.send(peer.account,peer.instance,JSON.stringify({id,data:(d.timing?d.timing.measureSync('streamSeal',()=>cipher.seal(value)):cipher.seal(value))})))throw Error('WSS stream disconnected');},
   close(){signal();},authorize:validate,consumed:validate,
   reader:files.reader,writer:files.writer,hash:async()=>{await validate();const hash=await files.hash();await validate();return hash;},discard:files.discard,
  });
  const started=Date.now();let firstRecordMs:number|undefined,firstDataMs:number|undefined;
  const observe=(data:boolean)=>{if(!d.outcome)return;const elapsed=Math.max(0,Date.now()-started);firstRecordMs??=elapsed;if(data)firstDataMs??=elapsed;};
  const a:Active={binary,id,peer,job,role,stream,cipher,signal,observe,done:Promise.resolve(false)};active.set(binding,a);
  const report=(result:WssStreamOutcome['result'],reason:WssStreamOutcome['reason'])=>{try{d.outcome?.({role,result,reason,guard,bytes:job.descriptor.manifest.bytes,binary,native:!!d.crypto,startedAt:started,milliseconds:Math.max(0,Date.now()-started),...(firstRecordMs===undefined?{}:{firstRecordMs}),...(firstDataMs===undefined?{}:{firstDataMs})});}catch{/* Diagnostics cannot affect transfer outcome. */}};
  a.done=(async()=>{try{await stream.start();await validate();if(role==='receive')await files.commit();report('verified','none');return true;}
   catch(error){const message=error instanceof Error?error.message.toLowerCase():'';report('failed',(['revoked','timeout','checksum','disconnected','invalid'] as const).find(reason=>message.includes(reason))??'other');stream.abort('WSS stream failed');return false;}
   finally{signal();cipher.close();active.delete(binding);finished.set(binding,Date.now()+60000);for(const [k,until]of finished)if(until<Date.now()||finished.size>32)finished.delete(k);try{files.discard();}catch{/* Cleanup must not turn a handled failure into an unhandled rejection. */}}})();
  // Event wake is intentionally per active stream; no global busy polling.
  return a;
 }
 return {
  receiveBinary(raw:Uint8Array,peer:IdentityPeer){
   if(stopped||raw.length<71||raw.length>32838||raw[0]!==2)return false;
   const binding=key(peer,bytesToHex(raw.subarray(1,33))),a=active.get(binding);
   if(!a)return (finished.get(binding)??0)>Date.now();
   if(!a.binary||peer.device!==a.peer.device||!d.current(a.job))return false;
   try{const value=(d.timing?d.timing.measureSync('streamOpen',()=>a.cipher.openBinary(raw.subarray(33))):a.cipher.openBinary(raw.subarray(33)));a.observe(typeof value!=='string');void a.stream.receive(value).catch(()=>{}).finally(()=>{if(typeof value==='string')a.signal();});}
   catch{a.stream.abort('Invalid encrypted binary WSS record');}return true;
  },
  receive(raw:string,peer:IdentityPeer){
   if(stopped||raw.length>14000)return false;
   try{const f=JSON.parse(raw);if(!f||Object.keys(f).sort().join(',')!=='data,id'||typeof f.id!=='string'||!/^[a-f0-9]{64}$/.test(f.id)||typeof f.data!=='string')return false;
    const binding=key(peer,f.id),a=active.get(binding);if(!a)return (finished.get(binding)??0)>Date.now();
    if(a.binary||peer.device!==a.peer.device||!d.current(a.job))return false;
    // Binary records are consumed by the serialized receiver, not its idle pump.
    // Waking that pump per record adds a second durable lease check per 8 KiB.
    // Keep per-record current checks, durable checks before every credit grant,
    // hash/commit guards and the idle safety timer. Controls unblock the sender.
    try{const value=(d.timing?d.timing.measureSync('streamOpen',()=>a.cipher.open(f.data)):a.cipher.open(f.data));a.observe(typeof value!=='string');void a.stream.receive(value).catch(()=>{}).finally(()=>{if(typeof value==='string')a.signal();});}
    catch{a.stream.abort('Invalid encrypted WSS record');}return true;
   }catch{return false;}
  },
  async pull(job:AttachmentJob,live:()=>Promise<boolean>){
   if(!d.peer(job.descriptor.manifest.sender))return 'unavailable' as const;
   const setup=async()=>{const id=bytesToHex(await d.random(32));return {id,a:await begin(job,id,'receive',live)};};
   const {id,a}=await(d.timing?d.timing.measure('streamSetup',setup):setup());if(!a)return 'unavailable' as const;
   try{const response=await d.request(a.peer.account,JSON.stringify({version:1,operation:'direct-stream',transport:'wss-v1',id,digest:job.digest}));
    if(!response||JSON.parse(response).status!=='streaming'){a.stream.abort('WSS stream unavailable');await a.done;return 'unavailable' as const;}
    return await a.done;
   }catch{a.stream.abort('WSS stream request failed');await a.done;return false;}
  },
  async serve(job:AttachmentJob,live:()=>Promise<boolean>,id:string){return !!await begin(job,id,'send',live);},
  stop(){stopped=true;for(const a of active.values())a.stream.abort('WSS streams stopped');},
 };
}
