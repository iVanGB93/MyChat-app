import type { OutgoingTextMessage, TextDeliveryOptions } from './normalChatContracts.ts';
import { decodeNormalChat, encodeNormalChat, normalChatTransportId, type NormalChatText } from './normalChatProtocol.ts';
import { validAccountId } from './identityProtocol.ts';

export interface NormalChatBinding { user: number; account: string }
interface Dependencies {
  owner: NormalChatBinding;
  current(): boolean;
  now(): number;
  /** Return a peer only for a current, unblocked two-member room and a verified local identity pin.
   * A network advertisement, numeric user claim, or FirstNeuron introduction is insufficient.
   */
  peer(roomId: string): Promise<NormalChatBinding | null>;
  /** Synchronous session/pin/room/blocklist check used by storage immediately before committing. */
  authorized(roomId: string, peer: NormalChatBinding): boolean;
  /** Read the original undeleted, own text row. No synthesized or edited replacement is allowed. */
  readOutgoing(id: string): Promise<OutgoingTextMessage | null>;
  /** Atomically insert or verify an identical normal inbox row. Conflicting existing IDs must fail.
   * The storage implementation must check current immediately before its write/commit.
   */
  persist(message: NormalChatText, current: () => boolean): Promise<boolean>;
  /** Apply a verified receipt to the unchanged original outbox row; preserve read status. */
  delivered(message: OutgoingTextMessage, peer: number, current: () => boolean): Promise<boolean>;
}
/** Account-scoped boundary for direct and custody delivery. It supplies no peer trust by itself. */
export function createNormalChatBoundary(d: Dependencies) {
  const owner = { ...d.owner };
  if (!Number.isSafeInteger(owner.user) || owner.user < 1 || !validAccountId(owner.account)) throw Error('Invalid chat owner');
  let stopped = false;
  const current = () => !stopped && d.current();
  async function peer(roomId: string) {
    if (!current()) return null;
    const p = await d.peer(roomId);
    return current() && p && Number.isSafeInteger(p.user) && p.user > 0 && p.user !== owner.user
      && validAccountId(p.account) && p.account !== owner.account && d.authorized(roomId, p) ? { ...p } : null;
  }
  const samePeer = (a: NormalChatBinding | null, b: NormalChatBinding) => a?.user === b.user && a.account === b.account;
  async function outgoing(message: OutgoingTextMessage, expected: NormalChatBinding) {
    const local = await d.readOutgoing(message.id);
    if (!current() || !local) return null;
    const raw = encodeNormalChat(message, owner.user, expected.user);
    if (!raw || encodeNormalChat(local, owner.user, expected.user) !== raw || !samePeer(await peer(message.roomId), expected)) return null;
    const decoded = decodeNormalChat(raw, d.now());
    return decoded ? { raw, decoded, id: normalChatTransportId(decoded, owner.account, expected.account) } : null;
  }
  return {
    async prepare(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
      message = { ...message };
      options = options ? { ...options, expectedRecipientIds: options.expectedRecipientIds?.slice() } : undefined;
      // Recovery fanout uses its existing path until per-device recovery is integrated.
      if (!current() || options?.hydration) return null;
      const p = await peer(message.roomId);
      if (!p || (options?.targetRecipientId != null && options.targetRecipientId !== p.user)
        || (options?.expectedRecipientIds && (options.expectedRecipientIds.length !== 1 || options.expectedRecipientIds[0] !== p.user))) return null;
      const packet = await outgoing(message, p);
      return packet && current() ? { id: packet.id, text: packet.raw, peer: p } : null;
    },
    /** Called only with an authenticated/decrypted transport sender. True permits its storage receipt. */
    async receive(packet: { from: string; id: string; text: string }) {
      packet = { ...packet };
      if (!current()) return false;
      const m = decodeNormalChat(packet.text, d.now());
      if (!m || m.recipient !== owner.user) return false;
      const p = await peer(m.roomId);
      if (!p || p.user !== m.sender || p.account !== packet.from
        || packet.id !== normalChatTransportId(m, p.account, owner.account)) return false;
      const permitted = () => current() && d.authorized(m.roomId, p);
      if (!await d.persist(m, permitted) || !permitted()) return false;
      return samePeer(await peer(m.roomId), p) && current();
    },
    /** This is not a relay-held callback. Caller must first verify the recipient's cryptographic receipt. */
    async confirm(message: OutgoingTextMessage, recipientAccount: string, transportId: string, lease = () => true) {
      message = { ...message };
      if (!lease()) return false;
      const p = await peer(message.roomId);
      if (!p || p.account !== recipientAccount) return false;
      const packet = await outgoing(message, p);
      const permitted = () => current() && lease() && d.authorized(message.roomId, p);
      return !!packet && packet.id === transportId && permitted()
        && await d.delivered(message, p.user, permitted) && permitted();
    },
    stop() { stopped = true; },
  };
}
