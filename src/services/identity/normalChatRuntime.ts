import { createNormalChatBoundary } from './normalChatBoundary';
import { createNormalChatOutbox } from './normalChatOutbox';
import { createCustodyCourier } from './custodyCourier';
import { createCustodyService } from './custodyService';
import type { createLocalIdentityController } from './localIdentityController';
import type { createLanIdentityRuntime } from './lanIdentityRuntime';
import type { OutgoingTextMessage } from '../transports/textTransport';

type Boundary = Parameters<typeof createNormalChatBoundary>[0];
type Outbox = Parameters<typeof createNormalChatOutbox>[0];
type Service = Parameters<typeof createCustodyService>[0];
type Network = Pick<ReturnType<typeof createLanIdentityRuntime>,
  'sendChatMessage' | 'custodyRequest' | 'custodians' | 'tick' | 'stop'>;

/** One foreground account owns direct chat, custody, receipts and bounded retries. */
export function createNormalChatRuntime(d: {
  identity: ReturnType<typeof createLocalIdentityController>;
  boundary: Boundary; records: Outbox['records']; own: Outbox['own']; bindings: Outbox['bindings'];
  custodyStore: Service['store']; allowed(account: string): boolean;
  network(hooks: Pick<Parameters<typeof createLanIdentityRuntime>[0], 'onChatMessage' | 'onCustody'>): Network;
  /** Only original, pending own text rows; the boundary revalidates each before sending. */
  pending(): Promise<OutgoingTextMessage[]>;
}) {
  let stopped = false, retrying = false, sweeping = false, maintaining = false, nextRetry = 0, nextSweep = 0;
  const current = () => !stopped && d.boundary.current()
    && d.identity.status().state === 'unlocked' && d.identity.status().account === d.boundary.owner.account;
  const boundary = createNormalChatBoundary({ ...d.boundary, current });
  const service = createCustodyService({ owner: d.boundary.owner.account, records: d.records,
    store: d.custodyStore, now: d.boundary.now, current });
  const network = d.network({ onChatMessage: boundary.receive, onCustody: (raw, peer) => service.receive(peer.account, raw) });
  const outbox = createNormalChatOutbox({ owner: d.boundary.owner.account, current, now: d.boundary.now,
    boundary, bindings: d.bindings, own: d.own, records: d.records, read: d.boundary.readOutgoing,
    direct: network.sendChatMessage,
    deposit: async (...args) => (await courier.deposit(...args)) === true });
  const courier = createCustodyCourier({ owner: () => current() ? d.boundary.owner.account : null,
    allowed: account => current() && d.allowed(account), now: d.boundary.now, records: d.records, own: d.own,
    relays: network.custodians, request: network.custodyRequest, confirmReceipt: outbox.confirmReceipt,
    seal: (...args) => d.identity.sealCustody(...args),
    receive: envelope => d.identity.receiveCustody(envelope, d.records, boundary.receive) });
  async function retry() {
    if (!current() || retrying || d.boundary.now() < nextRetry) return;
    retrying = true; nextRetry = d.boundary.now() + 10_000;
    try {
      const messages = await d.pending();
      for (const message of messages.slice(0, 20)) {
        if (!current()) return;
        try { await outbox.attempt(message); } catch { /* Retry later; preserve the original row. */ }
      }
    } finally { retrying = false; }
  }
  return {
    attempt: outbox.attempt,
    tick() {
      if (!current()) return;
      network.tick();
      // An axon has one request slot. Polling and retries must not compete for
      // it or a busy local slot can repeatedly back off a healthy custodian.
      if (!maintaining) {
        maintaining = true;
        void (async () => {
          await courier.tick().catch(() => {});
          await retry();
        })().catch(() => {}).finally(() => { maintaining = false; });
      }
      if (!sweeping && d.boundary.now() >= nextSweep) {
        sweeping = true; nextSweep = d.boundary.now() + 60_000;
        void service.sweep().catch(() => {}).finally(() => { sweeping = false; });
      }
    },
    stop() {
      if (stopped) return;
      stopped = true; outbox.stop(); courier.stop(); boundary.stop(); network.stop();
    },
  };
}
