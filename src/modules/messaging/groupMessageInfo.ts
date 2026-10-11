import type {RootChatReply,RootChatState} from '../../services/identity/rootChatTypes';
import {rootMessageStatus} from '../../services/identity/rootMessageStatus';
/** Recipients come from the original delivery rows, not today's membership. */
export function groupMessageInfo(state:RootChatState,owner:string,group:string,target:RootChatReply,now=Date.now()){
 const rows=state.messages.filter(m=>m.group?.id===group&&m.group.messageId===target.id&&(m.direction==='outgoing'?owner:m.peer)===target.author);
 if(!rows.length)return null;
 const message=rows[0],recipients=message.direction==='outgoing'?rows.map(m=>({peer:m.peer,status:rootMessageStatus(m,now)})):[];
 return {message,at:Math.min(...rows.map(m=>m.at)),recipients,
  read:recipients.filter(r=>r.status==='read').length,delivered:recipients.filter(r=>r.status==='delivered'||r.status==='read').length};
}
