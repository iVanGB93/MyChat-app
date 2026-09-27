import { useAppStore } from '../store/appStore';
import { getCachedRooms, getMessagesByIds } from './localMessageStore';
import { ingestMessage } from './ingressRouter';
import { isNotifWsReady, sendRawNotif, subscribeStatus } from './notificationWsManager';
import { debugLog } from './diagnostics';
import { configureP2pTextAttempt, P2P_TEXT_ENABLED } from './transports/p2pTextBridge';
import { createP2pTextRuntime, type P2pTextDependencies } from './transports/p2pTextRuntime';
import { createNativeTextPeer } from './transports/nativeTextPeer';

import NearbyNative from '../../modules/axonic-nearby';
import { createNearbyTextController } from './transports/nearbyTextController';
import { createNearbyRecovery } from './transports/nearbyRecovery';

function context(roomId?: string) {
  const state = useAppStore.getState();
  const room = roomId ?? state.activeRoomId;
  if (!P2P_TEXT_ENABLED || !state.user || state.appLifecycle !== 'active'
    || !room || state.activeCall) return null;
  return { userId: state.user.id, roomId: room };
}

// The current native LAN service advertises one room. Keep its scope when
// navigating elsewhere in the foreground; account changes must never inherit it.
let nearbyScope: { userId: number; roomId: string } | null = context();
function nearbyContext() {
  const state = useAppStore.getState();
  if (nearbyScope?.userId !== state.user?.id) nearbyScope = null;
  return nearbyScope ? context(nearbyScope.roomId) : null;
}

const dependencies: P2pTextDependencies = {
  context,
  signalingReady: isNotifWsReady,
  peer: async (roomId, ownerId) => {
    const room = (await getCachedRooms(ownerId)).find((entry) => entry.id === roomId);
    if (!room || room.room_type !== 'direct' || room.members.length !== 2 || !room.members.includes(ownerId)) return null;
    const peerId = room.members.find((id) => id !== ownerId);
    if (!peerId || useAppStore.getState().blockedIds[peerId]) return null;
    const detail = room.members_detail.find((entry) => entry.id === peerId);
    return detail ? { id: peerId, name: detail.username } : null;
  },
  sessionId: () => {
    try { return crypto.randomUUID(); }
    catch {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });
    }
  },
  preferHostCandidates: true,
  createConnection: (hostOnly) => createNativeTextPeer(hostOnly ? [] : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']),
  sendSignal: sendRawNotif,
  persist: async (roomId, peer, message) => {
    const ownerId = context(roomId)?.userId;
    if (!ownerId || useAppStore.getState().blockedIds[peer.id]) return false;
    const authorizedPeer = await dependencies.peer(roomId, ownerId);
    if (authorizedPeer?.id !== peer.id || context(roomId)?.userId !== ownerId) return false;
    const existing = (await getMessagesByIds([message.id]))[0];
    if (context(roomId)?.userId !== ownerId) return false;
    if (existing && (existing.room_id !== roomId || existing.sender_id !== peer.id || existing.is_mine)) return false;
    await ingestMessage({
      message_id: message.id, room_id: roomId, sender_id: peer.id, sender: peer.name,
      room_name: peer.name, content: message.content, created_at: message.createdAt, message_type: 'text',
    }, 'p2p');
    if (context(roomId)?.userId !== ownerId || useAppStore.getState().blockedIds[peer.id]) return false;
    const stored = (await getMessagesByIds([message.id]))[0];
    return context(roomId)?.userId === ownerId && stored?.room_id === roomId && stored.sender_id === peer.id
      && stored.type === 'text' && stored.content === message.content && !stored.is_mine;
  },
  log: (event, messageId) => debugLog('[P2P text]', event, messageId),
};
const runtime = createP2pTextRuntime(dependencies);
const nearbyController = createNearbyTextController({ ...dependencies,
  context: nearbyContext,
  preferHostCandidates: false,
  createConnection: () => createNativeTextPeer([]),
}, NearbyNative);
type NearbyRecoveryHandler = (roomId: string, ownerId: number, peerId: number, current: () => boolean) => Promise<void>;
let recoverNearbyOutbox: NearbyRecoveryHandler = async () => {};
export function configureNearbyOutboxRecovery(handler: NearbyRecoveryHandler) { recoverNearbyOutbox = handler; }
export const nearbyText = createNearbyRecovery(nearbyController, {
  context: nearbyContext,
  automatic: true,
  recover: async (scope, current) => {
    const peer = await dependencies.peer(scope.roomId, scope.userId);
    if (peer && current()) await recoverNearbyOutbox(scope.roomId, scope.userId, peer.id, current);
  },
});

if (P2P_TEXT_ENABLED) {
  configureP2pTextAttempt(async (message, options) => {
    const owner = context(message.roomId)?.userId;
    if (!owner) return null;
    const row = (await getMessagesByIds([message.id]))[0];
    if (context(message.roomId)?.userId !== owner || !row || !row.is_mine || row.sender_id !== owner
      || row.room_id !== message.roomId || row.content !== message.content) return null;
    const nearbyPeer = await nearbyText.trySend(message, options);
    if (context(message.roomId)?.userId !== owner) return null;
    return nearbyPeer ?? runtime.trySend(message, options);
  });
  useAppStore.subscribe((state, previous) => {
    // Foreground cache refreshes replace this object even when the block list is unchanged.
    const blocksChanged = state.blockedIds !== previous.blockedIds
      && [...new Set([...Object.keys(state.blockedIds), ...Object.keys(previous.blockedIds)])]
        .some(id => !!state.blockedIds[Number(id)] !== !!previous.blockedIds[Number(id)]);
    const accountChanged = state.user?.id !== previous.user?.id;
    const roomChanged = state.activeRoomId !== previous.activeRoomId;
    if (accountChanged) nearbyScope = null;
    if ((accountChanged || roomChanged) && state.user && state.activeRoomId) {
      nearbyScope = { userId: state.user.id, roomId: state.activeRoomId };
    }
    if (accountChanged || state.appLifecycle !== previous.appLifecycle || blocksChanged
      || state.activeCall !== previous.activeCall) {
      runtime.reset();
      nearbyText.refresh();
    } else if (roomChanged && state.activeRoomId) {
      nearbyText.refresh();
    }
  });
  subscribeStatus((status) => { if (status !== 'connected') runtime.signalingLost(); });
  nearbyText.refresh();
}

export function resetP2pTextSessions(): void { runtime.reset(); nearbyText.refresh(); }
export async function routeP2pTextSignal(payload: Record<string, any>): Promise<void> {
  if (P2P_TEXT_ENABLED) await runtime.handleSignal(payload);
}
