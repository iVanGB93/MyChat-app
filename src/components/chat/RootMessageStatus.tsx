import {t} from '../../localization/language';
import React,{useEffect,useRef,useState} from 'react';
import {Alert,AppState,Pressable} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {type RootChatMessage,rootMessageStatus,deliveryStatusIcon,deliveryStatusLabel} from '../../modules/messaging';
import {attachmentDigest,controlRootAttachment,resendExpiredRootAttachment} from '../../modules/media';
import {rootAttachmentFile} from '../../modules/storage';
import {localAccount} from '../../modules/identity';
import {useTransferProgress} from '../../modules/ui/transferState';

/** One status position for delivery evidence and available transfer recovery. */
export default function RootMessageStatus({message:m,onError}:{message:RootChatMessage;onError(message:string):void}){
 const {colors}=useTheme();
 if(m.attachment)return <AttachmentStatus message={m} onError={onError}/>;
 if(m.direction!=='outgoing')return null;
 const status=rootMessageStatus(m);
 return <Ionicons accessibilityLabel={t(deliveryStatusLabel(status))} name={deliveryStatusIcon(status)} size={13} color={status==='read'?colors.checkBlue:colors.textTertiary}/>;
}
function AttachmentStatus({message:m,onError}:{message:RootChatMessage;onError(message:string):void}){
 const {colors}=useTheme(),digest=m.attachment?attachmentDigest(m.attachment.manifest):'';
 const progress=useTransferProgress(digest),[busy,setBusy]=useState(false),[resent,setResent]=useState(false),lock=useRef(false);
 const [now,setNow]=useState(Date.now);
 const expires=m.attachment?.manifest.expires;
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined;const refresh=()=>{clearTimeout(timer);setNow(Date.now());if(expires&&expires>Date.now())timer=setTimeout(refresh,Math.min(expires-Date.now()+1,2147483647));};refresh();const sub=AppState.addEventListener('change',s=>{if(s==='active')refresh();});return()=>{clearTimeout(timer);sub.remove();};},[expires]);
 const owner=localAccount.status().account,expired=!!expires&&expires<=now;
 const eligible=!!m.attachment&&!m.deleted&&m.status!=='delivered'&&m.networkCancelledAt===undefined;
 const resend=eligible&&expired&&m.direction==='outgoing'&&!resent&&!!owner&&!!rootAttachmentFile(owner,digest)?.exists;
 const retry=eligible&&!expired&&(progress?.phase==='cancelled'||!!progress?.failures);
 async function perform(){if(lock.current)return;lock.current=true;setBusy(true);try{if(resend){await resendExpiredRootAttachment(m);setResent(true);}else await controlRootAttachment(digest,'retry');}catch(e){onError(e instanceof Error?e.message:'Unable to retry attachment');}finally{lock.current=false;setBusy(false);}}
 if(resend||retry)return <Pressable accessibilityRole="button" accessibilityLabel={resend?t("Send attachment again"):progress?.phase==='cancelled'?t("Resume transfer"):t("Retry transfer now")} accessibilityState={{disabled:busy,busy}} disabled={busy} hitSlop={8} onPress={event=>{event.stopPropagation();if(resend)Alert.alert(t("Send attachment again?"),m.group?t("This creates a new message for the current group members, including anyone who already received the original. The original message stays."):t("This creates a new transfer. The original message stays."),[{text:t("Cancel"),style:'cancel'},{text:t("Send again"),onPress:()=>void perform()}]);else void perform();}}><Ionicons name="refresh-outline" size={16} color={colors.primary} style={{opacity:busy?0.45:1}}/></Pressable>;
 if(m.direction!=='outgoing')return null;
 const status=rootMessageStatus(m,now);
 return <Ionicons accessibilityLabel={resent?t("New transfer queued"):t(deliveryStatusLabel(status))} name={deliveryStatusIcon(status)} size={13} color={status==='read'?colors.checkBlue:colors.textTertiary}/>;
}
