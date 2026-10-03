import { utf8ToBytes } from '@noble/hashes/utils.js';
import { callControlDigest, verifyCallControl, type CallControl } from './callControlProtocol.ts';
import { verifyCallControlReceipt, type CallControlReceipt } from './callControlDelivery.ts';
import { verifyRecord } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityPeer } from './identityClient.ts';

type Route = { sender: string; senderDevice: string; target: string; targetDevice: string; expiresAt: number };
type Row = Route & ({ event: CallControl; raw: string; receipt: null } | { event: null; raw: null; receipt: string });

/** Optional ordinary-neuron courier. No identity authority, media, or durable foreign history.
 * A restart drops this short-lived cache; the endpoints retain their own retry journals.
 * Call sweep periodically even while idle. No FCM payload is admitted by this service.
 */
export function createCallControlRelay(d: {
  records: Pick<IdentityRecordStore, 'read'>; now(): number; current(): boolean; blocked(account: string): boolean;
}) {
  const rows = new Map<string, Row>();
  let busy = false, stopped = false;
  const live = () => !stopped && d.current();
  const active = (peer: IdentityPeer) => live() && peer.expiresAt > d.now() && !d.blocked(peer.account);
  const sweep = () => { for (const [key, row] of rows) if (row.expiresAt <= d.now()) rows.delete(key); };
  async function record(account: string, device: string) {
    const value = await d.records.read(account);
    return value && verifyRecord(value, d.now()) && value.devices.some(item => item.id === device) && !d.blocked(account) ? value : null;
  }
  // Reject excess work rather than letting untrusted traffic grow a promise queue.
  async function run<T>(peer: IdentityPeer, fallback: T, work: () => Promise<T>): Promise<T> {
    if (busy || !active(peer)) return fallback;
    busy = true;
    try {
      sweep();
      if (!await record(peer.account, peer.device) || !active(peer)) return fallback;
      return await work();
    } catch { return fallback; }
    finally { busy = false; }
  }
  return {
    put(raw: string, targetDevice: string, peer: IdentityPeer): Promise<boolean> {
      if (typeof raw !== 'string' || utf8ToBytes(raw).length > 6000 || !/^[a-f0-9]{64}$/.test(targetDevice)) return Promise.resolve(false);
      return run(peer, false, async () => {
        const latest = await record(peer.account, peer.device);
        const event = latest && verifyCallControl(raw, latest, d.now());
        if (!event || event.record.account !== peer.account || event.device !== peer.device) return false;
        const target = event.caller === peer.account ? event.callee : event.caller;
        if ((target === event.caller && targetDevice !== event.callerDevice)
          || (event.kind === 'selected' && targetDevice !== event.selectedDevice)
          || !await record(target, targetDevice) || !active(peer)) return false;
        // Recheck after the target lookup: revocation must not be hidden by asynchronous I/O.
        const current = await record(peer.account, peer.device);
        if (!current || !verifyCallControl(raw, current, d.now()) || !active(peer)) return false;
        sweep();
        const key = `${callControlDigest(event)}:${targetDevice}`;
        if (rows.has(key)) return true; // Never resurrect the payload after an acknowledgment.
        if (rows.size >= 128 || [...rows.values()].filter(row => row.sender === peer.account).length >= 16) return false;
        rows.set(key, { sender: peer.account, senderDevice: peer.device, target, targetDevice,
          expiresAt: event.expiresAt, event, raw, receipt: null });
        return true;
      });
    },
    pending(peer: IdentityPeer): Promise<string[]> {
      return run(peer, [] as string[], async () => {
        const result: string[] = [];
        for (const [key, row] of rows) {
          if (!row.event || row.target !== peer.account || row.targetDevice !== peer.device) continue;
          const latest = await record(row.sender, row.senderDevice);
          if (!latest || !verifyCallControl(row.raw, latest, d.now())) { rows.delete(key); continue; }
          if (active(peer)) result.push(row.raw);
          if (result.length === 8) break;
        }
        return await record(peer.account, peer.device) && active(peer) ? result : [];
      });
    },
    acknowledge(raw: string, peer: IdentityPeer): Promise<boolean> {
      if (typeof raw !== 'string' || utf8ToBytes(raw).length > 6000) return Promise.resolve(false);
      return run(peer, false, async () => {
        const receipt: CallControlReceipt = JSON.parse(raw);
        const key = `${receipt.event}:${peer.device}`, row = rows.get(key);
        if (!row || row.target !== peer.account || row.targetDevice !== peer.device || row.expiresAt <= d.now()) return false;
        if (!row.event) return row.receipt === raw;
        const latest = await record(peer.account, peer.device);
        if (!latest || !verifyCallControlReceipt(raw, row.event, latest, d.now()) || receipt.device !== peer.device || !active(peer)) return false;
        // Drop the delivered event immediately. Keep only the recipient's signed receipt until expiry.
        rows.set(key, { sender: row.sender, senderDevice: row.senderDevice, target: row.target,
          targetDevice: row.targetDevice, expiresAt: Math.min(row.expiresAt, receipt.expiresAt), event: null, raw: null, receipt: raw });
        return true;
      });
    },
    receipts(peer: IdentityPeer): Promise<string[]> {
      return run(peer, [] as string[], async () => {
        const result: string[] = [];
        for (const row of rows.values()) {
          if (row.receipt && row.sender === peer.account && row.senderDevice === peer.device
            && row.expiresAt > d.now() && await record(row.target, row.targetDevice) && active(peer)) result.push(row.receipt);
          if (result.length === 8) break;
        }
        return await record(peer.account, peer.device) && active(peer) ? result : [];
      });
    },
    forgetReceipt(event: string, targetDevice: string, peer: IdentityPeer): Promise<boolean> {
      return run(peer, false, async () => {
        const key = `${event}:${targetDevice}`, row = rows.get(key);
        if (!row || !row.receipt || row.sender !== peer.account || row.senderDevice !== peer.device) return false;
        rows.delete(key);
        return true;
      });
    },
    sweep,
    stop() { stopped = true; rows.clear(); },
  };
}

