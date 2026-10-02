import { createIdentityDirectoryLookup } from './identityDirectoryLookup';
import { createIdentityDirectoryEndpoint } from './identityDirectoryEndpoint';
import { createIdentityDirectoryReplication } from './identityDirectoryReplication';
import { createMobileIdentityDirectoryStore } from './mobileIdentityDirectoryStore';
import type { createLocalIdentityController } from './localIdentityController';
import type { IdentityRecordStore } from './identityAdmission';
export function createMobileDirectory(identity: ReturnType<typeof createLocalIdentityController>, pins: IdentityRecordStore,
  current: () => boolean, network: () => { directoryPeers(): string[]; directoryRequest(peer: string, raw: string): Promise<string | null> } | undefined) {
  let stopped = false;
  const live = () => !stopped && current() && identity.status().state === 'unlocked' && !identity.status().busy;
  const receive = createIdentityDirectoryEndpoint({ store: createMobileIdentityDirectoryStore(), pins, now: Date.now, current: live });
  const worker = createIdentityDirectoryReplication({ now: Date.now, own: () => live() ? (() => {
    const { record, history } = JSON.parse(identity.recoveryRecord()); return { record, history };
  })() : null, peers: () => live() ? network()?.directoryPeers() ?? [] : [],
    request: (peer, raw) => network()?.directoryRequest(peer, raw) ?? Promise.resolve(null) });
  const lookup = createIdentityDirectoryLookup({ pins, now: Date.now, current: live,
    peers: () => network()?.directoryPeers() ?? [], request: (peer, raw) => network()?.directoryRequest(peer, raw) ?? Promise.resolve(null) });
  const unsubscribe = identity.subscribe(() => { if (!live()) { worker.invalidate(); lookup.invalidate(); } });
  return { receive, lookup: lookup.lookup, tick: worker.tick, snapshot: worker.snapshot, stop() { stopped = true; lookup.stop(); unsubscribe(); worker.stop(); } };
}
