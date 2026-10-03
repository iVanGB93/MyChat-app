import { createCallControlDelivery, type CallControlReceipt } from './callControlDelivery.ts';
import { callControlDigest, verifyCallControl, type CallControl } from './callControlProtocol.ts';
import { createDurableCallerCallControl, createDurableRecipientCallControl, type CallJournalStore } from './durableCallControl.ts';
import type { IdentityRecordStore } from './identityAdmission.ts';
import type { IdentityPeer } from './identityClient.ts';
import type { IdentityRecord } from './identityProtocol.ts';

/** One unlocked device's direct-call runtime. Never creates a Django fallback call. */
export function createCallControlRuntime(d: {
  account: string; device: string; store: CallJournalStore; records: Pick<IdentityRecordStore,'read'>;
  now(): number; current(): boolean; blocked(account: string): boolean;
  courierBlocked?(account: string): boolean;
  signReceipt(event: CallControl, now: number): Promise<string>;
  send(account: string, device: string, raw: string): Promise<string | null>;
}) {
  let stopped=false;
  const current=()=>!stopped&&d.current();
  const state=(e:CallControl)=> e.caller===d.account
    ? createDurableCallerCallControl(d.store,d.account,e.callId,d.now)
    : createDurableRecipientCallControl(d.store,d.account,e.callId,d.device,d.now);
  const commit=async(raw:string,latest:IdentityRecord,time:number)=>{
    const e=verifyCallControl(raw,latest,time); if(!e||!current()) return false;
    const call=state(e);
    const saved=e.kind==='invite'?await call.begin(raw,latest,time):await call.receive(raw,latest,time);
    return saved || (e.kind==='cancel' && await call.cancelUnknown(raw,latest,time)) || await call.hasStoredEvent(raw,latest,time);
  };
  const delivery=createCallControlDelivery({...d,current,commit});
  const inflight=new Set<string>();
  return {
    stop(){stopped=true;},
    receive:delivery.receive,
    receiveRelayed:delivery.receiveRelayed,
    async submit(raw:string):Promise<boolean>{
      if(!current())return false;
      const local=await d.records.read(d.account);
      if(!local||!current())return false;
      const e=verifyCallControl(raw,local,d.now());
      if(!e||e.record.account!==d.account||e.device!==d.device)return false;
      // Blocking stops delivery, but must not prevent our own durable hangup/rejection.
      if(d.blocked(e.caller===d.account?e.callee:e.caller)&&!['end','cancel','reject','busy'].includes(e.kind))return false;
      const saved=await commit(raw,local,d.now());
      return saved&&current();
    },
    /** Called when a direct authenticated axon is available. Reopening uses the original invite
     * only to identify the journal; it does not admit that invite again or extend its expiry. */
    async drain(invitation:CallControl,peer:IdentityPeer):Promise<number>{
      const remote=invitation.caller===d.account?invitation.callee:invitation.caller;
      const key=invitation.callId;
      const allowed=()=>current()&&!d.blocked(remote)&&peer.account===remote&&peer.expiresAt>d.now();
      if(!allowed()||inflight.has(key)||inflight.size>=2)return 0;
      inflight.add(key);let acknowledged=0;
      try {
        const call=state(invitation);
        // At most one event per bounded journal entry; never keep retrying within this drain.
        for(let n=0;n<128&&allowed();n++){
          const local=await d.records.read(d.account); if(!local||!allowed())break;
          await call.snapshot(d.now());
          const pending=await call.pendingEvents(local,peer.device,d.now());
          if(!pending.length||!allowed())break;
          const raw=pending[0];
          // Re-read immediately before send to suppress events cancelled during asynchronous lookup.
          if(!(await call.pendingEvents(local,peer.device,d.now())).includes(raw)||!allowed())break;
          const receipt=await d.send(remote,peer.device,raw);
          if(!receipt||!allowed())break;
          const latest=await d.records.read(remote); if(!latest||!allowed())break;
          let parsed:CallControlReceipt;try{parsed=JSON.parse(receipt);}catch{break;}
          if(parsed.device!==peer.device||parsed.event!==callControlDigest(JSON.parse(raw))
            ||!await call.recordReceipt(receipt,latest,d.now()))break;
          acknowledged++;
        }
        return acknowledged;
      } finally {inflight.delete(key);}
    },
  };
}
