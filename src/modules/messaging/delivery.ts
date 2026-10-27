import {deliveryEvidence} from '../../services/identity/deliveryEvidence';
import {messageRetryDeadline} from '../../services/identity/messageRetryDeadline';
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
  depositGroup?(messages:{peer:string;id:string;raw:string}[],selected:{peer:string;id:string;raw:string}):Promise<boolean|undefined>;
  now?():number;
  directTimeoutMs?:number;
  connectedPeers():string[];
  /** Opt in only for immutable, revision-cached runtime snapshots. */
  stableSnapshots?:boolean;
  changed?():void;
}) {
  const resolving=new Set<string>();
  const retries=new Map<string,{peer:string;failures:number;after:number}>();
  const now=d.now??Date.now;
  let connected=new Set<string>();
  let dispatchAfter=0;
  let attempts=0,directTimeouts=0,lastTraffic='none',lastOutcome='none';
  type State=Awaited<ReturnType<ReturnType<typeof createRootChatLedger>['snapshot']>>;
  let pendingDerivations=0,cached:{state:State;owner:string;rows:ReturnType<typeof pendingRootChat>;keys:Set<string>}|undefined;
  let blockedState:State|undefined;
  function updateBlocked(state:State){if(!d.stableSnapshots||blockedState!==state){d.blocked(state.contacts.filter(c=>c.blocked).map(c=>c.account));blockedState=state;}}
  function pendingView(state:State,owner:string){
    if(d.stableSnapshots&&cached?.state===state&&cached.owner===owner)return cached;
    pendingDerivations++;const rows=pendingRootChat(state,owner),view={state,owner,rows,keys:new Set(rows.map(m=>m.peer+':'+m.id))};
    if(d.stableSnapshots)cached=view;return view;
  }
  // Keep unresolved transports bounded even after their caller falls back.
  // Timeout starts fallback; a late authenticated ACK may still settle the same live intent.
  const directFlights=new Map<string,Promise<boolean>>();
  async function sendDirect(peer:string,raw:string,id:string,current:()=>boolean,lateAck:()=>Promise<void>){
    if(directFlights.has(peer)||directFlights.size>=2)return false;
    const flight=Promise.resolve().then(()=>current()?d.send(peer,raw,id):false).catch(()=>false);
    directFlights.set(peer,flight);
    void flight.then(()=>{if(directFlights.get(peer)===flight)directFlights.delete(peer);});
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    void flight.then(async accepted=>{if(accepted&&timedOut&&current())await lateAck();}).catch(()=>{});
    try{return await Promise.race([flight,new Promise<boolean>(resolve=>{timer=setTimeout(()=>{timedOut=true;directTimeouts++;resolve(false);},d.directTimeoutMs??6000);})]);}
    finally{clearTimeout(timer);}
  }
  let selecting = false, collecting = false, cursor = 0, stopped = false, generation = 0;
  // Bound network work while keeping an offline conversation from holding up
  // a connected peer. One attempt per recipient preserves duplicate protection.
  const active=new Map<string,{phase:string;started:number}>();
  const urgent: {peer:string;id:string}[]=[];
  let wakeTimer:ReturnType<typeof setTimeout>|undefined;
  function schedule(progress=false){if(stopped||selecting||active.size>=2||wakeTimer!==undefined||!progress&&!urgent.some(m=>!active.has(m.peer)&&(retries.get(m.peer+':'+m.id)?.after??0)<=now()))return;wakeTimer=setTimeout(()=>{wakeTimer=undefined;void dispatch();},0);}
  async function collect() {
    const owner = d.owner(), epoch = generation;
    if (collecting || !owner || stopped) return;
    collecting = true;
    try {
      const state = await d.ledger().snapshot();
      if (stopped || generation !== epoch || d.owner() !== owner) return;
      updateBlocked(state);
      await d.collect();
    } catch { /* A later tick retries inbox recovery independently of the outbox. */ }
    finally { collecting = false; }
  }
  async function dispatch() {
      const owner = d.owner(), epoch = generation;
      if (selecting || active.size>=2 || !owner || stopped) return;
      if(now()<dispatchAfter)return;
      selecting = true;let ownsSelection=true,peer:string|undefined,retryKey:string|undefined,delivered=false,handedOff=false;
      const attempt={phase:'storage',started:now()};
      const current = () => !stopped && generation === epoch && d.owner() === owner;
      try {
        const ledger = d.ledger(), state = await ledger.snapshot(); if (!current()) return;
        updateBlocked(state);
        const available=new Set(d.connectedPeers());
        for(const [key,retry] of retries)if(available.has(retry.peer)&&!connected.has(retry.peer))retries.delete(key);
        connected=available;
        const {rows:all,keys}=pendingView(state,owner);
        for(const key of retries.keys())if(!keys.has(key))retries.delete(key);
        for(let i=urgent.length-1;i>=0;i--)if(!keys.has(urgent[i].peer+':'+urgent[i].id))urgent.splice(i,1);
        const pending = all.filter(m=>!active.has(m.peer)&&(retries.get(m.peer+':'+m.id)?.after??0)<=now());
        // Retain user priority through temporary disconnection. A failed first
        // attempt must not place their message behind old maintenance traffic.
        const hint=urgent.find(h=>pending.some(m=>m.peer===h.peer&&m.id===h.id));
        const message = (hint?pending.find(m=>m.peer===hint.peer&&m.id===hint.id):null)??(pending.length ? pending[cursor++ % pending.length] : null);
        if (!message) return;
        retryKey=message.peer+':'+message.id;
        peer=message.peer;active.set(peer,attempt);selecting=false;ownsSelection=false;schedule();
        attempts++;lastTraffic=message.raw.startsWith('["axonic-avatar-')?'avatar':'chat';lastOutcome='attempting';
        let direct=false;
        // The route decision is a local session lookup, never a discovery wait.
        if(available.has(message.peer)){
          attempt.phase='send';direct=await sendDirect(message.peer,message.raw,message.id,current,async()=>{
            if(!current())return;const latest=await ledger.snapshot();if(!current())return;
            // Keep the original intent and current policy authoritative after fallback.
            if(latest.contacts.some(c=>c.account===message.peer&&c.blocked)||!pendingView(latest,owner).rows.some(m=>m.peer===message.peer&&m.id===message.id&&m.raw===message.raw))return;
            await ledger.delivered(message.peer,message.id,deliveryEvidence('receipt',now()));
            if(current()){retries.delete(message.peer+':'+message.id);d.changed?.();}
          });
        }
        lastOutcome=direct?'direct-ack':'direct-unavailable';
        if(direct){if(current()){await ledger.delivered(message.peer,message.id,deliveryEvidence('receipt',now()));delivered=true;}}
        else if(current()){
          // Recheck revocation after a failed direct attempt and before custody.
          const latest=await ledger.snapshot();if(!current())return;const latestPending=pendingView(latest,owner).rows;if(!latestPending.some(m=>m.peer===message.peer&&m.id===message.id&&m.raw===message.raw))return;
          attempt.phase='deposit';const group=await d.depositGroup?.(latestPending,message);if(!current())return;const held=group===undefined?await d.deposit(message.peer,message.raw,message.id):group;handedOff=held===true;lastOutcome=handedOff?'custody-held':'custody-attempted';
          if(handedOff)for(let i=urgent.length-1;i>=0;i--)if(urgent[i].peer===message.peer&&urgent[i].id===message.id)urgent.splice(i,1);
          // Missing keys may need discovery for a later retry. It must never
          // delay this handoff or occupy one of the outgoing delivery slots.
          if(held!==true&&current()&&!resolving.has(message.peer)&&resolving.size<2){
            resolving.add(message.peer);
            void Promise.resolve().then(()=>current()?d.resolve(message.peer):undefined).catch(()=>{}).finally(()=>resolving.delete(message.peer));
          }
        }
      } catch(error) { dispatchAfter=now()+5000;lastOutcome=error instanceof Error?'error:'+error.name:'error'; /* Durable outbox remains pending for a later tick/session. */ }
      finally {
        if(retryKey&&peer&&current()){
          if(delivered)retries.delete(retryKey);
          else {const failures=Math.min(4,(retries.get(retryKey)?.failures??0)+1);if(retries.size>=512&&!retries.has(retryKey))retries.delete(retries.keys().next().value!);retries.set(retryKey,{peer,failures,after:now()+(handedOff?60000:Math.min(15000,1000*2**failures))});}
        }
        if(ownsSelection)selecting=false;if(peer&&active.get(peer)===attempt)active.delete(peer);schedule(delivered||handedOff);if(peer)d.changed?.();
      }
  }
  return {
    dispatch,
    nextDeadline(){
      if(stopped||!d.owner()||selecting||active.size>=2)return Infinity;
      if(dispatchAfter>now())return dispatchAfter;
      if(!cached)return now();
      return messageRetryDeadline(cached.rows,now(),0,new Set(active.keys()),(peer,id)=>retries.get(peer+':'+id)?.after);
    },
    topologyChanged(){connected.clear();dispatchAfter=0;},
    snapshot:()=>({phase:selecting?'storage':active.values().next().value?.phase??'idle',busy:selecting||active.size>0,collecting,queuedHints:urgent.length,attempts,pendingDerivations,lastTraffic,lastOutcome,directTimeouts,directInFlight:directFlights.size,oldestAttemptMs:Math.max(0,...[...active.values()].map(a=>now()-a.started))}),
    wake(peer:string,id:string){if(stopped||!d.owner())return;if(!urgent.some(m=>m.peer===peer&&m.id===id)){if(urgent.length>=64)urgent.shift();urgent.push({peer,id});}schedule();},
    // An offline outgoing peer must not monopolize the bounded background wake
    // window. Inbox polling and receipt collection have their own single flight.
    async tick() { await Promise.all([collect(), dispatch()]); },
    invalidate() { generation++;cached=undefined;blockedState=undefined;retries.clear();connected.clear();urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
    stop() { stopped = true; generation++;cached=undefined;blockedState=undefined;retries.clear();connected.clear();urgent.length=0;clearTimeout(wakeTimer);wakeTimer=undefined; },
  };
}
