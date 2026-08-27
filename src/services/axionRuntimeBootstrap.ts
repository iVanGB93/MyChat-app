import { configureAxionRuntime } from './axionRuntimeBridge';
import {
  applyMessageUpdateServerAck,
  connectRoom,
  markServerMessageAccepted,
  recoverPendingOutgoingMessages,
} from './chatWsManager';
import { reconcileSentDeliveryStatus } from './deliveryReconciler';
import { routeInbound } from './ingressRouter';
import { emitRoomDigests, requestIncompleteMedia } from './outboundRouter';
import { checkPendingNotifications } from './backgroundNotificationService';
import { resetPresenceSessionSubscriptions } from './presenceService';

/** Application composition root for Axion. Dependencies point toward the
 * transport; the transport calls these injected hooks without importing the
 * higher-level chat modules back. */
configureAxionRuntime({
  connectRoom,
  checkPendingNotifications: () => checkPendingNotifications(),
  routeInbound: (payload) => routeInbound(payload, 'ws'),
  reconcileDelivery: () => reconcileSentDeliveryStatus(),
  markServerMessageAccepted,
  applyMessageUpdateServerAck,
  onAuthenticated: () => {
    // Presence subscriptions belong to one physical Axion session. Replay the
    // deduplicated desired set after authentication without coupling the
    // transport back to presenceService.
    resetPresenceSessionSubscriptions();
    void recoverPendingOutgoingMessages();
    void reconcileSentDeliveryStatus();
    void emitRoomDigests();
    void requestIncompleteMedia();
  },
});
