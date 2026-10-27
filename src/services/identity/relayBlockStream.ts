/** Bounded framing for already-encrypted attachment batches on an authenticated
 * ordered connection. Credit acknowledges transport buffering ONLY. Existing
 * custody handlers still verify signatures, quota and durable writes before
 * returning their storage response. No descriptor keys or plaintext enter here.
 */
export class RelayBlockStreamTimeout extends Error {}
export function createRelayBlockStream(d:{
 current():boolean;send(frame:unknown):void;deliver(frame:unknown):Promise<void>;
 admit?(direction:string,id:number):boolean;
}){
 // Keep small records for control-frame compatibility, but enough outstanding
 // ciphertext to cover Internet RTT. Two streams retain <=512 KB uncredited.
 const record=8000,window=32,max=4008000;
 type Out={id:number;direction:string;data:string;sent:number;acked:number;pumping:boolean;resolve():void;reject(e:Error):void;timer:ReturnType<typeof setTimeout>};
 type In={id:number;direction:string;size:number;header:Record<string,unknown>;parts:string[];received:number;finishing:boolean;timer:ReturnType<typeof setTimeout>};
 const outgoing=new Map<string,Out>(),incoming=new Map<string,In>();let stopped=false;
 const expiredOut=new Map<string,number>(),expiredIn=new Map<string,number>();
 function retire(map:Map<string,number>,k:string){
  for(const [id,until] of map)if(until<=Date.now())map.delete(id);
  if(map.size>=16)map.delete(map.keys().next().value!);map.set(k,Date.now()+30000);
 }
 const key=(direction:string,id:number)=>direction+':'+id;
 const validDirection=(s:unknown)=>s==='bulk-request'||s==='bulk-response';
 function stop(){stopped=true;for(const x of outgoing.values()){clearTimeout(x.timer);x.reject(Error('Relay stream closed'));}outgoing.clear();for(const x of incoming.values())clearTimeout(x.timer);incoming.clear();expiredOut.clear();expiredIn.clear();}
 const live=()=>!stopped&&d.current();
 const send=(v:object)=>{if(!live())throw Error('Relay stream unavailable');d.send({version:1,kind:'relay-block-stream',...v});};
 function pump(x:Out){
  if(x.pumping||x.acked<0)return;x.pumping=true;
  void Promise.resolve().then(()=>{
   try{while(outgoing.get(key(x.direction,x.id))===x&&x.sent<x.data.length&&x.sent-x.acked<record*window){
    const offset=x.sent,data=x.data.slice(offset,offset+record);x.sent+=data.length;
    send({op:'data',direction:x.direction,id:x.id,offset,data});
   }}catch(e){stop();}finally{x.pumping=false;}
  });
 }
 function headerValid(direction:string,h:Record<string,unknown>){
  const fields=Object.keys(h).sort().join(',');
  return Number.isSafeInteger(h.index)&&(h.index as number)>=0&&h.count===1&&
   (direction==='bulk-request'?fields==='count,digest,index,operation,version'&&h.version===1&&h.operation==='put-batch'&&typeof h.digest==='string'&&/^[a-f0-9]{64}$/.test(h.digest)
    :fields==='count,index,status'&&h.status==='ok');
 }
 return {
  stop,
  /** False means not a ciphertext batch; caller uses its ordinary small frame. */
  async transmit(frame:{kind:string;id:number;body:string}):Promise<boolean>{
   if(!validDirection(frame.kind)||frame.body.length<16000)return false;
   const body=JSON.parse(frame.body),{data,...header}=body;
   if(typeof data!=='string'||!headerValid(frame.kind,header))return false;
   if(data.length<16000)return false;
   if(!live()||data.length>max||!data.length||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data)||outgoing.size>=2)throw Error('Invalid relay stream');
   const k=key(frame.kind,frame.id);if(outgoing.has(k))throw Error('Duplicate relay stream');
   await new Promise<void>((resolve,reject)=>{
    const x:Out={id:frame.id,direction:frame.kind,data,sent:0,acked:-1,pumping:false,resolve,reject,timer:setTimeout(()=>{outgoing.delete(k);retire(expiredOut,k);reject(new RelayBlockStreamTimeout('Relay stream timed out'));},15000)};
    outgoing.set(k,x);
    try{send({op:'start',direction:frame.kind,id:frame.id,size:data.length,header});}catch(e){clearTimeout(x.timer);outgoing.delete(k);reject(e as Error);}
   });return true;
  },
  async receive(f:any):Promise<boolean>{
   if(!live()||f.version!==1||f.kind!=='relay-block-stream'||!validDirection(f.direction)||!Number.isSafeInteger(f.id)||f.id<1)return false;
   const k=key(f.direction,f.id),fields=Object.keys(f).sort().join(',');
   if(f.op==='credit'){
    const x=outgoing.get(k);
    if(!x&&(expiredOut.get(k)??0)>Date.now()&&fields==='direction,id,kind,offset,op,version'&&Number.isSafeInteger(f.offset)&&f.offset>=0&&f.offset<=max)return true;
    if(fields!=='direction,id,kind,offset,op,version'||!x||!Number.isSafeInteger(f.offset)||f.offset<=x.acked||f.offset>x.sent||(f.offset!==x.data.length&&f.offset%record!==0))return false;
    x.acked=f.offset;if(x.acked===x.data.length){outgoing.delete(k);clearTimeout(x.timer);x.resolve();}else pump(x);return true;
   }
   if(f.op==='start'){
    if(fields!=='direction,header,id,kind,op,size,version'||incoming.has(k)||incoming.size>=2||d.admit?.(f.direction,f.id)===false||!Number.isSafeInteger(f.size)||f.size<16000||f.size>max||f.size%4||!f.header||typeof f.header!=='object'||!headerValid(f.direction,f.header))return false;
    const x:In={id:f.id,direction:f.direction,size:f.size,header:f.header,parts:[],received:0,finishing:false,timer:setTimeout(()=>{incoming.delete(k);retire(expiredIn,k);},15000)};
    incoming.set(k,x);send({op:'credit',direction:f.direction,id:f.id,offset:0});return true;
   }
   const x=incoming.get(k);
   if(!x&&(expiredIn.get(k)??0)>Date.now()&&fields==='data,direction,id,kind,offset,op,version'&&f.op==='data'&&Number.isSafeInteger(f.offset)&&f.offset>=0&&f.offset<max&&typeof f.data==='string'&&f.data.length<=record)return true;
   if(fields!=='data,direction,id,kind,offset,op,version'||f.op!=='data'||!x||x.finishing||f.offset!==x.received||typeof f.data!=='string'||f.data.length!==Math.min(record,x.size-x.received)||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)||x.received+f.data.length<x.size&&f.data.includes('='))return false;
   x.parts.push(f.data);x.received+=f.data.length;
   if(x.received===x.size){
    x.finishing=true;
    try{await d.deliver({version:1,kind:x.direction,id:x.id,body:JSON.stringify({...x.header,data:x.parts.join('')})});
     if(!live())return false;if(incoming.get(k)!==x)return true;
     send({op:'credit',direction:x.direction,id:x.id,offset:x.received});
    }finally{clearTimeout(x.timer);incoming.delete(k);}
   }else if(x.parts.length%4===0)send({op:'credit',direction:x.direction,id:x.id,offset:x.received});
   return true;
  },
 };
}
