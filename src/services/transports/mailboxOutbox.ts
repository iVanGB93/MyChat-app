import type { OutgoingTextMessage, TextDeliveryOptions } from './textTransport';
import type { MailboxEnvelope, MailboxStore, createMailboxNode } from './mailboxProtocol';
interface Dependencies {
  owner: number;
  current(): boolean;
  now(): number;
  node: ReturnType<typeof createMailboxNode>;
  store: MailboxStore;
  read(id: string): Promise<OutgoingTextMessage | null>;
  peer(roomId: string): Promise<{ id: number } | null>;
  custodians(): number[];
  preferDirect?: boolean;
  digest(value: string): Promise<string>;
  binding(id: string): Promise<{ digest: string; custody: number } | null>;
  bind(id: string, digest: string, expires: number): Promise<void>;
  custody(id: string): Promise<void>;
  delivered(message: OutgoingTextMessage, recipient: number): Promise<boolean>;
}
export function createMailboxOutbox(d: Dependencies) {
  const inFlight = new Set<string>();
  let reconciling = false;
  const body = (m: OutgoingTextMessage) => JSON.stringify([m.id, m.roomId, m.content, Date.parse(m.createdAt)]);
  const eligible = (m: OutgoingTextMessage) => !!m.content && !m.replyTo && m.durationMs == null;
  async function matches(e: MailboxEnvelope) {
    if (!d.current() || e.sender !== d.owner) return false;
    const m = await d.read(e.id), bound = await d.binding(e.id);
    if (!d.current() || !m || !bound || !eligible(m) || m.roomId !== e.roomId || Date.parse(m.createdAt) !== e.createdAt) return false;
    const peer = await d.peer(e.roomId);
    return d.current() && peer?.id === e.recipient && bound.digest === await d.digest(body(m)) && d.current();
  }
  async function confirm(e: MailboxEnvelope) {
    if (!await matches(e) || await d.node.status(e.id) !== 'delivered' || !d.current()) return false;
    const m = await d.read(e.id);
    return !!m && d.current() && d.delivered(m, e.recipient);
  }
  return {
    matches,
    async reconcile() {
      if (reconciling || !d.current()) return;
      reconciling = true;
      try {
        for (const p of await d.store.list(d.owner, d.now())) {
          if (!d.current()) break;
          if (p.kind === 'envelope' && p.sender === d.owner) await confirm(p);
        }
      } finally { reconciling = false; }
    },
    async attempt(message: OutgoingTextMessage, options?: TextDeliveryOptions) {
      if (!d.current() || !eligible(message) || inFlight.has(message.id)) return null;
      inFlight.add(message.id);
      try {
        const local = await d.read(message.id), peer = await d.peer(message.roomId);
        if (!d.current() || !local || body(local) !== body(message) || !peer
          || (options?.targetRecipientId != null && options.targetRecipientId !== peer.id)
          || (options?.expectedRecipientIds && (options.expectedRecipientIds.length !== 1 || options.expectedRecipientIds[0] !== peer.id))) return null;
        let e = await d.store.get(d.owner, 'envelope', message.id, d.now());
        if (!d.current()) return null;
        if (!e) {
          if (options?.hydration || options?.targetRecipientId || !d.custodians().some(id => id !== peer.id)) return null;
          e = await d.node.create(message.id, message.roomId, peer.id, message.content!, Date.parse(message.createdAt));
          if (!e || !d.current()) return null;
          await d.bind(e.id, await d.digest(body(message)), e.expiresAt);
        }
        if (e.kind !== 'envelope' || !await matches(e)) return null;
        if (await confirm(e)) return { peerId: peer.id, delivered: true };
        const existing = await d.binding(message.id);
        if (!d.current()) return null;
        // Retain durable custody through reconnect/hydration; never label it delivery.
        if (existing?.custody) return { peerId: peer.id, delivered: false };
        const destinations = d.custodians().filter(id => id !== peer.id);
        if (d.preferDirect) destinations.unshift(peer.id);
        for (const custodian of destinations) {
          if (!d.current() || !await matches(e)) return null;
          if (await d.node.deposit(e.id, custodian)) {
            if (!d.current()) return null;
            await d.custody(e.id);
            return d.current() ? { peerId: peer.id, delivered: await confirm(e) } : null;
          }
        }
        return null;
      } finally { inFlight.delete(message.id); }
    },
  };
}
