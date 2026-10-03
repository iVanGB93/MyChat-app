import { callControlDigest, type CallControl } from './callControlProtocol.ts';
import { createDurableCallerCallControl, createDurableRecipientCallControl, type CallJournalStore } from './durableCallControl.ts';
import { CALL_MEDIA_MAX_BYTES, verifyCallMediaSignal, type CallMediaSignal } from './callMediaProtocol.ts';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecord } from './identityProtocol.ts';

/** One call on one authenticated axon. Destroy with that axon, on lock, or on hangup.
 * Never restore SDP/ICE or replay counters after restart: establish a fresh axon instance.
 * The callback must synchronously hand off to a bounded media queue; it must not persist SDP.
 */
export function createCallMediaSession(d: {
  invite: CallControl; account: string; device: string; instance: string; peer: IdentityPeer;
  store: CallJournalStore; readRecord(account: string): Promise<IdentityRecord | null>;
  now(): number; current(): boolean; blocked(account: string): boolean;
  received(signal: CallMediaSignal): void;
}) {
  const caller = d.invite.caller === d.account;
  const remote = caller ? d.invite.callee : d.invite.caller;
  if (d.invite.kind !== 'invite' || (caller ? d.invite.callerDevice !== d.device : d.invite.callee !== d.account)
    || d.peer.account !== remote) throw Error('Invalid media session');
  const call = caller ? createDurableCallerCallControl(d.store,d.account,d.invite.callId,d.now)
    : createDurableRecipientCallControl(d.store,d.account,d.invite.callId,d.device,d.now);
  let stopped = false, sequence = 0, pending = 0;
  let queue = Promise.resolve();
  const allowed = () => !stopped && d.current() && !d.blocked(remote) && d.peer.expiresAt > d.now();
  return {
    stop() { stopped = true; },
    receive(raw: string): Promise<boolean> {
      if (!allowed() || pending >= 4 || typeof raw !== 'string' || raw.length > CALL_MEDIA_MAX_BYTES
        || utf8ToBytes(raw).length > CALL_MEDIA_MAX_BYTES) return Promise.resolve(false);
      pending++;
      const result = queue.then(async () => {
        if (!allowed()) return false;
        const pinned = await d.readRecord(remote);
        if (!pinned || !allowed()) return false;
        const e = verifyCallMediaSignal(raw, pinned, d.now());
        if (!e || e.record.account !== remote || e.device !== d.peer.device
          || e.sourceInstance !== d.peer.instance || e.targetInstance !== d.instance
          || e.target !== d.account || e.targetDevice !== d.device || e.callId !== d.invite.callId
          || e.invitation !== callControlDigest(d.invite) || e.sequence <= sequence
          || (e.kind === 'offer' && caller) || (e.kind === 'answer' && !caller)) return false;
        const state = await call.snapshot(d.now());
        if (!state || !allowed() || e.expiresAt <= d.now() || state.status !== 'accepted' || !state.confirmed
          || state.invitation !== e.invitation || state.acceptance !== e.acceptance
          || state.selectedDevice !== (caller ? d.peer.device : d.device)
          || (!caller && d.peer.device !== d.invite.callerDevice)) return false;
        sequence = e.sequence;
        d.received(e);
        return true;
      }).catch(() => false).finally(() => { pending--; });
      queue = result.then(() => {});
      return result;
    },
  };
}
