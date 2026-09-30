import { authenticateIdentityPeer } from './identityClient.ts';
import type { IdentityRecordStore, IdentityRequest } from './identityAdmission.ts';
import type { NeuronCandidate, OpenNeuron } from './neuronConnections.ts';

export interface IdentityTransport {
  /** Transport adapter enforces byte limits and request timeouts before buffering. */
  exchange(operation: 'describe' | 'authenticate', payload: string): Promise<string>;
  onClosed(callback: () => void): () => void;
  close(): void;
}
/** One authentication path for ordinary hosted and mobile peers; no contact or bootstrap privilege.
 * Owner must stop its pool when the local account locks or participation is suspended.
 */
export function createIdentityConnectionOpener(d: {
  localAccount: string; store: IdentityRecordStore; now(): number; current(): boolean;
  random(size: number): Promise<Uint8Array>;
  sign(audience: { account: string; instance: string }): Promise<IdentityRequest>;
  transport(candidate: NeuronCandidate, signal: AbortSignal): Promise<IdentityTransport>;
}): OpenNeuron {
  return async (candidate, context) => {
    let transport: IdentityTransport | undefined, unsubscribe: (() => void) | undefined, closed = false;
    const close = () => {
      if (closed) return;
      closed = true; context.signal.removeEventListener('abort', close);
      try { unsubscribe?.(); } catch { /* Best-effort listener cleanup. */ }
      try { transport?.close(); } catch { /* Closing must not prevent slot cleanup. */ }
    };
    try {
      if (context.signal.aborted || !d.current()) return null;
      context.signal.addEventListener('abort', close, { once: true });
      transport = await d.transport(candidate, context.signal);
      if (closed || context.signal.aborted || !d.current()) { transport.close(); close(); return null; }
      unsubscribe = transport.onClosed(() => { close(); context.onClosed(); });
      if (closed) { unsubscribe(); return null; }
      const peer = await authenticateIdentityPeer({ ...d, expectedAccount: candidate.account,
        current: () => !closed && !context.signal.aborted && d.current(),
        exchange: (operation, payload) => transport!.exchange(operation, payload) });
      if (!peer || closed || context.signal.aborted || !d.current()) { close(); return null; }
      return { peer, close };
    } catch { close(); return null; }
  };
}
