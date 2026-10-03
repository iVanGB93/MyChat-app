import { recordDigest, validAccountId, type IdentityRecord } from './identityProtocol.ts';
import { verifyCallControl, type CallControl } from './callControlProtocol.ts';

export type CallWakeData = { type: 'neuron_call'; event: string; record: string; targetDevice: string };
/** Compact signed notification, verified with an already pinned public record. No private keys. */
export function createCallWake(raw: string, targetDevice: string, now: number): CallWakeData | null {
  try {
    const event: CallControl = JSON.parse(raw);
    if (!verifyCallControl(raw, event.record, now) || !['invite', 'cancel', 'end'].includes(event.kind)
      || event.record.account !== event.caller || !/^[a-f0-9]{64}$/.test(targetDevice)) return null;
    const { record, ...compact } = event;
    const data: CallWakeData = { type: 'neuron_call', event: JSON.stringify(compact), record: recordDigest(record), targetDevice };
    return new TextEncoder().encode(JSON.stringify(data)).length <= 3500 ? data : null;
  } catch { return null; }
}
export function callWakeSender(data: unknown): string | null {
  try {
    const d = data as CallWakeData;
    if (!d || d.type !== 'neuron_call' || typeof d.event !== 'string' || d.event.length > 3500
      || new TextEncoder().encode(JSON.stringify(d)).length > 3500) return null;
    const e = JSON.parse(d.event);
    return validAccountId(e.caller) ? e.caller : null;
  } catch { return null; }
}
export function verifyCallWake(data: unknown, pinned: IdentityRecord, account: string, device: string, now: number): string | null {
  try {
    const d = data as CallWakeData;
    if (callWakeSender(d) !== pinned.account || d.targetDevice !== device || d.record !== recordDigest(pinned)) return null;
    const compact = JSON.parse(d.event);
    if (Object.hasOwn(compact, 'record')) return null;
    const raw = JSON.stringify({ ...compact, record: pinned });
    const event = verifyCallControl(raw, pinned, now);
    return event && event.callee === account && event.record.account === event.caller
      && ['invite', 'cancel', 'end'].includes(event.kind) ? raw : null;
  } catch { return null; }
}
