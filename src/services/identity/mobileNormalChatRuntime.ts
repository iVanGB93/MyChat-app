import { neuronCallsEnabled } from './neuronCallFeature';
import { accountIdentityMayRun } from './accountIdentityActivity';
import { neuronStunConfig, parseNeuronIceConfig } from './neuronIceConfig';
import { createCallMediaRelay } from './callMediaRelay';
import { registerCallWakeOwner, pendingCallWakes, finishCallWake } from './mobileCallWake';
import { createDurableRecipientCallControl } from './durableCallControl';
import { verifyCallControl } from './callControlProtocol';
import { createCallControlRelay, createCallRelayEndpoint } from './callControlRelay';
import { createCallRelayPump } from './callRelayPump';
import { startMobilePushRegistration, rejectPushRegistration } from './mobilePushRegistration';
import { createMobileCallControlRuntime } from './mobileCallControlRuntime';
import { listMobileCallJournals, createMobileCallJournalStore } from './mobileCallJournalStore';
import { createNeuronCallCoordinator } from './neuronCallCoordinator';
import { registerNeuronCalls, notifyNeuronCall } from './mobileNeuronCalls';
import { hexToBytes } from '@noble/hashes/utils.js';
import { createCallRetryScheduler } from './callRetryScheduler';
import type { CallControl } from './callControlProtocol';
import { unavailableDirectoryLookup, type DirectoryLookupResult } from './identityDirectoryLookup';
import { createMobileDirectory } from './mobileDirectory';
import { NativeModules, Platform } from 'react-native';
import { RTCPeerConnection } from 'react-native-webrtc';
import Native from '../../../modules/axonic-nearby';
import { useAppStore } from '../../store/appStore';
import { allowedAxons, loadAllowedAxons, subscribeAllowedAxons } from '../allowedAxons';
import { getCachedRooms, getMessagesByIds, getPendingOutbox, type LocalMessage } from '../localMessageStore';
import { ingestVerifiedNeuronText } from '../ingressRouter';
import { acceptMailboxDelivered } from '../transports/p2pTextBridge';
import { registerNeuronTextAttempt } from '../transports/neuronTextBridge';
import type { OutgoingTextMessage } from '../transports/textTransport';
import { createChatIdentityPinStore } from './chatIdentityPinStore';
import { createMobileIdentityRecordStore } from './identityRecordStore';
import { createOwnCustodyStore } from './ownCustodyStore';
import { createNormalChatOutboxStore } from './normalChatOutboxStore';
import { createMobileCustodyStore } from './mobileCustodyStore';
import { createNormalChatRuntime } from './normalChatRuntime';
import { createLanIdentityRuntime, type NativeAxonLan } from './lanIdentityRuntime';
import { createInternetAxonConnector, FIRST_NEURON } from './internetAxonTransport';
import { mobileAxonTransportSupported } from './mobileAxonTransport';
import type { AxonPeerConnection } from './rtcAxonTransport';
import type { createLocalIdentityController } from './localIdentityController';
import type { NormalChatBinding } from './normalChatBoundary';

export const accountNeuronEnabled = () => process.env.EXPO_PUBLIC_AXONIC_CHAT_IDENTITY === '1';

let inspectNetwork: (() => ReturnType<ReturnType<typeof createLanIdentityRuntime>['snapshot']> | null) | null = null;
let activeLookup: ((account: string) => Promise<DirectoryLookupResult>) | null = null;
export const mobileNormalChatLookupIdentity = (account: string) => activeLookup?.(account) ?? Promise.resolve(unavailableDirectoryLookup());
let inspectDirectory: (() => ReturnType<ReturnType<typeof createMobileDirectory>['snapshot']>) | null = null;
export const mobileNormalChatDirectorySnapshot = () => inspectDirectory?.() ?? null;
/** Read-only view of the signed-in account's runtime, never the experimental identity. */
export const mobileNormalChatNetworkSnapshot = () => inspectNetwork?.() ?? null;
type DevCallInput=Omit<CallControl,'version'|'record'|'device'|'signature'>;
let developmentCalls: { account:string;device:string;submit(input:DevCallInput):Promise<boolean>;journals:()=>Promise<CallControl[]>;diagnostics:()=>{peers:unknown[];retryError:string|null;sent:number;received:number;acknowledged:number;retryFailures:number} } | null=null;
/** Diagnostic entry point only; production call buttons continue using their current route. */
export const mobileDevelopmentCallControl = () => __DEV__ ? developmentCalls : null;

