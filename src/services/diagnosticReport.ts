import {rootMessageStatus} from './identity/rootMessageStatus';
import type {RootChatState} from './identity/rootChatTypes';
export const REPORT_MAX_BYTES=65536;
export const REPORT_ISSUES=['delivery','notifications','slow_chats','connections','media','general'] as const;
export type ReportIssue=typeof REPORT_ISSUES[number];
export const REPORT_WHEN=['now','last_5_minutes','last_30_minutes','earlier'] as const;
export type ReportWhen=typeof REPORT_WHEN[number];
export function numericProjection(value:unknown,keys:readonly string[]){const input=value as Record<string,unknown>|null,result:Record<string,number>={};for(const key of keys){const n=input?.[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)result[key]=n;}return result;}
export function summarizeReportMessages(state:RootChatState,now:number){
 const result={private:{incoming:{pending:0,stored:0,delivered:0,read:0},outgoing:{pending:0,stored:0,delivered:0,read:0}},group:{incoming:{pending:0,stored:0,delivered:0,read:0},outgoing:{pending:0,stored:0,delivered:0,read:0}},incompleteMedia:0,descriptorReceivedIncompleteMedia:0,oldestOwnPendingSeconds:null as number|null};
 for(const m of state.messages){if(m.deleted)continue;const status=rootMessageStatus(m,now);result[m.group?'group':'private'][m.direction][status]++;if(m.attachment&&m.status!=='delivered'){result.incompleteMedia++;if(m.descriptorDelivered||m.descriptorReceivedAt!==undefined)result.descriptorReceivedIncompleteMedia++;}if(m.direction==='outgoing'&&(status==='pending'||status==='stored')){const age=Math.max(0,Math.floor((now-(m.queuedAt??m.at))/1000));result.oldestOwnPendingSeconds=Math.max(result.oldestOwnPendingSeconds??0,age);}}
 return {...result,scope:'Current retained non-deleted messages; outgoing group counts are per-recipient delivery rows, not unique logical messages. No content or peer/message IDs.'};
}
export function summarizeWakeForReport(value:unknown){
 const source=value as Record<string,any>|null;
 const project=(v:any)=>!v?null:{work:numericProjection(v.work,['schedulerChecks','storeReads','selectedItems','localGatewayCalls','remoteGatewayCalls','requestPayloadBytes','responsePayloadBytes','elapsedMs']),outcomes:numericProjection(v.outcomes,['forwarded','retry','unsupported','rejected','unavailable','exception']),gauges:numericProjection(v,['trackedEnvelopes','backingOff','acceptedEnvelopes'])};
 return {private:project(source?.private),group:project(source?.group),scope:'Current network runtime only. Calls are adapter invocations, not proven transmissions; bytes are JSON bytes, not wire bytes; elapsedMs is request latency, not CPU. Gateway acceptance is not device delivery.'};
}
export function chooseReportRecipient(connections:readonly {account:string;state:string;rank?:number;responseMs?:number|null}[],known:readonly {account:string;name:string}[],blocked:readonly string[]){
 const eligible=known.filter(p=>!blocked.includes(p.account));
 const connected=connections.filter(c=>c.state==='connected'&&eligible.some(p=>p.account===c.account)).slice().sort((a,b)=>(a.rank??999)-(b.rank??999));
 const selected=eligible.find(p=>p.account===connected[0]?.account)??eligible[0];
 if(!selected)throw Error('No diagnostic neuron is available. Unblock a configured neuron first.');
 return {...selected,connected:!!connected.length,selectionBasis:connected.length?'Best locally ranked connected configured AoN':'Configured AoN fallback; queued delivery may wait for connectivity'};
}
export function serializeDiagnosticReport(report:unknown){let raw=JSON.stringify(report,null,2);if(new TextEncoder().encode(raw).length>REPORT_MAX_BYTES)raw=JSON.stringify(report);if(new TextEncoder().encode(raw).length>REPORT_MAX_BYTES)throw Error('Diagnostic report exceeds the size limit');return raw;}
