import { configureAxionRuntime } from './axionRuntimeBridge';
import {
  applyMessageUpdateServerAck,
  connectRoom,
  markServerMessageAccepted,
  recoverPendingOutgoingMessages,
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

/** Application composition root for Axion. Dependencies point toward the
 * transport; the transport calls these injected hooks without importing the
 * higher-level chat modules back. */
configureAxionRuntime({
  connectRoom,
  checkPendingNotifications: () => checkPendingNotifications(),
  routeInbound: (payload) => routeInbound(payload, 'ws'),
  reconcileDelivery: () => reconcileSentDeliveryStatus(),
  markServerMessageAccepted,
  acceptStoredReceipts: (entries) => acceptStoredReceiptConfirmations(entries).catch(() => {}),
  applyMessageUpdateServerAck,
  onAuthenticated: () => {
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
