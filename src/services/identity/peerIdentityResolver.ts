import {compareRecord,validAccountId,verifyRecord,type IdentityRecord} from './identityProtocol.ts';
import {pinIdentityRecord,type IdentityRecordStore} from './identityAdmission.ts';
import {validDirectoryPacket} from './identityDirectory.ts';
import type {DirectoryLookupResult} from './identityDirectoryLookup.ts';
export type PeerIdentityResult={status:DirectoryLookupResult['status'];record?:IdentityRecord;source?:'stored'|'directory'};
export function peerIdentityUnavailableMessage(status:PeerIdentityResult['status']){
 if(status==='conflict'||status==='missing-history'||status==='stale'||status==='invalid')return 'The signed identity record needs to be resolved before calling. Check this identity in Network.';
 if(status==='busy')return 'Device-key discovery is busy. Please try again in a moment.';
 if(status==='cancelled')return 'The account or connection changed. Please try again.';
 if(status==='not-found')return 'Their device keys are not available yet. Ask them to open Axonic, then try again.';
 return 'Waiting for the Axonic network to obtain their device keys. Try again once Network shows an active axon.';
}
/** Operational keys, separate from read-only directory inspection. A stored pin is
 * usable until its signed expiry; it is not proof of global freshness or presence.
 * New records require the existing signature, ancestry and atomic pin checks. */
export function createPeerIdentityResolver(d:{records:IdentityRecordStore;lookup(account:string):Promise<DirectoryLookupResult>;current():boolean;now():number;wait?(ms:number):Promise<void>}){
 let stopped=false,generation=0;
 const pending=new Map<string,Promise<PeerIdentityResult>>();
 const retries=new Map<string,{until:number;status:PeerIdentityResult['status']}>();
 return {
  resolve(account:string):Promise<PeerIdentityResult>{
   if(!validAccountId(account))return Promise.resolve({status:'invalid'});
   if(stopped||!d.current())return Promise.resolve({status:'cancelled'});
   const shared=pending.get(account);if(shared)return shared;
   if(pending.size>=8)return Promise.resolve({status:'busy'});
   const epoch=generation,current=()=>!stopped&&generation===epoch&&d.current();
   const unavailable=(status:PeerIdentityResult['status']):PeerIdentityResult=>{
    if(current()&&['not-found','unavailable','busy'].includes(status)){
     for(const [peer,retry] of retries)if(retry.until<=d.now())retries.delete(peer);
     if(retries.has(account)||retries.size<256)retries.set(account,{status,until:d.now()+30000});
    }return {status};
   };
   const task=Promise.resolve().then(async():Promise<PeerIdentityResult>=>{
    try{
     if(!current())return {status:'cancelled'};
     const known=await d.records.read(account);if(!current())return {status:'cancelled'};
     if(known&&(known.account!==account||!verifyRecord(known,d.now(),true)))return {status:'invalid'};
     if(known&&verifyRecord(known,d.now()))return {status:'found',record:known,source:'stored'};
     const retry=retries.get(account);if(retry&&retry.until>d.now())return {status:retry.status};
     let result:DirectoryLookupResult|undefined;
     // Another peer's lookup can occupy the read-only resolver. Wait a bounded
     // number of times rather than reporting that scheduling state as bad keys.
     for(let attempt=0;attempt<9;attempt++){
      if(!current())return {status:'cancelled'};result=await d.lookup(account);
      if(!current())return {status:'cancelled'};if(result.status!=='busy')break;
      if(attempt<8)await (d.wait?.(250)??new Promise<void>(resolve=>setTimeout(resolve,250)));
     }
     if(!result||result.status!=='found')return unavailable(result?.status??'unavailable');
     const packet=result.packet;
     if(!validDirectoryPacket(packet,d.now())||packet.record.account!==account)return {status:'invalid'};
     const anchor=await d.records.read(account);if(!current())return {status:'cancelled'};
     const decision=compareRecord(packet.record,anchor,d.now(),packet.history);
     if(decision!=='accept')return {status:decision};
     if(!await pinIdentityRecord(d.records,anchor,packet.record,packet.history))return unavailable(current()?'unavailable':'cancelled');
     if(!current())return {status:'cancelled'};
     const stored=await d.records.read(account);if(!current())return {status:'cancelled'};
     if(!stored||compareRecord(packet.record,stored,d.now(),packet.history)!=='accept')return {status:'unavailable'};
     return {status:'found',record:stored,source:'directory'};
    }catch{return unavailable(current()?'unavailable':'cancelled');}
   }).finally(()=>{if(pending.get(account)===task)pending.delete(account);});
   pending.set(account,task);return task;
  },
  invalidate(){generation++;retries.clear();},stop(){stopped=true;generation++;retries.clear();},
 };
}
