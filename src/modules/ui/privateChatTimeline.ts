import type {RootChatMessage} from '../messaging';
import type {OwnCallSummary} from '../storage';
export type PrivateChatRow={key:string;at:number;message:RootChatMessage;call?:never}|{key:string;at:number;call:OwnCallSummary;message?:never};
/** Calls stay local records, never synthetic messages or receipt/reply targets. */
export function privateChatTimeline(messages:RootChatMessage[],calls:OwnCallSummary[],peer:string,hasOlderMessages:boolean):PrivateChatRow[]{
 const own=messages.filter(m=>m.peer===peer&&!m.group),oldest=own.length?Math.min(...own.map(m=>m.at)):Infinity;
 return [...own.map(message=>({key:'message:'+message.direction+':'+message.id,at:message.at,message})),
  ...calls.filter(c=>c.peer===peer&&(!hasOlderMessages||c.at>=oldest)).map(call=>({key:'call:'+call.id,at:call.at,call}))]
  .sort((a,b)=>b.at-a.at||a.key.localeCompare(b.key));
}
export function groupChatTimeline(messages:RootChatMessage[],calls:OwnCallSummary[],group:string,hasOlderMessages:boolean):PrivateChatRow[]{
 const own=messages.filter(m=>m.group?.id===group),oldest=own.length?Math.min(...own.map(m=>m.at)):Infinity;
 return [...own.map(message=>({key:(message.direction==='outgoing'?'own':message.peer)+':'+message.group!.messageId,at:message.at,message})),
  ...calls.filter(c=>c.group===group&&(!hasOlderMessages||c.at>=oldest)).map(call=>({key:'call:'+call.id,at:call.at,call}))]
  .sort((a,b)=>b.at-a.at||a.key.localeCompare(b.key));
}
