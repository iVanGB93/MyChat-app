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
  eventDriven?(peer:string):boolean;
  account: string; device: string; store: CallJournalStore; records: Pick<IdentityRecordStore, 'read'>;
  current(): boolean; now(): number; blocked(account: string): boolean;
  peers(): IdentityPeer[]; direct(): IdentityPeer[]; list(): Promise<CallControl[]>;
  request(peer: IdentityPeer, raw: string): Promise<string | null>;
  receive(raw: string, courier: IdentityPeer): Promise<string | null>;
}) {
  let stopped = false, busy = false, next = 0, rowCursor = 0, deviceCursor = 0;
  const stats={requests:0,deposits:0,received:0,receipts:0,inventoryReads:0,emptyPolls:0,last:'idle',reply:'none'};
  const urgent=new Set<string>();
  const idle=new Set<string>();let revision=0,hasPending=true;
  // Positive empty-outbox observations, scoped to this relay session and revision.
  const emptyRows=new Set<string>();
  const peerKey=(p:IdentityPeer)=>p.account+":"+p.device+":"+p.instance;
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
  async function flushPending(invite:CallControl,terminalOnly=false) {
      const key=invite.callId+':'+(terminalOnly?'terminal':'pending');
      if(!live()||urgent.has(key)||urgent.size>=2)return;
      urgent.add(key);
      try{
        const remote=invite.caller===d.account?invite.callee:invite.caller;
        if(d.blocked(remote))return;
        const [local,record]=await Promise.all([d.records.read(d.account),d.records.read(remote)]);
        if(!local||!record||!verifyRecord(local,d.now())||!verifyRecord(record,d.now())||!live()||d.blocked(remote))return;
        const call=state(invite),snapshot=await call.snapshot(d.now());
        const targets=record.devices.filter(device=>remote===invite.caller?device.id===invite.callerDevice:
          snapshot?.confirmed?device.id===snapshot.selectedDevice:true).slice(0,16);
        // Bypass the normal poll/cooldown, but send only signed, durably saved events.
        await Promise.all(d.peers().filter(p=>p.expiresAt>d.now()).slice(0,10).map(async peer=>{
          for(const device of targets){
            if(!active(peer)||d.blocked(remote))return;
            const pending=await call.pendingEvents(local,device.id,d.now());
            const raw=terminalOnly?pending.find(raw=>['end','cancel','reject','busy'].includes(JSON.parse(raw).kind)):pending[0];
            if(!raw||!active(peer)||d.blocked(remote))continue;
            if(!(await call.pendingEvents(local,device.id,d.now())).includes(raw))continue;
            if(!active(peer)||d.blocked(remote))return;
            const reply=await request(peer,'put',{raw,targetDevice:device.id});
            if(reply?.accepted===true)stats.deposits++;
          }
        }));
      }finally{urgent.delete(key);}
    }
  return {
    diagnostics:()=>({...stats,busy}),
    stop() { stopped = true; },
    flushPending,
    flushTerminal:(invite:CallControl)=>flushPending(invite,true),
    changed(){revision++;idle.clear();emptyRows.clear();next=0;hasPending=true;},
    nextDeadline:()=>!live()||!d.peers().some(p=>p.expiresAt>d.now()&&(hasPending||!d.eventDriven?.(p.account)||!idle.has(peerKey(p))))?Infinity:next,
    async tick() {
      if (!live() || busy || d.now() < next) return;
      busy = true; next = d.now() + 3000;const passRevision=revision;
      try {
        const peers = d.peers().filter(p => p.expiresAt > d.now()).slice(0, 10);
        if (!peers.length) return;
        // Share this pass's read, not mutable call state or verified receipts.
        // Keep polling at 3s: it remains the fallback for incoming calls.
        let inventory:Promise<CallControl[]>|undefined;
        const rowsForPass=()=>inventory??=(stats.inventoryReads++,d.list().then(rows=>rows.slice(0,64)));
        await Promise.all(peers.map(async peer=>{
        const reply = d.eventDriven?.(peer.account)&&idle.has(peerKey(peer))?null:await request(peer, 'poll');
        if(reply?.kind==='event'&&reply.raw===null){stats.emptyPolls++;if(passRevision===revision&&d.eventDriven?.(peer.account)){if(idle.size>=20)idle.clear();idle.add(peerKey(peer));}}
        if (reply?.kind === 'event' && typeof reply.raw === 'string') {
          if (typeof reply?.raw !== 'string' || !active(peer)) return;
          stats.received++;const receipt = await d.receive(reply.raw, peer);
          if(receipt){inventory=undefined;emptyRows.clear();} // Newly admitted events invalidate observations.
          if (receipt && active(peer)) await request(peer, 'acknowledge', { raw: receipt });
        }
        if (reply?.kind === 'receipt' && typeof reply.raw === 'string') {
          if (typeof reply?.raw !== 'string' || !active(peer)) return;
          stats.receipts++;const receipt: CallControlReceipt = JSON.parse(reply.raw);
          if (receipt.target !== d.account || receipt.targetDevice !== d.device) return;
          const rows = await rowsForPass();
          const invite = rows.find(row => row.callId === receipt.callId);
          if (!invite || !active(peer)) return;
          const remote = invite.caller === d.account ? invite.callee : invite.caller;
          if (d.blocked(remote)) return;
          const latest = await d.records.read(remote);
          if (!latest || !active(peer) || d.blocked(remote)) return;
          if (await state(invite).recordReceipt(reply.raw, latest, d.now()) && active(peer))
            await request(peer, 'forget', { event: receipt.event, targetDevice: receipt.device });
        }
        const rows = (await rowsForPass()).filter(row=>!emptyRows.has(peerKey(peer)+':'+row.callId));
        if(!rows.length)return;
        const local = await d.records.read(d.account);
        if (!local || !verifyRecord(local, d.now()) || !active(peer)) return;
        // Scan bounded inventory fairly, but send at most one event per tick.
        for (let n = 0; n < Math.min(4,rows.length); n++) {
          const invite = rows[rowCursor++ % rows.length];
          const remote = invite.caller === d.account ? invite.callee : invite.caller;
          if (d.blocked(remote)) {if(passRevision===revision)emptyRows.add(peerKey(peer)+':'+invite.callId);continue;}
          const record = await d.records.read(remote);
          if (!active(peer)) return;
          if (!record || !verifyRecord(record, d.now()) || d.blocked(remote)) continue;
          const devices = record.devices.filter(device => !d.direct().some(p => p.account === remote && p.device === device.id && p.expiresAt > d.now()));
          let confirmedEmpty=true;
          for (let i = 0; i < devices.length; i++) {
            const device = devices[(deviceCursor + i) % devices.length];
            if (remote === invite.caller && device.id !== invite.callerDevice) continue;
            const call = state(invite);
            const pending = await call.pendingEvents(local, device.id, d.now());
            if (!pending.length) continue;
            confirmedEmpty=false;
            const raw = pending[0];
            // Cancellation/block/lock can race a disk read. Never send the stale invitation.
            if (!active(peer) || d.blocked(remote)) return;
            if (!(await call.pendingEvents(local, device.id, d.now())).includes(raw)) continue;
            if (!active(peer) || d.blocked(remote)) return;
            deviceCursor++;
            const reply=await request(peer, 'put', { raw, targetDevice: device.id });if(reply?.accepted===true)stats.deposits++;
            return;
          }
          if(confirmedEmpty&&passRevision===revision&&active(peer)){if(emptyRows.size>=640)emptyRows.clear();emptyRows.add(peerKey(peer)+':'+invite.callId);}
        }
        }));
        if(passRevision===revision){const rows=await rowsForPass();if(passRevision===revision)
          hasPending=peers.some(peer=>rows.some(row=>!emptyRows.has(peerKey(peer)+':'+row.callId)));}
      } catch(error){hasPending=true;throw error;}finally { busy = false; }
    },
  };
}
