export type MessageDeliveryInput={groupAttachmentDelivery?:{delivered:number};status:string;deliveredAt?:number;retiredAttachment?:unknown;networkCancelledAt?:number;read?:boolean;attachment?:unknown;descriptorDelivered?:boolean;networkStoredUntil?:number;attachmentStoredUntil?:number};
export type MessageDeliveryStatus='pending'|'stored'|'delivered'|'read'|'cancelled'|'unavailable';
export const hasConfirmedDelivery=(m:MessageDeliveryInput)=>m.status==='delivered'||m.deliveredAt!==undefined;
export function rootMessageStatus(m:MessageDeliveryInput,now=Date.now()):MessageDeliveryStatus{
 if(m.retiredAttachment)return 'unavailable';
 if(hasConfirmedDelivery(m))return m.read?'read':'delivered';
 if(m.read&&!m.attachment)return 'read';
 if(m.networkCancelledAt!==undefined)return 'cancelled';
 const description=m.descriptorDelivered||(m.networkStoredUntil??0)>now;
 if(m.attachment)return description&&(m.attachmentStoredUntil??0)>now?'stored':'pending';
 return (m.networkStoredUntil??0)>now?'stored':'pending';
}
export const deliveryStatusIcon=(status:MessageDeliveryStatus|'partial')=>status==='unavailable'?'document-outline':status==='cancelled'?'close-circle-outline':status==='pending'?'time-outline':(status==='stored'||status==='partial')?'checkmark':'checkmark-done';
export const deliveryStatusLabel=(status:MessageDeliveryStatus|'partial')=>({unavailable:'Attachment from an earlier version',cancelled:'Canceled by network reset',pending:'Pending',partial:'Delivered to some recipients',stored:'Stored on Axonic network',delivered:'Delivered',read:'Read'})[status];

export function messagePresentationStatus(message:MessageDeliveryInput,now=Date.now()){
 const status=rootMessageStatus(message,now);
 return !hasConfirmedDelivery(message)&&message.groupAttachmentDelivery?.delivered?'partial' as const:status;
}
