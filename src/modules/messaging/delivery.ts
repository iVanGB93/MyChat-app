import {pendingRootChat} from '../../services/identity/rootChatLedger';
import type {createRootChatLedger} from '../../services/identity/rootChatLedger';

/** A transport-independent outbox pump: acknowledgement, not a send attempt, marks delivery. */
export function createMessageDelivery(d: {
  owner(): string | null;
  ledger(): ReturnType<typeof createRootChatLedger>;
  blocked(peers: string[]): void;
  collect(): Promise<unknown>;
  send(peer: string, raw: string, id: string): Promise<boolean>;
  resolve(peer: string): Promise<unknown>;
  deposit(peer: string, raw: string, id: string): Promise<unknown>;
}) {
  let busy = false, collecting = false, cursor = 0, stopped = false, generation = 0;
  let phase="idle";
  async function collect() {
    const owner = d.owner(), epoch = generation;
    if (collecting || !owner || stopped) return;
    collecting = true;
    try {
      const state = await d.ledger().snapshot();
      if (stopped || generation !== epoch || d.owner() !== owner) return;
      d.blocked(state.contacts.filter(c => c.blocked).map(c => c.account));
      await d.collect();
    } catch { /* A later tick retries inbox recovery independently of the outbox. */ }
    finally { collecting = false; }
  }
  async function dispatch() {
      const owner = d.owner(), epoch = generation;
      if (busy || !owner || stopped) return;
      busy = true;
      const current = () => !stopped && generation === epoch && d.owner() === owner;
      try {
        phase="storage";const ledger = d.ledger(), state = await ledger.snapshot(); if (!current()) return;
        d.blocked(state.contacts.filter(c => c.blocked).map(c => c.account));
        const pending = pendingRootChat(state, owner), message = pending.length ? pending[cursor++ % pending.length] : null;
        if (!message) return;
        phase="send";if (await d.send(message.peer, message.raw, message.id)) {
          if (current()) await ledger.delivered(message.peer, message.id);
        } else if (current()) {
          phase="resolve";await d.resolve(message.peer);
          phase="deposit";if (current()) await d.deposit(message.peer, message.raw, message.id);
        }
      } catch { /* Durable outbox remains pending for a later tick/session. */ }
      finally { busy = false; phase="idle"; }
  }
  return {
    snapshot:()=>({phase,busy,collecting}),
    // An offline outgoing peer must not monopolize the bounded background wake
    // window. Inbox polling and receipt collection have their own single flight.
    async tick() { await Promise.all([collect(), dispatch()]); },
    invalidate() { generation++; },
    stop() { stopped = true; generation++; },
  };
}
