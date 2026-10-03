import type { IceConfig } from '../types';

/** Call-scoped adapter: incoming events have already passed identity, device and call admission.
 * Keep one adapter for the mounted call. Dispose it when the call or its axon ends.
 */
export interface CallMediaTransport {
  send(kind: string, data: Record<string, unknown>): Promise<boolean>;
  subscribe(listener: (kind: string, data: Record<string, unknown>) => void): () => void;
  loadIceConfig(): Promise<IceConfig>;
}
