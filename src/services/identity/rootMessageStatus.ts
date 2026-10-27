export type MessageDeliveryInput={status:string;retiredAttachment?:unknown;networkCancelledAt?:number;read?:boolean;attachment?:unknown;descriptorDelivered?:boolean;networkStoredUntil?:number;attachmentStoredUntil?:number};
export type MessageDeliveryStatus='pending'|'stored'|'delivered'|'read'|'cancelled'|'unavailable';
export function rootMessageStatus(m:MessageDeliveryInput,now=Date.now()):MessageDeliveryStatus{
 if(m.retiredAttachment)return 'unavailable';
 if(m.status==='delivered')return m.read?'read':'delivered';
 if(m.read&&!m.attachment)return 'read';
 if(m.networkCancelledAt!==undefined)return 'cancelled';
 const description=m.descriptorDelivered||(m.networkStoredUntil??0)>now;
 if(m.attachment)return description&&(m.attachmentStoredUntil??0)>now?'stored':'pending';
 return (m.networkStoredUntil??0)>now?'stored':'pending';
}
export const deliveryStatusIcon=(status:MessageDeliveryStatus)=>status==='unavailable'?'document-outline':status==='cancelled'?'close-circle-outline':status==='pending'?'time-outline':status==='stored'?'checkmark':'checkmark-done';
export const deliveryStatusLabel=(status:MessageDeliveryStatus)=>({unavailable:'Attachment from an earlier version',cancelled:'Canceled by network reset',pending:'Pending',stored:'Stored on Axonic network',delivered:'Delivered',read:'Read'})[status];
