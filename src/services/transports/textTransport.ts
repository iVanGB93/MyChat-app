import type { OutgoingTextMessage, TextDeliveryOptions } from '../identity/normalChatContracts';
export type { OutgoingTextMessage, TextDeliveryOptions } from '../identity/normalChatContracts';

export interface TextTransport {
  /**
   * Synchronous handoff to an available transport. True means submitted only,
   * not accepted or delivered. Connection setup, receipts, persistence and
   * retries remain outside this interface. Exceptions propagate to the outbox.
   */
  send(message: OutgoingTextMessage, options?: TextDeliveryOptions): boolean;
}