/** One item per response stays within the axon's frame limit, including JSON escaping. */
export function createCallRelayEndpoint(relay: ReturnType<typeof createCallControlRelay>) {
  return async (raw: string, peer: IdentityPeer): Promise<string> => {
    try {
      if (typeof raw !== 'string' || utf8ToBytes(raw).length > 13000) return '{}';
      const input = JSON.parse(raw);
      if (!input || input.version !== 1) return '{}';
      const keys: Record<string, string[]> = { put: ['raw', 'targetDevice'], acknowledge: ['raw'], pending: [], receipts: [], poll: [], forget: ['event', 'targetDevice'] };
      if (!Object.hasOwn(keys, input.operation) || Object.keys(input).some(key => !['version', 'operation', ...keys[input.operation]].includes(key))) return '{}';
      let result: unknown;
      switch (input.operation) {
        case 'put': result = { accepted: await relay.put(input.raw, input.targetDevice, peer) }; break;
        case 'acknowledge': result = { accepted: await relay.acknowledge(input.raw, peer) }; break;
        case 'poll': {
          const receipt=(await relay.receipts(peer))[0];
          result=receipt?{kind:'receipt',raw:receipt}:{kind:'event',raw:(await relay.pending(peer))[0]??null};break;
        }
        case 'pending': result = { raw: (await relay.pending(peer))[0] ?? null }; break;
        case 'receipts': result = { raw: (await relay.receipts(peer))[0] ?? null }; break;
        case 'forget':
          if (typeof input.event !== 'string' || !/^[a-f0-9]{64}$/.test(input.event) || typeof input.targetDevice !== 'string' || !/^[a-f0-9]{64}$/.test(input.targetDevice)) return '{}';
          result = { accepted: await relay.forgetReceipt(input.event, input.targetDevice, peer) }; break;
      }
      const response = JSON.stringify(result);
      return response && utf8ToBytes(response).length <= 13000 ? response : '{}';
    } catch { return '{}'; }
  };
}
