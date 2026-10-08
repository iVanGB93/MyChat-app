import {createNeuronCallCoordinator,type NeuronCallView} from './neuronCallCoordinator';
import {createCallControlRuntime} from './callControlRuntime';
import {createCallRetryScheduler} from './callRetryScheduler';
import {validAccountId} from './identityProtocol';
import {createCallRelayPump} from './callRelayPump';
import {createCallControlRelay,createCallRelayEndpoint} from './callControlRelay';
import {createCallMediaRelay} from './callMediaRelay';
import {neuronStunConfig,parseNeuronIceConfig} from './neuronIceConfig';
import {verifyCallControl} from './callControlProtocol';
import {createDurableRecipientCallControl} from './durableCallControl';
import type {localAccount} from './localAccount';
import type {createLanIdentityRuntime} from './lanIdentityRuntime';
import type {CallJournalStore} from './durableCallControl';
import type {CallControl} from './callControlProtocol';
import type {IdentityRecordStore} from './identityAdmission';
import type {IdentityPeer} from './identityClient';

/** Root-addressed call composition. No numeric users, Django rooms, or legacy app store. */
export function createRootAccountCalls(d:{
 identity:typeof localAccount; network():ReturnType<typeof createLanIdentityRuntime>;
 records:IdentityRecordStore; store:CallJournalStore; list():Promise<CallControl[]>;
 listPending?():Promise<CallControl[]>;
 current():boolean; now():number; random():Promise<Uint8Array>;
 contacts():Promise<{account:string;alias:string;blocked:boolean}[]>;
 changed(view:NeuronCallView<string>|null):void;
 wakes?:{pending():Promise<{raw:string}[]>;finish(id:string):Promise<void>};
}){
 const account=d.identity.status().account,device=d.identity.callDevice();
 if(!account||!device||!d.current())throw Error('Unlock your account to use calls');
 let stopped=false,policyReady=false;
 let contacts:Awaited<ReturnType<typeof d.contacts>>=[];
 const current=()=>!stopped&&d.current()&&d.identity.status().account===account&&d.identity.callDevice()===device;
 const blocked=(peer:string)=>!policyReady||contacts.some(c=>c.account===peer&&c.blocked);
 const refresh=async()=>{const next=await d.contacts();if(!current())throw Error('Call interrupted');contacts=next;policyReady=true;};
 const readRecord=async(peer:string)=>peer===account?d.identity.publicRecord():d.records.read(peer);
 const name=(peer:string)=>contacts.find(c=>c.account===peer)?.alias||peer;
 const control=createCallControlRuntime({account,device,store:d.store,records:{read:readRecord},now:d.now,current,blocked,
  signReceipt:async e=>d.identity.signCallReceipt(e),send:(peer,remoteDevice,raw)=>d.network().callControlRequest(peer,remoteDevice,raw)});
 const coordinator=createNeuronCallCoordinator<string>({account,device,store:d.store,now:d.now,current,blocked,busy:()=>false,
  lookup:peer=>validAccountId(peer)?{user:peer,name:name(peer)}:null,
  resolve:async peer=>{await refresh();return validAccountId(peer)&&peer!==account?{account:peer,name:name(peer)}:null;},
  readRecord,list:d.list,random:d.random,sign:input=>d.identity.signCall(input),submit:control.submit,
  signMedia:input=>d.identity.signCallMedia(input),contexts:()=>d.network().mediaContexts(),
  sendMedia:(peer,remoteDevice,raw)=>d.network().callMediaRequest(peer,remoteDevice,raw),
  callRoute:(peer,remoteDevice)=>{
   const routes=[...d.network().callPeers().filter(p=>p.account===peer&&(!remoteDevice||p.device===remoteDevice)),...d.network().mediaRelayPeers()];
   const expiresAt=Math.max(0,...routes.filter(p=>!blocked(p.account)).map(p=>p.expiresAt));return expiresAt>d.now()?{expiresAt}:null;
  },sendRoutedMedia:raw=>d.network().sendRelayedMedia(raw),
  loadIceConfig:async()=>{
   for(const provider of d.network().relayPeers().filter(p=>!blocked(p.account))){
    const raw=await d.network().callRelayRequest(provider,JSON.stringify({version:1,operation:'ice'}));
    const config=raw&&parseNeuronIceConfig(raw,d.now());if(config)return config;
   }return neuronStunConfig();
  },changed:d.changed});
 const relay=createCallControlRelay({records:d.records,now:d.now,current,blocked});
 const endpoint=createCallRelayEndpoint(relay);
 const mediaRelay=createCallMediaRelay({records:d.records,now:d.now,current,blocked,forward:(...args)=>d.network().forwardMedia(...args)});
 const pump=createCallRelayPump({account,device,store:d.store,records:{read:readRecord},current,now:d.now,blocked,
  list:d.listPending??d.list,peers:()=>d.network().relayPeers().filter(p=>!blocked(p.account)),direct:()=>d.network().callPeers(),
  request:(...args)=>d.network().callRelayRequest(...args),
  receive:async(raw,peer)=>{await refresh();await coordinator.ready();const receipt=await control.receiveRelayed(raw,peer);
   if(receipt)await coordinator.observe(JSON.parse(raw));return receipt;}});
 const retry=createCallRetryScheduler({account,current,now:d.now,list:d.listPending??d.list,peers:()=>d.network().callPeers(),drain:control.drain});
 let ticking:Promise<void>|null=null;
 async function drainWakes(){
  if(!d.wakes)return;await coordinator.ready();
  for(const row of await d.wakes.pending()){
   if(!current())return;
   const hint=JSON.parse(row.raw) as CallControl;if(blocked(hint.caller))continue;
   const record=await readRecord(hint.caller),event=record&&verifyCallControl(row.raw,record,d.now());
   if(!event||event.callee!==account||event.record.account!==event.caller||!['invite','cancel','end'].includes(event.kind)||!current())continue;
   const journal=createDurableRecipientCallControl(d.store,account!,event.callId,device!,d.now);
   const saved=event.kind==='invite'?await journal.begin(row.raw,record!,d.now()):await journal.receive(row.raw,record!,d.now())||event.kind==='cancel'&&await journal.cancelUnknown(row.raw,record!,d.now());
   if(!saved&&!await journal.hasStoredEvent(row.raw,record!,d.now())||!current())continue;
   await coordinator.observe(event);await d.wakes.finish(event.callId);
  }
 }
 return {
  coordinator,
  diagnostics:()=>({relay:pump.diagnostics(),call:coordinator.diagnostics()}),
  async receiveRelay(raw:string,peer:IdentityPeer){await refresh();return endpoint(raw,peer);},
  async relayMedia(raw:string,peer:IdentityPeer){await refresh();return mediaRelay(raw,peer);},
  async receiveRoutedMedia(raw:string,peer:IdentityPeer){await refresh();return !blocked(peer.account)&&coordinator.receiveRoutedMedia(raw);},
  async receive(raw:string,peer:IdentityPeer){await refresh();await coordinator.ready();const receipt=await control.receive(raw,peer);
   if(receipt)await coordinator.observe(JSON.parse(raw));return receipt;},
  async receiveMedia(raw:string,peer:IdentityPeer,instance:string){await refresh();return coordinator.receiveMedia(raw,peer,instance);},
  tick(){
   // A slow direct peer must not hold up relay delivery or the local call clock.
   const clock=coordinator.tick();
   const work=ticking??=(async()=>{await refresh();await drainWakes();await Promise.all([retry.tick(),pump.tick()]);})().finally(()=>{ticking=null;});
   return Promise.all([clock,work]).then(()=>{});
  },
  stop(){stopped=true;pump.stop();relay.stop();retry.stop();control.stop();coordinator.stop();},
 };
}
