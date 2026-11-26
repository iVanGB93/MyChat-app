import {t} from '../../localization/language';
import AnimatedStickerButtonFace from './AnimatedStickerButtonFace';
import React,{useState} from 'react';
import {Platform,Pressable,Text,TouchableOpacity,View,type TextInput as NativeTextInput} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {useChatDraft} from '../../hooks/use-chat-draft';
import type {RootChatReply} from '../../modules/messaging';
import {KeyboardAwareTextInput as TextInput} from '../ui/KeyboardForm';
import RootVoiceComposer from './RootVoiceComposer';
import {chatRoomStyles as styles} from './chat-room-styles';

// Keep per-keystroke draft state in the composer instead of rerendering the chat screen.
export type ChatComposerHandle={setText(next:string|((current:string)=>string)):void;focus():void;blur():void;clear():void};
export const ChatComposer=React.forwardRef<ChatComposerHandle,{
 owner:string|null;peer:string;groupId?:string;disabled:boolean;cannotCompose:boolean;editing:boolean;reply?:RootChatReply;replyPreview?:React.ReactNode;
 onSend(value:string):Promise<void>;onAttach():void;onCamera(video?:boolean):void;onStickers():void;onSent():void;onTyping(value:boolean):void;onRecording?(value:boolean):void;onError(error:unknown):void;
}>(function ChatComposer({owner,peer,groupId,disabled,cannotCompose,editing,reply,replyPreview,onSend,onAttach,onCamera,onStickers,onSent,onTyping,onRecording,onError},ref){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),[draftState,setDraftState]=useState({empty:true,sendable:false}),[voice,setVoice]=useState(false);
 const surface={backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary};
 const [replyLeft,setReplyLeft]=useState(0);
 const scope=groupId?'group:'+groupId:peer;
 const composer=React.useRef<DraftEditorHandle>(null),activeScope=React.useRef(owner+':'+scope);
 activeScope.current=owner+':'+scope;
 React.useImperativeHandle(ref,()=>{
  const origin=owner+':'+scope;
  const editor=()=>activeScope.current===origin?composer.current:null;
  return {setText:next=>editor()?.setText(next),focus:()=>editor()?.focus(),blur:()=>editor()?.blur(),clear:()=>editor()?.clear()};
 },[owner,scope,voice]);
 return (<View pointerEvents="box-none" style={[styles.composerShell,{marginBottom:Math.max(insets.bottom,8)+4}]}>{!draftState.empty&&!voice&&!replyPreview&&<View style={styles.stickerToolbar}><Pressable accessibilityLabel={t("Open stickers")} disabled={disabled||!!editing} onPress={()=>onStickers()} accessibilityRole="button" accessibilityState={{disabled:disabled||!!editing}} style={({pressed})=>[styles.stickerToolbarButton,{backgroundColor:colors.tabBarBg,borderColor:colors.neonBorder,shadowColor:colors.primary,opacity:disabled||editing?0.45:pressed?0.7:1}]} hitSlop={4}><AnimatedStickerButtonFace color={colors.primary} enabled={!disabled&&!editing}/></Pressable></View>}<View testID="axonic-composer-bar">{replyPreview&&<View style={[styles.composerReplyTop,surface,{backgroundColor:colors.surfaceVariant,borderLeftColor:colors.primary}]} onLayout={event=>setReplyLeft(event.nativeEvent.layout.x)}>{replyPreview}</View>}<View style={[styles.inputBar,!!replyPreview&&styles.composerReplyInput,surface]}>{!!replyPreview&&<View pointerEvents="none" style={[styles.composerReplyShoulder,{width:replyLeft+1,borderColor:colors.neonBorder}]}/>}<View style={styles.inputRowWrap}>{!voice&&<><TouchableOpacity accessibilityLabel={t("Attach")} disabled={disabled||!!editing} onPress={()=>onAttach()} style={[styles.attachBtn,{borderColor:colors.neonBorder,backgroundColor:'transparent',shadowColor:colors.primary}]}><Ionicons name="add" size={24} color={colors.primary}/></TouchableOpacity><View style={[styles.inputRow,{backgroundColor:'transparent',borderWidth:0,paddingLeft:0}]}>{(draftState.empty||!!replyPreview&&!editing)&&<Pressable accessibilityLabel={t("Open stickers")} disabled={disabled||!!editing} onPress={()=>onStickers()} style={styles.stickerBtn} hitSlop={4}><Ionicons name="happy-outline" size={24} color={colors.primary}/></Pressable>}<DraftEditor key={owner+':'+scope} ref={composer} owner={owner} scope={scope} group={!!groupId} cannotCompose={cannotCompose} onState={setDraftState} onTyping={onTyping}/></View></>}{(draftState.sendable||editing)&&<TouchableOpacity testID="axonic-send-message" accessibilityLabel={groupId?t("Send group message"):t("Send message")} disabled={disabled||!draftState.sendable} onPress={()=>void onSend(composer.current?.getText()??'')} style={[styles.sendBtn,{borderRadius:22,backgroundColor:colors.primary,borderColor:colors.neonBorder,shadowColor:colors.primary,opacity:disabled||!draftState.sendable?0.45:1}]}><Text style={[!groupId&&styles.sendIcon,{color:colors.textInverse}]}>▶</Text></TouchableOpacity>}{draftState.empty&&!editing&&!voice&&<Pressable testID="axonic-camera-button" accessibilityLabel={t("Take a photo")} accessibilityRole="button" accessibilityState={{disabled:disabled||cannotCompose}} disabled={disabled||cannotCompose} onPress={()=>onCamera()} onLongPress={()=>onCamera(true)} accessibilityHint={t("Hold to record a short video")} style={({pressed})=>({width:44,height:44,alignItems:'center',justifyContent:'center',borderRadius:22,opacity:disabled||cannotCompose?0.45:pressed?0.65:1})}><Ionicons name="camera-outline" size={24} color={colors.primary}/></Pressable>}<View style={(draftState.sendable||editing)?{display:'none'}:voice?{flex:1}:undefined}><RootVoiceComposer peer={peer} groupId={groupId} disabled={disabled||!!editing||draftState.sendable} reply={reply} onSent={onSent} onActive={setVoice} onRecording={onRecording} onError={onError}/></View></View></View></View></View>);
});


