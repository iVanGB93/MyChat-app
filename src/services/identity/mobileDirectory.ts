import { createIdentityDirectoryLookup } from './identityDirectoryLookup';
import { createIdentityDirectoryEndpoint } from './identityDirectoryEndpoint';
import { createIdentityDirectoryReplication } from './identityDirectoryReplication';
import { createMobileIdentityDirectoryStore } from './mobileIdentityDirectoryStore';
import type { createLocalIdentityController } from './localIdentityController';
import { pinIdentityRecord, type IdentityRecordStore } from './identityAdmission';
import { compareRecord } from './identityProtocol';
export function createMobileDirectory(identity: ReturnType<typeof createLocalIdentityController>, pins: IdentityRecordStore,
  current: () => boolean, network: () => { directoryPeers(): string[]; directoryRequest(peer: string, raw: string): Promise<string | null> } | undefined) {
  let stopped = false;
  let refreshGeneration = 0;
  const live = () => !stopped && current() && identity.status().state === 'unlocked' && !identity.status().busy;
  const receive = createIdentityDirectoryEndpoint({ store: createMobileIdentityDirectoryStore(), pins, now: Date.now, current: live });
  const worker = createIdentityDirectoryReplication({ now: Date.now, own: () => live() ? (() => {
    const { record, history } = JSON.parse(identity.recoveryRecord()); return { record, history };
  })() : null, peers: () => live() ? network()?.directoryPeers() ?? [] : [],
    request: (peer, raw) => network()?.directoryRequest(peer, raw) ?? Promise.resolve(null) });
  const lookup = createIdentityDirectoryLookup({ pins, now: Date.now, current: live,
    peers: () => network()?.directoryPeers() ?? [], request: (peer, raw) => network()?.directoryRequest(peer, raw) ?? Promise.resolve(null) });
  const unsubscribe = identity.subscribe(() => { if (!live()) { refreshGeneration++; worker.invalidate(); lookup.invalidate(); } });
  async function refresh(account: string) {
    const owner = identity.status().account;
    const generation = refreshGeneration;
    const current = () => live() && refreshGeneration === generation && identity.status().account === owner;
    const result = await lookup.lookup(account);
    if (result.status !== 'found' || !result.packet) return result;
    const failed = (status: 'cancelled' | 'conflict' | 'stale' | 'missing-history' | 'unavailable') =>
      ({ ...result, status, packet: undefined });
    try {
      const {record, history} = result.packet;
      const previous = await pins.read(account);
      if (!current()) return failed('cancelled');
      const decision = compareRecord(record, previous, Date.now(), history);
      if (decision !== 'accept') return failed(decision === 'invalid' ? 'unavailable' : decision);
      if (!await pinIdentityRecord(pins, previous, record, history)) return failed('unavailable');
      return current() ? result : failed('cancelled');
    } catch {
      return failed(current() ? 'unavailable' : 'cancelled');
    }
  }
  return { receive, lookup: lookup.lookup, refresh, tick: worker.tick,nextDeadline:worker.nextDeadline, snapshot: worker.snapshot, stop() { stopped = true; lookup.stop(); unsubscribe(); worker.stop(); } };
}
