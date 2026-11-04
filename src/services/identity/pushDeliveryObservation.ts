import type {DiagnosticDetails} from '../diagnosticJournal';
/** Transport metadata only. Records payload presence only; never copies contents, IDs or tokens. */
export function pushDeliveryObservation(message:{sentTime?:unknown;priority?:unknown;originalPriority?:unknown;data?:unknown},state:string|null,now:number):DiagnosticDetails{
 const result:DiagnosticDetails={callbackState:['active','background','inactive'].includes(state??'')?state!:'unknown'};
 const data=message.data as {type?:unknown;envelope?:unknown}|undefined;
 if(data?.type==='neuron_message')result.wakePayload=typeof data.envelope==='string'?'inline':'hint_only';
 if(typeof message.sentTime==='number'&&Number.isFinite(message.sentTime)&&message.sentTime>0&&message.sentTime<=now)result.milliseconds=Math.min(86400000,Math.round(now-message.sentTime));
 if(message.priority===0||message.priority===1||message.priority===2)result.pushPriority=message.priority;
 if(message.originalPriority===0||message.originalPriority===1||message.originalPriority===2)result.pushOriginalPriority=message.originalPriority;
 return result;
}
