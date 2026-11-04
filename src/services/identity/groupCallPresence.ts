/** Room availability over the existing authenticated chat channel. No polling or media ownership. */
import {groupCallRoomKey,validGroupCallRoom,type GroupCallRoom} from './groupCallRoom';
import type {NeuronCallView} from './neuronCallCoordinator';
export function createGroupCallPresence(d:{owner():string|null;now():number;peers():{account:string;instance:string}[];allowed(room:GroupCallRoom,peer:string):Promise<boolean>;send(peer:string,raw:string):Promise<boolean>;changed():void}){
 const tag='axonic-call-presence-v1';
 const rooms=new Map<string,{room:GroupCallRoom;local:boolean;stamp:number;remote:Map<string,{active:boolean;stamp:number;instance:string}>}>();
 const retries=new Map<string,ReturnType<typeof setTimeout>>();
 const watches=new Map<string,number>(),queried=new Set<string>();let stamp=0,epoch=0;
 const get=(room:GroupCallRoom)=>{let r=rooms.get(room.id);if(r&&groupCallRoomKey(r.room)!==groupCallRoomKey(room))return null;if(!r){if(rooms.size>=64){const old=[...rooms].find(([id,r])=>!r.local&&!watches.has(id));if(old)rooms.delete(old[0]);else return null;}r={room:structuredClone(room),local:false,stamp:0,remote:new Map()};rooms.set(room.id,r);}return r;};
 const live=(peer:string)=>d.peers().find(p=>p.account===peer)?.instance;
 async function send(room:GroupCallRoom,peer:string,operation:'query'|'state',attempt=0){
  const owner=d.owner(),generation=epoch,r=rooms.get(room.id);if(!owner||!r||!live(peer)||!await d.allowed(room,peer)||generation!==epoch||owner!==d.owner())return;
  const key=room.id+':'+peer+':'+operation;
  const delivered=await d.send(peer,JSON.stringify([tag,peer,operation,room,operation==='state'?r.local:null,r.stamp,d.now()+15000])).catch(()=>false);
  if(generation!==epoch)return;const timer=retries.get(key);if(timer)clearTimeout(timer);retries.delete(key);
  // Retry only a failed event, never poll healthy/idle rooms. A topology event
  // supplies catch-up if the bounded delivery attempts all fail.
  if(!delivered&&attempt<3&&live(peer))retries.set(key,setTimeout(()=>{retries.delete(key);void send(room,peer,operation,attempt+1);},[250,1000,3000][attempt]));
 }
 return {
  active(id:string){const r=rooms.get(id);return !!r&&[...r.remote].some(([peer,v])=>v.active&&live(peer)===v.instance);},
  watch(room:GroupCallRoom){if(!validGroupCallRoom(room)||!get(room))return()=>{};watches.set(room.id,(watches.get(room.id)??0)+1);for(const p of room.members)if(p!==d.owner())void send(room,p,'query');return()=>{const n=(watches.get(room.id)??1)-1;if(n)watches.set(room.id,n);else watches.delete(room.id);};},
  update(view:NeuronCallView<string>|null){
   const descriptor=view?.room?.descriptor,active=!!descriptor&&view!.status==='ready'&&view!.room!.accepted&&view!.room!.legs.some(l=>l.status==='ready');
   if(descriptor)get(descriptor);
   for(const r of rooms.values()){const next=r.room.id===descriptor?.id&&active;if(r.local===next)continue;r.local=next;r.stamp=stamp=Math.max(d.now(),stamp+1);for(const peer of r.room.members)if(peer!==d.owner())void send(r.room,peer,'state');}
   d.changed();
  },
  async policyChanged(){
   const generation=epoch;
   for(const r of rooms.values())for(const peer of [...r.remote.keys()]){let allowed=false;try{allowed=await d.allowed(r.room,peer);}catch{}if(generation!==epoch)return;if(!allowed)r.remote.delete(peer);}
   if(generation===epoch)d.changed();
  },
  topology(){
   for(const r of rooms.values())for(const [peer,v] of r.remote)if(live(peer)!==v.instance)r.remote.delete(peer);
   const keys=new Set<string>();for(const r of rooms.values())if(r.local||watches.has(r.room.id))for(const peer of r.room.members){const instance=live(peer);if(peer===d.owner()||!instance)continue;const key=r.room.id+':'+peer+':'+instance;keys.add(key);if(!queried.has(key)){queried.add(key);void send(r.room,peer,'query');if(r.local)void send(r.room,peer,'state');}}
   for(const key of queried)if(!keys.has(key))queried.delete(key);d.changed();
  },
  async receive(peer:string,raw:string):Promise<boolean|null>{
   let p:any;try{p=JSON.parse(raw);}catch{return null;}if(!Array.isArray(p)||p[0]!==tag)return null;
   const owner=d.owner(),generation=epoch,instance=live(peer);
   if(!owner||p.length!==7||p[1]!==owner||!['query','state'].includes(p[2])||!validGroupCallRoom(p[3])||!p[3].members.includes(peer)||!p[3].members.includes(owner)||!instance||!Number.isSafeInteger(p[5])||p[5]<0||!Number.isSafeInteger(p[6])||p[6]<=d.now()||p[6]>d.now()+20000||p[2]==='state'&&typeof p[4]!=='boolean')return false;
   if(!await d.allowed(p[3],peer)||generation!==epoch||owner!==d.owner()||instance!==live(peer))return false;
   const r=get(p[3]);if(!r)return false;
   if(p[2]==='query'){void send(r.room,peer,'state');return true;}
   const old=r.remote.get(peer);if(old&&old.instance===instance&&old.stamp>p[5])return true;
   r.remote.set(peer,{active:p[4],stamp:p[5],instance});d.changed();return true;
  },
  clear(){epoch++;for(const timer of retries.values())clearTimeout(timer);retries.clear();rooms.clear();watches.clear();queried.clear();d.changed();},
 };
}
