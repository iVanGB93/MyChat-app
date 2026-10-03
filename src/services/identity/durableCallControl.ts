import { callControlDigest, createCallerCallControl, createRecipientCallControl, verifyCallControl } from './callControlProtocol.ts';
import type { IdentityRecord } from './identityProtocol.ts';
import { verifyCallControlReceipt } from './callControlDelivery.ts';

export interface CallJournal { version: 1; owner: string; callId: string; recipientDevice?: string; observedAt: number; entries: Array<{ raw: string; at: number }>; receipts?: Array<{ raw: string; at: number }> }
/** Implementations must atomically compare and replace, and throw on corrupt/unavailable storage.
 * Call journals contain only this owner's calls. Do not delete active replay state on logout. */
export interface CallJournalStore {
  read(owner: string, callId: string): Promise<string | null>;
  compareAndSet(owner: string, callId: string, before: string | null, after: string): Promise<boolean>;
}
function restore(raw: string, owner: string, callId: string, recipientDevice?: string) {
  if (raw.length > 800000) throw Error('Oversized call journal');
  const journal: CallJournal = JSON.parse(raw);
  if (journal.version !== 1 || journal.owner !== owner || journal.callId !== callId || journal.recipientDevice !== recipientDevice
    || !Array.isArray(journal.entries) || !journal.entries.length || journal.entries.length > 128) throw Error('Invalid call journal');
  let state: ReturnType<typeof createCallerCallControl> | ReturnType<typeof createRecipientCallControl> | undefined;
  let previous = 0;
  for (const entry of journal.entries) {
    if (!entry || typeof entry.raw !== 'string' || entry.raw.length > 6000
      || !Number.isSafeInteger(entry.at) || entry.at < previous) throw Error('Invalid call journal entry');
    previous = entry.at;
    const event = JSON.parse(entry.raw);
    // Historical signatures are checked at their original admission time, not granted fresh admission.
    if (!state) {
      if ((recipientDevice ? event.callee : event.caller) !== owner || event.callId !== callId) throw Error('Invalid call journal owner');
      if (recipientDevice && event.kind === 'cancel') {
        if (journal.entries.length !== 1 || !verifyCallControl(entry.raw, event.record, entry.at)) throw Error('Invalid cancellation tombstone');
        state = { snapshot: () => ({ status: 'cancelled' as const, selectedDevice: null, invitation: event.invitation,
          acceptance: null, confirmed: false }), receive: () => false };
        continue;
      }
      state = recipientDevice ? createRecipientCallControl(entry.raw, event.record, recipientDevice, entry.at)
        : createCallerCallControl(entry.raw, event.record, entry.at);
    } else if (!state.receive(entry.raw, event.record, entry.at)) throw Error('Invalid call journal transition');
  }
  if (!Number.isSafeInteger(journal.observedAt) || journal.observedAt < previous) throw Error('Invalid call journal clock');
  if (journal.receipts !== undefined && (!Array.isArray(journal.receipts) || journal.receipts.length > 128)) throw Error('Invalid call receipts');
  const receiptKeys = new Set<string>();
  for (const receipt of journal.receipts ?? []) {
    if (typeof receipt.raw !== 'string' || receipt.raw.length > 6000 || !Number.isSafeInteger(receipt.at)
      || receipt.at > journal.observedAt) throw Error('Invalid stored receipt');
    const decoded = JSON.parse(receipt.raw);
    const event = journal.entries.map(e => JSON.parse(e.raw)).find(e => callControlDigest(e) === decoded.event);
    if (!event || event.record.account !== owner || !verifyCallControlReceipt(receipt.raw, event, decoded.record, receipt.at)) throw Error('Invalid stored receipt');
    const key = decoded.event + ':' + decoded.device;
    if (receiptKeys.has(key)) throw Error('Duplicate stored receipt');
    receiptKeys.add(key);
  }
  state!.snapshot(journal.observedAt);
  return { journal, state: state! };
}

