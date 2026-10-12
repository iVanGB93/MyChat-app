import {pendingRootChat} from '../../services/identity/rootChatLedger';
import type {createRootChatLedger} from '../../services/identity/rootChatLedger';

/** A transport-independent outbox pump: acknowledgement, not a send attempt, marks delivery. */
export function createMessageDelivery(d: {
  owner(): string | null;
  ledger(): ReturnType<typeof createRootChatLedger>;
  blocked(peers: string[]): void;
  collect(): Promise<unknown>;
  send(peer: string, raw: string, id: string): Promise<boolean>;
  resolve(peer: string): Promise<unknown>;
  deposit(peer: string, raw: string, id: string): Promise<unknown>;
}) {
  let attempts=0,lastTraffic='none',lastOutcome='none';
  let selecting = false, collecting = false, cursor = 0, stopped = false, generation = 0;
  // Bound network work while keeping an offline conversation from holding up
  // a connected peer. One attempt per recipient preserves duplicate protection.
  const active=new Map<string,{phase:string}>();
  const urgent: {peer:string;id:string}[]=[];
  let wakeTimer:ReturnType<typeof setTimeout>|undefined;
  function schedule(){if(stopped||selecting||active.size>=2||wakeTimer!==undefined||!urgent.some(m=>!active.has(m.peer)))return;wakeTimer=setTimeout(()=>{wakeTimer=undefined;void dispatch();},0);}
  async function collect() {
    const owner = d.owner(), epoch = generation;
    if (collecting || !owner || stopped) return;
    collecting = true;
    try {
      const state = await d.ledger().snapshot();
      if (stopped || generation !== epoch || d.owner() !== owner) return;
      d.blocked(state.contacts.filter(c => c.blocked).map(c => c.account));
      await d.collect();
    } catch { /* A later tick retries inbox recovery independently of the outbox. */ }
    finally { collecting = false; }
  }
  async function dispatch() {
      const owner = d.owner(), epoch = generation;
      if (selecting || active.size>=2 || !owner || stopped) return;
      selecting = true;let ownsSelection=true,peer:string|undefined;
      const attempt={phase:'storage'};
      const current = () => !stopped && generation === epoch && d.owner() === owner;
      try {
        const ledger = d.ledger(), state = await ledger.snapshot(); if (!current()) return;
        d.blocked(state.contacts.filter(c => c.blocked).map(c => c.account));
        const pending = pendingRootChat(state, owner).filter(m=>!active.has(m.peer)),hintIndex=urgent.findIndex(m=>!active.has(m.peer));
        const hint=hintIndex<0?undefined:urgent.splice(hintIndex,1)[0];
        const message = (hint?pending.find(m=>m.peer===hint.peer&&m.id===hint.id):null)??(pending.length ? pending[cursor++ % pending.length] : null);
        if (!message) return;
        peer=message.peer;active.set(peer,attempt);selecting=false;ownsSelection=false;schedule();
        attempts++;lastTraffic=message.raw.startsWith('["axonic-avatar-')?'avatar':'chat';lastOutcome='attempting';let direct=false;attempt.phase="send";try{direct=await d.send(message.peer, message.raw, message.id);}catch{/* A closed direct connection falls back to custody. */}
        lastOutcome=direct?'direct-ack':'direct-unavailable';
        if (direct) {
          if (current()) await ledger.delivered(message.peer, message.id);
        } else if (current()) {
          attempt.phase="resolve";try{await d.resolve(message.peer);}catch{/* Existing verified keys may still allow custody delivery. */}
          if(!current())return;
          // Discovery can establish a direct axon. Recheck cancellation/blocking
          // before retrying the same durable ID or giving it to a custodian.
          const latest=await ledger.snapshot();if(!current()||!pendingRootChat(latest,owner).some(m=>m.peer===message.peer&&m.id===message.id&&m.raw===message.raw))return;
          attempt.phase="send";try{direct=await d.send(message.peer,message.raw,message.id);}catch{/* Preserve encrypted fallback. */}
          if(!current())return;
          if(direct)await ledger.delivered(message.peer,message.id);
          else {attempt.phase="deposit";await d.deposit(message.peer,message.raw,message.id);lastOutcome='custody-attempted';}
        }
      } catch(error) { lastOutcome=error instanceof Error?'error:'+error.name:'error'; /* Durable outbox remains pending for a later tick/session. */ }
      finally { if(ownsSelection)selecting=false;if(peer&&active.get(peer)===attempt)active.delete(peer);schedule(); }
  }
  return {
    snapshot:()=>({phase:selecting?'storage':active.values().next().value?.phase??'idle',busy:selecting||active.size>0,collecting,queuedHints:urgent.length,attempts,lastTraffic,lastOutcome}),
    wake(peer:string,id:string){if(stopped||!d.owner())return;if(!urgent.some(m=>m.peer===peer&&m.id===id)){if(urgent.length>=64)urgent.shift();urgent.push({peer,id});}schedule();},
    // An offline outgoing peer must not monopolize the bounded background wake
    // window. Inbox polling and receipt collection have their own single flight.
    async tick() { await Promise.all([collect(), dispatch()]); },
    invalidate() { generation++;urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
    stop() { stopped = true; generation++;urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
  };
}
