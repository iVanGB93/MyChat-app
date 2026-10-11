import {AppState} from 'react-native';
import {createMessageSounds} from '../services/messageSounds';
import {subscribeRootMessageFeedback} from '../services/identity/rootMessageFeedback';
import {rootConversationVisible} from '../services/identity/rootNotificationRoute';
import {readRootNotificationPreferences} from '../services/identity/rootNotificationPreferences';
import {localAccount} from '../services/identity/localAccount';
import {rootVoiceRecordingActive} from '../services/identity/rootVoiceRecorder';
import {localAccountCalls} from './neuronRuntime';
import {playMessageSound,stopMessageSounds} from '../services/soundService';
export function startMessageSounds(){
 const sounds=createMessageSounds({current:owner=>{const call=localAccountCalls()?.snapshot();return AppState.currentState==='active'&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner&&!rootVoiceRecordingActive()&&(!call||call.status==='ended');},visible:rootConversationVisible,preferences:readRootNotificationPreferences,play:playMessageSound});
 let generation=0;
 const pending=new Set<ReturnType<typeof setTimeout>>();
 // Let the enqueue promise and voice recorder's cleanup finish before audio feedback.
 const stop=subscribeRootMessageFeedback(event=>{if(AppState.currentState!=='active'||localAccount.status().state!=='unlocked'||localAccount.status().account!==event.owner)return;const own=generation;const timer=setTimeout(()=>{pending.delete(timer);if(own===generation)void sounds.receive(event);},0);pending.add(timer);});
 let lastOwner=localAccount.status().account;
 const accountStop=localAccount.subscribe(()=>{const status=localAccount.status();if(status.state!=='unlocked'||status.account!==lastOwner){generation++;stopMessageSounds();}lastOwner=status.account;});
 const lifecycle=AppState.addEventListener('change',state=>{if(state!=='active'){generation++;stopMessageSounds();}});
 return()=>{accountStop();lifecycle.remove();stop();for(const timer of pending)clearTimeout(timer);pending.clear();sounds.stop();stopMessageSounds();};
}