/** No successful result (or outgoing selected event) may be exposed before durable CAS succeeds. */
export function createDurableCallerCallControl(store: CallJournalStore, owner: string, callId: string, clock?: () => number) {
  return createDurableCallControl(store, owner, callId, undefined, clock);
}
export function createDurableRecipientCallControl(store: CallJournalStore, owner: string, callId: string, device: string, clock?: () => number) {
  if (!/^[0-9a-f]{64}$/.test(device)) throw Error('Invalid recipient device');
  return createDurableCallControl(store, owner, callId, device, clock);
}
function createDurableCallControl(store: CallJournalStore, owner: string, callId: string, recipientDevice?: string, clock?: () => number) {
  return {
    async cancelUnknown(raw: string, latest: IdentityRecord, now: number) {
      const e = verifyCallControl(raw, latest, now);
      if (!recipientDevice || !e || e.kind !== 'cancel' || e.callee !== owner || e.callId !== callId) return false;
      return store.compareAndSet(owner, callId, null, JSON.stringify({version:1, owner, callId, recipientDevice,
        observedAt:now, entries:[{raw,at:now}]} satisfies CallJournal));
    },
    async recordReceipt(raw: string, latest: IdentityRecord, now: number) {
      if (typeof raw !== 'string' || raw.length > 6000) return false;
      for (let attempt=0; attempt<8; attempt++) {
        const before=await store.read(owner,callId); if (!before) return false;
        const {journal}=restore(before,owner,callId,recipientDevice);
        now = clock?.() ?? now;
        if (now < journal.observedAt) return false;
        let decoded; try { decoded=JSON.parse(raw); } catch { return false; }
        const event=journal.entries.map(e=>JSON.parse(e.raw)).find(e=>callControlDigest(e)===decoded?.event);
        if (!event || event.record.account!==owner || !verifyCallControlReceipt(raw,event,latest,now)) return false;
        const receipts=journal.receipts ??= [];
        if (receipts.some(r=>{ const old=JSON.parse(r.raw); return old.event===decoded.event && old.device===decoded.device; })) return true;
        if (receipts.length>=128) return false;
        receipts.push({raw,at:now}); journal.observedAt=now;
        if (JSON.stringify(journal).length>780000) return false;
        if (await store.compareAndSet(owner,callId,before,JSON.stringify(journal))) return true;
      }
      return false;
    },
    /** Per-device delivery, in journal order. Terminal state suppresses obsolete invitations/answers. */
    async pendingEvents(latest: IdentityRecord, targetDevice: string, now: number): Promise<string[]> {
      const before=await store.read(owner,callId); if (!before) return [];
      const {journal,state}=restore(before,owner,callId,recipientDevice);
        now = clock?.() ?? now;
      if (!Number.isSafeInteger(now) || now<journal.observedAt) return [];
      const terminal=['cancelled','ended','expired','rejected','answered-elsewhere'].includes(state.snapshot(now).status);
      return journal.entries.filter(entry=>{
        const e=verifyCallControl(entry.raw,latest,now);
        if (!e || e.record.account!==owner || (terminal && !['cancel','end','reject','busy'].includes(e.kind))) return false;
        if (e.kind==='selected' && e.selectedDevice!==targetDevice) return false;
        return !(journal.receipts??[]).some(r=>{const ack=JSON.parse(r.raw);return ack.event===callControlDigest(e)&&ack.device===targetDevice;});
      }).map(e=>e.raw);
    },
    /** Only exact previously admitted events are eligible for duplicate delivery receipts. */
    async hasStoredEvent(raw: string, latest: IdentityRecord, now: number) {
      const event = verifyCallControl(raw, latest, now);
      if (!event) return false;
      const saved = await store.read(owner, callId);
      if (saved === null) return false;
      const { journal } = restore(saved, owner, callId, recipientDevice);
        now = clock?.() ?? now;
      if (now < journal.observedAt) return false;
      return journal.entries.some(entry => callControlDigest(JSON.parse(entry.raw)) === callControlDigest(event));
    },
    async begin(raw: string, pinned: IdentityRecord, now: number) {
      const event = verifyCallControl(raw, pinned, now);
      if (!event || event.kind !== 'invite' || (recipientDevice ? event.callee : event.caller) !== owner || event.callId !== callId) return false;
      const value = JSON.stringify({ version: 1, owner, callId, ...(recipientDevice ? { recipientDevice } : {}), observedAt: now, entries: [{ raw, at: now }] } satisfies CallJournal);
      return store.compareAndSet(owner, callId, null, value);
    },
    async receive(raw: string, latest: IdentityRecord, now: number) {
      const event = verifyCallControl(raw, latest, now);
      if (!event) return false;
      // Each caller races through the store's CAS; losers re-evaluate the winner's durable state.
      for (let attempt = 0; attempt < 8; attempt++) {
        const before = await store.read(owner, callId);
        if (before === null) return false;
        const { journal, state } = restore(before, owner, callId, recipientDevice);
        now = clock?.() ?? now;
        if (now < journal.observedAt || journal.entries.length >= 128) return false;
        if (journal.entries.length >= 126 && !['end', 'cancel'].includes(event.kind)) return false;
        if (!state.receive(raw, latest, now)) return false;
        journal.entries.push({ raw, at: now });
        journal.observedAt = now;
        if (JSON.stringify(journal).length>(['end','cancel'].includes(event.kind)?800000:780000)) return false;
        if (await store.compareAndSet(owner, callId, before, JSON.stringify(journal))) return true;
      }
      return false;
    },
    async snapshot(now: number) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const raw = await store.read(owner, callId);
        if (raw === null) return null;
        const { journal, state } = restore(raw, owner, callId, recipientDevice);
        now = clock?.() ?? now;
        if (!Number.isSafeInteger(now) || now < journal.observedAt) throw Error('Invalid call clock');
        journal.observedAt = now;
        if (await store.compareAndSet(owner, callId, raw, JSON.stringify(journal))) return state.snapshot(now);
      }
      throw Error('Call state changed concurrently');
    },
    /** An expired/empty outbox is not evidence that the recipient confirmed selection. */
    async selectionAcknowledged(device: string, now: number): Promise<boolean> {
      if (recipientDevice) return false;
      const raw = await store.read(owner, callId);if(raw===null)return false;
      const {journal,state}=restore(raw,owner,callId);
        now = clock?.() ?? now;
      if(!Number.isSafeInteger(now)||now<journal.observedAt)return false;
      const snapshot=state.snapshot(now);
      if(snapshot.status!=='accepted'||!snapshot.confirmed||snapshot.selectedDevice!==device)return false;
      const selection=journal.entries.map(entry=>JSON.parse(entry.raw)).find(event=>event.kind==='selected');
      return !!selection&&(journal.receipts??[]).some(entry=>{
        const ack=JSON.parse(entry.raw);return ack.event===callControlDigest(selection)&&ack.device===device;
      });
    },
    /** Single-slot durable outbox, derived from the saved selection. Replays exact bytes only.
     * The transport must serialize draining with local mutations and stop on session teardown.
     * Returning a packet is not an acknowledgment; an in-flight packet may race cancellation. */
    async pendingSelection(latestCaller: IdentityRecord, now: number): Promise<string | null> {
      if (recipientDevice) return null;
      await createDurableCallerCallControl(store, owner, callId, clock).snapshot(now);
      const raw = await store.read(owner, callId);
      if (raw === null) return null;
      const { journal, state } = restore(raw, owner, callId);
        now = clock?.() ?? now;
      if (!Number.isSafeInteger(now) || now < journal.observedAt) return null;
      const snapshot = state.snapshot(now);
      if (snapshot.status !== 'accepted' || !snapshot.confirmed) return null;
      const selection = journal.entries.find(entry => JSON.parse(entry.raw).kind === 'selected')?.raw;
      if (selection && (journal.receipts ?? []).some(r => {
        const ack=JSON.parse(r.raw), event=JSON.parse(selection);
        return ack.event===callControlDigest(event) && ack.device===event.selectedDevice;
      })) return null;
      return selection && verifyCallControl(selection, latestCaller, now) ? selection : null;
    },
  };
}

/** Retire only fully verified terminal state after every signed delivery window closes.
 * Archive storage must retain the call ID to prevent resurrection by a fresh invitation. */
export function canArchiveCallJournal(raw:string,now:number):boolean {
  try {
    if(!Number.isSafeInteger(now)||now<0||raw.length>800000)return false;
    const key=JSON.parse(raw),{journal,state}=restore(raw,key.owner,key.callId,key.recipientDevice);
    return now>=journal.observedAt
      &&['cancelled','ended','expired','rejected','answered-elsewhere'].includes(state.snapshot(now).status)
      &&journal.entries.every(e=>JSON.parse(e.raw).expiresAt<=now)
      &&(journal.receipts??[]).every(e=>JSON.parse(e.raw).expiresAt<=now);
  }catch{return false;}
}
