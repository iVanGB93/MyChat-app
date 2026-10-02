import { compareRecord, recordDigest, validRecordHistory, type IdentityRecord } from './identityProtocol';
import type { DirectoryLookupResult } from './identityDirectoryLookup';
export type RecoveryLookup = (checkpoint: IdentityRecord) => Promise<DirectoryLookupResult>;
export function parseRecoveryCheckpoint(raw: string, now: number) {
  if (typeof raw !== 'string' || raw.length > 12000) throw Error('Invalid recovery record');
  let packet;
  try { packet = JSON.parse(raw); } catch { throw Error('Invalid recovery record'); }
  if (packet?.version !== 1 || !validRecordHistory(packet.history, packet.record, now)) throw Error('Invalid recovery record');
  return packet as { version: 1; record: IdentityRecord; history: IdentityRecord[] };
}
/** Discovery needs a saved owner-signed checkpoint. Peer votes cannot prove global freshness. */
export async function checkRecoveryRecord(raw: string, lookup: RecoveryLookup, now: () => number, unchanged = false) {
  const checkpoint = parseRecoveryCheckpoint(raw, now());
  const response = await lookup(checkpoint.record);
  if (response.status !== 'found' || !response.packet) throw Error(`Recovery check stopped: ${response.status}. Keep your saved record and try again.`);
  const packet = response.packet;
  const decision = compareRecord(packet.record, checkpoint.record, now(), packet.history);
  if (decision !== 'accept') throw Error(`Recovery check stopped: ${decision}.`);
  if (unchanged && recordDigest(packet.record) !== recordDigest(checkpoint.record)) throw Error('The identity record changed. Check the network again before restoring.');
  const result = JSON.stringify({ version: 1, record: packet.record, history: packet.history });
  if (result.length > 12000) throw Error('Recovery history exceeds the supported size');
  return { raw: result, revision: packet.record.revision, sources: response.sources.length };
}
