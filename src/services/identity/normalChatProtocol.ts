import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { validAccountId } from './identityProtocol.ts';
import type { OutgoingTextMessage } from './normalChatContracts.ts';

const DOMAIN = 'axonic-chat-text-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const NORMAL_CHAT_WIRE_BYTES = 2048;
export interface NormalChatText {
  id: string; roomId: string; sender: number; recipient: number;
  createdAt: string; content: string;
}
const user = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
function valid(m: NormalChatText): boolean {
  return typeof m.id === 'string' && UUID.test(m.id) && typeof m.roomId === 'string' && UUID.test(m.roomId)
    && user(m.sender) && user(m.recipient) && m.sender !== m.recipient
    && typeof m.createdAt === 'string' && m.createdAt.length === 24
    && Number.isSafeInteger(Date.parse(m.createdAt)) && Date.parse(m.createdAt) >= 0
    && new Date(m.createdAt).toISOString() === m.createdAt
    && typeof m.content === 'string' && m.content.length > 0 && m.content.length <= NORMAL_CHAT_WIRE_BYTES;
}
function wire(m: NormalChatText) {
  return JSON.stringify([DOMAIN, m.id, m.roomId, m.sender, m.recipient, m.createdAt, m.content]);
}
/** The original UUID is kept inside the payload; transport changes never allocate a new message. */
export function normalChatTransportId(m: NormalChatText, senderAccount: string, recipientAccount: string): string {
  if (!valid(m) || !validAccountId(senderAccount) || !validAccountId(recipientAccount) || senderAccount === recipientAccount) {
    throw Error('Invalid normal-chat identity');
  }
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([DOMAIN, senderAccount, recipientAccount,
    m.sender, m.recipient, m.roomId, m.id]))));
}
export function encodeNormalChat(message: OutgoingTextMessage, sender: number, recipient: number): string | null {
  // Keep unsupported message features on their existing transport.
  if (message.replyTo != null || message.durationMs != null || typeof message.content !== 'string') return null;
  const m: NormalChatText = { id: message.id, roomId: message.roomId, sender, recipient,
    createdAt: message.createdAt, content: message.content };
  if (!valid(m)) return null;
  const raw = wire(m);
  return utf8ToBytes(raw).length <= NORMAL_CHAT_WIRE_BYTES ? raw : null;
}
export function decodeNormalChat(raw: string, now: number): NormalChatText | null {
  if (typeof raw !== 'string' || raw.length > NORMAL_CHAT_WIRE_BYTES || utf8ToBytes(raw).length > NORMAL_CHAT_WIRE_BYTES
    || !Number.isSafeInteger(now) || now < 0) return null;
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a) || a.length !== 7 || a[0] !== DOMAIN) return null;
    const m: NormalChatText = { id: a[1], roomId: a[2], sender: a[3], recipient: a[4], createdAt: a[5], content: a[6] };
    return valid(m) && Date.parse(m.createdAt) <= now + 30_000 && wire(m) === raw ? m : null;
  } catch { return null; }
}
