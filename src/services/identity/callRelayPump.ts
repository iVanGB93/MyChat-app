import { createDurableCallerCallControl, createDurableRecipientCallControl, type CallJournalStore } from './durableCallControl.ts';
import { verifyRecord } from './identityProtocol.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { CallControl } from './callControlProtocol.ts';
import type { CallControlReceipt } from './callControlDelivery.ts';

/** Bounded foreground courier client. A courier accepting a deposit is NOT delivery.
 * Only the recipient's verified receipt clears the durable endpoint outbox.
 */
export function createCallRelayPump(d: {
  account: string; device: string; store: CallJournalStore; records: Pick<IdentityRecordStore, 'read'>;
  current(): boolean; now(): number; blocked(account: string): boolean;
  peers(): IdentityPeer[]; direct(): IdentityPeer[]; list(): Promise<CallControl[]>;
  request(peer: IdentityPeer, raw: string): Promise<string | null>;
  receive(raw: string, courier: IdentityPeer): Promise<string | null>;
}) {
  let stopped = false, busy = false, next = 0, rowCursor = 0, deviceCursor = 0;
  const stats={requests:0,deposits:0,received:0,receipts:0,last:'idle',reply:'none'};
  const live = () => !stopped && d.current();
  const state = (event: CallControl) => event.caller === d.account
    ? createDurableCallerCallControl(d.store,d.account,event.callId,d.now)
    : createDurableRecipientCallControl(d.store,d.account,event.callId,d.device,d.now);
  const active = (peer: IdentityPeer) => live() && peer.expiresAt > d.now()
    && d.peers().some(p => p.account === peer.account && p.device === peer.device && p.instance === peer.instance);
  async function request(peer: IdentityPeer, operation: string, fields: object = {}) {
    if (!active(peer)) return null;
    stats.requests++;stats.last=operation;
    const raw = await d.request(peer, JSON.stringify({ version: 1, operation, ...fields }));
    if (!raw || !active(peer) || new TextEncoder().encode(raw).length > 13000) return null;
    const result=JSON.parse(raw);stats.reply=result?.accepted===true?'accepted':result?.accepted===false?'rejected':typeof result?.raw==='string'?'item':'empty';return result;
  }
  return {
    diagnostics:()=>({...stats,busy}),
    stop() { stopped = true; },
    async tick() {
      if (!live() || busy || d.now() < next) return;
      busy = true; next = d.now() + 3000;
      try {
        const peers = d.peers().filter(p => p.expiresAt > d.now()).slice(0, 10);
        if (!peers.length) return;
        await Promise.all(peers.map(async peer=>{
        const reply = await request(peer, 'poll');
        if (reply?.kind === 'event' && typeof reply.raw === 'string') {
          if (typeof reply?.raw !== 'string' || !active(peer)) return;
          stats.received++;const receipt = await d.receive(reply.raw, peer);
          if (receipt && active(peer)) await request(peer, 'acknowledge', { raw: receipt });
        }
        if (reply?.kind === 'receipt' && typeof reply.raw === 'string') {
          if (typeof reply?.raw !== 'string' || !active(peer)) return;
          stats.receipts++;const receipt: CallControlReceipt = JSON.parse(reply.raw);
          if (receipt.target !== d.account || receipt.targetDevice !== d.device) return;
          const rows = (await d.list()).slice(0, 64);
          const invite = rows.find(row => row.callId === receipt.callId);
          if (!invite || !active(peer)) return;
          const remote = invite.caller === d.account ? invite.callee : invite.caller;
          if (d.blocked(remote)) return;
          const latest = await d.records.read(remote);
          if (!latest || !active(peer) || d.blocked(remote)) return;
          if (await state(invite).recordReceipt(reply.raw, latest, d.now()) && active(peer))
            await request(peer, 'forget', { event: receipt.event, targetDevice: receipt.device });
        }
        const rows = (await d.list()).slice(0, 64);
        const local = await d.records.read(d.account);
        if (!local || !verifyRecord(local, d.now()) || !active(peer)) return;
        // Scan bounded inventory fairly, but send at most one event per tick.
        for (let n = 0; n < Math.min(4,rows.length); n++) {
          const invite = rows[rowCursor++ % rows.length];
          const remote = invite.caller === d.account ? invite.callee : invite.caller;
          if (d.blocked(remote)) continue;
          const record = await d.records.read(remote);
          if (!active(peer)) return;
          if (!record || !verifyRecord(record, d.now()) || d.blocked(remote)) continue;
          const devices = record.devices.filter(device => !d.direct().some(p => p.account === remote && p.device === device.id && p.expiresAt > d.now()));
          for (let i = 0; i < devices.length; i++) {
            const device = devices[(deviceCursor + i) % devices.length];
            if (remote === invite.caller && device.id !== invite.callerDevice) continue;
            const call = state(invite);
            const pending = await call.pendingEvents(local, device.id, d.now());
            if (!pending.length) continue;
            const raw = pending[0];
            // Cancellation/block/lock can race a disk read. Never send the stale invitation.
            if (!active(peer) || d.blocked(remote)) return;
            if (!(await call.pendingEvents(local, device.id, d.now())).includes(raw)) continue;
            if (!active(peer) || d.blocked(remote)) return;
            deviceCursor++;
            const reply=await request(peer, 'put', { raw, targetDevice: device.id });if(reply?.accepted===true)stats.deposits++;
            return;
          }
        }
        }));
      } finally { busy = false; }
    },
  };
}
