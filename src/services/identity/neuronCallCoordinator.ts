import { bytesToHex } from '@noble/hashes/utils.js';
import { callControlDigest, type CallControl } from './callControlProtocol.ts';
import { createDurableCallerCallControl, createDurableRecipientCallControl, type CallJournalStore } from './durableCallControl.ts';
import { createCallMediaSession } from './callMediaSession.ts';
import type { CallMediaSignal, CallMediaData } from './callMediaProtocol.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecord } from './identityProtocol.ts';
import type { CallMediaTransport } from './callMediaTransport.ts';

export interface NeuronCallView<Peer = number> {
  id: string; peerUser: Peer; peerName: string; outgoing: boolean; media: 'voice' | 'video';
  status: 'ringing' | 'connecting' | 'ready' | 'ended'; reason?: string;
  transport?: CallMediaTransport;
}
type ControlInput = Omit<CallControl, 'version' | 'record' | 'device' | 'signature'>;
type MediaInput = Omit<CallMediaSignal, 'version' | 'record' | 'device' | 'signature'>;
export type CallMediaContext = { peer: IdentityPeer; instance: string };

/** Foreground development calls. One call, bounded ephemeral media, durable control.
 * A process restart ends old calls; no old SDP is replayed into a new media connection.
 */
export function createNeuronCallCoordinator<Peer = number>(d: {
  account: string; device: string; store: CallJournalStore; now(): number; current(): boolean;
  busy(): boolean; blocked(account: string): boolean;
  preserveIncoming?(id:string):boolean;
  lookup(account: string): { user: Peer; name: string } | null;
  resolve(user: Peer): Promise<{ account: string; name: string } | null>;
  readRecord(account: string): Promise<IdentityRecord | null>; list(): Promise<CallControl[]>;
  random(): Promise<Uint8Array>; sign(input: ControlInput): string; submit(raw: string): Promise<boolean>;
  signMedia(input: MediaInput): string; contexts(): CallMediaContext[];
  sendMedia(account: string, device: string, raw: string): Promise<boolean>;
  loadIceConfig?: CallMediaTransport['loadIceConfig'];
  callRoute?(account:string,device:string): {expiresAt:number}|null;
  sendRoutedMedia?(raw:string):Promise<boolean>;
  changed(view: NeuronCallView<Peer> | null): void;
}) {
  let stopped = false, active: CallControl | null = null, view: NeuronCallView<Peer> | null = null;
  const declined=new Set<string>();
  let awaitingRouteSince: number | null = null;
  let media: { context: CallMediaContext; receiver: ReturnType<typeof createCallMediaSession>; transport: CallMediaTransport; stop(): void } | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const diagnostics={sent:0,received:0,accepted:0,sendStage:'idle',receiveStage:'idle',error:null as string|null};
  const current = () => !stopped && d.current();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const p=tail.then(work);tail=p.catch(()=>{});return p; };
  const state = (e: CallControl) => e.caller===d.account ? createDurableCallerCallControl(d.store,d.account,e.callId,d.now)
    : createDurableRecipientCallControl(d.store,d.account,e.callId,d.device,d.now);
  const remote = (e:CallControl) => e.caller===d.account?e.callee:e.caller;
  const emit = () => d.changed(view ? {...view} : null);
  const finish = (reason:string) => { media?.stop();media=null;if(view){view={...view,status:'ended',reason,transport:undefined};emit();} };
  async function control(e:CallControl,kind:CallControl['kind'],extra:Partial<ControlInput>={}) {
    const raw=await d.store.read(d.account,e.callId);if(!raw||!current())return false;
    const events=JSON.parse(raw).entries.map((entry:{raw:string})=>JSON.parse(entry.raw) as CallControl);
    const sequence=1+Math.max(0,...events.filter((x:CallControl)=>x.record.account===d.account&&x.device===d.device).map((x:CallControl)=>x.sequence));
    const issuedAt=d.now(),expiresAt=['end','cancel'].includes(kind)?issuedAt+30000:Math.min(e.expiresAt,issuedAt+30000);
    if(expiresAt<=issuedAt)return false;
    return d.submit(d.sign({callId:e.callId,caller:e.caller,callee:e.callee,callerDevice:e.callerDevice,
      media:e.media,kind,invitation:callControlDigest(e),sequence,issuedAt,expiresAt,...extra}));
  }
  async function terminate(e:CallControl) {
    const s=await state(e).snapshot(d.now());
    if(!s||!['ringing','accepted'].includes(s.status))return;
    await control(e,s.confirmed?'end':e.caller===d.account?'cancel':'reject');
  }
  // Start recovery before the network can deliver new calls into this coordinator.
  let recovery: Promise<void> | null = null;
  let ticking: Promise<void> | null = null;
  const recover = () => recovery ??= (async()=>{
    for(const e of await d.list()) { if(!current())return;if(e.kind==='invite'){
      const pending=e.callee===d.account&&d.preserveIncoming?.(e.callId)&&(await state(e).snapshot(d.now()))?.status==='ringing';
      if(!pending)await terminate(e);
    } }
  })().catch(error=>{recovery=null;throw error;});
  void recover().catch(()=>{});

  const routedContext=(e:CallControl,acceptance:string,device:string):CallMediaContext|null=>{
    const route=d.callRoute?.(remote(e),device);if(!route||route.expiresAt<=d.now())return null;
    const outgoing=e.caller===d.account;
    return {instance:outgoing?e.callId:acceptance,peer:{account:remote(e),device,instance:outgoing?acceptance:e.callId,expiresAt:route.expiresAt}};
  };
  function openMedia(e:CallControl,acceptance:string,context:CallMediaContext) {
    let ended=false,sequence=0,waiting=0;
    let sendTail=Promise.resolve(true);
    let listener:((kind:string,data:Record<string,unknown>)=>void)|null=null;
    const buffered:CallMediaSignal[]=[];
    const usable=()=>{
      const live=d.callRoute?routedContext(e,acceptance,context.peer.device):d.contexts().find(c=>c.instance===context.instance&&c.peer.instance===context.peer.instance
        &&c.peer.account===context.peer.account&&c.peer.device===context.peer.device);
      if(live)context.peer.expiresAt=live.peer.expiresAt;
      return !ended&&current()&&!!live&&!d.blocked(context.peer.account)&&active?.callId===e.callId&&view?.status!=='ended';
    };
    const receiver=createCallMediaSession({invite:e,account:d.account,device:d.device,instance:context.instance,
      peer:context.peer,store:d.store,readRecord:d.readRecord,now:d.now,current:usable,blocked:d.blocked,
      received:signal=>{
        if(listener)listener(signal.kind,signal.data as unknown as Record<string,unknown>);
        else if(buffered.length<32)buffered.push(signal);
        else throw Error('Media receiver not ready');
      }});
    const transport:CallMediaTransport={
      loadIceConfig:d.loadIceConfig??(async()=>({ice_servers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}],ice_transport_policy:'all'})),
      subscribe(fn){if(listener)throw Error('Media already mounted');listener=fn;
        if(usable())for(const signal of buffered.splice(0))fn(signal.kind,signal.data as unknown as Record<string,unknown>);
        return()=>{listener=null;buffered.length=0;};},
      send(kind,data){
        if(!usable()||waiting>=32||!['offer','answer','ice-candidate'].includes(kind))return Promise.resolve(false);
        waiting++;
        const p=sendTail.then(async()=>{
          diagnostics.sendStage='checking';
          if(!usable())return false;
          const s=await state(e).snapshot(d.now());
          diagnostics.sendStage='signing';
          if(!s||s.status!=='accepted'||!s.confirmed||s.acceptance!==acceptance||!usable())return false;
          const issuedAt=d.now();
          const payload:CallMediaData=kind==='ice-candidate'
            ?{candidate:String(data.candidate??''),sdpMid:typeof data.sdpMid==='string'?data.sdpMid:null,
              sdpMLineIndex:typeof data.sdpMLineIndex==='number'?data.sdpMLineIndex:null}
            :{type:kind as 'offer'|'answer',sdp:String(data.sdp??'')};
          const raw=d.signMedia({callId:e.callId,invitation:callControlDigest(e),acceptance,
            target:context.peer.account,targetDevice:context.peer.device,sourceInstance:context.instance,targetInstance:context.peer.instance,
            sequence:++sequence,issuedAt,expiresAt:issuedAt+30000,kind:kind as CallMediaSignal['kind'],data:payload});
          diagnostics.sendStage='sending';diagnostics.sent++;
          const result=usable()&&await (d.sendRoutedMedia?d.sendRoutedMedia(raw):d.sendMedia(context.peer.account,context.peer.device,raw));
          diagnostics.sendStage=result?'delivered':'rejected';return result;
        }).catch(error=>{diagnostics.error=error instanceof Error?error.message:'Media send failed';return false;}).finally(()=>{waiting--;});
        sendTail=p;return p;
      },
    };
    return {context,receiver,transport,stop(){ended=true;receiver.stop();buffered.length=0;listener=null;}};
  }
  async function update() {
    if(!active||!view||view.status==='ended'||!current())return;
    const e=active,s=await state(e).snapshot(d.now());
    if(!current())return;
    if(!s||!['ringing','accepted'].includes(s.status)){finish(s?.status??'Call unavailable');return;}
    if(d.blocked(remote(e))){await terminate(e);finish('Contact blocked');return;}
    if(s.status==='accepted'&&!s.confirmed&&view.outgoing&&s.selectedDevice&&s.acceptance){
      await control(e,'selected',{selectedDevice:s.selectedDevice,acceptance:s.acceptance});return;
    }
    if(!s.confirmed||!s.selectedDevice||!s.acceptance)return;
    if(view.status==='ringing'){view={...view,status:'connecting'};emit();}
    const peerDevice=view.outgoing?s.selectedDevice:e.callerDevice;
    const context=d.callRoute?routedContext(e,s.acceptance,peerDevice):d.contexts().find(c=>c.peer.account===remote(e)&&c.peer.device===peerDevice);
    // A permission prompt can reconnect the recipient while selection is in flight.
    // Routed media is bound to this call/acceptance, so a short route gap need not end its media.
    // A changed direct session still fails closed; no signaling is accepted during a route gap.
    if(!context&&(!media||d.callRoute)){
      awaitingRouteSince ??= d.now();
      if(d.now()-awaitingRouteSince<10000)return;
    }else awaitingRouteSince=null;
    if(!context || media&&(context.instance!==media.context.instance||context.peer.instance!==media.context.peer.instance)){
      await terminate(e);finish('Peer disconnected');return;
    }
    if(view.outgoing){
      // Do not send an offer until the selected device has durably acknowledged confirmation.
      if(!await state(e).selectionAcknowledged(peerDevice,d.now())){
        if(d.now()>=e.expiresAt){await terminate(e);finish('Peer confirmation expired');}
        return;
      }
    }
    if(!media){media=openMedia(e,s.acceptance,context);view={...view,status:'ready',transport:media.transport};emit();}
  }
  return {
    ready:recover,
    async peerReady(user:Peer){const target=await d.resolve(user);return current()&&!!target&&!d.blocked(target.account)&&
      (d.contexts().some(c=>c.peer.account===target.account)||!!d.callRoute?.(target.account,''));},
    resumeIncoming(id:string){return serial(async()=>{
      await recover();if(!current()||!d.preserveIncoming?.(id))return false;
      if(active?.callId===id&&view?.status==='ringing')return true;
      if(view&&view.status!=='ended'||d.busy())return false;
      const e=(await d.list()).find(e=>e.kind==='invite'&&e.callId===id&&e.callee===d.account);
      if(!e||!current()||d.blocked(e.caller)||(await state(e).snapshot(d.now()))?.status!=='ringing')return false;
      const peer=d.lookup(e.caller);if(!peer||!current())return false;
      active=e;view={id:e.callId,peerUser:peer.user,peerName:peer.name,outgoing:false,media:e.media,status:'ringing'};emit();return true;
    });},
    diagnostics:()=>({...diagnostics}),
    snapshot:()=>view?{...view}:null,
    async start(user:Peer,kind:'voice'|'video') {return serial(async()=>{
      await recover();
      if(!current()||view&&view.status!=='ended'||d.busy())throw Error('Finish your current call first.');
      const target=await d.resolve(user);
      if(!target||d.blocked(target.account)||!d.contexts().some(c=>c.peer.account===target.account)&&!d.callRoute?.(target.account,''))
        throw Error('This peer is not connected for neuron calls. Keep both apps open and try again.');
      const bytes=await d.random();if(bytes.length!==32||!current())throw Error('Call interrupted');
      const issuedAt=d.now(),raw=d.sign({callId:bytesToHex(bytes),caller:d.account,callee:target.account,callerDevice:d.device,
        media:kind,kind:'invite',invitation:null,sequence:0,issuedAt,expiresAt:issuedAt+60000});
      if(!await d.submit(raw)||!current())throw Error('Could not save the call invitation.');
      declined.clear();active=JSON.parse(raw);view={id:active!.callId,peerUser:user,peerName:target.name,outgoing:true,media:kind,status:'ringing'};emit();return view.id;
    });},
    observe(event:CallControl){return serial(async()=>{
      await recover();if(!current())return;
      if(event.kind==='invite'&&event.callee===d.account&&event.callId!==active?.callId){
        const s=await state(event).snapshot(d.now());if(!s||s.status!=='ringing')return;
        const peer=d.lookup(event.caller);if(!peer)return;
        if(view&&view.status!=='ended'||d.busy()){await control(event,'busy');return;}
        declined.clear();active=event;view={id:event.callId,peerUser:peer.user,peerName:peer.name,outgoing:false,media:event.media,status:'ringing'};emit();
      }
      if(active&&event.callId===active.callId&&view?.outgoing&&['reject','busy'].includes(event.kind)){
        declined.add(event.device);
        const record=d.callRoute?await d.readRecord(active.callee):null;
        const another=record?record.devices.some(device=>!declined.has(device.id)&&!!d.callRoute?.(active!.callee,device.id))
          :d.contexts().some(c=>c.peer.account===active!.callee&&!declined.has(c.peer.device));
        if(!another
          &&(await state(active).snapshot(d.now()))?.status==='ringing'){
          await terminate(active);finish(event.kind==='busy'?'Peer is busy':'Call declined');return;
        }
      }
      if(event.callId===active?.callId)await update();
    });},
    accept(id:string){return serial(async()=>{
      if(!active||view?.id!==id||view.outgoing||view.status!=='ringing'||!current())return false;
      if(!await control(active,'accept'))return false;
      view={...view,status:'connecting'};emit();return true;
    });},
    end(id:string){return serial(async()=>{
      if(!active||view?.id!==id||view.status==='ended')return;
      try{await terminate(active);}finally{finish('Call ended');}
    });},
    tick(){return ticking ??= serial(async()=>{await recover();await update();}).finally(()=>{ticking=null;});},
    receiveRoutedMedia(raw:string){return serial(async()=>{
      if(!d.callRoute||!media||!current())return false;
      const accepted=await media.receiver.receive(raw);if(accepted)diagnostics.accepted++;return accepted;
    });},
    receiveMedia(raw:string,peer:IdentityPeer,instance:string){diagnostics.received++;diagnostics.receiveStage='queued';return serial(async()=>{
      diagnostics.receiveStage='checking';
      if(!media||media.context.instance!==instance||media.context.peer.instance!==peer.instance
        ||media.context.peer.account!==peer.account||media.context.peer.device!==peer.device)return false;
      const accepted=await media.receiver.receive(raw);
      diagnostics.receiveStage=accepted?'accepted':'rejected';if(accepted)diagnostics.accepted++;return accepted;
    });},
    stop(){stopped=true;finish('Call disconnected');},
  };
}
