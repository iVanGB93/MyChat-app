export type DiagnosticEvent='app_active'|'app_background'|'app_inactive'|'network_changed'|'chat_history_read'|'chat_view_derived'|'private_chat_layout'|'group_chat_layout'|'chat_snapshot_ready'|'chat_snapshot_failed'|'message_committed_incoming'|'message_committed_outgoing'|'wake_verified'|'notification_requested'|'recovery_started'|'recovery_finished'|'notification_fallback_posted'|'notification_preview_posted'|'wake_failed';
const eventsAllowed=new Set<DiagnosticEvent>(['app_active','app_background','app_inactive','network_changed','chat_history_read','chat_view_derived','private_chat_layout','group_chat_layout','chat_snapshot_ready','chat_snapshot_failed','message_committed_incoming','message_committed_outgoing','wake_verified','notification_requested','recovery_started','recovery_finished','notification_fallback_posted','notification_preview_posted','wake_failed']);
const wakeReasons=new Set(['invalid-payload','invalid-event','invalid-sender','owner-unavailable','sender-blocked','invalid-routing-or-expiry','sender-record-missing','sender-lookup-unavailable','sender-lookup-invalid','sender-lookup-deferred','sender-lookup-changed','sender-lookup-verification_failed','sender-lookup-pin_rejected','context-changed','signature-or-record-invalid']);
export type DiagnosticDetails={milliseconds?:number;connected?:number;authenticating?:number;reason?:string;sleepMs?:number;processCpuMs?:number;setupMs?:number;waitLagMs?:number;overrunMs?:number};
type Row={at:number;event:DiagnosticEvent}&DiagnosticDetails;
/** Only fixed wake reason codes and numeric details; never identifiers or payloads. No I/O or timer. */
export function createDiagnosticJournal(now=Date.now){
 let startedAt=now(),dropped=0,networkKey='',lastNetworkAt=0;const rows:Row[]=[];
 function trim(){const cutoff=now()-30*60*1000;while(rows.length&&(rows[0].at<cutoff||rows.length>128)){rows.shift();dropped++;}}
 function record(event:DiagnosticEvent,details:DiagnosticDetails={}){
  if(!eventsAllowed.has(event))return;
  const row:Row={at:now(),event};for(const key of ['milliseconds','connected','authenticating'] as const){const v=details[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)row[key]=Math.min(86400000,Math.round(v));}
  if(event==='wake_failed'&&details.reason&&wakeReasons.has(details.reason))row.reason=details.reason;
  if(event==='recovery_finished'){
   for(const key of ['sleepMs','processCpuMs','setupMs','waitLagMs','overrunMs'] as const){const n=details[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)row[key]=Math.min(86400000,Math.round(n));}
   if(['receipt_complete','deadline','account_changed','error'].includes(details.reason??''))row.reason=details.reason;
  }
  rows.push(row);trim();
 }
 return {record,network(connected:number,authenticating:number){if(now()-lastNetworkAt<15000)return;lastNetworkAt=now();const key=connected+':'+authenticating;if(key!==networkKey){networkKey=key;record('network_changed',{connected,authenticating});}},
  clear(){rows.length=0;startedAt=now();dropped=0;networkKey='';lastNetworkAt=0;},
  snapshot(){trim();return {startedAt,observedAt:now(),retentionMinutes:30,maximumEvents:128,droppedEvents:dropped,events:rows.map(r=>({...r})),recoveryTimingScope:'Recovery milliseconds are elapsed time after account startup, not CPU time. sleepMs is the native elapsed-minus-uptime delta; absent on older clients. processCpuMs covers ALL app threads during that interval, not just this recovery; overlapping recoveries must not be summed. waitLagMs is the largest late observation of a 300ms wait and can include sleep or scheduling delay. setupMs includes inline persistence, which is never interrupted. overrunMs measures time beyond the 20s recovery budget, not extra authorized network work.',scope:'Volatile local observations since account context reset; lost on process restart. Network counts sampled at most once per 15 seconds; transient churn and swaps with unchanged counts may be missed. Not continuous background monitoring. Notification posted/requested does not prove user-visible display. Chat history read includes ledger queue wait, storage, parsing and validation on UI cache misses; view derivation is measured separately. Private/group chat layout measures screen render start to its first container layout, not message paint or animation completion. Chat snapshot readiness is not frame render time.'};}};
}
export const diagnosticJournal=createDiagnosticJournal();
