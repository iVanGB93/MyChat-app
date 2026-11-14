import {mobileTrialCredits} from '../services/identity/mobileTrialCredits';
import {trialReference} from '../services/identity/trialCredits';
import {networkScorecard} from '../services/identity/networkScorecard';
import {createGroupCallPresence} from '../services/identity/groupCallPresence';
import {groupCallMembershipMatches,type GroupCallRoom} from '../services/identity/groupCallRoom';
import {GROUP_CUSTODY_LIMITS} from '../services/identity/groupCustodyService';
import {createReceiptConfirmation} from '../services/identity/receiptConfirmation';
import {createIncomingMessageAdmission} from '../services/identity/incomingMessageAdmission';
import {createCustodyMaintenance} from '../services/identity/custodyMaintenance';
import {createMobileCallSession} from './mobileCallSession';
import {createChangeSignal} from '../services/identity/changeSignal';
const networkChanges=createChangeSignal(500);
const relayChanges=createChangeSignal(2000);
export const subscribeRelayChanges=relayChanges.subscribe;
export const subscribeLocalNetworkChanges=networkChanges.subscribe;
import {createCustodyEvents} from '../services/identity/custodyEvents';
import {createNativeCallDeadline} from '../services/identity/nativeCallDeadline';
import {createEventDeadlineTask as createSharedEventDeadlineTask} from '../services/identity/eventDeadlineTask';
// Native background callbacks can run while React Native frame timers are paused.
const createEventDeadlineTask=(d:Parameters<typeof createSharedEventDeadlineTask>[0])=>createSharedEventDeadlineTask({...d,immediateEvents:true});
import type {GroupCustodyPayload} from '../services/identity/groupCustodyProtocol';
import {deliveryEvidence,receiptDeliveryEvidence} from '../services/identity/deliveryEvidence';
import {diagnosticJournal} from '../services/diagnosticJournal';
import {relayInventory} from '../services/identity/relayInventory';
import type {CustodyEnvelope} from '../services/identity/custodyProtocol';
import {loadRecoverySettings} from '../services/recoverySettings';
import {createGroupCustodyCourier} from '../services/identity/groupCustodyCourier';
import type {IdentityPeer} from '../services/identity/identityClient';
import {createGroupCustodyService,groupCustodyWakeStore} from '../services/identity/groupCustodyService';
import {createMobileGroupCustodyStore} from '../services/identity/mobileGroupCustodyStore';
import {createRuntimeChatReads,createPeerCapabilityWriter} from '../services/identity/runtimeChatReads';
import {ownChatRevision,subscribeOwnChatWrites} from '../modules/storage/chatStore';
import {migrateSharedProfileAvatar} from '../modules/messaging/profile';
import {createProfileRecovery} from '../services/identity/profileRecovery';
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
import { localAccount,requestLocalNetworkReset,closeForNetworkReset } from '../services/identity/localAccount';
import { createLanIdentityRuntime, type NativeAxonLan } from '../services/identity/lanIdentityRuntime';
import { createMobileIdentityRecordStore } from '../services/identity/identityRecordStore';
import { createInternetAxonConnector, BOOTSTRAP_NEURONS, configuredWakeCustodian } from '../services/identity/internetAxonTransport';
import { createCustodyService } from '../services/identity/custodyService';
import {createCustodyWakeForwarder} from '../services/identity/custodyWakeForwarder';
import { createMobileCustodyStore } from '../services/identity/mobileCustodyStore';
import { localRootChat,subscribeRootChatQueued,subscribeRootProfileChanges } from '../services/identity/localRootChat';
import {createDeliveryOutbox} from '../modules/messaging/deliveryOutbox';
import {createMessageDelivery} from '../modules/messaging/delivery';
import { AppState, NativeModules, Platform } from 'react-native';
import { RTCPeerConnection } from 'react-native-webrtc';
import type { AxonPeerConnection } from '../services/identity/rtcAxonTransport';
import { createCustodyCourier } from '../services/identity/custodyCourier';
import { createOwnCustodyStore } from '../services/identity/ownCustodyStore';
import {createRootAccountCalls} from '../services/identity/rootAccountCalls';
import {subscribeCallJournalWrites} from '../services/identity/mobileCallJournalStore';
import type {NeuronCallView} from '../services/identity/neuronCallCoordinator';
import {startRootPushRegistration} from '../services/identity/rootPushRegistration';
import {subscribeRootCallWakes} from '../services/identity/rootCallWake';
import {finishRootMessageWake} from '../services/identity/rootMessageWake';
import {createAttachmentCustody} from '../services/identity/attachmentCustody';
import {createMobileAttachmentStore} from '../services/identity/mobileAttachmentStore';
import {startRootAttachmentRuntime} from '../services/identity/rootAttachmentRuntime';
import {createPeerIdentityResolver,type PeerIdentityResult} from '../services/identity/peerIdentityResolver';
let inspectCoordinator:(()=>Record<string,ReturnType<ReturnType<typeof createEventDeadlineTask>['diagnostics']>>)|null=null;
export const localAccountCoordinatorDiagnostics=()=>inspectCoordinator?.()??null;
let activeCalls:ReturnType<typeof createRootAccountCalls>|null=null;
let inspectPush:(()=>{status:string})|null=null;
export const localAccountPushStatus=()=>inspectPush?.()??{status:'locked'};
const callListeners=new Set<(view:NeuronCallView<string>|null)=>void>();
export const localAccountCalls=()=>activeCalls?.coordinator??null;
export async function resetLocalNetworkWork(confirmed:true){
 const call=localAccountCalls()?.snapshot();if(call&&!['ended','failed'].includes(call.status))throw Error('Finish the call before resetting network work');
 const account=localAccount.status().account;if(!account)throw Error('Unlock your account first');
 await requestLocalNetworkReset(account,confirmed);await closeForNetworkReset();
}
export function subscribeLocalAccountCalls(listener:(view:NeuronCallView<string>|null)=>void){callListeners.add(listener);listener(localAccountCalls()?.snapshot()??null);return()=>{callListeners.delete(listener);};}
const groupCallPresenceChanges=createChangeSignal(0);
let activeGroupCallPresence:ReturnType<typeof createGroupCallPresence>|null=null;
export const subscribeGroupCallPresence=groupCallPresenceChanges.subscribe;
export const groupCallIsActive=(id:string)=>activeGroupCallPresence?.active(id)??false;
export const watchGroupCallPresence=(room:GroupCallRoom)=>activeGroupCallPresence?.watch(room)??(()=>{});
const activityChanges=createChangeSignal(0);
export const subscribeChatActivity=activityChanges.subscribe;
export const nextChatActivityDeadline=()=>activeActivity?.nextDeadline()??Infinity;
let activeActivity:ReturnType<typeof createChatActivity>|null=null;
export const peerRecording=(peer:string,group?:string)=>activeActivity?.recording(peer,group)??false;
export const notifyPeerRecording=(peer:string,value:boolean,group?:string)=>activeActivity?.notify(peer,value,group,'recording')??Promise.resolve();
export const peerTyping=(peer:string,group?:string)=>activeActivity?.typing(peer,group)??false;
export const notifyPeerTyping=(peer:string,value:boolean,group?:string)=>activeActivity?.notify(peer,value,group)??Promise.resolve();
let inspectContribution:(()=>{privateRelay:ReturnType<ReturnType<typeof createCustodyService>['contribution']>|null;groupRelay:ReturnType<ReturnType<typeof createGroupCustodyService>['contribution']>|null;mediaRelay:ReturnType<ReturnType<typeof createAttachmentCustody>['contribution']>|null})|null=null;
export function localAccountScorecard(){const n=localAccountNetworkSnapshot();return networkScorecard({state:n?.state??'unavailable',connected:n?.pool?.connections.filter(c=>c.state==='connected').length??0,error:!!n?.error,...(inspectContribution?.()??{privateRelay:null,groupRelay:null,mediaRelay:null})});}
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
let inspectPolling:(()=>{private:ReturnType<ReturnType<typeof createCustodyCourier>['diagnostics']>;group:ReturnType<ReturnType<typeof createGroupCustodyCourier>['diagnostics']>;pendingDerivations:number;events:ReturnType<ReturnType<typeof createCustodyEvents>['diagnostics']>})|null=null;
export const localAccountPollingDiagnostics=()=>localAccount.status().state==='unlocked'?inspectPolling?.()??null:null;
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
function createLocalAccountNetwork(recoveryPeers:()=>ReadonlySet<string>|undefined) {
  diagnosticNetworkStartedAt=Date.now();
  const recoveryListeners=new Set<(sender:string,id:string)=>void>();
  const receiptAccepted=(sender:string,id:string)=>{for(const listener of recoveryListeners){try{listener(sender,id);}catch{/* Independent recovery waiters. */}}};
  if (!Native?.axonLanStart || !Native?.axonWssConnect) throw Error('Network transport unavailable in this build');
  const records = createMobileIdentityRecordStore(Date.now);
  const remembered=createRememberedNeurons({now:Date.now,read:account=>AsyncStorage.getItem('@axonic_known_neurons_v1:'+account),write:(account,raw)=>AsyncStorage.setItem('@axonic_known_neurons_v1:'+account,raw)});
  let rememberedOwner:string|null=null,rememberedPeers:NeuronCandidate[]=[],loadingOwner:string|null=null;
  function loadRemembered(){const account=owner();if(!account){rememberedOwner=null;rememberedPeers=[];return;}
    if(rememberedOwner===account||loadingOwner===account)return;loadingOwner=account;
    return remembered.list(account).then(peers=>{if(owner()===account){rememberedOwner=account;rememberedPeers=peers;}}).finally(()=>{if(loadingOwner===account)loadingOwner=null;});
  }
  let stopped = false;
  let push:ReturnType<typeof startRootPushRegistration>|null=null;
  let calls: {account:string;runtime:ReturnType<typeof createRootAccountCalls>}|null=null;
  let stopCallNotice:(()=>void)|null=null;
  function stopCalls(){Native?.axonCallSetupWindow?.(0);stopCallNotice?.();stopCallNotice=null;push=null;inspectPush=null;if(!calls)return;const previous=calls;calls=null;if(activeCalls===previous.runtime)activeCalls=null;}
  let lastCallDiagnostic='';
  function callService(){
    const account=owner();if(!account){stopCalls();return null;}
    if(calls?.account!==account){stopCalls();
      const session=createMobileCallSession(account,{owner,network:()=>runtime,records:operationalRecords,chat:metadataReads.read,
        inboxChanged:peer=>callEvents.changed(peer),wake:()=>{callClockWork.changed();callWork.changed();},
        activate:callRuntime=>{calls={account,runtime:callRuntime};activeCalls=callRuntime;},
        changed:view=>{presence.update(view);const evidence={callStatus:view?.status??'idle',callMedia:view?.media,groupCall:!!view?.room,participants:view?.room?.descriptor.members.length??(view?2:0),readyLegs:view?.room?.legs.filter(l=>l.status==='ready').length??0,endedLegs:view?.room?.legs.filter(l=>l.status==='ended').length??0},key=JSON.stringify(evidence);if(key!==lastCallDiagnostic){lastCallDiagnostic=key;diagnosticJournal.record('call_state_changed',evidence);}for(const listener of callListeners)listener(view);}});
      push=session.push;inspectPush=push.snapshot;stopCallNotice=session.stop;
    }return calls?.runtime??null;
  }
  let custody: { owner: string; group:ReturnType<typeof createGroupCustodyService>;groupWake:ReturnType<typeof createCustodyWakeForwarder>;service: ReturnType<typeof createCustodyService>; wake: ReturnType<typeof createCustodyWakeForwarder> } | null = null;
  let attachments:{owner:string;service:ReturnType<typeof createAttachmentCustody>}|null=null;
  let ownAttachments:ReturnType<typeof startRootAttachmentRuntime>|null=null;
  const owner = () => !stopped && !localAccount.status().busy && localAccount.status().state === 'unlocked' ? localAccount.status().account : null;
  const metadataReads=createRuntimeChatReads({owner,revision:ownChatRevision,read:()=>localRootChat().metadataSnapshot()});
  const deliveryReads=createRuntimeChatReads({owner,revision:ownChatRevision,read:()=>localRootChat().deliverySnapshot()});
  const outbox=createDeliveryOutbox({owner,read:deliveryReads.read,delivered:(...args)=>localRootChat().delivered(...args)});
  const capabilities=createPeerCapabilityWriter({owner,write:async(p,t,g)=>{const ledger=localRootChat();await ledger.rememberPeerCapabilities({profileOfferPeers:runtime.profileOfferPeers(),profilePeers:p,timestampPeers:t,groupCustodyPeers:g});}});
  function service() {
    const account = owner(); if (!account) return null;
    if (custody?.owner !== account) {
      custody?.wake.stop();custody?.groupWake.stop();
      const store = createMobileCustodyStore(account),groupStore=createMobileGroupCustodyStore(account);
      const next: NonNullable<typeof custody> = { owner: account,group:createGroupCustodyService({scoreChanged:networkChanges.changed,trial:event=>{void mobileTrialCredits(account).observe(event);},changed:peer=>{inboxEvents.changed(peer);next.wake.changed();next.groupWake.changed();privateWakeWork.changed();groupWakeWork.changed();},owner:account,records:operationalRecords,store:groupStore,now:Date.now,current:()=>custody===next&&owner()===account,receiveOwn:async(grant,payload,relay)=>{const receipt=await localAccount.receiveCustody(grant,operationalRecords,m=>receiveMessage(m,relay),payload,relay);if(receipt)void receiptConfirmation.confirm(receipt,relay,payload.id);return receipt;}}),groupWake:createCustodyWakeForwarder({eventDriven:true,groupPayload:packet=>next.group.payloadFor(packet),custodian:account,deliverDirect:packet=>next.group.deliverDirect(packet,runtime.custodyRequest),store:groupCustodyWakeStore(groupStore),records,now:Date.now,current:()=>!stopped&&custody===next&&owner()===account,peers:()=>[],request:async()=>null}), service: createCustodyService({scoreChanged:networkChanges.changed,trial:event=>{void mobileTrialCredits(account).observe(event);}, changed:peer=>{inboxEvents.changed(peer);next.wake.changed();next.groupWake.changed();privateWakeWork.changed();groupWakeWork.changed();},owner: account, records:operationalRecords,
        store, now: Date.now, current: () => custody === next && owner() === account,
        receiveOwn:async(envelope,relay)=>{const receipt=await localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,relay),undefined,relay);if(receipt)void receiptConfirmation.confirm(receipt,relay);return receipt;} }),
        wake: createCustodyWakeForwarder({eventDriven:true,inlineEnvelope:true,custodian:account,store, records, now: Date.now,
          deliverDirect:packet=>next.service.deliverDirect(packet,runtime.custodyRequest),
          current: () => !stopped && custody === next && owner() === account,
          peers: () => [], request: async () => null}) };
      custody = next;
    }
    return custody.service;
  }
  function attachmentService(){const account=owner();if(!account)return null;
    if(attachments?.owner!==account)attachments={owner:account,service:createAttachmentCustody({scoreChanged:networkChanges.changed,trial:event=>{void mobileTrialCredits(account).observe(event);},owner:account,records,store:createMobileAttachmentStore(account),now:Date.now,current:()=>owner()===account})};
    return attachments.service;
  }
  const activity=createChatActivity({owner,now:Date.now,changed:activityChanges.changed,allowed:async(peer,group)=>{const s=await metadataReads.read();if(s.contacts.some(c=>c.account===peer&&c.blocked))return false;return group?s.groups?.some(g=>g.id===group&&g.accepted&&!g.blocked&&g.members.includes(peer)&&g.members.includes(owner()!))===true:s.contacts.some(c=>c.account===peer&&c.accepted);},send:async(peer,raw)=>{if(AppState.currentState!=='active')return false;const id=await Native!.identityRandomBytes!(32);return runtime.sendChatMessage(peer,raw,id);}});
  const presence=createGroupCallPresence({owner,now:Date.now,changed:groupCallPresenceChanges.changed,peers:()=>runtime.callPeers(),
   allowed:async(room,peer)=>{const s=await metadataReads.read();return groupCallMembershipMatches(room,s.groups?.find(g=>g.id===room.group),owner()??'')&&!s.contacts.some(c=>c.account===peer&&c.blocked);},
   send:async(peer,raw)=>runtime.sendChatMessage(peer,raw,await Native!.identityRandomBytes!(32))});
  activeGroupCallPresence=presence;
  activeActivity=activity;
  const native = Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> };
  const incomingPresentation=new Map<string,Promise<void>>();
  const presentationKey=(account:string,sender:string,id:string)=>account+":"+sender+":"+id;
  const receiveMessage=createIncomingMessageAdmission({owner,receive:async(message,relay)=>{
    const account=owner();if(!account)return false;
    const began=performance.now(),ledger=localRootChat(),seen=await ledger.hasReceived(message.from,message.id),checked=performance.now();
    const accepted=await ledger.receive(message.from,message.id,message.text,deliveryEvidence('payload',Date.now(),relay));
    const committed=performance.now();
    if(accepted&&!seen){
      const key=presentationKey(account,message.from,message.id);
      const work=Promise.resolve().then(async()=>{
        if(owner()!==account)return;
        const state=rootChatView(account,await localRootChat().messageSnapshot(message.from,message.id)),m=state.messages.find(m=>m.direction==='incoming'&&m.peer===message.from&&m.id===message.id);
        const contact=state.contacts.find(c=>c.account===message.from),group=m?.group&&state.groups?.find(g=>g.id===m.group!.id);
        const preview=m?{name:group?.name||contact?.alias||shortIdentity(message.from),senderName:contact?.alias||shortIdentity(message.from),text:rootNotificationPreviewText(m),at:m.at,read:!!m.read||!!m.deleted,...(m.group?{group:m.group.id,orderId:m.group.messageId}:{})}:undefined;
        if(owner()===account)await finishRootMessageWake(account,message.from,message.id,preview);
      }).catch(()=>{}).finally(()=>{
        if(incomingPresentation.get(key)===work)incomingPresentation.delete(key);
        console.info('[Axonic incoming presentation]',{presentationMs:Math.round(performance.now()-committed)});
      });
      incomingPresentation.set(key,work);
      console.info('[Axonic incoming timing]',{dedupMs:Math.round(checked-began),storeMs:Math.round(committed-checked)});
    }
    return accepted;
  }});
  const directory = createMobileDirectory(localAccount, records, () => !stopped, () => runtime);
  const peerResolver=createPeerIdentityResolver({wait:ms=>Native?.axonMessageWait?Native.axonMessageWait(ms):new Promise(resolve=>setTimeout(resolve,ms)),records,lookup:directory.lookup,current:()=>!!owner(),now:Date.now});
  // Relayed inbox/call traffic can be the first contact with this sender. Resolve
  // their signed record before those existing verifiers read the shared pin store.
  const operationalRecords={...records,read:async(account:string)=>{
    const result=await peerResolver.resolve(account);return result.status==='found'?result.record??null:null;
  }};
  const runtime = createLanIdentityRuntime({recoveryPeers,onQualityChanged:networkChanges.changed,onWorkChanged:()=>{transportWork.changed();networkChanges.changed();}, remembered:()=>rememberedPeers,
    onConnected:peer=>{const account=owner();if(account)void remembered.remember(account,peer).catch(()=>{});},
    identity: localAccount, native, store: records, now: Date.now, limit: allowedAxons(),
    // Advertise the registration protocol as a client; ordinary phones do not mint FCM leases.
    onPush:Object.assign(async()=>JSON.stringify({status:'unsupported'}),{gateway:false}),
    onAttachment:Object.assign(async(raw:string,peer:IdentityPeer)=>{try{return (await ownAttachments?.receive(raw,peer))??await attachmentService()?.receive(raw,peer)??'{"status":"rejected"}';}finally{relayChanges.changed();}},{wssBinary:(raw:Uint8Array,peer:IdentityPeer)=>ownAttachments?.receiveWssBinary(raw,peer)??false,wssStream:(raw:string,peer:IdentityPeer)=>ownAttachments?.receiveWss(raw,peer)??false,uploadBatch:true,streams:Platform.OS==='android'&&!!Native?.attachmentStageStream&&NativeModules.WebRTCModule?.axonicIdentityGuardVersion?.()===1&&NativeModules.WebRTCModule?.axonicStreamGuardVersion?.()===1}),
    onCallControl:async(raw,peer)=>{try{return await callService()?.receive(raw,peer)??null;}catch{return null;}},
    onCallRelay:async(raw,peer)=>{try{return await callService()?.receiveRelay(raw,peer)??'{}';}catch{return '{}';}},
    onCallMediaRelay:async(raw,peer)=>{try{return await callService()?.relayMedia(raw,peer)??false;}catch{return false;}},
    onRelayedCallMedia:async(raw,peer)=>{try{return await callService()?.receiveRoutedMedia(raw,peer)??false;}catch{return false;}},
    onCallMedia:async(raw,peer,instance)=>{try{return await callService()?.receiveMedia(raw,peer,instance)??false;}catch{return false;}},
    onChatMessage: async message => { try { const presenceHint=await presence.receive(message.from,message.text);if(presenceHint!==null)return presenceHint;const hint=await activity.receive(message.from,message.text);return hint===null?await receiveMessage(message):hint; } catch { return false; } },
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
    onCustody: Object.assign(async(raw:string,peer:{account:string})=>{const notice=inboxEvents.receive(peer.account,raw);if(notice!==null)return notice;const callNotice=callEvents.receive(peer.account,raw);if(callNotice!==null)return callNotice;service();let group=false;try{group=String(JSON.parse(raw)?.operation).startsWith('group-');}catch{}try{return await (group?custody?.group.receive(peer.account,raw):custody?.service.receive(peer.account,raw))??JSON.stringify({status:'rejected'});}finally{relayChanges.changed();}},{groupCustody:true,custodyEvents:true,callInboxEvents:true}),
    internet: { peers: [...BOOTSTRAP_NEURONS], connect: createInternetAxonConnector(native, owner) } });
  const blocked=new Set<string>();
  const ownCustody=createOwnCustodyStore();
  const wakeCustodians=(ranked:string[],raw?:string)=>{
   const push=new Set(runtime.pushPeers());
   const media=raw&&/^\["axonic-root-(?:group-)?attachment(?:-reply)?-v1"/.test(raw)?new Set(runtime.attachmentUploadBatchPeers()):null;
   return ranked.filter(peer=>configuredWakeCustodian(peer)&&push.has(peer)&&(!media||media.has(peer)));
  };
  const courier=createCustodyCourier({receiptAccepted,owner,allowed:peer=>!blocked.has(peer),now:Date.now,records:operationalRecords,own:ownCustody,singleCustodian:true,
    relays:runtime.custodians,depositRelays:raw=>wakeCustodians(runtime.custodians(),raw),eventDriven:peer=>runtime.eventCustodians().includes(peer),
    request:runtime.custodyRequest,seal:(...args)=>localAccount.sealCustody(...args),
    receive:(envelope,relay)=>localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,relay),undefined,relay),
    held:async (envelope,relay)=>{await localRootChat().networkStored(envelope.recipient,envelope.id,envelope.expires,false,relay);void mobileTrialCredits(envelope.sender).observe({kind:'relay-use',chat:'private',reference:trialReference(envelope.sender,envelope.id,envelope.recipient)});},
    confirmReceipt:async(receipt,current,relay)=>{
      if(!current())return false;const ledger=localRootChat(),known=await ledger.hasOutgoingReceipt(receipt.recipient,receipt.id);
      if(!current()||!known)return false;
      await ledger.delivered(receipt.recipient,receipt.id,receiptDeliveryEvidence(receipt,receipt.sender,Date.now(),relay));return current();
    },
  });
  const groupCourier=createGroupCustodyCourier({receiptAccepted,owner,now:Date.now,records:{...operationalRecords,read:async account=>account===owner()?localAccount.publicRecord():operationalRecords.read(account)},own:ownCustody,
    compatible:async peer=>(await metadataReads.read()).groupCustodyPeers?.includes(peer)===true,relays:runtime.groupCustodians,depositRelays:raw=>wakeCustodians(runtime.groupCustodians(),raw),eventDriven:peer=>runtime.eventCustodians().includes(peer),request:runtime.custodyRequest,allowed:peer=>!blocked.has(peer),
    store:{read:async account=>{const raw=await AsyncStorage.getItem('@axonic_group_outbox_v1:'+account);if(raw&&raw.length>GROUP_CUSTODY_LIMITS.bytes)throw Error('Group outbox capacity');const rows=raw?JSON.parse(raw):[];if(!Array.isArray(rows)||rows.length>GROUP_CUSTODY_LIMITS.perSender)throw Error('Invalid group outbox');return rows;},write:(account,rows)=>AsyncStorage.setItem('@axonic_group_outbox_v1:'+account,JSON.stringify(rows))},
    heldGroup:async (envelopes,relay)=>{await localRootChat().networkStoredGroup(envelopes,relay);for(const e of envelopes)void mobileTrialCredits(e.sender).observe({kind:'relay-use',chat:'group',reference:trialReference(e.sender,e.id,e.recipient)});},seal:localAccount.sealGroupCustody,receive:(envelope,payload,relay)=>localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,relay),payload,relay),
    held:async (envelope,relay)=>{await localRootChat().networkStored(envelope.recipient,envelope.id,envelope.expires,false,relay);void mobileTrialCredits(envelope.sender).observe({kind:'relay-use',chat:'group',reference:trialReference(envelope.sender,envelope.id,envelope.recipient)});},
    confirm:async(receipt,current,relay)=>{if(!current())return false;const known=await localRootChat().hasOutgoingReceipt(receipt.recipient,receipt.id,true);if(!current()||!known)return false;await localRootChat().delivered(receipt.recipient,receipt.id,receiptDeliveryEvidence(receipt,receipt.sender,Date.now(),relay));return current();}
  });
  const inboxEvents=createCustodyEvents({current:()=>!stopped&&!!owner(),now:Date.now,peers:runtime.eventCustodians,request:runtime.custodyRequest,scheduled:()=>noticeWork.changed(),reconcile:peer=>{courier.resume(peer);groupCourier.resume(peer);privateInboxWork.changed();groupInboxWork.changed();}});
  const callEvents=createCustodyEvents({operation:'call-inbox-changed',current:()=>!stopped&&!!owner(),now:Date.now,peers:runtime.eventCallPeers,request:runtime.custodyRequest,scheduled:()=>callNoticeWork.changed(),reconcile:()=>{calls?.runtime.changed();callClockWork.changed();callWork.changed();}});
  const unsub = localAccount.subscribe(() => { if (!owner()) {metadataReads.clear();deliveryReads.clear();outbox.clear();capabilities.clear();activity.clear();presence.clear();peerResolver.invalidate();delivery.invalidate();stopCalls();custody = null;blocked.clear();courier.invalidate();groupCourier.invalidate();profileRecovery.invalidate();}else{profileRecovery.changed();void migrateSharedProfileAvatar().catch(()=>{});} stateWork.changed(); });
  const unlimit = subscribeAllowedAxons(() => runtime.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  void loadRecoverySettings().catch(() => {});
  const delivery=createMessageDelivery({owner,changed:()=>deliveryWork.changed(),readOutbox:outbox.readOutbox,acceptDirect:outbox.acceptDirect,
   directDelivery:(sender,peer,id)=>{void mobileTrialCredits(sender).observe({kind:'direct-delivery',reference:trialReference(sender,id,peer)});},
    now:Date.now,connectedPeers:()=>runtime.snapshot().sessions.filter(s=>s.state==='connected'&&s.account).map(s=>s.account!),
    blocked:peers=>{blocked.clear();for(const peer of peers)blocked.add(peer);},collect:async()=>{
      // Each courier owns bounded per-relay single flights. Do not hold the
      // runtime-wide collect lock while a slow transport awaits its timeout.
      void courier.tick().catch(()=>{});void groupCourier.tick().catch(()=>{});
    },
    send:runtime.sendChatMessage,resolve:peerResolver.resolve,deposit:(...args)=>courier.deposit(...args),depositGroup:groupCourier.deposit});
  const unqueue=subscribeRootChatQueued((account,peer,id)=>{if(owner()===account){delivery.wake(peer,id);deliveryWork.changed();}});
  const groupRecovery=createGroupRecovery({owner,now:Date.now,peers:()=>runtime.snapshot().sessions.filter(s=>s.state==='connected'&&s.account).map(s=>s.account!),random:()=>Native!.identityRandomBytes!(32),recover:(peer,id)=>localRootChat().recoverGroupsForPeer(peer,id)});
  const profileRecovery=createProfileRecovery({owner,state:metadataReads.read,peers:runtime.profilePeers,offerPeers:runtime.profileOfferPeers,
    remember:async(peers,offers)=>{const ledger=localRootChat();await ledger.rememberPeerCapabilities({profileOfferPeers:offers,profilePeers:peers});},
    send:runtime.sendChatMessage,known:peer=>sharedAvatarHash(owner()!,peer),request:(peer,id,known)=>localRootChat().requestProfile(peer,id,known)});
  // State-only jobs no longer run on the transport clock. Events are coalesced,
  // and a failed operation keeps its own retry instead of waiting for polling.
  const capabilityWork=createEventDeadlineTask({now:Date.now,run:async()=>{
    if(owner())await capabilities.update(runtime.profilePeers(),runtime.timestampPeers(),runtime.groupCustodians());
  }});
  const groupWork=createEventDeadlineTask({now:Date.now,run:async()=>{await groupRecovery.tick();return groupRecovery.nextDeadline();}});
  const directoryWork=createEventDeadlineTask({now:Date.now,run:async()=>{await directory.tick();networkChanges.changed();return directory.nextDeadline();}});
  const stateWork=createEventDeadlineTask({now:Date.now,run:async()=>{
    service();callService();capabilityWork.changed();groupWork.changed();directoryWork.changed();await loadRemembered();wakeWorkers();
  }});
  const untopology=runtime.subscribeTopology(()=>{presence.topology();ownAttachments?.wake();networkChanges.changed();capabilityWork.changed();groupWork.changed();directoryWork.changed();push?.connected();delivery.topologyChanged();calls?.runtime.changed();wakeWorkers();});
  stateWork.changed();
  const unprofile=subscribeRootProfileChanges(()=>profileRecovery.changed()),unconnected=runtime.subscribeConnected(peer=>{profileRecovery.connected(peer);groupRecovery.connected(peer);groupWork.changed();courier.resume(peer);groupCourier.resume(peer);custody?.wake.connected(peer);custody?.groupWake.connected(peer);ownAttachments?.wake();wakeWorkers();});
  profileRecovery.changed();void migrateSharedProfileAvatar().catch(()=>{});
  const transportWork=createEventDeadlineTask({now:Date.now,run:async()=>{runtime.tick();networkChanges.changed();return owner()?runtime.nextDeadline():Infinity;}});
  const privateInboxWork=createEventDeadlineTask({now:Date.now,run:async()=>{const before=courier.diagnostics().startedPasses;const pass=courier.tick();if(courier.diagnostics().startedPasses!==before)void pass.finally(()=>privateInboxWork.changed()).catch(()=>{});return courier.nextDeadline();}});
  const groupInboxWork=createEventDeadlineTask({now:Date.now,run:async()=>{const before=groupCourier.diagnostics().startedPasses;const pass=groupCourier.tick();if(groupCourier.diagnostics().startedPasses!==before)void pass.finally(()=>groupInboxWork.changed()).catch(()=>{});return groupCourier.nextDeadline();}});
  const deliveryWork=createEventDeadlineTask({now:Date.now,run:async()=>{await delivery.dispatch();return delivery.nextDeadline();}});
  const noticeWork=createEventDeadlineTask({now:Date.now,run:async()=>{inboxEvents.tick();return inboxEvents.nextDeadline();}});
  const callNoticeWork=createEventDeadlineTask({now:Date.now,run:async()=>{callEvents.tick();return callEvents.nextDeadline();}});
  const privateWakeWork=createEventDeadlineTask({now:Date.now,run:async()=>{await custody?.wake.tick();relayChanges.changed();return custody?.wake.nextDeadline()??Infinity;}});
  const groupWakeWork=createEventDeadlineTask({now:Date.now,run:async()=>{await custody?.groupWake.tick();relayChanges.changed();return custody?.groupWake.nextDeadline()??Infinity;}});
  const callDeadline=Native?.axonCallWait?createNativeCallDeadline(ms=>Native!.axonCallWait!(ms)):{};
  const callClockWork=createEventDeadlineTask({...callDeadline,now:Date.now,run:async()=>{await calls?.runtime.clock();return calls?.runtime.nextClockDeadline()??Infinity;}});
  const callWork=createEventDeadlineTask({...callDeadline,now:Date.now,run:async()=>{await calls?.runtime.tick();return calls?.runtime.nextDeadline()??Infinity;}});
  let policyKey='';
  const policyWork=createEventDeadlineTask({now:Date.now,run:async()=>{if(!owner()){policyKey='';return;}const state=await metadataReads.read(),key=JSON.stringify([owner(),state.contacts.map(c=>[c.account,c.blocked,c.alias]),state.groups?.map(g=>[g.id,g.revision,g.accepted,g.blocked,g.recoveryPending,g.members])]);if(key===policyKey)return;policyKey=key;await presence.policyChanged();courier.resume();groupCourier.resume();privateInboxWork.changed();groupInboxWork.changed();callClockWork.changed();callWork.changed();}});
  const diagnosticWork=createEventDeadlineTask({now:Date.now,run:async()=>{if(!owner())return;const connections=runtime.snapshot().pool?.connections??[];diagnosticJournal.network(connections.filter(c=>c.state==='connected').length,connections.filter(c=>c.state==='authenticating').length);}});
  const workers=[stateWork,capabilityWork,groupWork,directoryWork,transportWork,privateInboxWork,groupInboxWork,deliveryWork,noticeWork,callNoticeWork,privateWakeWork,groupWakeWork,callClockWork,callWork,policyWork,diagnosticWork];
  inspectCoordinator=()=>Object.fromEntries(Object.entries({stateWork,capabilityWork,groupWork,directoryWork,transportWork,privateInboxWork,groupInboxWork,deliveryWork,noticeWork,callNoticeWork,privateWakeWork,groupWakeWork,callClockWork,callWork,policyWork,diagnosticWork}).map(([key,value])=>[key,value.diagnostics()]));
  function wakeWorkers(){for(const work of workers)if(work!==stateWork&&work!==capabilityWork&&work!==groupWork&&work!==directoryWork)work.changed();}
  const unchat=subscribeOwnChatWrites(account=>{if(owner()===account){deliveryWork.changed();policyWork.changed();}});
  const uncallwake=subscribeRootCallWakes(account=>{if(owner()===account){void calls?.runtime.recoverWakes().catch(()=>{});calls?.runtime.changed();callWork.changed();}});
  const unjournal=subscribeCallJournalWrites(account=>{if(owner()===account){calls?.runtime.changed();callClockWork.changed();callWork.changed();}});
  // Native background wake clocks may run overdue deadlines while JS timers slept.
  // They must not turn an idle worker back into a once-per-second scan.
  const pump=()=>{for(const work of workers)work.runDue();ownAttachments?.runDue();};
  const maintenance=createCustodyMaintenance({owner,now:Date.now,sweep:async()=>{const current=service();if(current)await Promise.all([current.sweep(),custody?.group.sweep(),attachmentService()?.sweep()]);},changed:relayChanges.changed});
  const offMaintenance=localAccount.subscribe(maintenance.changed);maintenance.changed();
  runtime.tick(); inspectDirectory = directory.snapshot; activeLookup = directory.lookup; activeSnapshot = runtime.snapshot;inspectContribution=()=>({privateRelay:custody?.owner===owner()?custody.service.contribution():null,groupRelay:custody?.owner===owner()?custody.group.contribution():null,mediaRelay:attachments?.owner===owner()?attachments.service.contribution():null});networkChanges.changed();
  inspectWake=()=>({private:custody?.wake.diagnostics()??null,group:custody?.groupWake.diagnostics()??null});
  const pollDiagnostics=()=>({events:inboxEvents.diagnostics(),private:courier.diagnostics(),group:groupCourier.diagnostics(),pendingDerivations:delivery.snapshot().pendingDerivations});
  inspectPolling=pollDiagnostics;
  activePeerResolver=peerResolver.resolve;
  const attachmentApi={sharedPeers:runtime.sharedAttachmentPeers,peers:runtime.attachmentPeers,request:runtime.attachmentRequest,blockStreamPeers:runtime.attachmentBlockStreamPeers,bulkPeers:runtime.attachmentBulkPeers,uploadBatchPeers:runtime.attachmentUploadBatchPeers,batchChunks:runtime.attachmentBatchChunks,batchWindow:runtime.attachmentBatchWindow,bulkRequest:runtime.attachmentBulkRequest};
  ownAttachments=startRootAttachmentRuntime({...attachmentApi,canStoreOutgoing:peer=>wakeCustodians([peer]).length>0,outgoingCustodian:async job=>{
    const {id,recipient}=job.descriptor.manifest;
    const binding=await ownCustody.get(job.owner,id);
    if(binding?.relay)return binding.relay;
    const state=await localRootChat().messageSnapshot(recipient,id,'outgoing');
    const message=state.messages.find(row=>row.id===id&&row.peer===recipient&&row.direction==='outgoing');
    return message?.messageStorageRelays?.[0]??(message?.descriptorDelivered?undefined:null);
   },wss:{binary:runtime.supportsWssBinary,sendBinary:runtime.sendWssBinary,peer:runtime.wssStreamPeer,send:runtime.sendWssStream,request:runtime.attachmentRequest},streams:runtime.attachmentStreams,lookup:peerResolver.resolve});
  const receiptConfirmation=createReceiptConfirmation({owner,now:Date.now,request:runtime.custodyRequest,accepted:receiptAccepted});
  return { snapshot: runtime.snapshot, recoveryStatus:delivery.snapshot,
    subscribeRecovery:(listener:(sender:string,id:string)=>void)=>{recoveryListeners.add(listener);return()=>{recoveryListeners.delete(listener);};},
    receiveWakeEnvelope:async(envelope:CustodyEnvelope,custodian?:string,payload?:GroupCustodyPayload)=>{
      const receipt=await localAccount.receiveCustody(envelope,operationalRecords,m=>receiveMessage(m,custodian??''),payload);
      // Hint is not authority: only send a verified recipient receipt, over an
      // already authenticated connection. Polling retries if this socket is absent.
      // Admission is already durable. Receipt acceptance wakes recovery separately;
      // a slow reverse request must not hold setup or delay connection resume.
      if(receipt&&custodian)void receiptConfirmation.confirm(receipt,custodian,payload?.id);
      return receipt;
    },
    waitForMessagePresentation:(account:string,sender:string,id:string)=>incomingPresentation.get(presentationKey(account,sender,id)),
    attachmentRecoveryState:(sender:string,id:string)=>ownAttachments?.recoveryState(sender,id)??Promise.resolve('complete' as const),
    hasRecoveredContent:async(sender:string,id:string)=>{
      const state=await localRootChat().messageSnapshot(sender,id,'incoming');
      return state.messages.some(message=>message.id===id&&message.peer===sender&&message.direction==='incoming'&&(message.deleted||!message.attachment||message.status==='delivered'));
    },
    recoveryComplete:(sender:string,id:string)=>{if(receiptConfirmation.complete(sender,id))return true;return courier.receiptAccepted(sender,id)||groupCourier.receiptAccepted(sender,id);},
    resumeRecovery(peer:string) {
      courier.resume(peer);groupCourier.resume(peer);
      privateInboxWork.changed();groupInboxWork.changed();
      ownAttachments?.wake();pump();
    },
    resume() {
      stateWork.changed();runtime.resume();transportWork.changed();
      courier.resume();groupCourier.resume();
      // Resetting the relay schedule alone leaves its coordinator asleep at
      // Infinity after an empty event-driven inbox. A verified FCM hint is an
      // inbox event too, even if the existing connection never reconnects.
      privateInboxWork.changed();groupInboxWork.changed();
      ownAttachments?.wake();pump();
    }, refreshRoutes:runtime.tick, tick:pump, stop() { receiptConfirmation.stop();recoveryListeners.clear();inspectCoordinator=null;unchat();unjournal();uncallwake();for(const work of workers)work.stop();stateWork.stop();capabilityWork.stop();groupWork.stop();directoryWork.stop();untopology();inboxEvents.stop();callEvents.stop();metadataReads.clear();deliveryReads.clear();outbox.clear();capabilities.clear();activity.clear();presence.clear();if(activeActivity===activity)activeActivity=null;if(activeGroupCallPresence===presence)activeGroupCallPresence=null;unqueue();unprofile();unconnected();profileRecovery.stop();delivery.stop();ownAttachments.stop();if(activePeerResolver===peerResolver.resolve)activePeerResolver=null;peerResolver.stop();stopCalls();courier.stop();groupCourier.stop();custody?.groupWake.stop();custody?.wake.stop();directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory ===directory.snapshot) inspectDirectory = null; if(inspectPolling===pollDiagnostics)inspectPolling=null; if (activeSnapshot === runtime.snapshot) {activeSnapshot = null;inspectContribution=null;inspectWake=null;networkChanges.changed();} stopped = true; custody = null; offMaintenance();maintenance.stop(); unsub(); unlimit(); runtime.stop(); } };
}

