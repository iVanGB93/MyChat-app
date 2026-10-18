/** Fast explicit hangup on this call's authenticated WebRTC channel; durable control remains authoritative. */
export function createCallEndHandshake(id:string,d:{send(raw:string):boolean;ended():void}){
 let closed=false,received=false,pending:Promise<void>|null=null,finish:(()=>void)|null=null;
 const packet=(kind:string)=>JSON.stringify({version:1,call:id,kind});
 return {
  receive(raw:unknown){
   if(closed||typeof raw!=='string'||raw.length>512)return false;
   let value;try{value=JSON.parse(raw);}catch{return false;}
   if(value?.version!==1||value.call!==id||!['call-end','call-end-ack'].includes(value.kind))return false;
   if(value.kind==='call-end-ack'){finish?.();return true;}
   d.send(packet('call-end-ack'));
   if(!received){received=true;d.ended();}
   return true;
  },
  end(){
   if(closed)return Promise.resolve();if(pending)return pending;
   pending=new Promise<void>(resolve=>{
    const timer=setTimeout(()=>finish?.(),350);
    finish=()=>{clearTimeout(timer);finish=null;resolve();};
    if(!d.send(packet('call-end')))finish();
   });return pending;
  },
  close(){closed=true;finish?.();},
 };
}
