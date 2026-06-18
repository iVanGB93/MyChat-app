/**
 * deliveryReconciler.ts
 *
 * Reconciles delivery ticks for messages WE sent. When the sender is offline
 * (WS dropped) at the moment the recipient acknowledges a message, the
 * real-time `message_delivery_ack` event is missed. On reconnect / foreground
 * we ask the backend which of our locally-pending messages are now delivered
 * and update the local DB + any open chat room UI accordingly.
 */

import api from './api';
import { getPendingSentMessageIds, markDelivered } from './localMessageStore';
import { markIdsAsDeliveredInRoom } from './chatWsManager';

interface DeliveredEntry {
  message_id: string;
  recipient_id: number;
  delivered_at?: string | null;
}

let _inFlight = false;

/**
 * Query the backend for delivery status of our locally-pending sent messages
 * and apply any deliveries we missed. Safe to call frequently — it no-ops when
 * there is nothing pending and guards against overlapping runs.
 */
export async function reconcileSentDeliveryStatus(): Promise<void> {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const pending = await getPendingSentMessageIds();
    if (pending.length === 0) return;

    const idToRoom = new Map<string, string>();
    for (const p of pending) idToRoom.set(p.id, p.room_id);

    const response = await api.post('/api/chat/messages/delivery-status/', {
      message_ids: pending.map((p) => p.id),
    });

    const delivered: DeliveredEntry[] = response?.data?.delivered ?? [];
    if (!Array.isArray(delivered) || delivered.length === 0) return;

    // Group newly-delivered message ids by room so we can update open chat UIs.
    const idsByRoom = new Map<string, string[]>();
    for (const entry of delivered) {
      const messageId = String(entry.message_id);
      const recipientId = Number(entry.recipient_id);
      if (!messageId || !recipientId) continue;

      // Persist to local DB (per-recipient tracking + status flip).
      await markDelivered(messageId, recipientId).catch(() => {});

      const roomId = idToRoom.get(messageId);
      if (roomId) {
        const list = idsByRoom.get(roomId) ?? [];
        list.push(messageId);
        idsByRoom.set(roomId, list);
      }
    }

    // Update any currently-open room's delivery ticks.
    for (const [roomId, ids] of idsByRoom.entries()) {
      try {
        markIdsAsDeliveredInRoom(roomId, ids);
      } catch {
        /* room may not be open — DB update above is enough */
      }
    }

    if (delivered.length > 0) {
      console.log('[DeliveryReconciler] reconciled', delivered.length, 'delivered message(s)');
    }
  } catch (err: any) {
    // Network/auth errors are expected when offline — silently retry next trigger.
    const status = err?.response?.status;
    if (status && status !== 401 && status !== 403) {
      console.warn('[DeliveryReconciler] reconcile failed (status:', status, ')');
    }
  } finally {
    _inFlight = false;
  }
}
