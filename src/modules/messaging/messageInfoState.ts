import {rootMessageStatus,type MessageDeliveryInput} from '../../services/identity/rootMessageStatus';
export function messageInfoDescription(message:MessageDeliveryInput&{direction:'incoming'|'outgoing'},now=Date.now()){
 const status=rootMessageStatus(message,now);
 if(message.direction==='incoming'){
  if(message.attachment&&status==='pending')return 'Message information received. The full attachment has not been received yet.';
  if(status==='read')return 'Read on this device. Exact read times are not recorded.';
  if(status==='delivered')return message.attachment?'The complete attachment was received on this device.':'Received on this device.';
  return 'Waiting for the message to finish arriving on this device.';
 }
 if(status==='stored')return message.attachment?'Message information and the full attachment are stored on the network, not yet confirmed received by the destination device.':'Stored on the network, not yet confirmed received by the destination device.';
 if(status==='pending')return message.attachment?'Waiting for confirmed storage or receipt of the complete attachment. A notification or metadata receipt alone is not delivery.':'Waiting for network storage or device acknowledgment.';
 if(status==='read')return 'Read by the recipient. Exact read times are not recorded.';
 return message.attachment?'The destination device confirmed receipt of the complete attachment. Exact receipt times are not recorded.':'Confirmed by the receiving device. Exact receipt times are not recorded.';
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
