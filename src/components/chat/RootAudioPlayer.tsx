import React from 'react';
import {rootVoiceRecordingActive} from '../../modules/messaging';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {localAccountCalls} from '../../modules/messaging';
import VoiceMessageBubble from '../VoiceMessageBubble';
export default function RootAudioPlayer({uri,onError}:{uri:string;onError(error:string):void}){
 const {colors}=useTheme(),owner=localAccount.status().account;
 const allowed=()=>{const call=localAccountCalls()?.snapshot();return !rootVoiceRecordingActive()&&(!call||call.status==='ended')&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner;};
 return <VoiceMessageBubble fileUri={uri} durationMs={null} tint={colors.primary} subtleColor={colors.textSecondary} trackBg={colors.neonBorder} playbackAllowed={allowed} onPlaybackError={onError}/>;
}
