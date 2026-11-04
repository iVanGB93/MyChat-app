import {groupCallRoomKey,validGroupCallRoom,type GroupCallRoom} from './identity/groupCallRoom';
/** Negotiation is confined to the current call's authenticated DTLS channel.
 * The original media leg is never replaced. New legs retain invitation consent. */
export function createCallExpansion(id:string,d:{send(raw:string):boolean;adopt(room:GroupCallRoom):Promise<boolean>;commit(room:GroupCallRoom):Promise<boolean>;ready(value:boolean):void;timeoutMs?:number;enabled?:()=>boolean}){
 let closed=false,supported=false,receiving=false;
 let pending:{room:GroupCallRoom;key:string;resolve(value:boolean):void;timer:ReturnType<typeof setTimeout>;committing:boolean}|null=null;
 const send=(kind:string,room?:GroupCallRoom,accepted?:boolean)=>d.send(JSON.stringify({version:1,call:id,kind,...(room?{room}:{}),...(accepted!==undefined?{accepted}:{})}));
 const capability=()=>{if(!closed&&!supported){supported=true;d.ready(true);}};
 return {
  opened(){if(!closed&&d.enabled?.()!==false)send('call-expand-capability');},
  receive(raw:unknown){
   if(closed||typeof raw!=='string'||raw.length>4096)return false;
   let v;try{v=JSON.parse(raw);}catch{return false;}
   if(v?.version!==1||v.call!==id||!['call-expand-capability','call-expand-capability-ack','call-expand','call-expand-result'].includes(v.kind))return false;
   if(d.enabled?.()===false)return true;
   if(v.kind==='call-expand-capability'){capability();send('call-expand-capability-ack');return true;}
   if(v.kind==='call-expand-capability-ack'){capability();return true;}
   if(!supported||!validGroupCallRoom(v.room)||!v.room.adHoc)return true;
   if(v.kind==='call-expand-result'){
    const own=pending;
    if(!own||own.key!==groupCallRoomKey(v.room)||typeof v.accepted!=='boolean'||own.committing)return true;
    clearTimeout(own.timer);own.committing=true;
    // Keep a timed-out request identifiable: a late confirmation still converges
    // the audience instead of leaving one side in a private call permanently.
    void (v.accepted?d.commit(own.room):Promise.resolve(false)).catch(()=>false).then(ok=>{if(pending===own)pending=null;own.resolve(!closed&&ok);});return true;
   }
   // Simultaneous proposals are refused before either changes its audience.
   if(pending||receiving){send('call-expand-result',v.room,false);return true;}
   receiving=true;
   void d.adopt(v.room).then(ok=>{if(!closed)send('call-expand-result',v.room,ok);}).catch(()=>{if(!closed)send('call-expand-result',v.room,false);}).finally(()=>{receiving=false;});return true;
  },
  request(room:GroupCallRoom){
   if(closed||!supported||pending||receiving||d.enabled?.()===false||!validGroupCallRoom(room)||!room.adHoc)return Promise.resolve(false);
   const copy=structuredClone(room);
   return new Promise<boolean>(resolve=>{
    const timer=setTimeout(()=>resolve(false),d.timeoutMs??10000);
    pending={room:copy,key:groupCallRoomKey(copy),resolve,timer,committing:false};
    if(!send('call-expand',copy)){clearTimeout(timer);pending=null;resolve(false);}
   });
  },
  close(){closed=true;supported=false;d.ready(false);if(pending){clearTimeout(pending.timer);pending.resolve(false);pending=null;}}
 };
}
