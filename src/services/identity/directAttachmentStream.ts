/** One file on a reliable ordered, authenticated DTLS channel to its intended peer.
 * The adapter must bind this lane to the verified account/device and a live chat job.
 * Never use on the unencrypted LAN socket or a custodian connection. This protocol
 * acknowledges verified bytes only; the attachment worker owns signed delivery receipts.
 */
export const DIRECT_FRAME_BYTES=16*1024;
export const DIRECT_WINDOW_BYTES=256*1024;
const MAX_BYTES=250*1024*1024, IDLE_MS=15000, MAX_MS=10*60*1000;
export interface DirectAttachmentExpectation {digest:string;bytes:number;checksum:string}
interface Reader {read(count:number):Uint8Array;close():void}
interface Writer {write(bytes:Uint8Array):void;close():void}
export interface DirectAttachmentStreamAdapter {
 role:'send'|'receive';expected:DirectAttachmentExpectation;
 /** Includes unlocked owner, exact remote device, policy, job revision and expiry. */
 live():boolean;now():number;wait():Promise<unknown>;
 send(data:string|Uint8Array):void;close():void;
 /** Native admission must finish before telling the sender it may send bytes. */
 authorize?():Promise<void>;
 /** Replenish native bridge credit only after this prefix was written. */
 consumed?(offset:number):Promise<void>;
 reader?():Reader;writer?():Writer;
 /** Read back the receiver's private temporary file. Do not publish or sign here. */
 hash():Promise<string>;
 /** Only this lane's temporary file, never an existing verified file or source. */
 discard():void;
}
/** Call receive for every channel frame and abort on close/error/account invalidation.
 * done resolves after hash verification; it never creates a chat delivery receipt.
 * A session is single-use, including after failure; fallback starts a fresh attempt.
 */
export function createDirectAttachmentStream(d:DirectAttachmentStreamAdapter){
 const e={...d.expected},hex=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
 if(!hex(e.digest)||!hex(e.checksum)||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>MAX_BYTES
  ||d.role==='send'&&!d.reader||d.role==='receive'&&!d.writer)throw Error('Invalid direct attachment');
 let state:'new'|'waiting'|'streaming'|'verifying'|'done'|'failed'='new';
 let reader:Reader|undefined,writer:Writer|undefined,offset=0,ack=0,queued=0;
 let tail=Promise.resolve(),last=d.now();const started=last;
 let resolve!:()=>void,reject!:(error:Error)=>void;
 const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
 // Adapters may await done after wiring event listeners. Keep early rejection handled.
 void done.catch(()=>{});
 const finished=()=>state==='done'||state==='failed';
 function closeFiles(){try{reader?.close();}catch{}reader=undefined;try{writer?.close();}catch{}writer=undefined;}
 function abort(reason:unknown){
  if(finished())return;state='failed';closeFiles();
  if(d.role==='receive')try{d.discard();}catch{}
  try{d.close();}catch{}reject(reason instanceof Error?reason:Error(String(reason)));
 }
 function current(){
  if(finished()||!d.live())throw Error('Direct attachment revoked');
  if(d.now()-last>IDLE_MS||d.now()-started>MAX_MS)throw Error('Direct attachment timeout');
 }
 function control(kind:string,extra:object={}){current();d.send(JSON.stringify({kind,digest:e.digest,...extra}));}
 function complete(){state='done';closeFiles();resolve();}
 async function receive(data:unknown){
  const size=typeof data==='string'?data.length:data instanceof ArrayBuffer?data.byteLength:Infinity;
  if(finished())throw Error('Direct attachment closed');
  if(size<1||size>(typeof data==='string'?1024:DIRECT_FRAME_BYTES)||queued+size>DIRECT_WINDOW_BYTES+2048){
   const error=Error('Direct attachment receive bound');abort(error);throw error;
  }
  queued+=size;
  const work=tail.then(async()=>{
   current();
   if(typeof data!=='string'){
    if(d.role!=='receive'||state!=='streaming'||!writer||size!==Math.min(DIRECT_FRAME_BYTES,e.bytes-offset))throw Error('Unexpected direct bytes');
    writer.write(new Uint8Array(data as ArrayBuffer));offset+=size;last=d.now();
    if(offset===e.bytes){
     writer.close();writer=undefined;state='verifying';
     const hash=await d.hash();current();
     if(hash!==e.checksum)throw Error('Direct attachment checksum mismatch');
     control('complete',{bytes:e.bytes,checksum:hash});complete();
    }else if(offset-ack>=DIRECT_WINDOW_BYTES/2){
     await d.consumed?.(offset);current();ack=offset;control('ack',{offset});
    }
    return;
   }
   const m=JSON.parse(data);
   if(!m||typeof m!=='object'||m.digest!==e.digest)throw Error('Unexpected direct transfer');
   const keys=Object.keys(m).sort().join(',');
   if(d.role==='receive'){
    if(state!=='waiting'||keys!=='bytes,checksum,digest,kind'||m.kind!=='start'||m.bytes!==e.bytes||m.checksum!==e.checksum)throw Error('Unsolicited direct attachment');
    await d.authorize?.();current();
    writer=d.writer!();state='streaming';last=d.now();control('ready');
   }else if(state==='waiting'&&keys==='digest,kind'&&m.kind==='ready'){
    state='streaming';last=d.now();
   }else if(state==='streaming'&&keys==='digest,kind,offset'&&m.kind==='ack'&&Number.isSafeInteger(m.offset)
     &&m.offset>ack&&m.offset<=offset&&m.offset%DIRECT_FRAME_BYTES===0){ack=m.offset;last=d.now();
   }else if(state==='streaming'&&keys==='bytes,checksum,digest,kind'&&m.kind==='complete'&&offset===e.bytes&&m.bytes===e.bytes&&m.checksum===e.checksum){complete();
   }else throw Error('Invalid direct acknowledgement');
  }).catch(error=>{abort(error);throw error;}).finally(()=>{queued-=size;});
  tail=work.catch(()=>{});return work;
 }
 async function pump(){
  try{
   while(!finished()){
    current();
    if(d.role==='send'&&state==='streaming'&&offset<e.bytes&&offset-ack<DIRECT_WINDOW_BYTES){
     reader??=d.reader!();const count=Math.min(DIRECT_FRAME_BYTES,e.bytes-offset),value=reader.read(count);
     current();if(!(value instanceof Uint8Array)||value.length!==count)throw Error('Short direct source');
     offset+=count;d.send(value);
     // Yield after a bounded burst, not every buffer: per-buffer native timer
     // round trips otherwise dominate fast local links. Credit still caps memory.
     if(offset%(DIRECT_WINDOW_BYTES/2)===0)await d.wait();
    }else await d.wait();
   }
  }catch(error){abort(error);}
 }
 function start(){
  if(state!=='new')throw Error('Direct attachment already started');
  try{current();state='waiting';if(d.role==='send')control('start',{bytes:e.bytes,checksum:e.checksum});void pump();}
  catch(error){abort(error);}return done;
 }
 return {start,receive,abort,done};
}
