import type { TestMessageStore, TestRow } from './testMessageStore';
/** One foreground worker. Explicit peer consent is supplied anew after every unlock.
 * A failed send means unconfirmed, not undelivered. Keep its ID for all future attempts.
 */
export function createTestMessageQueue(d: {
  store: TestMessageStore; owner(): string | null; allowed(peer: string): boolean;
  randomId(): Promise<string>; now(): number;
  send(peer: string, text: string, id: string): Promise<boolean>;
}) {
  let generation = 0, stopped = false, busy = false;
  function lease() {
    const owner = d.owner(), epoch = generation;
    return { owner, current: () => !stopped && epoch === generation && !!owner && d.owner() === owner };
  }
  return {
    async enqueue(peer: string, text: string): Promise<string | null> {
      const l = lease(); if (!l.current() || !d.allowed(peer)) return null;
      const id = await d.randomId();
      if (!l.current() || !d.allowed(peer)) return null;
      const row: TestRow = { owner: l.owner!, peer, direction: 'out', id, text, state: 'pending', created: d.now(), attempts: 0, next: 0 };
      return await d.store.put(row, () => l.current() && d.allowed(peer)) ? id : null;
    },
    async receive(message: { from: string; id: string; text: string }): Promise<boolean> {
      const l = lease(); if (!l.current() || !d.allowed(message.from)) return false;
      return d.store.put({ owner: l.owner!, peer: message.from, direction: 'in', id: message.id,
        text: message.text, state: 'delivered', created: d.now(), attempts: 0, next: 0 }, () => l.current() && d.allowed(message.from));
    },
    async tick() {
      const l = lease(); if (busy || !l.current()) return;
      busy = true;
      try {
        const rows = await d.store.list(l.owner!);
        // At most one attempt per tick, globally, to leave room for identity/liveness frames.
        const row = rows.filter(r => r.direction === 'out' && r.state === 'pending' && r.next <= d.now() && d.allowed(r.peer))
          .sort((a, b) => a.next - b.next || a.created - b.created)[0];
        if (!row || !l.current()) return;
        let delivered = false;
        try { delivered = await d.send(row.peer, row.text, row.id); } catch { /* retain pending */ }
        if (!l.current()) return;
        await d.store.update(row, delivered, d.now() + Math.min(60_000, 5000 * 2 ** Math.min(row.attempts, 4)), l.current);
      } finally { busy = false; }
    },
    invalidate() { generation++; },
    stop() { stopped = true; generation++; },
  };
}
