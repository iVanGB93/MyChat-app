// Composition root: joins module ports and owns foreground/background leases.
import {shortIdentity} from '../services/identity/identityPresentation';
import {rootChatView} from '../services/identity/rootChatActions';
import {parseSticker} from '../services/stickers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createRememberedNeurons} from '../services/identity/rememberedNeurons';
import type {NeuronCandidate} from '../services/identity/neuronConnections';
import { unavailableDirectoryLookup, type DirectoryLookupResult } from '../services/identity/identityDirectoryLookup';
import { createMobileDirectory } from '../services/identity/mobileDirectory';
import Native from '../../modules/axonic-nearby';
import { allowedAxons, loadAllowedAxons, subscribeAllowedAxons } from '../services/allowedAxons';
import { localAccount } from '../services/identity/localAccount';
import { createLanIdentityRuntime, type NativeAxonLan } from '../services/identity/lanIdentityRuntime';
import { createMobileIdentityRecordStore } from '../services/identity/identityRecordStore';
import { createInternetAxonConnector, FIRST_NEURON } from '../services/identity/internetAxonTransport';
import { createCustodyService } from '../services/identity/custodyService';
import {createCustodyWakeForwarder} from '../services/identity/custodyWakeForwarder';
import { createMobileCustodyStore } from '../services/identity/mobileCustodyStore';
import { localRootChat } from '../services/identity/localRootChat';
import {createMessageDelivery} from '../modules/messaging/delivery';
import { AppState, NativeModules, Platform } from 'react-native';
import { RTCPeerConnection } from 'react-native-webrtc';
import type { AxonPeerConnection } from '../services/identity/rtcAxonTransport';
import { createCustodyCourier } from '../services/identity/custodyCourier';
import { createOwnCustodyStore } from '../services/identity/ownCustodyStore';
import {createRootAccountCalls} from '../services/identity/rootAccountCalls';
import {createMobileCallJournalStore,listMobileCallJournals} from '../services/identity/mobileCallJournalStore';
import {hexToBytes} from '@noble/hashes/utils.js';
import type {NeuronCallView} from '../services/identity/neuronCallCoordinator';
import {startRootPushRegistration} from '../services/identity/rootPushRegistration';
import {registerRootCallWakeOwner,pendingRootCallWakes,finishRootCallWake,syncRootCallNotification} from '../services/identity/rootCallWake';
import {finishRootMessageWake} from '../services/identity/rootMessageWake';
import {createAttachmentCustody} from '../services/identity/attachmentCustody';
import {createMobileAttachmentStore} from '../services/identity/mobileAttachmentStore';
import {startRootAttachmentRuntime} from '../services/identity/rootAttachmentRuntime';
import {createPeerIdentityResolver,type PeerIdentityResult} from '../services/identity/peerIdentityResolver';
let activeCalls:ReturnType<typeof createRootAccountCalls>|null=null;
let attachmentNetwork:{peers():string[];request(peer:string,raw:string):Promise<string|null>}|null=null;
export const localAccountAttachments=()=>attachmentNetwork;
let inspectPush:(()=>{status:string})|null=null;
export const localAccountPushStatus=()=>inspectPush?.()??{status:'locked'};
const callListeners=new Set<(view:NeuronCallView<string>|null)=>void>();
export const localAccountCalls=()=>activeCalls?.coordinator??null;
export const localAccountCallDiagnostics=()=>activeCalls?.diagnostics()??null;
export function subscribeLocalAccountCalls(listener:(view:NeuronCallView<string>|null)=>void){callListeners.add(listener);listener(localAccountCalls()?.snapshot()??null);return()=>{callListeners.delete(listener);};}
let activeSnapshot: (() => ReturnType<ReturnType<typeof createLanIdentityRuntime>['snapshot']>) | null = null;
let activeLookup: ((account: string) => Promise<DirectoryLookupResult>) | null = null;
export const localAccountLookupIdentity = (account: string) => activeLookup?.(account) ?? Promise.resolve(unavailableDirectoryLookup());
let activePeerResolver:((account:string)=>Promise<PeerIdentityResult>)|null=null;
export const ensureLocalPeerIdentity=(account:string)=>activePeerResolver?.(account)??Promise.resolve<PeerIdentityResult>({status:'unavailable'});
let inspectDirectory: (() => ReturnType<ReturnType<typeof createMobileDirectory>['snapshot']>) | null = null;
export const localAccountDirectorySnapshot = () => inspectDirectory?.() ?? null;
export const localAccountNetworkSnapshot = () => activeSnapshot?.() ?? null;
/** Independent root-identity participation; no legacy user ID, JWT, or Axion session. */
function createLocalAccountNetwork() {
  if (!Native?.axonLanStart || !Native?.axonWssConnect) throw Error('Network transport unavailable in this build');
  const records = createMobileIdentityRecordStore(Date.now);
  const remembered=createRememberedNeurons({now:Date.now,read:account=>AsyncStorage.getItem('@axonic_known_neurons_v1:'+account),write:(account,raw)=>AsyncStorage.setItem('@axonic_known_neurons_v1:'+account,raw)});
  let rememberedOwner:string|null=null,rememberedPeers:NeuronCandidate[]=[],loadingOwner:string|null=null;
  function loadRemembered(){const account=owner();if(!account){rememberedOwner=null;rememberedPeers=[];return;}
    if(rememberedOwner===account||loadingOwner===account)return;loadingOwner=account;
    void remembered.list(account).then(peers=>{if(owner()===account){rememberedOwner=account;rememberedPeers=peers;}}).catch(()=>{}).finally(()=>{if(loadingOwner===account)loadingOwner=null;});
  }
  let stopped = false;
  let push:ReturnType<typeof startRootPushRegistration>|null=null;
  let calls: {account:string;runtime:ReturnType<typeof createRootAccountCalls>}|null=null;
  let stopCallNotice:(()=>void)|null=null;
  function stopCalls(){stopCallNotice?.();stopCallNotice=null;push?.stop();push=null;inspectPush=null;if(!calls)return;const previous=calls;calls=null;if(activeCalls===previous.runtime)activeCalls=null;previous.runtime.stop();}
  function callService(){
    const account=owner();if(!account){stopCalls();return null;}
    if(calls?.account!==account){stopCalls();
      const callRuntime=createRootAccountCalls({identity:localAccount,network:()=>runtime,records:operationalRecords,
        store:createMobileCallJournalStore(),list:()=>listMobileCallJournals(account),
        listPending:()=>listMobileCallJournals(account,Date.now()),current:()=>owner()===account,
        now:Date.now,random:async()=>hexToBytes(await Native!.identityRandomBytes!(32)),
        contacts:async()=>(await localRootChat().snapshot()).contacts,
        wakes:{pending:()=>pendingRootCallWakes(account),finish:id=>{
          const view=calls?.runtime.coordinator.snapshot();
          return finishRootCallWake(account,id,AppState.currentState!=='active'&&view?.id===id&&!view.outgoing&&view.status==='ringing');
        }},
        changed:view=>{void syncRootCallNotification(account,view).catch(()=>{});for(const listener of callListeners)listener(view);}});
      calls={account,runtime:callRuntime};activeCalls=callRuntime;
      const noticeLifecycle=AppState.addEventListener('change',()=>{void syncRootCallNotification(account,callRuntime.coordinator.snapshot()).catch(()=>{});});
      stopCallNotice=()=>noticeLifecycle.remove();
      const device=localAccount.callDevice()!;
      push=startRootPushRegistration(()=>owner()===account,(peer,raw)=>runtime.pushRequest(peer,raw));
      inspectPush=push.snapshot;
      void registerRootCallWakeOwner(account,device).catch(()=>{});
    }return calls.runtime;
  }
  let custody: { owner: string; service: ReturnType<typeof createCustodyService>; wake: ReturnType<typeof createCustodyWakeForwarder> } | null = null;
  let attachments:{owner:string;service:ReturnType<typeof createAttachmentCustody>}|null=null;
  let ownAttachments:ReturnType<typeof startRootAttachmentRuntime>|null=null;
  const owner = () => !stopped && !localAccount.status().busy && localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
  function service() {
    const account = owner(); if (!account) return null;
    if (custody?.owner !== account) {
      custody?.wake.stop();
      const store = createMobileCustodyStore(account);
      const next: NonNullable<typeof custody> = { owner: account, service: createCustodyService({ owner: account, records,
        store, now: Date.now, current: () => custody === next && owner() === account }),
        wake: createCustodyWakeForwarder({store, records, now: Date.now,
          current: () => !stopped && custody === next && owner() === account,
          peers: () => runtime.pushPeers(), request: (peer, raw) => runtime.pushRequest(peer, raw)}) };
      custody = next;
    }
    return custody.service;
  }
  function attachmentService(){const account=owner();if(!account)return null;
    if(attachments?.owner!==account)attachments={owner:account,service:createAttachmentCustody({owner:account,records,store:createMobileAttachmentStore(account),now:Date.now,current:()=>owner()===account})};
    return attachments.service;
  }
  const native = Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> };
  async function receiveMessage(message:{from:string;id:string;text:string}){
    const account=owner();if(!account)return false;
    const ledger=localRootChat(),before=await ledger.snapshot();
    const seen=[...before.messages,...(before.actions??[]),...(before.groupActions??[]),].some(m=>m.id===message.id&&m.peer===message.from&&m.direction==='incoming')||before.groupSeen?.some(m=>m.id===message.id&&m.peer===message.from)===true;
    const accepted=await ledger.receive(message.from,message.id,message.text);
    if(accepted&&!seen){
      const state=rootChatView(account,await localRootChat().snapshot()),m=state.messages.find(m=>m.direction==='incoming'&&m.peer===message.from&&m.id===message.id);
      const contact=state.contacts.find(c=>c.account===message.from),group=m?.group&&state.groups?.find(g=>g.id===m.group!.id);
      const preview=m?{name:group?.name||contact?.alias||shortIdentity(message.from),text:m.attachment?m.attachment.name:parseSticker(m.text)?'Sticker':m.text,at:m.at,read:!!m.read||!!m.deleted,...(m.group?{group:m.group.id}:{})}:undefined;
      await finishRootMessageWake(account,message.from,message.id,preview).catch(()=>{});
    }
    return accepted;
  }
  const directory = createMobileDirectory(localAccount, records, () => !stopped, () => runtime);
  const peerResolver=createPeerIdentityResolver({wait:ms=>Native?.axonMessageWait?Native.axonMessageWait(ms):new Promise(resolve=>setTimeout(resolve,ms)),records,lookup:directory.lookup,current:()=>!!owner(),now:Date.now});
  // Relayed inbox/call traffic can be the first contact with this sender. Resolve
  // their signed record before those existing verifiers read the shared pin store.
  const operationalRecords={...records,read:async(account:string)=>{
    const result=await peerResolver.resolve(account);return result.status==='found'?result.record??null:null;
  }};
  const runtime = createLanIdentityRuntime({ remembered:()=>rememberedPeers,
    onConnected:peer=>{const account=owner();if(account)void remembered.remember(account,peer).catch(()=>{});},
    identity: localAccount, native, store: records, now: Date.now, limit: allowedAxons(),
    // Advertise the registration protocol as a client; ordinary phones do not mint FCM leases.
    onPush:async()=>JSON.stringify({status:'unsupported'}),
    onAttachment:async(raw,peer)=>(await ownAttachments?.receive(raw,peer))??attachmentService()?.receive(raw,peer)??'{"status":"rejected"}',
    onCallControl:async(raw,peer)=>{try{return await callService()?.receive(raw,peer)??null;}catch{return null;}},
    onCallRelay:async(raw,peer)=>{try{return await callService()?.receiveRelay(raw,peer)??'{}';}catch{return '{}';}},
    onCallMediaRelay:async(raw,peer)=>{try{return await callService()?.relayMedia(raw,peer)??false;}catch{return false;}},
    onRelayedCallMedia:async(raw,peer)=>{try{return await callService()?.receiveRoutedMedia(raw,peer)??false;}catch{return false;}},
    onCallMedia:async(raw,peer,instance)=>{try{return await callService()?.receiveMedia(raw,peer,instance)??false;}catch{return false;}},
    onChatMessage: async message => { try { return await receiveMessage(message); } catch { return false; } },
    rtc: Platform.OS==='android'&&NativeModules.WebRTCModule?.axonicIdentityGuardVersion?.()===1?{
      wait: Native?.axonMessageWait ? milliseconds => Native!.axonMessageWait!(milliseconds) : undefined,
      authenticated:NativeModules.WebRTCModule?.axonicIdentityAuthenticated?channel=>{
        if(typeof channel._peerConnectionId==='number'&&typeof channel._reactTag==='string')NativeModules.WebRTCModule.axonicIdentityAuthenticated(channel._peerConnectionId,channel._reactTag);
      }:undefined,
      random:()=>Native!.identityRandomBytes!(32),sign:(...args)=>localAccount.signSignal(...args),
      createConnection:()=>{const configuration={axonicIdentityGuard:true,iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]};return new RTCPeerConnection(configuration) as unknown as AxonPeerConnection;},
    }:undefined,
    onDirectory: (raw, peer) => directory.receive(peer.account, raw),
    onCustody: (raw, peer) => service()?.receive(peer.account, raw) ?? Promise.resolve(JSON.stringify({ status: 'rejected' })),
    internet: { peers: [FIRST_NEURON], connect: createInternetAxonConnector(native, owner) } });
  const blocked=new Set<string>();
  const courier=createCustodyCourier({owner,allowed:peer=>!blocked.has(peer),now:Date.now,records:operationalRecords,own:createOwnCustodyStore(),
    relays:runtime.custodians,request:runtime.custodyRequest,seal:(...args)=>localAccount.sealCustody(...args),
    receive:envelope=>localAccount.receiveCustody(envelope,records,receiveMessage),
    confirmReceipt:async(receipt,current)=>{
      if(!current())return false;const ledger=localRootChat(),state=await ledger.snapshot();
      if(!current()||![...state.messages,...(state.actions??[]),...(state.groupActions??[])].some(m=>m.id===receipt.id&&m.peer===receipt.recipient&&m.direction==='outgoing')&&!state.groupPackets?.some(m=>m.id===receipt.id&&m.peer===receipt.recipient))return false;
      await ledger.delivered(receipt.recipient,receipt.id);return current();
    },
  });
  const unsub = localAccount.subscribe(() => { if (!owner()) {peerResolver.invalidate();delivery.invalidate();stopCalls();custody = null;blocked.clear();courier.invalidate();} });
  const unlimit = subscribeAllowedAxons(() => runtime.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  const delivery=createMessageDelivery({owner,ledger:localRootChat,
    blocked:peers=>{blocked.clear();for(const peer of peers)blocked.add(peer);},collect:()=>courier.tick(),
    send:runtime.sendChatMessage,resolve:peerResolver.resolve,deposit:(...args)=>courier.deposit(...args)});
  const pump = () => { loadRemembered(); runtime.tick(); service();void custody?.wake.tick(); void directory.tick().catch(() => {});void delivery.tick();void callService()?.tick().catch(()=>{});void push?.tick().catch(()=>{}); };
  const tick = setInterval(pump, 1000);
  let sweeping = false;
  const sweep = setInterval(() => { if (sweeping) return; const current = service(); if (!current) return;
    sweeping = true; void Promise.all([current.sweep(),attachmentService()?.sweep()]).catch(() => {}).finally(() => { sweeping = false; }); }, 60_000);
  runtime.tick(); inspectDirectory = directory.snapshot; activeLookup = directory.lookup; activeSnapshot = runtime.snapshot;
  activePeerResolver=peerResolver.resolve;
  const attachmentApi={peers:runtime.attachmentPeers,request:runtime.attachmentRequest};attachmentNetwork=attachmentApi;
  ownAttachments=startRootAttachmentRuntime({...attachmentApi,lookup:peerResolver.resolve});
  return { snapshot: runtime.snapshot, recoveryStatus:delivery.snapshot, resume: runtime.resume, tick:pump, stop() { delivery.stop();ownAttachments.stop();if(attachmentNetwork===attachmentApi)attachmentNetwork=null;if(activePeerResolver===peerResolver.resolve)activePeerResolver=null;peerResolver.stop();stopCalls();courier.stop();directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory ===directory.snapshot) inspectDirectory = null; if (activeSnapshot === runtime.snapshot) activeSnapshot = null; stopped = true; custody = null; clearInterval(tick); clearInterval(sweep); unsub(); unlimit(); runtime.stop(); } };
}

// Foreground UI and a headless wake share one transport; each releases only its own lease.
let sharedNetwork:{runtime:ReturnType<typeof createLocalAccountNetwork>;references:number}|null=null;
export function startLocalAccountNetwork(){
 const shared=sharedNetwork??={runtime:createLocalAccountNetwork(),references:0};shared.references++;
 let released=false;return {snapshot:shared.runtime.snapshot,recoveryStatus:shared.runtime.recoveryStatus,resume:shared.runtime.resume,tick:shared.runtime.tick,stop(){if(released)return;released=true;if(--shared.references===0){if(sharedNetwork===shared)sharedNetwork=null;shared.runtime.stop();}}};
}
