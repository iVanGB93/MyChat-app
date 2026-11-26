import {t} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {attachmentDigest,attachmentBlockBytes,backgroundUploadScheduled,retiredAttachment} from '../../modules/media';
import {hasConfirmedDelivery,type RootChatMessage} from '../../modules/messaging';
import {useTransferProgress} from '../../modules/ui/transferState';
import {outgoingMediaStatus} from '../../utils/outgoing-media-status';

/** Detailed transfer guidance belongs in Message info, not under the photo. */
export default function MediaTransferInfo({message,now}:{message:RootChatMessage;now:number}){
 const {colors}=useTheme(),d=message.attachment;
 const progress=useTransferProgress(d?attachmentDigest(d.manifest):'');
 if(!d||retiredAttachment(d)||message.deleted||hasConfirmedDelivery(message))return null;
 const percent=progress?Math.min(100,Math.floor(progress.cursor*attachmentBlockBytes(d.manifest)/d.manifest.bytes*100)):0;
 const status=outgoingMediaStatus(message,d.manifest.expires,progress?.phase,percent,now,backgroundUploadScheduled(localAccount.status().account));
 const expired=d.manifest.expires<=now;
 const hint=expired?(message.direction==='incoming'?t("The download authorization expired. Ask the sender to send this attachment again."):t("Use Send again on the original message if the file is still available. Otherwise select the original from your photos or files. A resend creates a new transfer and preserves this message.")):progress?.phase==='cancelled'?t("This device paused the transfer. Copies already sent may still arrive."):status?.hint;
 if(!hint)return null;
 return <View style={{gap:6,marginTop:8}}><Text style={{color:colors.primary,fontWeight:'600'}}>{status?.label??t("Attachment expired")}</Text><Text style={{color:colors.textSecondary}}>{hint}</Text><Text style={{color:colors.textSecondary}}>{t("Transfer authorized")} · {new Date(d.manifest.created).toLocaleString()}</Text><Text style={{color:colors.textSecondary}}>{t("Transfer expires")} · {new Date(d.manifest.expires).toLocaleString()}</Text></View>;
}
