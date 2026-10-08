import type {RootChatMessage} from './rootChatTypes';
export type MessageDeliveryStatus='pending'|'stored'|'delivered'|'read';
export function rootMessageStatus(m:RootChatMessage,now=Date.now()):MessageDeliveryStatus{
 if(m.status==='delivered')return m.read?'read':'delivered';
 if(m.read&&!m.attachment)return 'read';
 const description=m.descriptorDelivered||(m.networkStoredUntil??0)>now;
 if(m.attachment)return description&&(m.attachmentStoredUntil??0)>now?'stored':'pending';
 return (m.networkStoredUntil??0)>now?'stored':'pending';
}
export const deliveryStatusIcon=(status:MessageDeliveryStatus)=>status==='pending'?'time-outline':status==='stored'?'checkmark':'checkmark-done';
export const deliveryStatusLabel=(status:MessageDeliveryStatus)=>({pending:'Pending',stored:'Stored on Axonic network',delivered:'Delivered',read:'Read'})[status];
