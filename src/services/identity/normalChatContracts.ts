import type { CustodyEnvelope } from './custodyProtocol.ts';
export interface ReplyRef {
  id: string;
  sender_name: string;
  /** Short preview of the original content (truncated client-side before sending). */
  content: string;
  /** Type of the original message ('text', 'image', etc.) — used to render an icon
   *  hint for non-text replies. */
  type?: string;
}

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

export interface OwnCustodyRow { owner: string; id: string; envelope: CustodyEnvelope; relay: string | null }
export interface OwnCustodyStore {
  get(owner: string, id: string): Promise<OwnCustodyRow | null>;
  save(owner: string, envelope: CustodyEnvelope, current: () => boolean): Promise<OwnCustodyRow | null>;
  held(owner: string, id: string, relay: string, current: () => boolean): Promise<void>;
  clear(owner: string): Promise<void>;
}
export interface NormalChatOutgoingBinding {
  owner: string; messageId: string; transportId: string; peer: string; peerUser: number; digest: string;
}
export interface NormalChatOutboxStore {
  find(owner: string, transportId: string): Promise<NormalChatOutgoingBinding | null>;
  bind(row: NormalChatOutgoingBinding, current: () => boolean): Promise<boolean>;
}
