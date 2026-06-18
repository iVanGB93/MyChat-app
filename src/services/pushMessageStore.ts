/**
 * pushMessageStore.ts
 *
 * Thin wrapper that funnels push-delivered messages into the central ingress
 * router (ingressRouter.ts), so push / push-tap / background-receive share the
 * EXACT same dedupe → persist → ack → store-update pipeline as the notification
 * WebSocket. Kept as a named export because App.tsx and the background receive
 * task import `savePushMessage` directly.
 *
 * Called from:
 *   - App.tsx notification tap (response listener)
 *   - App.tsx notification received while backgrounded (received listener)
 *   - backgroundNotificationService PUSH_RECEIVE_TASK (killed app)
 */

import { ingestMessage } from './ingressRouter';

/**
 * Persist + ack a message that arrived via Expo push.
 * Safe to call with incomplete data — the router skips gracefully (still acking
 * when possible) and the WS sync hydrates the full message later.
 */
export async function savePushMessage(
  data: Record<string, string | undefined> | null | undefined,
): Promise<boolean> {
  if (!data) return false;
  await ingestMessage(data, 'push_receive');
  return true;
}

