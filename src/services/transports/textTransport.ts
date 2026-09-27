import type { ReplyRef } from '../localMessageStore';

/** Message identity is assigned by the outbox, never by a transport. */
export interface OutgoingTextMessage {
  readonly id: string;
  readonly roomId: string;
  readonly content: string | null;
  readonly createdAt: string;
  readonly replyTo?: ReplyRef | null;
  readonly durationMs?: number | null;
}

/** Recovery routing is separate from the message itself. */
export interface TextDeliveryOptions {
  readonly hydration?: boolean;
  readonly targetRecipientId?: number;
  readonly expectedRecipientIds?: readonly number[] | null;
}

export interface TextTransport {
  /**
   * Synchronous handoff to an available transport. True means submitted only,
   * not accepted or delivered. Connection setup, receipts, persistence and
   * retries remain outside this interface. Exceptions propagate to the outbox.
   */
  send(message: OutgoingTextMessage, options?: TextDeliveryOptions): boolean;
}
