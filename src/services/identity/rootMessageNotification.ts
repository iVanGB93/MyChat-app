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
 const notices=await notifee.getDisplayedNotifications();
 const current=notices.find(n=>n.notification.id===rootMessageNotificationId(account,sender,group))?.notification;
 if(current?.data?.sender===sender&&current.data.messageId===messageId&&current.id)
  await notifee.cancelNotification(current.id);
 const legacy='root-message:'+account+':'+sender+':'+messageId;
 if(notices.some(n=>n.notification.id===legacy))await notifee.cancelNotification(legacy);
}

/** Opening a conversation retires its current and legacy notices, independent of unread counts. */
export async function dismissRootConversationNotifications(account:string,target:{peer?:string;group?:string}){
 const id=rootMessageNotificationId(account,target.peer??'',target.group);
 const notices=await notifee.getDisplayedNotifications();
 for(const {notification:n} of notices){
  const data=n.data;
  if(n.id===id||(n.id?.startsWith('root-message:')&&data?.type==='root_neuron_message'&&data.account===account&&(target.group?data.group===target.group:!data.group&&data.sender===target.peer)))
   if(n.id)await notifee.cancelNotification(n.id);
 }
}
