import React,{useState} from 'react';
import {Text,TouchableOpacity,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import type {RootChatMessage} from '../../modules/messaging';
import {messageReactionBadges} from '../../utils/message-reactions';
import {messageBubbleStyles as styles} from './message-bubble-styles';
type Props={message:RootChatMessage;owner?:string|null;disabled?:boolean;onReact(emoji:string):void};
export default function RootMessageReactions({children,...props}:Props&{children:React.ReactNode}){
 const [height,setHeight]=useState(22),hasReactions=!props.message.deleted&&!!props.message.reactions?.length;
 return <View style={[styles.bubbleTouchTarget,styles.bubbleWrap,hasReactions&&{paddingBottom:Math.max(12,height-10)}]}>{children}<ReactionBadges {...props} onHeight={setHeight}/></View>;
}
function ReactionBadges({message,owner,disabled,onReact,onHeight}:Props&{onHeight(height:number):void}){
 const {colors}=useTheme();
 if(message.deleted||!message.reactions?.length)return null;
 return <View onLayout={event=>onHeight(event.nativeEvent.layout.height)} style={[styles.reactionsOverlay,styles.reactionsOverlayLeft,{right:8}]}>{messageReactionBadges(message.reactions,owner??undefined).map(badge=><TouchableOpacity key={badge.emoji} disabled={disabled} accessibilityLabel={`${badge.emoji}, ${badge.count} reactions${badge.mine?', including yours':''}`} onPress={()=>onReact(badge.mine?'':badge.emoji)} style={[styles.reactionBadge,{backgroundColor:badge.mine?colors.neonGlow:colors.surface,borderColor:badge.mine?colors.primary:colors.neonBorder,shadowColor:colors.primary}]}><Text style={styles.reactionEmojiInBadge}>{badge.emoji}</Text><Text style={[styles.reactionBadgeText,{color:badge.mine?colors.primary:colors.text}]}>{badge.count}</Text></TouchableOpacity>)}</View>;
}
