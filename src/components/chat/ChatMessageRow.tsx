import React,{memo} from 'react';
import {Pressable,Text,View,type GestureResponderEvent} from 'react-native';
import {t} from '../../localization/language';
import {useLanguage} from '../../localization/useLanguage';
import {useTheme} from '../../contexts/ThemeContext';
import {pendingMessages,type RootChatMessage} from '../../modules/messaging';
import {parseSticker,type Sticker} from '../../services/stickers';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import {retainEqualChatProps} from '../../modules/ui/useChatSnapshot';
import {voiceMessageKey} from '../../services/voicePlayback';
import RootAttachmentBubble from '../RootAttachmentBubble';
import ChatDateSeparator from './ChatDateSeparator';
import DeletedMessage from './DeletedMessage';
import MessageTextWithFooter from './MessageTextWithFooter';
import ReplySwipe from './ReplySwipe';
import RootMediaSize from './RootMediaSize';
import RootMessageReactions from './RootMessageReactions';
import RootMessageStatus from './RootMessageStatus';
import RootReplyContent from './RootReplyContent';
import StickerArt from './sticker-art';
import {CHAT_STICKER_SIZE,messageBubbleStyles as styles} from './message-bubble-styles';

type Props={
 message:RootChatMessage;olderAt?:number;at:number;owner:string|null;disabled:boolean;highlighted:boolean;
 time:string;quoted?:RootChatMessage;quoteAuthorName?:string;senderName?:string;
 onSender?(account:string):void;onJump(message?:RootChatMessage):void;onReply(message:RootChatMessage):void;
 onMenu(message:RootChatMessage,event:GestureResponderEvent):void;onReact(message:RootChatMessage,value:string):void;
 onSticker(sticker:Sticker):void;onMedia(message:RootChatMessage):void;nextVoice?:string;onError(error:string):void;
};

/** Row props are message-scoped. List layout and unrelated receipt changes can leave this row intact. */
export default memo(function ChatMessageRow({message:m,olderAt,at,owner,disabled,highlighted,time,quoted,quoteAuthorName,senderName,onSender,onJump,onReply,onMenu,onReact,onSticker,onMedia,nextVoice,onError}:Props){
 useLanguage();
 const {colors}=useTheme(),mine=m.direction==='outgoing',attachment=m.attachment,group=!!m.group;
 const sticker=!attachment?parseSticker(m.text):undefined;
 const audio=!!attachment?.mime.startsWith('audio/');
 const imported=attachment?.name===IMPORTED_STICKER_CONTENT;
 const photo=attachment&&!imported&&/^(image|video)\//.test(attachment.mime);
 const menu=(event:GestureResponderEvent)=>onMenu(m,event);
 const edited=m.edited?t("Edited"):'';
 const meta=(inline=false)=><View style={[styles.metaRow,inline&&{marginTop:0},audio&&{flexShrink:0}]}>
  {attachment&&<RootMediaSize message={m}/>}
  {!!edited&&<Text style={{color:colors.textTertiary,fontSize:11}}>{edited}</Text>}
  <Text style={[styles.timeText,{color:colors.textTertiary}]}>{time}</Text>
  <RootMessageStatus message={m} onError={onError}/>
 </View>;
 return <View>
  <ChatDateSeparator at={at} olderAt={olderAt}/>
  <ReplySwipe disabled={disabled||m.deleted||m.localPending} onReply={()=>onReply(m)}>
   <View onLayout={mine?pendingMessages.layoutCallback(owner,m.group?.messageId??m.id):undefined} style={[styles.bubbleRow,mine?styles.bubbleRowRight:styles.bubbleRowLeft]}>
    {!!senderName&&<Pressable accessibilityRole="button" accessibilityLabel={t("Open details for ")+senderName} onPress={()=>onSender?.(m.peer)} style={styles.groupSenderLink} hitSlop={4}>
     <Text numberOfLines={1} style={[styles.senderName,{color:colors.primary}]}>{senderName}</Text>
    </Pressable>}
    <RootMessageReactions message={m} owner={owner} disabled={disabled||!group&&m.localPending} onReact={value=>onReact(m,value)}>
     <Pressable accessibilityLabel={!group&&!attachment?m.text:undefined} onLongPress={menu} style={[
      styles.bubble,mine?styles.bubbleSent:styles.bubbleReceived,{minWidth:attachment?260:96,borderColor:highlighted?colors.primary:colors.neonBorder,backgroundColor:highlighted?colors.highlight:mine?colors.bubbleSent:colors.bubbleReceived},
      !m.deleted&&attachment&&styles.mediaBubble,!m.deleted&&audio&&styles.voiceBubble,!m.deleted&&photo&&styles.photoBubble,!m.deleted&&(sticker||imported)&&styles.stickerBubble,
     ]}>
      {!m.deleted&&m.reply&&<Pressable accessibilityRole="button" accessibilityLabel={t("Go to original message")} onPress={()=>onJump(quoted)} style={[
       group?styles.quoteBlock:{borderLeftWidth:3,borderRadius:8,padding:8,marginBottom:6},
       {borderLeftColor:colors.primary,backgroundColor:m.reply.author===owner?colors.bubbleSent:colors.bubbleReceived},
      ]}>
       {group&&!!quoteAuthorName&&<Text numberOfLines={1} style={[styles.quoteName,{color:colors.primary}]}>{quoteAuthorName}</Text>}
       <RootReplyContent message={quoted}/>
      </Pressable>}
      {m.deleted?<DeletedMessage color={colors.textSecondary}/>:attachment?
       <RootAttachmentBubble message={m} onMedia={onMedia} voiceKey={audio?voiceMessageKey(m):undefined} nextVoice={nextVoice} onLongPress={menu} audioFooter={audio?meta(true):undefined} onError={onError}/>:sticker?
       <Pressable accessibilityLabel={sticker.label+' sticker'} onLongPress={menu} onPress={()=>onSticker(sticker)}><StickerArt sticker={sticker} size={CHAT_STICKER_SIZE}/></Pressable>:
       <MessageTextWithFooter text={m.text} style={[styles.messageText,{color:colors.text}]} linkColor={colors.primary} footer={meta(true)} footerKey={JSON.stringify([time,edited,mine])}/>}
      {(m.deleted||!!sticker||!!attachment&&!audio)&&meta()}
     </Pressable>
    </RootMessageReactions>
   </View>
  </ReplySwipe>
 </View>;
},(previous,next)=>retainEqualChatProps(previous,next)===previous);
