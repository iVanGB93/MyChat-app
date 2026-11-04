import {rootMessageStatus,type MessageDeliveryInput} from '../services/identity/rootMessageStatus';

/** A local preview is not evidence that the media left this device. */
export function outgoingMediaStatus(message:MessageDeliveryInput&{direction:string},expires:number,phase:string|undefined,percent:number,now=Date.now(),background=false){
 if(message.direction!=='outgoing'||message.status==='delivered')return null;
 if(message.networkCancelledAt!==undefined)return {label:'Transfer canceled',hint:'This attachment was not delivered.'};
 if(expires<=now||phase==='expired')return {label:'Attachment expired',hint:'Send this attachment again to deliver it.'};
 if(rootMessageStatus(message,now)==='stored')return {label:'Stored on Axonic network',hint:'Waiting for delivery to the recipient.'};
 if(phase==='cancelled')return {label:'Transfer paused',hint:'Resume to continue sending.'};
 return {label:phase==='confirming'?'Waiting for transfer confirmation':`Sending · ${Math.max(0,Math.min(100,percent))}%`,hint:background?'Not yet confirmed sent. Android will continue the upload in the background while your account stays unlocked.':'Not yet confirmed sent. Keep Axonic open; unfinished transfers resume when you reopen and unlock it.'};
}
