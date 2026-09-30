import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { custodyDigest, verifyCustody, type CustodyReceipt } from './custodyProtocol';
import type { IdentityRecordStore } from './identityAdmission';
import type { OwnCustodyStore } from './ownCustodyStore';
import type { NormalChatOutboxStore } from './normalChatOutboxStore';
import type { createNormalChatBoundary } from './normalChatBoundary';
import type { OutgoingTextMessage, TextDeliveryOptions } from '../transports/textTransport';

const digest = (raw: string) => bytesToHex(sha256(utf8ToBytes(raw)));
/** Normal outbox adapter. Transport custody and recipient delivery are deliberately separate. */
export function createNormalChatOutbox(d: {
  owner: string; current(): boolean; now(): number;
  boundary: ReturnType<typeof createNormalChatBoundary>; bindings: NormalChatOutboxStore;
  own: OwnCustodyStore; records: IdentityRecordStore;
  read(messageId: string): Promise<OutgoingTextMessage | null>;
  /** True only after the authenticated direct recipient's durable-storage receipt. */
  direct(peer: string, text: string, id: string): Promise<boolean>;
  /** True only after custody is durably recorded. This never means delivered. */
  deposit(peer: string, text: string, id: string): Promise<boolean>;
}) {
  let stopped = false;
  const sending = new Set<string>();
  const current = () => !stopped && d.current();
  return {
    async attempt(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
      message = { ...message };
      if (!current() || sending.has(message.id)) return null;
      sending.add(message.id);
      try {
        const packet = await d.boundary.prepare(message, options);
        if (!packet || !current()) return null;
        if (!await d.bindings.bind({ owner: d.owner, messageId: message.id, transportId: packet.id,
          peer: packet.peer.account, peerUser: packet.peer.user, digest: digest(packet.text) }, current) || !current()) return null;
        let direct = false;
        try { direct = await d.direct(packet.peer.account, packet.text, packet.id); } catch { /* Try custody. */ }
        if (!current()) return null;
        if (direct && await d.boundary.confirm(message, packet.peer.account, packet.id, current) && current()) {
          return { peerId: packet.peer.user, delivered: true };
        }
        // Recheck original content/authorization after an async direct attempt.
        const fresh = await d.boundary.prepare(message, options);
        if (!fresh || fresh.id !== packet.id || fresh.text !== packet.text || !current()) return null;
        if (!await d.deposit(packet.peer.account, packet.text, packet.id) || !current()) return null;
        return { peerId: packet.peer.user, delivered: false };
      } finally { sending.delete(message.id); }
    },
    async confirmReceipt(receipt: CustodyReceipt, lease = () => true): Promise<boolean> {
      receipt = { ...receipt };
      const permitted = () => current() && lease();
      if (!permitted() || receipt.sender !== d.owner || !await verifyCustody(receipt, d.records, d.now()) || !permitted()) return false;
      const bound = await d.bindings.find(d.owner, receipt.id);
      const envelope = (await d.own.get(d.owner, receipt.id))?.envelope;
      if (!bound || !envelope || bound.peer !== receipt.recipient || envelope.sender !== d.owner
        || envelope.id !== receipt.id || envelope.recipient !== receipt.recipient || envelope.recipientDevice !== receipt.recipientDevice
        || envelope.expires !== receipt.expires || custodyDigest(envelope) !== receipt.digest || !permitted()) return false;
      const message = await d.read(bound.messageId);
      if (!message || !permitted()) return false;
      const packet = await d.boundary.prepare(message);
      if (!packet || packet.id !== receipt.id || packet.peer.user !== bound.peerUser || packet.peer.account !== bound.peer
        || digest(packet.text) !== bound.digest || !permitted()) return false;
      return await d.boundary.confirm(message, bound.peer, receipt.id, permitted) && permitted();
    },
    stop() { stopped = true; },
  };
}
