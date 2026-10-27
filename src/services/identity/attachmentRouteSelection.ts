import {validAccountId} from './identityProtocol.ts';
import {attachmentBlockBytes} from './attachmentProtocol.ts';
import type {AttachmentJob} from './attachmentTypes.ts';
import type {AttachmentRequests} from './attachmentConnections.ts';

/** Ephemeral observations, never durable job state or permission to send. */
export interface AttachmentRouteSnapshot {
 peers:readonly string[];blocks:readonly string[];shared:readonly string[];
 bulk:readonly string[];uploads:readonly string[];bulkRequest:boolean;directStream:boolean;
}
/** Read current capabilities at a decision boundary, not once at worker startup. */
export function attachmentRouteSnapshot(connections:AttachmentRequests,directStream:boolean):AttachmentRouteSnapshot {
 return {peers:[...connections.peers()],blocks:[...(connections.blockStreamPeers?.()??[])],
  shared:[...(connections.sharedPeers?.()??[])],bulk:[...(connections.bulkPeers?.()??[])],
  uploads:[...(connections.uploadBatchPeers?.()??[])],bulkRequest:!!connections.bulkRequest,directStream};
}
export function attachmentStreamEligible(job:AttachmentJob,source:string,directStream:boolean,now:number,retryAt:number){
 return job.direction==='incoming'&&source===job.descriptor.manifest.sender&&directStream
  &&job.cursor<Math.ceil(job.descriptor.manifest.bytes/attachmentBlockBytes(job.descriptor.manifest))&&retryAt<=now;
}
/** Rank without changing jobs, deadlines, observations, or connection lifetime.
 * Failed sources lose priority even after their cooldown expires. Actual senders
 * may stream without relay capabilities; custodians never receive that exception. */
export function attachmentRouteCandidates(job:AttachmentJob,snapshot:AttachmentRouteSnapshot,now:number,
 unavailable:ReadonlyMap<string,number>,streamRetryAt:number):string[]{
 const manifest=job.descriptor.manifest,peer=job.direction==='outgoing'?manifest.recipient:manifest.sender;
 return snapshot.peers.filter(p=>(attachmentStreamEligible(job,p,snapshot.directStream,now,streamRetryAt)
  ||snapshot.blocks.includes(p)&&(!manifest.shared||snapshot.shared.includes(p)))
  &&validAccountId(p)&&p!==job.owner&&(job.direction==='incoming'||p!==peer)&&(unavailable.get(p)??0)<=now)
  .sort((a,b)=>(unavailable.get(a)??0)-(unavailable.get(b)??0)||Number(b===peer)-Number(a===peer)).slice(0,10);
}
/** Keep a usable current route unless an eligible incoming sender takes priority. */
export function attachmentRouteNeedsSelection(job:AttachmentJob,candidates:readonly string[]){
 return !job.relay||!candidates.includes(job.relay)||job.direction==='incoming'
  &&candidates[0]===job.descriptor.manifest.sender&&job.relay!==job.descriptor.manifest.sender;
}
/** Sibling metadata is supplied by the worker; selection never reads a store. */
export function selectAttachmentCustodian(candidates:readonly string[],siblings:readonly {recipient:string;relay:string|null}[]):string|undefined {
 const audience=new Set(siblings.map(s=>s.recipient)),shared=candidates.filter(p=>!audience.has(p));
 return siblings.find(s=>s.relay&&shared.includes(s.relay))?.relay??shared[0]??candidates[0];
}
export function selectAttachmentReceiptPeer(pending:readonly string[],connected:readonly string[],now:number,unavailable:ReadonlyMap<string,number>){
 return pending.find(p=>connected.includes(p)&&(unavailable.get(p)??0)<=now);
}
export function attachmentBlockRoute(snapshot:AttachmentRouteSnapshot,peer:string,direction:'incoming'|'outgoing'){
 return snapshot.bulkRequest&&(direction==='outgoing'?snapshot.uploads.includes(peer):snapshot.bulk.includes(peer)&&snapshot.blocks.includes(peer));
}
/** Scheduling readiness only. Authorization and fresh route checks still occur
 * in the worker. Unrelated connected peers must not create a polling loop. */
export function attachmentCanAdvance(job:AttachmentJob,snapshot:AttachmentRouteSnapshot,now:number){
 if(job.receipt){
  if(job.direction==='outgoing')return true;
  const pending=job.custodians.filter(p=>!job.acknowledged.includes(p));
  return !pending.length||pending.some(p=>snapshot.peers.includes(p));
 }
 if(job.direction==='incoming'&&job.cursor>=Math.ceil(job.descriptor.manifest.bytes/attachmentBlockBytes(job.descriptor.manifest)))return true;
 if(job.direction==='outgoing'&&snapshot.peers.includes(job.descriptor.manifest.recipient))return true;
 return attachmentRouteCandidates(job,snapshot,now,new Map(),0).some(peer=>
  attachmentStreamEligible(job,peer,snapshot.directStream,now,0)||attachmentBlockRoute(snapshot,peer,job.direction));
}