/** Explicitly enabled account composition. The app root reserves native discovery for this runtime. */
export function startMobileNormalChatRuntime(owner: number, identity: ReturnType<typeof createLocalIdentityController>, lease: () => boolean) {
  if (!accountNeuronEnabled() || !mobileAxonTransportSupported() || !Native?.axonLanStart
    || !Native.axonLanStop || !Native.axonLanSnapshot || !Native.axonAccept || !Native.axonClaim) return () => {};
  const account = identity.status().account;
  if (!account || identity.status().state !== 'unlocked') return () => {};
  let stopped = false, roomCursor = 0;
  const messageCursors = new Map<string, number>();
  const current = () => !stopped && lease() && useAppStore.getState().user?.id === owner
    && accountIdentityMayRun(useAppStore.getState());
  const pins = createChatIdentityPinStore(owner), peers = new Map<string, NormalChatBinding>();
  const peerNames=new Map<number,string>();
  const blockedAccounts=new Set<string>();
  let refreshing: Promise<void> | null = null;
  const authorized = (room: string, peer: NormalChatBinding) => current()
    && peers.get(room)?.user === peer.user && peers.get(room)?.account === peer.account
    && !useAppStore.getState().blockedIds[peer.user];
  const refresh = () => refreshing ??= (async () => {
    const rooms = await getCachedRooms(owner), next = new Map<string, NormalChatBinding>(), nextBlocked = new Set<string>();
    for (const room of rooms) {
      if (!current()) return;
      if (room.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(owner)) continue;
      const user = room.members.find(id => id !== owner);
      if (!user) continue;
      if (useAppStore.getState().blockedIds[user]) { const blockedAccount=await pins.read(user);if(blockedAccount)nextBlocked.add(blockedAccount);continue; }
      const member=room.members_detail?.find(member=>member.id===user);
      if(member)peerNames.set(user,member.display_name||member.username);
      const peerAccount = await pins.read(user);
      if (peerAccount) next.set(room.id, { user, account: peerAccount });
    }
    if (current()) { blockedAccounts.clear();for(const id of nextBlocked)blockedAccounts.add(id);peers.clear(); for (const [room, peer] of next) peers.set(room, peer); }
  })().finally(() => { refreshing = null; });
  const outgoing = (row: LocalMessage | undefined): OutgoingTextMessage | null => {
    if (!current() || !row || !row.is_mine || row.sender_id !== owner || row.is_deleted || row.type !== 'text'
      || row.reply_to || row.duration_ms != null || row.file_uri || row.media_ptr || (row.revision ?? 0) > 0) return null;
    return { id: row.id, roomId: row.room_id, content: row.content, createdAt: row.created_at };
  };
  const read = async (id: string) => outgoing((await getMessagesByIds([id]))[0]);
  const records = createMobileIdentityRecordStore(Date.now);
  let network: ReturnType<typeof createLanIdentityRuntime> | undefined;
  const callDevice=identity.callDevice();
  let sentCalls=0,receivedCalls=0,acknowledgedCalls=0,callRetryFailures=0;
  const calls=neuronCallsEnabled() && callDevice
    ? createMobileCallControlRuntime({account,device:callDevice,current,now:Date.now,
      records:{read:async id=>id===account?identity.publicRecord():records.read(id)},
      // Initial development rollout is limited to verified existing chat bindings.
      blocked:id=>![...peers].some(([room,peer])=>peer.account===id&&authorized(room,peer)),
      courierBlocked:id=>blockedAccounts.has(id),
      signReceipt:async event=>identity.signCallReceipt(event),
      send:async(peer,device,raw)=>{sentCalls++;const receipt=await network?.callControlRequest(peer,device,raw)??null;if(receipt)acknowledgedCalls++;return receipt;}}) : null;
  const callRetries=calls?createCallRetryScheduler({account,current,now:Date.now,
    list:()=>listMobileCallJournals(account,Date.now()),peers:()=>network?.callPeers()??[],drain:calls.drain}):null;
  let callRetryError:string|null=null;
  const callAccess=calls&&callDevice?{account,device:callDevice,
    submit:async(input:DevCallInput)=>{
      if(!current())return false;
      await refresh();
      return current()?calls.submit(identity.signCall(input)):false;
    },journals:()=>current()?listMobileCallJournals(account):Promise.resolve([]),
    diagnostics:()=>({peers:network?.callPeers()??[],relayPeers:network?.relayPeers()??[],relay:callRelayPump?.diagnostics(),retryError:callRetryError,sent:sentCalls,received:receivedCalls,acknowledged:acknowledgedCalls,retryFailures:callRetryFailures})}:null;
  if(callAccess)developmentCalls=callAccess;
  const callCoordinator=calls&&callDevice?createNeuronCallCoordinator({account,device:callDevice,
    store:createMobileCallJournalStore(),now:Date.now,current,
    busy:()=>!!useAppStore.getState().activeCall||!!useAppStore.getState().incomingCall,
    blocked:id=>![...peers].some(([room,peer])=>peer.account===id&&authorized(room,peer)),
    lookup:id=>{const peer=[...peers.values()].find(p=>p.account===id);return peer?{user:peer.user,name:peerNames.get(peer.user)??`User ${peer.user}`}:null;},
    resolve:async user=>{await refresh();const peer=[...peers.values()].find(p=>p.user===user);return peer?{account:peer.account,name:peerNames.get(user)??`User ${user}`}:null;},
    readRecord:async id=>id===account?identity.publicRecord():records.read(id),
    list:()=>listMobileCallJournals(account),random:async()=>hexToBytes(await Native!.identityRandomBytes!(32)),
    sign:input=>identity.signCall(input),submit:async raw=>{
      const saved=await calls.submit(raw);
      if(saved){const event=JSON.parse(raw) as CallControl;
        for(const peer of network?.callPeers()??[])if(peer.account===(event.caller===account?event.callee:event.caller))
          void calls.drain(event,peer).catch(()=>{});}
      return saved;
    },signMedia:input=>identity.signCallMedia(input),
    contexts:()=>network?.mediaContexts()??[],sendMedia:(peer,device,raw)=>network?.callMediaRequest(peer,device,raw)??Promise.resolve(false),
    loadIceConfig:async()=>{
      const provider=network?.relayPeers().find(p=>p.account===FIRST_NEURON.account);
      if(!provider)return neuronStunConfig();
      const raw=await network!.callRelayRequest(provider,JSON.stringify({version:1,operation:'ice'}));
      return raw&&parseNeuronIceConfig(raw,Date.now())||neuronStunConfig();
    },
    callRoute:(target,device)=>{
      const routes=[...(network?.callPeers().filter(p=>p.account===target&&(!device||p.device===device))??[]),...(network?.mediaRelayPeers()??[])];
      const expiresAt=Math.max(0,...routes.filter(p=>!blockedAccounts.has(p.account)).map(p=>p.expiresAt));return expiresAt>Date.now()?{expiresAt}:null;
    },sendRoutedMedia:async raw=>{
      const event=JSON.parse(raw);if(await network?.forwardMedia(event.target,event.targetDevice,raw))return true;
      return network?.sendRelayedMedia(raw)??false;
    },
    changed:notifyNeuronCall}):null;
  const mediaRelay=calls?createCallMediaRelay({records,now:Date.now,current,blocked:id=>blockedAccounts.has(id),
    forward:(target,device,raw)=>network?.forwardMedia(target,device,raw)??Promise.resolve(false)}):undefined;
  const callRelay=calls?createCallControlRelay({records,now:Date.now,current,blocked:id=>blockedAccounts.has(id)}):null;
  const relayEndpoint=callRelay?createCallRelayEndpoint(callRelay):undefined;
  const callRelayPump=calls&&callDevice?createCallRelayPump({account,device:callDevice,store:createMobileCallJournalStore(),
    records:{read:async id=>id===account?identity.publicRecord():records.read(id)},now:Date.now,current,
    blocked:id=>![...peers].some(([room,peer])=>peer.account===id&&authorized(room,peer)),
    list:()=>listMobileCallJournals(account,Date.now()),peers:()=>network?.relayPeers().filter(p=>!blockedAccounts.has(p.account))??[],
    direct:()=>network?.callPeers()??[],request:(peer,raw)=>network?.callRelayRequest(peer,raw)??Promise.resolve(null),
    receive:async(raw,peer)=>{await refresh();await callCoordinator?.ready();const receipt=await calls.receiveRelayed(raw,peer);
      if(receipt)void callCoordinator?.observe(JSON.parse(raw)).catch(()=>{callRetryError='Relayed call UI update failed';});return receipt;},
  }):null;
  if(calls&&callDevice)void registerCallWakeOwner(owner,account,callDevice).catch(()=>{});
  let waking=false;
  const drainWakes=async()=>{
    if(waking||!calls||!callCoordinator||!callDevice||!current())return;
    waking=true;
    try {
      await refresh();await callCoordinator.ready();
      for(const row of await pendingCallWakes(owner)) {
        if(!current())return;
        const hint=JSON.parse(row.raw) as CallControl;
        if(![...peers].some(([room,peer])=>peer.account===hint.caller&&authorized(room,peer)))continue;
        const record=await records.read(hint.caller),event=record&&verifyCallControl(row.raw,record,Date.now());
        if(!event||event.callee!==account||!current())continue;
        const call=createDurableRecipientCallControl(createMobileCallJournalStore(),account,event.callId,callDevice,Date.now);
        const saved=event.kind==='invite'?await call.begin(row.raw,record!,Date.now()):await call.receive(row.raw,record!,Date.now())||event.kind==='cancel'&&await call.cancelUnknown(row.raw,record!,Date.now());
        if(!saved&&!await call.hasStoredEvent(row.raw,record!,Date.now()))continue;
        if(!current())return;
        await callCoordinator.observe(event);
        if(row.dismissed===1)await callCoordinator.end(event.callId);
        await finishCallWake(owner,event.callId);
      }
    } finally {waking=false;}
  };
  const unregisterCalls=callCoordinator?registerNeuronCalls(callCoordinator):()=>{};
  const push = startMobilePushRegistration(current, (peer, raw) => network?.pushRequest(peer, raw) ?? Promise.resolve(null), account);
  const directory = createMobileDirectory(identity, records, current, () => network);
  inspectDirectory = directory.snapshot; activeLookup = directory.lookup;
  const runtime = createNormalChatRuntime({ identity, records, own: createOwnCustodyStore(), bindings: createNormalChatOutboxStore(),
    custodyStore: createMobileCustodyStore(account),
    allowed: id => [...peers].some(([room, peer]) => peer.account === id && authorized(room, peer)),
    boundary: { owner: { user: owner, account }, current, now: Date.now, authorized,
      peer: async room => { await refresh(); return peers.get(room) ?? null; }, readOutgoing: read,
      persist: (message, guard) => ingestVerifiedNeuronText(message, owner, peers.get(message.roomId)?.account ?? '', guard),
      delivered: (message, peer, guard) => acceptMailboxDelivered(owner, message, peer, guard) },
    pending: async () => {
      await refresh(); if (!current()) return [];
      // Rotate rooms so an unavailable contact cannot starve another conversation.
      const rooms = [...peers]; if (!rooms.length) return [];
      const [room, peer] = rooms[roomCursor++ % rooms.length];
      const rows = await getPendingOutbox(room, owner, peer.user);
      if (!authorized(room, peer)) return [];
      const messages = rows.filter(row => row.status !== 'delivered' && row.status !== 'read' && !row.auto_retry_blocked)
        .map(outgoing).filter((message): message is OutgoingTextMessage => message !== null);
      for (const id of messageCursors.keys()) if (!peers.has(id)) messageCursors.delete(id);
      const offset = messages.length ? (messageCursors.get(room) ?? 0) % messages.length : 0;
      messageCursors.set(room, offset + 20);
      return [...messages.slice(offset), ...messages.slice(0, offset)].slice(0, 20);
    },
    network: hooks => network = createLanIdentityRuntime({ identity, native: Native as NativeAxonLan,
      store: records, now: Date.now, limit: allowedAxons(), ...hooks, onPush: rejectPushRegistration,
      onCallMediaRelay:mediaRelay,
      onRelayedCallMedia:callCoordinator?async(raw,peer)=>!blockedAccounts.has(peer.account)&&callCoordinator.receiveRoutedMedia(raw):undefined,
      onCallRelay:relayEndpoint?async(raw,peer)=>{await refresh();return relayEndpoint(raw,peer);}:undefined,
      onCallControl:calls?async(raw,peer)=>{receivedCalls++;await refresh();await callCoordinator?.ready();const receipt=await calls.receive(raw,peer);
        if(receipt)void callCoordinator?.observe(JSON.parse(raw)).catch(()=>{callRetryError='Call UI update failed';});return receipt;}:undefined,
      onCallMedia:callCoordinator?(raw,peer,instance)=>callCoordinator.receiveMedia(raw,peer,instance):undefined,
      onDirectory: (raw, peer) => directory.receive(peer.account, raw),
      rtc: Platform.OS === 'android' && NativeModules.WebRTCModule?.axonicIdentityGuardVersion?.() === 1 ? {
        random: () => Native!.identityRandomBytes!(32), sign: (...args) => identity.signSignal(...args),
        createConnection: () => {
          const configuration = { axonicIdentityGuard: true,
            iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
          return new RTCPeerConnection(configuration) as unknown as AxonPeerConnection;
        },
      } : undefined,
      internet: Native?.axonWssConnect ? { peers: [FIRST_NEURON], connect: createInternetAxonConnector(
        Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> }, () => current() ? account : null) } : undefined }),
  });
  const inspect = () => current() ? network?.snapshot() ?? null : null;
  inspectNetwork = inspect;
  const unregister = registerNeuronTextAttempt(runtime.attempt);
  const stopLimit = subscribeAllowedAxons(() => network?.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  runtime.tick();
  const timer = setInterval(() => { runtime.tick(); void push.tick(); void directory.tick().catch(() => {});
    void drainWakes().catch(()=>{callRetryError='Call wake recovery failed';});
    callRelay?.sweep();void callRelayPump?.tick().catch(()=>{callRetryError='Call relay retry failed';callRetryFailures++;});
    void callRetries?.tick().then(()=>callCoordinator?.tick()).catch(() => {callRetryError='Call retry failed';callRetryFailures++;}); }, 1000);
  return () => {
    if (stopped) return;
    if(developmentCalls===callAccess)developmentCalls=null;
    stopped = true; callRelayPump?.stop();callRelay?.stop();callCoordinator?.stop();unregisterCalls();callRetries?.stop(); calls?.stop(); push.stop(); directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory === directory.snapshot) inspectDirectory = null; unregister(); clearInterval(timer); stopLimit(); runtime.stop(); peers.clear(); messageCursors.clear();
    if (inspectNetwork === inspect) inspectNetwork = null;
  };
}