// Foreground UI and a headless wake share one transport; each releases only its own lease.
function recoveryRoutes(leases:Map<symbol,string|null|undefined>){
 const routes=[...leases.values()];
 return routes.includes(undefined)?undefined:new Set(routes.filter((value):value is string=>typeof value==='string'));
}
let sharedNetwork:{runtime:ReturnType<typeof createLocalAccountNetwork>;leases:Map<symbol,string|null|undefined>;scope:{peers:ReadonlySet<string>|undefined}}|null=null;
export function startLocalAccountNetwork(recovery?:{custodian?:string}){
 const lease=Symbol(),peer=recovery?configuredWakeCustodian(recovery.custodian)?.account??null:undefined;
 const existing=sharedNetwork,leases=existing?.leases??new Map<symbol,string|null|undefined>();
 leases.set(lease,peer);
 const scope=existing?.scope??{peers:undefined};
 scope.peers=recoveryRoutes(leases);
 const shared=sharedNetwork??={leases,scope,runtime:createLocalAccountNetwork(()=>scope.peers)};
 if(existing)shared.runtime.refreshRoutes();
 return {...shared.runtime,stop(){
  if(!leases.delete(lease))return;
  if(leases.size){scope.peers=recoveryRoutes(leases);shared.runtime.refreshRoutes();return;}
  if(sharedNetwork===shared)sharedNetwork=null;
  shared.runtime.stop();
 }};
}