type DraftEditorHandle=ChatComposerHandle&{getText():string};
const DraftEditor=React.forwardRef<DraftEditorHandle,{
 owner:string|null;scope:string;group:boolean;cannotCompose:boolean;
 onState(state:{empty:boolean;sendable:boolean}):void;onTyping(value:boolean):void;
}>(function DraftEditor({owner,scope,group,cannotCompose,onState,onTyping},ref){
 const {colors}=useTheme(),[text,setText]=useChatDraft(owner,scope);
 const input=React.useRef<NativeTextInput>(null),latest=React.useRef(text);
 latest.current=text;
 const empty=text.length===0,sendable=!!text.trim();
 React.useLayoutEffect(()=>{onState({empty,sendable});},[empty,sendable,onState]);
 // Android .clear() retained old text in rapid send-then-type device tests.
 // Update native text and selection together; draft state remains owned by useChatDraft.
 React.useImperativeHandle(ref,()=>({setText,getText:()=>latest.current,focus:()=>input.current?.focus(),blur:()=>input.current?.blur(),clear:()=>{if(Platform.OS==='android')input.current?.setNativeProps({text:'',selection:{start:0,end:0}});else input.current?.clear();}}),[setText]);
 return <TextInput ref={input} testID="axonic-message-composer" accessibilityLabel={group?t("New group message"):t("New message")} placeholder={t("Message...")} placeholderTextColor={colors.textTertiary} value={text} onChangeText={value=>{latest.current=value;setText(value);onTyping(!!value.trim());}} multiline editable={!cannotCompose} maxLength={1600} style={[styles.textInput,{color:colors.text}]}/>;
});
