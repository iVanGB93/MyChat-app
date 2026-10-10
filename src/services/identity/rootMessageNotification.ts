import notifee from '@notifee/react-native';

/** Notification presentation is per conversation; inbox deduplication stays per message. */
export const rootMessageNotificationId=(account:string,sender:string,group?:string)=>
 'root-conversation:'+account+':'+(group?'group:'+group:'direct:'+sender);

export async function currentRootMessageNotification(account:string,sender:string,group?:string){
 const id=rootMessageNotificationId(account,sender,group);
 return (await notifee.getDisplayedNotifications()).find(n=>n.notification.id===id)?.notification;
}

/** An old wake or action must not dismiss a newer message in the same conversation. */
export async function cancelRootMessageNotification(account:string,sender:string,messageId:string,group?:string){
 const current=await currentRootMessageNotification(account,sender,group);
 if(current?.data?.sender===sender&&current.data.messageId===messageId&&current.id)
  await notifee.cancelNotification(current.id);
 const legacy='root-message:'+account+':'+sender+':'+messageId;
 if((await notifee.getDisplayedNotifications()).some(n=>n.notification.id===legacy))await notifee.cancelNotification(legacy);
}
