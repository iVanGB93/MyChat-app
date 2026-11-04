import type { CustodyEnvelope } from './custodyProtocol.ts';
export interface OwnCustodyRow { owner: string; id: string; envelope: CustodyEnvelope; relay: string | null }
export interface OwnCustodyStore {
  get(owner: string, id: string): Promise<OwnCustodyRow | null>;
  save(owner: string, envelope: CustodyEnvelope, current: () => boolean): Promise<OwnCustodyRow | null>;
  held(owner: string, id: string, relay: string, current: () => boolean): Promise<void>;
  /** Release ciphertext only after the verified receipt was durably applied and consumed. */
  consumed?(owner: string, id: string, current: () => boolean): Promise<void>;
  clear(owner: string): Promise<void>;
}
