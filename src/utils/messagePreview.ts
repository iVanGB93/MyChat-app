export type MessageDeliveryStatus = 'pending' | 'delivered' | 'read';

export interface MessagePreview {
  id?: string;
  content: string;
  created_at: string;
  sender?: string;
  sender_id?: number;
  status?: MessageDeliveryStatus;
}

const STATUS_ORDER: Record<MessageDeliveryStatus, number> = {
  pending: 0,
  delivered: 1,
  read: 2,
};

export function newestDeliveryStatus(
  first?: MessageDeliveryStatus,
  second?: MessageDeliveryStatus,
): MessageDeliveryStatus | undefined {
  if (!first) return second;
  if (!second) return first;
  return STATUS_ORDER[second] > STATUS_ORDER[first] ? second : first;
}

/**
 * Merge two snapshots of a room's last message. Equal timestamps for the same
 * id are common because SQLite and Zustand describe the same row; in that case
 * keep the most advanced delivery state instead of whichever cache came first.
 */
export function mergeMessagePreview(
  previous: MessagePreview | null | undefined,
  incoming: MessagePreview,
): MessagePreview {
  if (!previous) return incoming;
  const previousTime = Date.parse(previous.created_at);
  const incomingTime = Date.parse(incoming.created_at);
  if (Number.isFinite(previousTime) && Number.isFinite(incomingTime)) {
    if (incomingTime < previousTime) return previous;
    if (incomingTime > previousTime) return incoming;
  }

  if (previous.id && incoming.id && previous.id === incoming.id) {
    return {
      ...previous,
      ...incoming,
      status: newestDeliveryStatus(previous.status, incoming.status),
    };
  }

  // Equal/invalid timestamps with different identities are ambiguous. Keep the
  // established preview until an unquestionably newer message arrives.
  return previous;
}

export function selectLatestMessagePreview(
  candidates: Array<MessagePreview | null | undefined>,
): MessagePreview | null {
  let latest: MessagePreview | null = null;
  for (const candidate of candidates) {
    if (candidate) latest = mergeMessagePreview(latest, candidate);
  }
  return latest;
}

