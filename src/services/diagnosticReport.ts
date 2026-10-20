import {rootMessageStatus} from './identity/rootMessageStatus';
import type {RootChatState} from './identity/rootChatTypes';
export const REPORT_MAX_BYTES=65536;
export const REPORT_ISSUES=['delivery','notifications','slow_chats','connections','media','general'] as const;
export type ReportIssue=typeof REPORT_ISSUES[number];
export const REPORT_WHEN=['now','last_5_minutes','last_30_minutes','earlier'] as const;
export type ReportWhen=typeof REPORT_WHEN[number];
export function numericProjection(value:unknown,keys:readonly string[]){const input=value as Record<string,unknown>|null,result:Record<string,number>={};for(const key of keys){const n=input?.[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)result[key]=n;}return result;}
export function summarizeReportMessages(state:RootChatState,now:number){
 const result={networkResetAt:state.networkResetAt??null,private:{incoming:{pending:0,stored:0,delivered:0,read:0,cancelled:0},outgoing:{pending:0,stored:0,delivered:0,read:0,cancelled:0}},group:{incoming:{pending:0,stored:0,delivered:0,read:0,cancelled:0},outgoing:{pending:0,stored:0,delivered:0,read:0,cancelled:0}},incompleteMedia:0,descriptorReceivedIncompleteMedia:0,oldestOwnPendingSeconds:null as number|null};
 for(const m of state.messages){if(m.deleted)continue;const status=rootMessageStatus(m,now);result[m.group?'group':'private'][m.direction][status]++;if(status==='cancelled')continue;if(m.attachment&&m.status!=='delivered'){result.incompleteMedia++;if(m.descriptorDelivered||m.descriptorReceivedAt!==undefined)result.descriptorReceivedIncompleteMedia++;}if(m.direction==='outgoing'&&(status==='pending'||status==='stored')){const age=Math.max(0,Math.floor((now-(m.queuedAt??m.at))/1000));result.oldestOwnPendingSeconds=Math.max(result.oldestOwnPendingSeconds??0,age);}}
 const pendingEvidence={olderThanOneHour:0,olderThanOneDay:0,expiredStorageEvidence:0,mediaAwaitingDescriptor:0,mediaDescriptorKnownIncomplete:0};
 const incompleteMediaEvidence={expiredTransferAuthorization:0,liveTransferAuthorization:0,incoming:0,outgoing:0};
 for(const m of state.messages){if(m.deleted||!m.attachment||m.status==='delivered'||m.networkCancelledAt!==undefined)continue;
  incompleteMediaEvidence[m.direction]++;
  const expires=m.attachment.manifest?.expires;
  if(Number.isFinite(expires)){if(expires<=now)incompleteMediaEvidence.expiredTransferAuthorization++;else incompleteMediaEvidence.liveTransferAuthorization++;}
 }
 for(const m of state.messages){
  if(m.deleted||m.direction!=='outgoing'||!['pending','stored'].includes(rootMessageStatus(m,now)))continue;
  const age=now-(m.queuedAt??m.at);if(age>=3600000)pendingEvidence.olderThanOneHour++;if(age>=86400000)pendingEvidence.olderThanOneDay++;
  const until=m.attachment?m.attachmentStoredUntil:m.networkStoredUntil;
  if(until!==undefined&&until<=now)pendingEvidence.expiredStorageEvidence++;
  if(m.attachment){if(m.descriptorDelivered)pendingEvidence.mediaDescriptorKnownIncomplete++;else pendingEvidence.mediaAwaitingDescriptor++;}
 }
 return {...result,pendingEvidence,incompleteMediaEvidence,scope:'Current retained non-deleted messages; outgoing group counts are per-recipient delivery rows, not unique logical messages. Pending evidence counts overlap and describe retained state, not confirmed loss. Expired transfer authorization cannot be extended by a receiver; local files are not inspected by this summary. No content or peer/message IDs.'};
}
export function summarizeWakeForReport(value:unknown){
 const source=value as Record<string,any>|null;
 const outcomes=['recipient_receipt','forwarded','retry','unsupported','rejected','unavailable','exception','local_wake_verification_failed','local_silent_flag_binding_mismatch'];
 // Keep the scheduler's bounded evidence, not raw queue rows. Without these
 // observations a cumulative mismatch count cannot distinguish old failures
 // from a currently retrying packet. Never invent peer/message correlation.
 const pending=(v:unknown)=>Array.isArray(v)?v.slice(0,8).map(row=>{
  const result:Record<string,number|string|null>={};
  for(const key of ['requests','lastObservedAt','nextRetryAt']){const n=row?.[key];if(Number.isSafeInteger(n)&&n>=0)result[key]=n;}
  if(row?.nextRetryAt===null)result.nextRetryAt=null;
  if(typeof row?.lastOutcome==='string'&&['validation',...outcomes].includes(row.lastOutcome))result.lastOutcome=row.lastOutcome;
  return result;
 }):[];
 const project=(v:any)=>!v?null:{work:numericProjection(v.work,['schedulerChecks','storeReads','selectedItems','localGatewayCalls','remoteGatewayCalls','requestPayloadBytes','responsePayloadBytes','elapsedMs']),outcomes:numericProjection(v.outcomes,outcomes),gauges:numericProjection(v,['trackedEnvelopes','backingOff','acceptedEnvelopes']),pendingSample:pending(v.pendingSample)};
 return {private:project(source?.private),group:project(source?.group),scope:'Current network runtime only. Calls are adapter invocations, not proven transmissions; bytes are JSON bytes, not wire bytes; elapsedMs is request latency, not CPU. Gateway acceptance is not device delivery. Each pendingSample contains at most eight locally tracked wake items, not all undelivered messages. lastObservedAt and nextRetryAt use this device clock; nextRetryAt is eligibility, not a promised send time, and null means no eligible gateway is currently known. validation means no more specific outcome was recorded, not successful validation. Rows have no stable aliases: do not correlate array positions across reports.'};
}
export function summarizePollingForReport(value:unknown){
 const source=value as Record<string,unknown>|null;
 const keys=['startedPasses','emptyPasses','itemPasses','unsuccessfulPasses','cooldownSkips','busySkips','activePasses','trackedRelays','eventIdlePeers','idleMaximumMs'];
 return {private:source?numericProjection(source.private,keys):null,group:source?numericProjection(source.group,keys):null,
  localWork:source?numericProjection(source,['pendingDerivations']):null,events:source?numericProjection(source.events,['sent','acknowledged','received','retries','pending']):null,
  scope:'Current network runtime. Passes are local scheduled inbox batches, not wire packets. Item passes saw a packet, not necessarily valid or delivered. Empty passes are not failures. Skips are local checks with no poll started. Unsuccessful passes returned neither a packet nor confirmed empty inbox. Event-capable peers stop polling after a confirmed drain until a connection, wake, or inbox-change event. Legacy empty-inbox backoff is capped at 15s; unfinished work can retry. Notice acknowledgment only confirms reconciliation was requested, not message delivery. Call inboxes also sleep when both peers support call-inbox events; older relays retain their compatibility poll.'};
}
export function chooseReportRecipient(connections:readonly {account:string;state:string;rank?:number;responseMs?:number|null}[],known:readonly {account:string;name:string}[],blocked:readonly string[]){
 const eligible=known.filter(p=>!blocked.includes(p.account));
 const connected=connections.filter(c=>c.state==='connected'&&eligible.some(p=>p.account===c.account)).slice().sort((a,b)=>(a.rank??999)-(b.rank??999));
 const selected=eligible.find(p=>p.account===connected[0]?.account)??eligible[0];
 if(!selected)throw Error('No diagnostic neuron is available. Unblock a configured neuron first.');
 return {...selected,connected:!!connected.length,selectionBasis:connected.length?'Best locally ranked connected configured AoN':'Configured AoN fallback; queued delivery may wait for connectivity'};
}
export function serializeDiagnosticReport(report:unknown){let raw=JSON.stringify(report,null,2);if(new TextEncoder().encode(raw).length>REPORT_MAX_BYTES)raw=JSON.stringify(report);if(new TextEncoder().encode(raw).length>REPORT_MAX_BYTES)throw Error('Diagnostic report exceeds the size limit');return raw;}
