import {profileAudience} from './rootProfileSharing.ts';
import {profileOfferId} from './rootProfileProtocol.ts';
import type {RootChatState} from './rootChatTypes.ts';
/** Connection/profile/policy events only. Timers exist solely for bounded failed
 * announcements; unchanged connected peers generate no periodic avatar work. */
export function createProfileRecovery(d:{owner():string|null;state():Promise<RootChatState>;peers():string[];offerPeers():string[];
 remember(peers:string[],offers:string[]):Promise<void>;send(peer:string,raw:string,id:string):Promise<boolean>;
 request(peer:string,id:string,known:string|null):Promise<void>;known(peer:string):Promise<string|null>;
 interactionAllowed?(state:RootChatState,peer:string):boolean}){
 let stopped=false,busy=false,dirty=false,epoch=0,readFailures=0,timer:ReturnType<typeof setTimeout>|undefined;
 const sent=new Map<string,string>(),failures=new Map<string,number>();
 function schedule(delay=0){if(stopped||timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;void run();},delay);}
 async function run(){if(stopped||busy)return;busy=true;dirty=false;let retry=false;
  const owner=d.owner(),generation=epoch,current=()=>!stopped&&generation===epoch&&d.owner()===owner&&!!owner;
  try{if(!owner)return;const peers=d.peers(),offers=d.offerPeers();let s=await d.state();if(!current())return;
   // Reconnect/profile events often repeat capabilities already on disk. Reuse
   // the revision-scoped read view instead of queueing another ledger mutation.
   if(peers.some(p=>!s.profilePeers?.includes(p))||offers.some(p=>!s.profileOfferPeers?.includes(p))){
    await d.remember(peers,offers);if(!current())return;s=await d.state();if(!current())return;
   }
   const allowed=new Set(profileAudience(s,owner).filter(peer=>d.interactionAllowed?.(s,peer)!==false));readFailures=0;
   for(const p of sent.keys())if(!peers.includes(p)||!allowed.has(p))sent.delete(p);
   for(const peer of peers){if(!current())return;if(!allowed.has(peer))continue;
    const modern=offers.includes(peer),manifest=s.ownProfile?.manifest??null;
    const id=profileOfferId(owner,peer,modern?manifest:null),key=(modern?'offer:':'legacy:')+id;
    if(sent.get(peer)===key)continue;
    if((failures.get(peer)??0)>=3)continue;
    try{
    // A policy change while waiting for another send cannot leak an avatar.
    const latest=await d.state();
    if(!profileAudience(latest,owner).includes(peer)||d.interactionAllowed?.(latest,peer)===false||!current()||!d.peers().includes(peer))continue;
    if(modern){const ok=await d.send(peer,JSON.stringify(['axonic-avatar-offer-v1',peer,id,manifest]),id);if(!current())return;
     if(!ok){failures.set(peer,(failures.get(peer)??0)+1);retry=true;continue;}
    }else{const known=await d.known(peer);if(!current())return;await d.request(peer,id,known);}
    sent.set(peer,key);failures.delete(peer);
    }catch{failures.set(peer,(failures.get(peer)??0)+1);retry=true;}
   }
  }catch{readFailures++;retry=true;}finally{busy=false;if(stopped)return;if(dirty)schedule();else if(retry&&(readFailures>0&&readFailures<3||[...failures.values()].some(n=>n<3)))schedule(2000);}
 }
 return {
  changed(){if(stopped)return;dirty=true;readFailures=0;failures.clear();schedule();},
  connected(peer:string){sent.delete(peer);failures.delete(peer);dirty=true;schedule();},
  invalidate(){epoch++;sent.clear();failures.clear();clearTimeout(timer);timer=undefined;dirty=true;},
  stop(){stopped=true;epoch++;clearTimeout(timer);timer=undefined;sent.clear();failures.clear();},
 };
}
