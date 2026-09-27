import type { TextTransport } from './textTransport';

interface AxionConnection {
  isReady(): boolean;
  sendFrame(frame: Record<string, unknown>): boolean;
}

/** Uses the existing authenticated socket; never creates a second connection. */
export function createLegacyAxionTextTransport(connection: AxionConnection): TextTransport {
  return {
    send(message, options) {
      if (!connection.isReady()) return false;
      return connection.sendFrame({
        type: 'send_message',
        room_id: message.roomId,
        id: message.id,
        message: message.content,
        message_type: 'text',
        created_at: message.createdAt,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.durationMs != null ? { duration_ms: message.durationMs } : {}),
        ...(options?.hydration ? { hydration: true } : {}),
        ...(options?.targetRecipientId ? { target_recipient_id: options.targetRecipientId } : {}),
        ...(options?.expectedRecipientIds ? { expected_recipient_ids: options.expectedRecipientIds } : {}),
      });
    },
  };
}
