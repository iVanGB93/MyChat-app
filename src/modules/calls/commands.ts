import type {GroupCallRoom} from '../../services/identity/groupCallRoom';
import type {PeerIdentityResult} from '../../services/identity/peerIdentityResolver';
import {peerIdentityUnavailableMessage} from '../../services/identity/peerIdentityResolver';

type Calls = {prepareExpansion?(id:string,members:string[]):Promise<GroupCallRoom>;start(peer: string, kind: 'voice' | 'video'): Promise<string>;startGroup?(group:{id:string;revision:number;members:string[]},kind:'voice'|'video'):Promise<string>};
/** Permission prompts belong to UI; readiness and account checks belong here. */
export function createCallCommands(d: {
  owner(): string | null;
  calls(): Calls | null;
  connected(): boolean;
  resolve(peer: string): Promise<PeerIdentityResult>;
  wait?(ms:number):Promise<void>;
  readinessTimeoutMs?:number;
  subscribeReady?(listener:()=>void):()=>void;
}) {
  async function ready(permission:()=>Promise<void>){
    const owner=d.owner();if(!owner)throw Error('Unlock your account and try again');
    await permission();if(d.owner()!==owner)throw Error('Account changed');
    if((!d.calls()||!d.connected())&&d.subscribeReady)await new Promise<void>((resolve,reject)=>{
      let off=()=>{},settled=false;
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);off();error?reject(error):resolve();};
      const check=()=>{if(d.owner()!==owner)finish(Error('Account changed'));else if(d.calls()&&d.connected())finish();};
      const timer=setTimeout(()=>finish(),d.readinessTimeoutMs??10000);
      off=d.subscribeReady!(check);if(settled)off();else check();
    });
    else if(!d.subscribeReady){
      const until=Date.now()+(d.readinessTimeoutMs??10000);
      while((!d.calls()||!d.connected())&&Date.now()<until){await(d.wait??(ms=>new Promise(r=>setTimeout(r,ms))))(100);if(d.owner()!==owner)throw Error('Account changed');}
    }
    const calls=d.calls();if(d.owner()!==owner)throw Error('Account changed');
    if(!calls)throw Error('Wait for the network to connect');
    if(!d.connected())throw Error('Connecting to Axonic. Calls need an active axon; try again once the network connects.');
    return {owner,calls};
  }
  async function resolvePeers(members:string[],owner:string,calls:Calls){
    const identities=await Promise.all([...new Set(members)].map(peer=>d.resolve(peer)));
    if(d.owner()!==owner||calls!==d.calls())throw Error('Account changed');
    for(const identity of identities)if(identity.status!=='found')throw Error(peerIdentityUnavailableMessage(identity.status));
  }
  return {
    async prepareExpansion(id:string,members:string[]){
      const {owner,calls}=await ready(async()=>{});
      await resolvePeers(members,owner,calls);
      if(!calls.prepareExpansion)throw Error('Adding people is unavailable');
      return calls.prepareExpansion(id,members);
    },
    async startGroup(group:{id:string;revision:number;members:string[]},kind:'voice'|'video',permission:()=>Promise<void>){
      const {owner,calls}=await ready(permission);
      await resolvePeers(group.members.filter(p=>p!==owner),owner,calls);
      if(!calls.startGroup)throw Error('Group calls unavailable');
      return calls.startGroup(group,kind);
    },
    async start(peer: string, kind: 'voice' | 'video', permission: () => Promise<void>) {
      const {owner,calls}=await ready(permission);
      const identity = await d.resolve(peer);
      if (d.owner() !== owner || calls !== d.calls()) throw Error('Unlock your account and try again');
      if (identity.status !== 'found') throw Error(peerIdentityUnavailableMessage(identity.status));
      return calls.start(peer, kind);
    },
  };
}
