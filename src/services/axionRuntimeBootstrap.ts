import { configureAxionRuntime } from './axionRuntimeBridge';
import { flushPendingCallEnds } from './call-end-queue';
import {
  applyMessageUpdateServerAck,
  confirmMailboxDelivery,
  connectRoom,
  markServerMessageAccepted,
  recoverPendingOutgoingMessages,
  recoverNearbyTextOutbox,
  flushStoredReceiptConfirmations,
  acceptStoredReceiptConfirmations,
} from './chatWsManager';
import { reconcileSentDeliveryStatus } from './deliveryReconciler';
import { routeInbound } from './ingressRouter';
import { emitRoomDigests, requestIncompleteMedia } from './outboundRouter';
import { checkPendingNotifications } from './backgroundNotificationService';
import { resetPresenceSessionSubscriptions } from './presenceService';
import { flushPendingMediaConfirmations } from './mediaConfirmationQueue';
import { flushPendingAcks } from './messageAckRetryQueue';
import { configureNearbyOutboxRecovery, resetP2pTextSessions, routeP2pTextSignal } from './p2pTextComposition';
import { initializeMailboxRecovery, routeMailboxSignal } from './mailboxComposition';
import { configureMailboxDelivered } from './transports/p2pTextBridge';

configureNearbyOutboxRecovery(recoverNearbyTextOutbox);
configureMailboxDelivered(confirmMailboxDelivery);
initializeMailboxRecovery();

/** Application composition root for Axion. Dependencies point toward the
 * transport; the transport calls these injected hooks without importing the
 * higher-level chat modules back. */
configureAxionRuntime({
  connectRoom,
  checkPendingNotifications: () => checkPendingNotifications(),
  routeInbound: async (payload) => {
    if (payload.event === 'p2p_text_signal') {
      await routeMailboxSignal(payload);
      await routeP2pTextSignal(payload);
      return {};
    }
    if (payload.event === 'room_update') resetP2pTextSessions();
    return routeInbound(payload, 'ws');
  },
  reconcileDelivery: () => reconcileSentDeliveryStatus(),
  markServerMessageAccepted,
  acceptStoredReceipts: (entries) => acceptStoredReceiptConfirmations(entries).catch(() => {}),
  applyMessageUpdateServerAck,
  onAuthenticated: () => {
    resetP2pTextSessions();
    void flushPendingCallEnds();
    // Presence subscriptions belong to one physical Axion session. Replay the
    // deduplicated desired set after authentication without coupling the
    // transport back to presenceService.
    resetPresenceSessionSubscriptions();
    void recoverPendingOutgoingMessages();
    void reconcileSentDeliveryStatus();
    void flushStoredReceiptConfirmations(true);
    void flushPendingAcks({ force: true });
    void flushPendingMediaConfirmations({ force: true });
    void emitRoomDigests();
    void requestIncompleteMedia();
    // Resume any local Gallery/Downloads copy interrupted by process death.
    // This is device-only work and does not add backend traffic.
    void import('./media-export-service')
      .then(({ retryPendingMediaExports }) => retryPendingMediaExports())
      .catch(() => {});
  },
});
