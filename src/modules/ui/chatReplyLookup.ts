import type {RootChatMessage,RootChatReply} from '../messaging';

export function createChatReplyLookup(
  messages: readonly RootChatMessage[],
  references: readonly RootChatMessage[],
  owner: string | null,
  peer?: string,
) {
  const byTarget = new Map<string,RootChatMessage>();
  for (const rows of [messages,references]) {
    for (const message of rows) {
      if (peer && message.peer !== peer) continue;
      const id = peer ? message.id : message.group?.messageId;
      const author = message.direction === 'outgoing' ? owner : message.peer;
      if (!id || !author) continue;
      const key = id+':'+author;
      if (!byTarget.has(key)) byTarget.set(key,message);
    }
  }
  return (reply:RootChatReply) => byTarget.get(reply.id+':'+reply.author);
}
