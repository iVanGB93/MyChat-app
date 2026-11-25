import React,{useCallback} from 'react';
import {AppState} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {rootVoiceRecordingActive,subscribeRootVoiceRecording} from '../../modules/media';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {localAccountCalls,subscribeLocalAccountCalls} from '../../modules/calls';
import VoiceMessageBubble from '../VoiceMessageBubble';
export default function RootAudioPlayer({uri,onError,messageFooter,voiceKey,nextVoice}:{uri:string;onError(error:string):void;messageFooter?:React.ReactNode;voiceKey?:string;nextVoice?:string}){
 const {colors}=useTheme(),owner=localAccount.status().account,focused=useIsFocused();
 const allowed=useCallback(()=>{const call=localAccountCalls()?.snapshot();return focused&&AppState.currentState==='active'&&!rootVoiceRecordingActive()&&(!call||call.status==='ended')&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner;},[owner,focused]);
 const subscribe=useCallback((changed:()=>void)=>{const a=localAccount.subscribe(changed),b=subscribeLocalAccountCalls(changed),c=subscribeRootVoiceRecording(changed),app=AppState.addEventListener('change',changed);return()=>{a();b();c();app.remove();};},[]);
 return <VoiceMessageBubble fileUri={uri} durationMs={null} tint={colors.primary} subtleColor={colors.textSecondary} trackBg={colors.neonBorder} playbackAllowed={allowed} subscribePlaybackAllowed={subscribe} onPlaybackError={onError} sequence={focused&&owner&&voiceKey?{owner,key:voiceKey,next:nextVoice}:undefined} messageFooter={messageFooter}/>;
}
