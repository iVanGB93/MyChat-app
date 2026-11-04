import {bytesToHex} from '@noble/hashes/utils.js';
import type {CallControl} from './callControlProtocol.ts';
import type {createNeuronCallCoordinator,NeuronCallView} from './neuronCallCoordinator.ts';
import {groupCallLegId,groupCallOfferer,groupCallRoomKey,groupCallExpansionMatches,validGroupCallRoom,type GroupCallRoom} from './groupCallRoom.ts';
type Leg=ReturnType<typeof createNeuronCallCoordinator<string>>;

/** One room above independent durable pair coordinators. Only a creator invitation
 * may ring a new room; other pair invitations wait for that invitation and consent.
 * No media is routed through the creator. No polling or automatic capture here. */
export function createGroupCallCoordinator(d:{
 account:string;device:string;now():number;random():Promise<Uint8Array>;current():boolean;
 factory(id:string|null,changed:(view:NeuronCallView<string>|null)=>void,busy:()=>boolean):Leg;
 authorize(room:GroupCallRoom):Promise<string|null>;
 changed(view:NeuronCallView<string>|null):void;
}){
 let stopped=false,tail:Promise<unknown>=Promise.resolve();
 let room:{descriptor:GroupCallRoom;id:string;name:string;media:'voice'|'video';accepted:boolean;outgoing:boolean;ended:boolean;reason?:string;expiresAt:number;joining?:boolean;anchorId?:string}|null=null;
 const legs=new Map<string,Leg>(),views=new Map<string,NeuronCallView<string>>(),deferred=new Map<string,CallControl>();
 let privateView:NeuronCallView<string>|null=null;
 const previousAudiences=new Set<string>();
 const current=()=>!stopped&&d.current();
 const serial=<T>(f:()=>Promise<T>)=>{const p=tail.then(f);tail=p.catch(()=>{});return p;};
 const roomActive=()=>!!room&&!room.ended;
 const snapshot=():NeuronCallView<string>|null=>{
  if(!room)return privateView;
  if(room.anchorId&&privateView)return {...privateView,id:room.id,status:room.ended?'ended':'ready',reason:room.reason,room:{descriptor:structuredClone(room.descriptor),name:room.name,accepted:true,anchorId:room.anchorId,legs:[...views.values()].map(v=>({...v}))}};
  return {id:room.id,peerUser:room.descriptor.creator===d.account?room.descriptor.members.find(p=>p!==d.account)!:room.descriptor.creator,
   peerName:room.name,outgoing:room.outgoing,media:room.media,status:room.ended?'ended':room.joining&&![...views.values()].some(v=>v.status==='ready')?'connecting':room.accepted?'ready':'ringing',
   reason:room.reason,expiresAt:room.expiresAt,room:{descriptor:structuredClone(room.descriptor),name:room.name,accepted:room.accepted,legs:[...views.values()].map(v=>({...v}))}};
 };
 let lastPublished='';
 let lastTransports:unknown[]=[];
 const emit=()=>{if(current()){
  // Pair transitions are authoritative: close an empty room immediately instead
  // of waiting for an unrelated topology event or expiry timer.
  if(roomActive()&&(d.now()>=room!.expiresAt||views.size===room!.descriptor.members.length-1)&&views.size>0&&![...views.values()].some(v=>v.status!=='ended')){
   room!.ended=true;room!.reason='No participants connected';
  }
  const view=snapshot(),key=JSON.stringify(view),transports=view?.room?view.room.legs.map(l=>l.transport):[view?.transport];
  if(key!==lastPublished||transports.length!==lastTransports.length||transports.some((t,i)=>t!==lastTransports[i])){
   lastPublished=key;lastTransports=transports;d.changed(view);
  }
 }};
 const privateCall=d.factory(null,v=>{privateView=v;if(roomActive()&&room!.anchorId){if(v)views.set(room!.anchorId,v);emit();return;}if(!roomActive()) {room=null;emit();}},roomActive);
 const pair=(id:string)=>{
  let leg=legs.get(id);if(leg)return leg;
  leg=d.factory(id,v=>{if(v)views.set(id,v);else views.delete(id);emit();},()=>!roomActive());
  legs.set(id,leg);return leg;
 };
 const clear=()=>{for(const l of legs.values())if(l!==privateCall)l.stop();legs.clear();views.clear();previousAudiences.clear();room=null;};
 const matching=(r:GroupCallRoom)=>roomActive()&&groupCallRoomKey(room!.descriptor)===groupCallRoomKey(r);
 async function leave(reason:string){
  if(!roomActive())return;room!.ended=true;room!.reason=reason;emit();
  await Promise.allSettled([...legs].map(([id,l])=>l.end(id)));
 }
 async function valid(){
  if(!roomActive()||!current())return false;
  const active=room,name=await d.authorize(active!.descriptor);
  if(!current()||room!==active||!roomActive())return false;
  if(!name){await leave('Group membership or permissions changed');return false;}
  return true;
 }
 async function connect(){
  if(!room?.accepted||room.joining||!await valid())return;
  const active=room!;
  for(const peer of active.descriptor.members){
   if(peer===d.account||!current()||room!==active||active.ended)continue;
   const existing=[...views.values()].find(v=>v.peerUser===peer);
   if(existing){if(existing.status==='ringing'&&!existing.outgoing)await legs.get(existing.id)?.accept(existing.id);continue;}
   const id=groupCallLegId(active.descriptor,d.account,peer);
   const l=pair(id),v=l.snapshot();
   if(v?.status==='ringing'&&!v.outgoing)await l.accept(id);
   else if(!v&&groupCallOfferer(active.descriptor,d.account,peer)===d.account){
    try{await l.start(peer,active.media,active.descriptor);}catch{
     // A failed admission is retried on topology changes, never in a timer loop.
    }
   }
  }
 }
 async function observe(event:CallControl){
  await privateCall.ready();if(!current())return;
  for(const [id,e] of deferred)if(e.expiresAt<=d.now())deferred.delete(id);
  if(!event.room){await privateCall.observe(event);return;}
  const r=event.room;
  if(!validGroupCallRoom(r)||event.caller!==d.account&&event.callee!==d.account)return;
  const name=await d.authorize(r);if(!name||!current())return;
  if(event.rejoin&&event.kind==='invite'){
   const previous=[...views.values()].find(v=>v.peerUser===event.caller);
   if(!matching(r)||!room!.accepted||event.media!==room!.media||previous&&previous.status!=='ended'&&previous.id!==event.callId){
    // A join never rings an idle device or resurrects a finished room.
    const reject=d.factory(event.callId,()=>{},()=>true);try{await reject.observe(event);}finally{reject.stop();}return;
   }
   if(previous&&previous.id!==event.callId){legs.get(previous.id)?.stop();legs.delete(previous.id);views.delete(previous.id);}
   await pair(event.callId).observe(event);await legs.get(event.callId)!.accept(event.callId);emit();return;
  }
  // Existing signed legs retain their original audience after an addition.
  const retainedLeg=roomActive()&&previousAudiences.has(groupCallRoomKey(r))&&legs.has(event.callId);
  if(!matching(r)&&!retainedLeg){
   if(roomActive()||privateView&&privateView.status!=='ended')return;
   if(event.rejoin||event.kind!=='invite'||event.caller!==r.creator){
    if(event.kind==='invite'&&deferred.size<90)deferred.set(event.callId,event);
    return;
   }
   clear();room={descriptor:structuredClone(r),id:event.callId,name,media:event.media,accepted:false,outgoing:false,ended:false,expiresAt:event.expiresAt};
  }
  if(event.media!==room!.media)return;
  const remotePeer=event.caller===d.account?event.callee:event.caller;
  const currentLeg=[...views.values()].find(v=>v.peerUser===remotePeer);
  // Delayed control from a retired connection must not recreate it next to the
  // replacement connection or change the room's participant count.
  if(currentLeg&&currentLeg.id!==event.callId)return;
  if(room!.joining&&!event.rejoin)return;
  await pair(event.callId).observe(event);
  for(const [id,e] of deferred){
   if(e.expiresAt<=d.now()){deferred.delete(id);continue;}
   if(matching(e.room!)&&e.media===room!.media){deferred.delete(id);await pair(id).observe(e);}
  }
  if(!room!.accepted&&views.get(room!.id)?.status==='ended'){await leave('Group call ended');return;}
  await connect();emit();
 }
 return {
  snapshot,ready:privateCall.ready,
  prepareExpansion:(id:string,members:string[])=>serial(async()=>{
   if(roomActive()){
    const active=room!;
    if(!current()||active.id!==id||!active.accepted||!active.descriptor.adHoc||active.descriptor.creator!==d.account)throw Error('Only the call creator can add people to this call.');
    const descriptor={...active.descriptor,members:[...new Set([...active.descriptor.members,...members])].sort()};
    if(descriptor.members.length<=active.descriptor.members.length||!groupCallExpansionMatches(active.descriptor,descriptor)||!await d.authorize(descriptor)||!current()||room!==active||active.ended)throw Error('Selected call participants are unavailable.');
    return descriptor;
   }
   if(!current()||roomActive()||privateView?.id!==id||privateView.status!=='ready')throw Error('Only a connected private call can be expanded.');
   const token=bytesToHex(await d.random());
   const descriptor:GroupCallRoom={id:token,group:token,revision:1,creator:d.account,creatorDevice:d.device,members:[...new Set([d.account,privateView.peerUser,...members])].sort(),adHoc:true};
   if(!validGroupCallRoom(descriptor)||descriptor.members.length<3||!await d.authorize(descriptor)||!current()||privateView?.id!==id||privateView.status!=='ready')throw Error('Selected call participants are unavailable.');
   return descriptor;
  }),
  adoptExpansion:(id:string,descriptor:GroupCallRoom,from:string)=>serial(async()=>{
   if(roomActive()){
    const active=room!,leg=views.get(id);
    if(!current()||!active.accepted||from!==active.descriptor.creator
     ||(from===d.account?active.id!==id:!leg||leg.peerUser!==from||leg.status!=='ready')
     ||!groupCallExpansionMatches(active.descriptor,descriptor))return false;
    if(groupCallRoomKey(active.descriptor)===groupCallRoomKey(descriptor))return true;
    const name=await d.authorize(descriptor);
    if(!name||!current()||room!==active||active.ended)return false;
    previousAudiences.add(groupCallRoomKey(active.descriptor));
    active.descriptor=structuredClone(descriptor);active.name=name;active.expiresAt=d.now()+60000;
    emit();await connect();return true;
   }
   if(!current()||privateView?.id!==id||privateView.status!=='ready'||!descriptor.adHoc||!validGroupCallRoom(descriptor)
    ||descriptor.members.length<3||descriptor.creator!==from||![d.account,privateView.peerUser].includes(from)
    ||!descriptor.members.includes(d.account)||!descriptor.members.includes(privateView.peerUser))return false;
   const anchor=privateView,name=await d.authorize(descriptor);
   if(!name||!current()||privateView?.id!==id||privateView.status!=='ready')return false;
   room={descriptor:structuredClone(descriptor),id,anchorId:id,name,media:anchor.media,accepted:true,outgoing:anchor.outgoing,ended:false,expiresAt:d.now()+60000};
   legs.set(id,privateCall);views.set(id,anchor);emit();await connect();return true;
  }),
  peerReady:privateCall.peerReady,resumeIncoming:privateCall.resumeIncoming,
  start(peer:string,kind:'voice'|'video'){return serial(async()=>{if(roomActive())throw Error('Finish your current call first.');clear();return privateCall.start(peer,kind);});},
  startGroup(group:{id:string;revision:number;members:string[]},kind:'voice'|'video'){return serial(async()=>{
   await privateCall.ready();if(!current()||roomActive()||privateView&&privateView.status!=='ended')throw Error('Finish your current call first.');
   const descriptor:GroupCallRoom={id:bytesToHex(await d.random()),group:group.id,revision:group.revision,creator:d.account,creatorDevice:d.device,members:[...group.members].sort()};
   if(!validGroupCallRoom(descriptor))throw Error('Invalid group call audience');
   const name=await d.authorize(descriptor);if(!name||!current())throw Error('Group membership is unavailable or changed');
   clear();room={descriptor,id:descriptor.id,name,media:kind,accepted:true,outgoing:true,ended:false,expiresAt:d.now()+60000};emit();await connect();return descriptor.id;
  });},
  joinGroup:(descriptor:GroupCallRoom,media:'voice'|'video')=>serial(async()=>{
   await privateCall.ready();if(!current()||roomActive()||privateView&&privateView.status!=='ended')throw Error('Finish your current call first.');
   const name=await d.authorize(descriptor);if(!name||!current())throw Error('This call audience is no longer available.');
   const attempt=bytesToHex(await d.random());
   clear();room={descriptor:structuredClone(descriptor),id:attempt,name,media,accepted:true,outgoing:true,ended:false,joining:true,expiresAt:d.now()+60000};emit();
   for(const peer of descriptor.members){if(peer===d.account)continue;const id=groupCallLegId(descriptor,d.account,peer,attempt);try{await pair(id).start(peer,media,descriptor,attempt);}catch{/* No route: other participants may still accept. */}}
   emit();return attempt;
  }),
  observe:(event:CallControl)=>serial(()=>observe(event)),
  accept:(id:string)=>serial(async()=>{
   if(!roomActive())return privateCall.accept(id);
   if(room!.id!==id||room!.accepted||!await valid())return false;
   if(!await legs.get(id)?.accept(id))return false;
   room!.accepted=true;emit();await connect();return true;
  }),
  confirmRinging:(id:string)=>roomActive()?legs.get(id)?.confirmRinging(id)??Promise.resolve(false):privateCall.confirmRinging(id),
  end:(id:string)=>serial(()=>roomActive()&&room!.id===id?leave('Call ended'):privateCall.end(id)),
  endParticipant:(id:string)=>serial(async()=>{if(roomActive())await legs.get(id)?.end(id);}),
  tick:()=>serial(async()=>{
   await privateCall.tick();if(!roomActive())return;
   if(!await valid())return;
   await Promise.all([...legs.values()].filter(l=>l!==privateCall).map(l=>l.tick()));
   if(!room!.accepted&&d.now()>=room!.expiresAt){await leave('No answer');return;}
   await connect();
   if((d.now()>=room!.expiresAt||views.size===room!.descriptor.members.length-1)&&![...views.values()].some(v=>v.status!=='ended'))await leave('No participants connected');
   emit();
  }),
  nextDeadline:()=>Math.min(privateCall.nextDeadline(),roomActive()&&d.now()<room!.expiresAt?room!.expiresAt:Infinity,...[...legs.values()].map(l=>l.nextDeadline())),
  receiveRoutedMedia(raw:string){let id:string;try{id=JSON.parse(raw).callId;}catch{return Promise.resolve(false);}return (legs.get(id)??privateCall).receiveRoutedMedia(raw);},
  receiveMedia(raw:string,...args:Parameters<Leg['receiveMedia']> extends [string,...infer P]?P:never){let id:string;try{id=JSON.parse(raw).callId;}catch{return Promise.resolve(false);}return (legs.get(id)??privateCall).receiveMedia(raw,...args);},
  diagnostics:()=>({private:privateCall.diagnostics(),room:room?.descriptor.id??null,legs:[...legs].map(([id,l])=>({id,...l.diagnostics()}))}),
  stop(){stopped=true;privateCall.stop();clear();deferred.clear();},
 };
}
