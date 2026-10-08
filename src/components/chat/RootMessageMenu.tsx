import React from 'react';
import {Modal,Pressable,Text,TouchableOpacity,View,useWindowDimensions} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {ROOT_REACTIONS} from '../../modules/messaging';
import type {RootChatMessage} from '../../modules/messaging';
import {chatRoomStyles as styles} from './chat-room-styles';
export default function RootMessageMenu({message,close,copy,reply,forward,edit,remove,react,info,pageY}:{message:RootChatMessage;close():void;copy():void;reply():void;forward?():void;edit():void;remove():void;react(text:string):void;info?():void;pageY?:number}){
 const {colors}=useTheme(),{height}=useWindowDimensions();
 const option=(label:string,fn:()=>void,danger=false)=><TouchableOpacity accessibilityLabel={label} onPress={()=>{close();fn();}} style={styles.contextOption}><Text style={[styles.contextOptionText,{color:danger?colors.error:colors.text}]}>{label}</Text></TouchableOpacity>;
 return <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={close}><Pressable onPress={close} style={styles.modalBackdrop}><Pressable onPress={()=>{}} style={[styles.contextPanel,{backgroundColor:colors.surface,borderColor:colors.neonBorder,top:Math.max(24,Math.min((pageY??height/2)-70,height-440))}]}>
  {info&&option('ⓘ  Info',info)}
  <View style={styles.reactionsRow}>{ROOT_REACTIONS.map(emoji=><TouchableOpacity key={emoji} accessibilityLabel={'React '+emoji} onPress={()=>{close();react(emoji);}} style={[styles.reactionBtn,{backgroundColor:colors.surfaceVariant}]}><Text style={styles.reactionEmoji}>{emoji}</Text></TouchableOpacity>)}</View>
  <View style={[styles.contextDivider,{backgroundColor:colors.divider}]}/>
  {!message.attachment&&option('📋  Copy message',copy)}{option('↩  Reply',reply)}{forward&&option('↗  Forward',forward)}
  {message.direction==='outgoing'&&!message.attachment&&option('✎  Edit message',edit)}
  {message.direction==='outgoing'&&option('Delete message',remove,true)}{!!message.reactions?.length&&option('Remove my reaction',()=>react(''))}
 </Pressable></Pressable></Modal>;
}
