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
  let busy = false, collecting = false, cursor = 0, stopped = false, generation = 0;
  let phase="idle";
  const urgent: {peer:string;id:string}[]=[];
  let wakeTimer:ReturnType<typeof setTimeout>|undefined;
  function schedule(){if(stopped||busy||wakeTimer!==undefined||!urgent.length)return;wakeTimer=setTimeout(()=>{wakeTimer=undefined;void dispatch();},0);}
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
      if (busy || !owner || stopped) return;
      busy = true;
      const current = () => !stopped && generation === epoch && d.owner() === owner;
      try {
        phase="storage";const ledger = d.ledger(), state = await ledger.snapshot(); if (!current()) return;
        d.blocked(state.contacts.filter(c => c.blocked).map(c => c.account));
        const pending = pendingRootChat(state, owner),hint=urgent.shift();
        const message = (hint?pending.find(m=>m.peer===hint.peer&&m.id===hint.id):null)??(pending.length ? pending[cursor++ % pending.length] : null);
        if (!message) return;
        let direct=false;phase="send";try{direct=await d.send(message.peer, message.raw, message.id);}catch{/* A closed direct connection falls back to custody. */}
        if (direct) {
          if (current()) await ledger.delivered(message.peer, message.id);
        } else if (current()) {
          phase="resolve";await d.resolve(message.peer);
          phase="deposit";if (current()) await d.deposit(message.peer, message.raw, message.id);
        }
      } catch { /* Durable outbox remains pending for a later tick/session. */ }
      finally { busy = false; phase="idle"; schedule(); }
  }
  return {
    snapshot:()=>({phase,busy,collecting}),
    wake(peer:string,id:string){if(stopped||!d.owner())return;if(!urgent.some(m=>m.peer===peer&&m.id===id)){if(urgent.length>=64)urgent.shift();urgent.push({peer,id});}schedule();},
    // An offline outgoing peer must not monopolize the bounded background wake
    // window. Inbox polling and receipt collection have their own single flight.
    async tick() { await Promise.all([collect(), dispatch()]); },
    invalidate() { generation++;urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
    stop() { stopped = true; generation++;urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
  };
}
