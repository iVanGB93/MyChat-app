import { startMobilePushRegistration, rejectPushRegistration } from './mobilePushRegistration';
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

/** Explicitly enabled account composition. The app root reserves native discovery for this runtime. */
export function startMobileNormalChatRuntime(owner: number, identity: ReturnType<typeof createLocalIdentityController>, lease: () => boolean) {
  if (!accountNeuronEnabled() || !mobileAxonTransportSupported() || !Native?.axonLanStart
    || !Native.axonLanStop || !Native.axonLanSnapshot || !Native.axonAccept || !Native.axonClaim) return () => {};
  const account = identity.status().account;
  if (!account || identity.status().state !== 'unlocked') return () => {};
  let stopped = false, roomCursor = 0;
  const messageCursors = new Map<string, number>();
  const current = () => !stopped && lease() && useAppStore.getState().user?.id === owner
    && useAppStore.getState().appLifecycle === 'active';
  const pins = createChatIdentityPinStore(owner), peers = new Map<string, NormalChatBinding>();
  let refreshing: Promise<void> | null = null;
  const authorized = (room: string, peer: NormalChatBinding) => current()
    && peers.get(room)?.user === peer.user && peers.get(room)?.account === peer.account
    && !useAppStore.getState().blockedIds[peer.user];
  const refresh = () => refreshing ??= (async () => {
    const rooms = await getCachedRooms(owner), next = new Map<string, NormalChatBinding>();
    for (const room of rooms) {
      if (!current()) return;
      if (room.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(owner)) continue;
      const user = room.members.find(id => id !== owner);
      if (!user || useAppStore.getState().blockedIds[user]) continue;
      const peerAccount = await pins.read(user);
      if (peerAccount) next.set(room.id, { user, account: peerAccount });
    }
    if (current()) { peers.clear(); for (const [room, peer] of next) peers.set(room, peer); }
  })().finally(() => { refreshing = null; });
  const outgoing = (row: LocalMessage | undefined): OutgoingTextMessage | null => {
    if (!current() || !row || !row.is_mine || row.sender_id !== owner || row.is_deleted || row.type !== 'text'
      || row.reply_to || row.duration_ms != null || row.file_uri || row.media_ptr || (row.revision ?? 0) > 0) return null;
    return { id: row.id, roomId: row.room_id, content: row.content, createdAt: row.created_at };
  };
  const read = async (id: string) => outgoing((await getMessagesByIds([id]))[0]);
  const records = createMobileIdentityRecordStore(Date.now);
  let network: ReturnType<typeof createLanIdentityRuntime> | undefined;
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
      store: records, now: Date.now, limit: allowedAxons(), ...hooks, onPush: rejectPushRegistration, onDirectory: (raw, peer) => directory.receive(peer.account, raw),
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
  const timer = setInterval(() => { runtime.tick(); void push.tick(); void directory.tick().catch(() => {}); }, 1000);
  return () => {
    if (stopped) return;
    stopped = true; push.stop(); directory.stop(); if (activeLookup === directory.lookup) activeLookup = null; if (inspectDirectory === directory.snapshot) inspectDirectory = null; unregister(); clearInterval(timer); stopLimit(); runtime.stop(); peers.clear(); messageCursors.clear();
    if (inspectNetwork === inspect) inspectNetwork = null;
  };
}
