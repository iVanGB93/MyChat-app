import type { NotificationPayload } from './axionTypes';

export interface AxionInboundResult {
  ackUpdateIds?: string[];
  ackSenderId?: number;
}

export interface AxionRuntimeHooks {
  connectRoom: (roomId: string) => unknown;
  checkPendingNotifications: () => unknown;
  onAuthenticated: () => unknown;
  reconcileDelivery: () => unknown;
  routeInbound: (payload: NotificationPayload) => Promise<AxionInboundResult>;
  markServerMessageAccepted: (roomId: string, messageId: string, recipientIds?: number[]) => unknown;
  acceptStoredReceipts: (entries: Array<{ message_id: string; recipient_ids: number[] }>) => unknown;
  applyMessageUpdateServerAck: (
    roomId: string,
    updates: Array<{ id?: string; expected_peer_ids?: number[] }>,
  ) => unknown;
}

let runtimeHooks: AxionRuntimeHooks | null = null;

/** Configure the application layer that sits above the Axion transport.
 * The transport never imports chat or ingress modules back again. */
export function configureAxionRuntime(hooks: AxionRuntimeHooks): void {
  runtimeHooks = hooks;
}

export function connectAxionRoom(roomId: string): void {
  if (!roomId) return;
  try { runtimeHooks?.connectRoom(roomId); } catch {}
}

export function notifyAxionAuthenticated(): void {
  try { runtimeHooks?.onAuthenticated(); } catch {}
}

export function checkAxionPendingNotifications(): void {
  try { runtimeHooks?.checkPendingNotifications(); } catch {}
}

export function reconcileAxionDelivery(): void {
  try { runtimeHooks?.reconcileDelivery(); } catch {}
}

export async function routeAxionInbound(
  payload: NotificationPayload,
): Promise<AxionInboundResult> {
  if (!runtimeHooks) return {};
  return runtimeHooks.routeInbound(payload);
}

export function acceptAxionServerMessage(roomId: string, messageId: string, recipientIds?: number[]): void {
  try { runtimeHooks?.markServerMessageAccepted(roomId, messageId, recipientIds); } catch {}
}

export function acceptAxionStoredReceipts(entries: Array<{ message_id: string; recipient_ids: number[] }>): void {
  try { runtimeHooks?.acceptStoredReceipts(entries); } catch {}
}

export function acceptAxionMessageUpdates(
  roomId: string,
  updates: Array<{ id?: string; expected_peer_ids?: number[] }>,
): void {
  try { runtimeHooks?.applyMessageUpdateServerAck(roomId, updates); } catch {}
}
