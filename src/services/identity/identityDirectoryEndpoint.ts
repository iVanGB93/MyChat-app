import { createIdentityDirectory, DIRECTORY_DOMAIN, validDirectoryPacket, type DirectoryStore } from './identityDirectory.ts';
import { compareRecord, validAccountId } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
/** Directory replicas never override a newer or conflicting authenticated admission pin. */
export function createIdentityDirectoryEndpoint(d: { store: DirectoryStore; pins: IdentityRecordStore; now(): number; current(): boolean }) {
  const service = createIdentityDirectory(d);
  const reject = () => JSON.stringify({ domain: DIRECTORY_DOMAIN, status: 'rejected' });
  let pending = 0;
  return async (peer: string, raw: string): Promise<string> => {
    if (pending >= 8 || !d.current() || !validAccountId(peer) || raw.length > 13_000) return reject();
    pending++;
    try {
      const request = JSON.parse(raw);
      if (request.domain !== DIRECTORY_DOMAIN) return reject();
      if (request.operation === 'put') {
        const packet = request.packet;
        if (!validDirectoryPacket(packet, d.now()) || packet.record.account !== peer) return reject();
        const pinned = await d.pins.read(peer);
        if (!d.current() || compareRecord(packet.record, pinned, d.now(), packet.history) !== 'accept') return reject();
      }
      const result = await service.receive(peer, raw), response = JSON.parse(result);
      const packet = response.status === 'found' ? response.packet : response.status === 'stored' ? request.packet : null;
      if (packet) {
        const pinned = await d.pins.read(packet.record.account);
        if (!d.current() || compareRecord(packet.record, pinned, d.now(), packet.history) !== 'accept') return reject();
      }
      return d.current() ? result : reject();
    } catch { return reject(); }
    finally { pending--; }
  };
}
