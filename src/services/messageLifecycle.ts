export interface MessageLifecycleState {
  pendingIds: Set<string>;
  deliveredIds: Set<string>;
  readIds: Set<string>;
}

export type MessageLifecycleEvent =
  | { type: 'server_accepted'; ids: string[] }
  | { type: 'delivered'; ids: string[] }
  | { type: 'read'; ids: string[] };

/** Pure status transition used by the room coordinator and unit tests.
 * Server acceptance deliberately keeps the pending clock: only a recipient's
 * delivery/read acknowledgement can promote the user-visible status. */
export function applyMessageLifecycleEvent(
  state: MessageLifecycleState,
  event: MessageLifecycleEvent,
): MessageLifecycleState {
  const ids = new Set(event.ids.filter(Boolean));
  if (ids.size === 0 || event.type === 'server_accepted') return state;

  const pendingIds = new Set(state.pendingIds);
  const deliveredIds = new Set(state.deliveredIds);
  const readIds = new Set(state.readIds);

  for (const id of ids) {
    pendingIds.delete(id);
    deliveredIds.add(id);
    if (event.type === 'read') readIds.add(id);
  }

  return { pendingIds, deliveredIds, readIds };
}

export interface IdentifiedMessage {
  id: string;
  file_uri?: string | null;
}

export interface MessageMergeResult<T> {
  messages: T[];
  changed: boolean;
  inserted: boolean;
}

/** Append a new message exactly once, or merge a hydration/update into the
 * existing row while preserving a previously downloaded local file URI. */
export function mergeMessageById<T extends IdentifiedMessage>(
  messages: T[],
  incoming: T,
  updateExisting = false,
): MessageMergeResult<T> {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index === -1) {
    return { messages: [...messages, incoming], changed: true, inserted: true };
  }
  if (!updateExisting) {
    return { messages, changed: false, inserted: false };
  }

  const previous = messages[index];
  const merged = {
    ...previous,
    ...incoming,
    file_uri: incoming.file_uri ?? previous.file_uri,
  } as T;
  return {
    messages: [...messages.slice(0, index), merged, ...messages.slice(index + 1)],
    changed: true,
    inserted: false,
  };
}
