import {rootMessageStatus,type MessageDeliveryInput} from '../../services/identity/rootMessageStatus';
import type {RootChatMessage} from '../../services/identity/rootChatTypes';
/** Shared by private info and each group recipient; never infer routes from Stored. */
export function messageInfoRoutes(m:RootChatMessage){
 return [{label:m.attachment?'Message information route':'Message route',evidence:m.messageDelivery},
  ...(m.attachment?[{label:'Complete attachment route',evidence:m.attachmentDelivery}]:[])].map(({label,evidence:e})=>({label,
   value:!e?'Unknown — no confirmed route recorded.':[
    e.scope==='receipt'?'Confirmed receipt path (original payload route unknown).':'Confirmed payload sources.',
    e.method==='peer'?'Authenticated peer connection.':e.method==='mixed'?'Peer connection and relay custody.':'Relay custody.',
    e.relays.length?'Observed relay IDs: '+e.relays.join(', '):e.method==='custody'?'Relay identity not observed.':'',
    e.partial?'Partial observation; earlier sources may be unknown.':'',
    'Observed '+new Date(e.at).toLocaleString()+'. Network/TURN hops are not recorded.'
   ].filter(Boolean).join(' ')}));
}
/** Local observations only: receipts do not carry a trusted remote wall-clock time. */
export function messageInfoTimeline(m:RootChatMessage,now=Date.now()){
 const rows:{label:string;at?:number}[]=[];
 if(m.direction==='outgoing')rows.push({label:'Pending (queued on this device)',at:m.queuedAt});
 if(m.attachment)rows.push({label:m.direction==='outgoing'?'Message information receipt confirmed':'Message information received',at:m.descriptorReceivedAt});
 if(m.direction==='outgoing'&&(m.storedAt!==undefined||rootMessageStatus(m,now)==='stored'))rows.push({label:'First confirmed Stored',at:m.storedAt});
 rows.push({label:m.direction==='outgoing'?'Delivery confirmed on this device':'Received on this device',at:m.deliveredAt});
 rows.push({label:m.direction==='outgoing'?'Read confirmation received':'Read on this device',at:m.readAt});
 return rows;
}
export function messageInfoDescription(message:MessageDeliveryInput&{direction:'incoming'|'outgoing'},now=Date.now()){
 const status=rootMessageStatus(message,now);
 if(message.direction==='incoming'){
  if(message.attachment&&status==='pending')return 'Message information received. The full attachment has not been received yet.';
  if(status==='read')return 'Read on this device.';
  if(status==='delivered')return message.attachment?'The complete attachment was received on this device.':'Received on this device.';
  return 'Waiting for the message to finish arriving on this device.';
 }
 if(status==='stored')return message.attachment?'Message information and the full attachment are stored on the network, not yet confirmed received by the destination device.':'Stored on the network, not yet confirmed received by the destination device.';
 if(status==='pending')return message.attachment?'Waiting for confirmed storage or receipt of the complete attachment. A notification or metadata receipt alone is not delivery.':'Waiting for network storage or device acknowledgment.';
 if(status==='read')return 'Read by the recipient. Times below indicate when confirmation reached this device.';
 return message.attachment?'The destination device confirmed receipt of the complete attachment.':'Confirmed by the receiving device. Times below indicate when confirmation reached this device.';
}
/** Only a currently Stored state needs a clock-driven refresh. */
export function nextMessageStateExpiry(messages:readonly MessageDeliveryInput[],now:number){
 let next:number|undefined;
 for(const message of messages){
  if(rootMessageStatus(message,now)!=='stored')continue;
  const deadlines=message.attachment?[...(!message.descriptorDelivered?[message.networkStoredUntil]:[]),message.attachmentStoredUntil]:[message.networkStoredUntil];
  for(const at of deadlines)if(at!==undefined&&Number.isFinite(at)&&at>now&&(next===undefined||at<next))next=at;
 }
 return next;
}
