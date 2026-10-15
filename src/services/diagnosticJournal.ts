export type DiagnosticEvent='app_active'|'app_background'|'app_inactive'|'network_changed'|'chat_snapshot_ready'|'chat_snapshot_failed'|'message_committed_incoming'|'message_committed_outgoing'|'wake_verified'|'notification_requested'|'recovery_started'|'recovery_finished'|'notification_fallback_posted'|'notification_preview_posted'|'wake_failed';
const eventsAllowed=new Set<DiagnosticEvent>(['app_active','app_background','app_inactive','network_changed','chat_snapshot_ready','chat_snapshot_failed','message_committed_incoming','message_committed_outgoing','wake_verified','notification_requested','recovery_started','recovery_finished','notification_fallback_posted','notification_preview_posted','wake_failed']);
type Row={at:number;event:DiagnosticEvent;milliseconds?:number;connected?:number;authenticating?:number};
/** No strings, identifiers or payloads are accepted as event details. No I/O or timer. */
export function createDiagnosticJournal(now=Date.now){
 let startedAt=now(),dropped=0,networkKey='',lastNetworkAt=0;const rows:Row[]=[];
 function trim(){const cutoff=now()-30*60*1000;while(rows.length&&(rows[0].at<cutoff||rows.length>128)){rows.shift();dropped++;}}
 function record(event:DiagnosticEvent,details:{milliseconds?:number;connected?:number;authenticating?:number}={}){
  if(!eventsAllowed.has(event))return;
  const row:Row={at:now(),event};for(const key of ['milliseconds','connected','authenticating'] as const){const v=details[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)row[key]=Math.min(86400000,Math.round(v));}
  rows.push(row);trim();
 }
 return {record,network(connected:number,authenticating:number){if(now()-lastNetworkAt<15000)return;lastNetworkAt=now();const key=connected+':'+authenticating;if(key!==networkKey){networkKey=key;record('network_changed',{connected,authenticating});}},
  clear(){rows.length=0;startedAt=now();dropped=0;networkKey='';lastNetworkAt=0;},
  snapshot(){trim();return {startedAt,observedAt:now(),retentionMinutes:30,maximumEvents:128,droppedEvents:dropped,events:rows.map(r=>({...r})),scope:'Volatile local observations since account context reset; lost on process restart. Network counts sampled at most once per 15 seconds; transient churn and swaps with unchanged counts may be missed. Not continuous background monitoring. Notification posted/requested does not prove user-visible display. Chat snapshot readiness is not frame render time.'};}};
}
export const diagnosticJournal=createDiagnosticJournal();
