import React,{useCallback} from 'react';
import {rootVoiceRecordingActive,subscribeRootVoiceRecording} from '../../modules/media';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {localAccountCalls,subscribeLocalAccountCalls} from '../../modules/calls';
import VoiceMessageBubble from '../VoiceMessageBubble';
export default function RootAudioPlayer({uri,onError,messageFooter}:{uri:string;onError(error:string):void;messageFooter?:React.ReactNode}){
 const {colors}=useTheme(),owner=localAccount.status().account;
 const allowed=useCallback(()=>{const call=localAccountCalls()?.snapshot();return !rootVoiceRecordingActive()&&(!call||call.status==='ended')&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner;},[owner]);
 const subscribe=useCallback((changed:()=>void)=>{const a=localAccount.subscribe(changed),b=subscribeLocalAccountCalls(changed),c=subscribeRootVoiceRecording(changed);return()=>{a();b();c();};},[]);
 return <VoiceMessageBubble fileUri={uri} durationMs={null} tint={colors.primary} subtleColor={colors.textSecondary} trackBg={colors.neonBorder} playbackAllowed={allowed} subscribePlaybackAllowed={subscribe} onPlaybackError={onError} messageFooter={messageFooter}/>;
}
