import {deliveryEvidence} from '../services/identity/deliveryEvidence';
import {diagnosticJournal} from '../services/diagnosticJournal';
import {relayInventory} from '../services/identity/relayInventory';
import type {CustodyEnvelope} from '../services/identity/custodyProtocol';
import {loadRecoverySettings} from '../services/recoverySettings';
import {createGroupCustodyCourier} from '../services/identity/groupCustodyCourier';
import {createGroupCustodyService,groupCustodyWakeStore} from '../services/identity/groupCustodyService';
import {createMobileGroupCustodyStore} from '../services/identity/mobileGroupCustodyStore';
import {createRuntimeChatReads,createPeerCapabilityWriter} from '../services/identity/runtimeChatReads';
import {ownChatRevision} from '../modules/storage/chatStore';
import {migrateSharedProfileAvatar} from '../modules/messaging/profile';
import {createProfileRecovery} from '../services/identity/profileRecovery';
import {knownProfileReceipt} from '../services/identity/rootProfileSharing';
import {sharedAvatarHash} from '../modules/storage/sharedProfileStore';
import {createChatActivity} from '../services/identity/chatActivity';
import {createGroupRecovery} from '../services/identity/groupRecovery';
// Composition root: joins module ports and owns foreground/background leases.
import {shortIdentity} from '../services/identity/identityPresentation';
import {rootChatView} from '../services/identity/rootChatActions';
import {rootNotificationPreviewText} from '../services/identity/rootNotificationPreviewText';
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
import { createInternetAxonConnector, BOOTSTRAP_NEURONS } from '../services/identity/internetAxonTransport';
import { createCustodyService } from '../services/identity/custodyService';
import {createCustodyWakeForwarder} from '../services/identity/custodyWakeForwarder';
import { createMobileCustodyStore } from '../services/identity/mobileCustodyStore';
import { localRootChat,subscribeRootChatQueued,subscribeRootProfileChanges } from '../services/identity/localRootChat';
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
let inspectPush:(()=>{status:string})|null=null;
export const localAccountPushStatus=()=>inspectPush?.()??{status:'locked'};
const callListeners=new Set<(view:NeuronCallView<string>|null)=>void>();
export const localAccountCalls=()=>activeCalls?.coordinator??null;
export function subscribeLocalAccountCalls(listener:(view:NeuronCallView<string>|null)=>void){callListeners.add(listener);listener(localAccountCalls()?.snapshot()??null);return()=>{callListeners.delete(listener);};}
let activeActivity:ReturnType<typeof createChatActivity>|null=null;
export const peerTyping=(peer:string,group?:string)=>activeActivity?.typing(peer,group)??false;
export const notifyPeerTyping=(peer:string,value:boolean,group?:string)=>activeActivity?.notify(peer,value,group)??Promise.resolve();
let activeSnapshot: (() => ReturnType<ReturnType<typeof createLanIdentityRuntime>['snapshot']>) | null = null;
let diagnosticNetworkStartedAt:number|null=null;
export const localAccountDiagnosticNetworkEpoch=()=>activeSnapshot?diagnosticNetworkStartedAt:null;
let activeLookup: ((account: string) => Promise<DirectoryLookupResult>) | null = null;
export const localAccountLookupIdentity = (account: string) => activeLookup?.(account) ?? Promise.resolve(unavailableDirectoryLookup());
let activePeerResolver:((account:string)=>Promise<PeerIdentityResult>)|null=null;
export const ensureLocalPeerIdentity=(account:string)=>activePeerResolver?.(account)??Promise.resolve<PeerIdentityResult>({status:'unavailable'});
let inspectDirectory: (() => ReturnType<ReturnType<typeof createMobileDirectory>['snapshot']>) | null = null;
let inspectWake:(()=>{private:ReturnType<ReturnType<typeof createCustodyWakeForwarder>['diagnostics']>|null;group:ReturnType<ReturnType<typeof createCustodyWakeForwarder>['diagnostics']>|null})|null=null;
export const localAccountWakeDiagnostics=()=>localAccount.status().state==='unlocked'?inspectWake?.()??null:null;
export const localAccountDirectorySnapshot = () => inspectDirectory?.() ?? null;
export const localAccountNetworkSnapshot = () => activeSnapshot?.() ?? null;
export const subscribeRelayInventoryAccess=(listener:()=>void)=>localAccount.subscribe(listener);
export async function localAccountRelayInventory(){
 const status=localAccount.status(),account=status.state==='unlocked'&&!status.busy?status.account:null;if(!account)return null;
 const [messages,groups,media]=await Promise.all([createMobileCustodyStore(account).inspect(),createMobileGroupCustodyStore(account).inspect(),createMobileAttachmentStore(account).inspect()]);
 const after=localAccount.status();if(after.state!=='unlocked'||after.busy||after.account!==account)return null;
 return relayInventory(account,Date.now(),messages,groups,media.rows,media.chunks,activeCalls?.relayMetadata()??[]);
}
/** Independent root-identity participation; no legacy user ID, JWT, or Axion session. */
function createLocalAccountNetwork() {
  diagnosticNetworkStartedAt=Date.now();
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
        contacts:async()=>(await chatReads.read()).contacts,
        wakes:{pending:()=>pendingRootCallWakes(account),finish:id=>{
          const view=calls?.runtime.coordinator.snapshot();
          return finishRootCallWake(account,id,AppState.currentState!=='active'&&view?.id===id&&!view.outgoing&&view.status==='ringing');
        }},
        changed:view=>{void syncRootCallNotification(account,view).then(shown=>{if(shown&&view&&calls?.account===account)return calls.runtime.coordinator.confirmRinging(view.id);}).catch(()=>{});for(const listener of callListeners)listener(view);}});
      calls={account,runtime:callRuntime};activeCalls=callRuntime;
      const noticeLifecycle=AppState.addEventListener('change',()=>{const view=callRuntime.coordinator.snapshot();void syncRootCallNotification(account,view).then(shown=>{if(shown&&view)return callRuntime.coordinator.confirmRinging(view.id);}).catch(()=>{});});
      stopCallNotice=()=>noticeLifecycle.remove();
      const device=localAccount.callDevice()!;
      push=startRootPushRegistration(()=>owner()===account,(peer,raw)=>runtime.pushRequest(peer,raw));
      inspectPush=push.snapshot;
      void registerRootCallWakeOwner(account,device).catch(()=>{});
    }return calls.runtime;
  }
  let custody: { owner: string; group:ReturnType<typeof createGroupCustodyService>;groupWake:ReturnType<typeof createCustodyWakeForwarder>;service: ReturnType<typeof createCustodyService>; wake: ReturnType<typeof createCustodyWakeForwarder> } | null = null;
  let attachments:{owner:string;service:ReturnType<typeof createAttachmentCustody>}|null=null;
  let ownAttachments:ReturnType<typeof startRootAttachmentRuntime>|null=null;
  const owner = () => !stopped && !localAccount.status().busy && localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
  const chatReads=createRuntimeChatReads({owner,revision:ownChatRevision,read:()=>localRootChat().snapshot()});
  const capabilities=createPeerCapabilityWriter({owner,write:async(p,t,g)=>{const ledger=localRootChat();await ledger.rememberProfileOfferPeers(runtime.profileOfferPeers());await ledger.rememberProfilePeers(p);await ledger.rememberTimestampPeers(t);await ledger.rememberGroupCustodyPeers(g);}});
  function service() {
    const account = owner(); if (!account) return null;
    if (custody?.owner !== account) {
      custody?.wake.stop();custody?.groupWake.stop();
      const store = createMobileCustodyStore(account),groupStore=createMobileGroupCustodyStore(account);
      const next: NonNullable<typeof custody> = { owner: account,group:createGroupCustodyService({owner:account,records,store:groupStore,now:Date.now,current:()=>custody===next&&owner()===account}),groupWake:createCustodyWakeForwarder({store:groupCustodyWakeStore(groupStore),records,now:Date.now,current:()=>!stopped&&custody===next&&owner()===account,peers:()=>runtime.pushPeers(),request:(peer,raw)=>runtime.pushRequest(peer,raw)}), service: createCustodyService({ owner: account, records,
        store, now: Date.now, current: () => custody === next && owner() === account }),
        wake: createCustodyWakeForwarder({inlineEnvelope:true,store, records, now: Date.now,
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
  const activity=createChatActivity({owner,now:Date.now,allowed:async(peer,group)=>{const s=await chatReads.read();if(s.contacts.some(c=>c.account===peer&&c.blocked))return false;return group?s.groups?.some(g=>g.id===group&&g.accepted&&!g.blocked&&g.members.includes(peer)&&g.members.includes(owner()!))===true:s.contacts.some(c=>c.account===peer&&c.accepted);},send:async(peer,raw)=>{if(AppState.currentState!=='active')return false;const id=await Native!.identityRandomBytes!(32);return runtime.sendChatMessage(peer,raw,id);}});
  activeActivity=activity;
  const native = Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> };
  async function receiveMessage(message:{from:string;id:string;text:string},relay?:string){
    const account=owner();if(!account)return false;
    const ledger=localRootChat(),before=await ledger.snapshot();
    const seen=[...before.messages,...(before.actions??[]),...(before.groupActions??[]),].some(m=>m.id===message.id&&m.peer===message.from&&m.direction==='incoming')||before.groupSeen?.some(m=>m.id===message.id&&m.peer===message.from)===true;
    const accepted=await ledger.receive(message.from,message.id,message.text,deliveryEvidence('payload',Date.now(),relay));
    if(accepted&&!seen){
      const state=rootChatView(account,await localRootChat().snapshot()),m=state.messages.find(m=>m.direction==='incoming'&&m.peer===message.from&&m.id===message.id);
      const contact=state.contacts.find(c=>c.account===message.from),group=m?.group&&state.groups?.find(g=>g.id===m.group!.id);
      const preview=m?{name:group?.name||contact?.alias||shortIdentity(message.from),senderName:contact?.alias||shortIdentity(message.from),text:rootNotificationPreviewText(m),at:m.at,read:!!m.read||!!m.deleted,...(m.group?{group:m.group.id,orderId:m.group.messageId}:{})}:undefined;
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
    onChatMessage: async message => { try { const hint=await activity.receive(message.from,message.text);return hint===null?await receiveMessage(message):hint; } catch { return false; } },
    rtc: Platform.OS==='android'&&NativeModules.WebRTCModule?.axonicIdentityGuardVersion?.()===1?{
      mediaLane:typeof Native?.axonEnableMediaLane==='function',
      streamCredit:NativeModules.WebRTCModule?.axonicStreamGuardVersion?.()===1?async(channel,value,authorize)=>
        typeof channel._peerConnectionId==='number'&&typeof channel._reactTag==='string'&&
        await NativeModules.WebRTCModule.axonicStreamCredit(channel._peerConnectionId,channel._reactTag,value,authorize)===true:undefined,
      wait: Native?.axonMessageWait ? milliseconds => Native!.axonMessageWait!(milliseconds) : undefined,
      authenticated:NativeModules.WebRTCModule?.axonicIdentityAuthenticated?channel=>{
        if(typeof channel._peerConnectionId==='number'&&typeof channel._reactTag==='string')NativeModules.WebRTCModule.axonicIdentityAuthenticated(channel._peerConnectionId,channel._reactTag);
      }:undefined,
      random:()=>Native!.identityRandomBytes!(32),sign:(...args)=>localAccount.signSignal(...args),
      createConnection:()=>{const configuration={axonicIdentityGuard:true,iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]};return new RTCPeerConnection(configuration) as unknown as AxonPeerConnection;},
    }:undefined,
    onDirectory: (raw, peer) => directory.receive(peer.account, raw),
    onCustody: Object.assign(async(raw:string,peer:{account:string})=>{service();let group=false;try{group=String(JSON.parse(raw)?.operation).startsWith('group-');}catch{}return (group?custody?.group.receive(peer.account,raw):custody?.service.receive(peer.account,raw))??JSON.stringify({status:'rejected'});},{groupCustody:true}),
    internet: { peers: [...BOOTSTRAP_NEURONS], connect: createInternetAxonConnector(native, owner) } });
  const blocked=new Set<string>();
  const courier=createCustodyCourier({owner,allowed:peer=>!blocked.has(peer),now:Date.now,records:operationalRecords,own:createOwnCustodyStore(),
    relays:runtime.custodians,request:runtime.custodyRequest,seal:(...args)=>localAccount.sealCustody(...args),
    receive:(envelope,relay)=>localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,relay)),
    held:envelope=>localRootChat().networkStored(envelope.recipient,envelope.id,envelope.expires),
    confirmReceipt:async(receipt,current,relay)=>{
      if(!current())return false;const ledger=localRootChat(),state=await chatReads.read();
      if(!current()||![...state.messages,...(state.actions??[]),...(state.groupActions??[])].some(m=>m.id===receipt.id&&m.peer===receipt.recipient&&m.direction==='outgoing')&&!state.groupPackets?.some(m=>m.id===receipt.id&&m.peer===receipt.recipient)&&!knownProfileReceipt(state,owner()!,receipt.recipient,receipt.id))return false;
      await ledger.delivered(receipt.recipient,receipt.id,deliveryEvidence('receipt',Date.now(),relay));return current();
    },
  });
  const groupCourier=createGroupCustodyCourier({owner,now:Date.now,records:{...operationalRecords,read:async account=>account===owner()?localAccount.publicRecord():operationalRecords.read(account)},own:createOwnCustodyStore(),
    compatible:async peer=>(await chatReads.read()).groupCustodyPeers?.includes(peer)===true,relays:runtime.groupCustodians,request:runtime.custodyRequest,allowed:peer=>!blocked.has(peer),
    store:{read:async account=>{const raw=await AsyncStorage.getItem('@axonic_group_outbox_v1:'+account);if(raw&&raw.length>8*1024*1024)throw Error('Group outbox capacity');const rows=raw?JSON.parse(raw):[];if(!Array.isArray(rows)||rows.length>128)throw Error('Invalid group outbox');return rows;},write:(account,rows)=>AsyncStorage.setItem('@axonic_group_outbox_v1:'+account,JSON.stringify(rows))},
    heldGroup:envelopes=>localRootChat().networkStoredGroup(envelopes),seal:localAccount.sealGroupCustody,receive:(envelope,payload,relay)=>localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,relay),payload),
    held:envelope=>localRootChat().networkStored(envelope.recipient,envelope.id,envelope.expires),
    confirm:async(receipt,current,relay)=>{if(!current())return false;const state=await chatReads.read();if(!current()||![...state.messages,...(state.groupActions??[])].some(m=>m.direction==='outgoing'&&m.peer===receipt.recipient&&m.id===receipt.id))return false;await localRootChat().delivered(receipt.recipient,receipt.id,deliveryEvidence('receipt',Date.now(),relay));return current();}
  });
  const unsub = localAccount.subscribe(() => { if (!owner()) {chatReads.clear();capabilities.clear();activity.clear();peerResolver.invalidate();delivery.invalidate();stopCalls();custody = null;blocked.clear();courier.invalidate();groupCourier.invalidate();profileRecovery.invalidate();}else{profileRecovery.changed();void migrateSharedProfileAvatar().catch(()=>{});} });
  const unlimit = subscribeAllowedAxons(() => runtime.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  void loadRecoverySettings().catch(() => {});
  const delivery=createMessageDelivery({owner,ledger:()=>({...localRootChat(),snapshot:chatReads.read}),
    now:Date.now,connectedPeers:()=>runtime.snapshot().sessions.filter(s=>s.state==='connected'&&s.account).map(s=>s.account!),
    blocked:peers=>{blocked.clear();for(const peer of peers)blocked.add(peer);},collect:async()=>{await courier.tick();await groupCourier.tick();},
    send:runtime.sendChatMessage,resolve:peerResolver.resolve,deposit:(...args)=>courier.deposit(...args),depositGroup:groupCourier.deposit});
  const unqueue=subscribeRootChatQueued((account,peer,id)=>{if(owner()===account)delivery.wake(peer,id);});
  const groupRecovery=createGroupRecovery({owner,now:Date.now,peers:()=>runtime.snapshot().sessions.filter(s=>s.state==='connected'&&s.account).map(s=>s.account!),random:()=>Native!.identityRandomBytes!(32),recover:(peer,id)=>localRootChat().recoverGroupsForPeer(peer,id)});
  const profileRecovery=createProfileRecovery({owner,state:chatReads.read,peers:runtime.profilePeers,offerPeers:runtime.profileOfferPeers,
    remember:async(peers,offers)=>{const ledger=localRootChat();await ledger.rememberProfileOfferPeers(offers);await ledger.rememberProfilePeers(peers);},
    send:runtime.sendChatMessage,known:peer=>sharedAvatarHash(owner()!,peer),request:(peer,id,known)=>localRootChat().requestProfile(peer,id,known)});
  const unprofile=subscribeRootProfileChanges(()=>profileRecovery.changed()),unconnected=runtime.subscribeConnected(peer=>profileRecovery.connected(peer));
  profileRecovery.changed();void migrateSharedProfileAvatar().catch(()=>{});
  let lastDiagnosticSample=0;
  const pump = () => { if(owner()&&Date.now()-lastDiagnosticSample>=15000){lastDiagnosticSample=Date.now();const connections=runtime.snapshot().pool?.connections??[];diagnosticJournal.network(connections.filter(c=>c.state==='connected').length,connections.filter(c=>c.state==='authenticating').length);}  void capabilities.update(runtime.profilePeers(),runtime.timestampPeers(),runtime.groupCustodians()).catch(()=>{});loadRemembered(); runtime.tick(); service();void groupRecovery.tick().catch(()=>{});void custody?.wake.tick();void custody?.groupWake.tick();void custody?.group.replicate(runtime.groupCustodians(),runtime.custodyRequest).catch(()=>{}); void directory.tick().catch(() => {});void delivery.tick();void callService()?.tick().catch(()=>{});void push?.tick().catch(()=>{}); };
  const tick = setInterval(pump, 1000);
  let sweeping = false;
  const sweep = setInterval(() => { if (sweeping) return; const current = service(); if (!current) return;
    sweeping = true; void Promise.all([current.sweep(),custody?.group.sweep(),attachmentService()?.sweep()]).catch(() => {}).finally(() => { sweeping = false; }); }, 60_000);
  runtime.tick(); inspectDirectory = directory.snapshot; activeLookup = directory.lookup; activeSnapshot = runtime.snapshot;
  inspectWake=()=>({private:custody?.wake.diagnostics()??null,group:custody?.groupWake.diagnostics()??null});
  activePeerResolver=peerResolver.resolve;
  const attachmentApi={sharedPeers:runtime.sharedAttachmentPeers,peers:runtime.attachmentPeers,request:runtime.attachmentRequest,bulkPeers:runtime.attachmentBulkPeers,batchChunks:runtime.attachmentBatchChunks,batchWindow:runtime.attachmentBatchWindow,bulkRequest:runtime.attachmentBulkRequest};
  ownAttachments=startRootAttachmentRuntime({...attachmentApi,streams:runtime.attachmentStreams,lookup:peerResolver.resolve});
  return { snapshot: runtime.snapshot, recoveryStatus:delivery.snapshot,
    receiveWakeEnvelope:(envelope:CustodyEnvelope)=>localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,'')),
    recoveryComplete:(sender:string,id:string)=>{const status=delivery.snapshot();return !status.busy&&!status.collecting&&!status.queuedHints&&(courier.recoveryComplete(sender,id)||groupCourier.recoveryComplete(sender,id));},
    resume() { runtime.resume();courier.resume();groupCourier.resume();pump(); }, tick:pump, stop() { chatReads.clear();capabilities.clear();activity.clear();if(activeActivity===activity)activeActivity=null;unqueue();unprofile();unconnected();profileRecovery.stop();delivery.stop();ownAttachments.stop();if(activePeerResolver===peerResolver.resolve)activePeerResolver=null;peerResolver.stop();stopCalls();courier.stop();groupCourier.stop();custody?.groupWake.stop();directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory ===directory.snapshot) inspectDirectory = null; if (activeSnapshot === runtime.snapshot) {activeSnapshot = null;inspectWake=null;} stopped = true; custody = null; clearInterval(tick); clearInterval(sweep); unsub(); unlimit(); runtime.stop(); } };
}

// Foreground UI and a headless wake share one transport; each releases only its own lease.
let sharedNetwork:{runtime:ReturnType<typeof createLocalAccountNetwork>;references:number}|null=null;
export function startLocalAccountNetwork(){
 const shared=sharedNetwork??={runtime:createLocalAccountNetwork(),references:0};shared.references++;
 let released=false;return {receiveWakeEnvelope:shared.runtime.receiveWakeEnvelope,snapshot:shared.runtime.snapshot,recoveryStatus:shared.runtime.recoveryStatus,recoveryComplete:shared.runtime.recoveryComplete,resume:shared.runtime.resume,tick:shared.runtime.tick,stop(){if(released)return;released=true;if(--shared.references===0){if(sharedNetwork===shared)sharedNetwork=null;shared.runtime.stop();}}};
}


