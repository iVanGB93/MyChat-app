import {readSharedAvatar} from '../../modules/storage';
import React,{useEffect,useRef,useState} from 'react';
import {Animated,AppState,Image,Text,TouchableOpacity,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {subscribeRootMessageToast,type RootToast} from '../../modules/messaging/notifications';
import {queueRootNotificationOpen} from '../../modules/messaging/notifications';
import {messageToastStyles as styles} from './message-toast-styles';
import {chatPreviewText} from '../../utils/chat-preview-text';
export default function RootMessageToast(){
 const {colors}=useTheme(),[toast,setToast]=useState<(RootToast&{count:number})|null>(null),slide=useRef(new Animated.Value(-120)).current,timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [avatar,setAvatar]=useState<string|null>(null);
 useEffect(()=>{let live=true;setAvatar(null);if(toast)void readSharedAvatar(toast.account,toast.sender).then(uri=>{if(live&&localAccount.status().state==='unlocked'&&localAccount.status().account===toast.account)setAvatar(uri);}).catch(()=>{});return()=>{live=false;};},[toast?.account,toast?.sender]);
 const generation=useRef(0);
 const dismiss=()=>{const version=++generation.current;if(timer.current)clearTimeout(timer.current);Animated.timing(slide,{toValue:-120,duration:250,useNativeDriver:true}).start(()=>{if(generation.current===version)setToast(null);});};
 useEffect(()=>{
  const unsubscribe=subscribeRootMessageToast(preview=>{
   if(AppState.currentState!=='active'||localAccount.status().state!=='unlocked'||localAccount.status().account!==preview.account)return false;
   generation.current++;if(timer.current)clearTimeout(timer.current);setToast(old=>({...preview,count:old?.sender===preview.sender&&old.group===preview.group?old.count+1:1}));
   Animated.timing(slide,{toValue:0,duration:250,useNativeDriver:true}).start();timer.current=setTimeout(dismiss,5000);return true;
  });
  const listener=AppState.addEventListener('change',state=>{if(state!=='active'){if(timer.current)clearTimeout(timer.current);slide.setValue(-120);setToast(null);}});
  return()=>{unsubscribe();listener.remove();if(timer.current)clearTimeout(timer.current);slide.stopAnimation();};
 },[slide]);
 if(!toast||localAccount.status().state!=='unlocked'||localAccount.status().account!==toast.account)return null;
 return <Animated.View style={[styles.container,{transform:[{translateY:slide}]}]}><TouchableOpacity accessibilityLabel="Open message notification" style={[styles.inner,{backgroundColor:colors.surface,borderColor:colors.neonBorder,shadowColor:colors.primary}]} activeOpacity={0.85} onPress={()=>{if(localAccount.status().account===toast.account)void queueRootNotificationOpen({type:'root_neuron_message',account:toast.account,sender:toast.sender,...(toast.group?{group:toast.group}:{})});dismiss();}}><View style={[styles.avatar,{backgroundColor:colors.highlight,borderColor:colors.primary}]}>{avatar?<Image source={{uri:avatar}} style={{width:36,height:36,borderRadius:18}} onError={()=>setAvatar(null)}/>:<Text style={[styles.avatarText,{color:colors.primary}]}>{toast.name.charAt(0).toUpperCase()}</Text>}</View><View style={styles.textCol}><Text style={[styles.sender,{color:colors.primary}]} numberOfLines={1}>{toast.name}{toast.count>1&&<Text style={{color:colors.textTertiary,fontWeight:'400'}}> · {toast.count} notifications</Text>}</Text><Text style={[styles.content,{color:colors.textSecondary}]} numberOfLines={1}>{chatPreviewText(toast.text)}</Text></View><TouchableOpacity accessibilityLabel="Dismiss message notification" onPress={dismiss} hitSlop={10}><Text style={[styles.close,{color:colors.textTertiary}]}>✕</Text></TouchableOpacity></TouchableOpacity></Animated.View>;
}
