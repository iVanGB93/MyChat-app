import React,{useEffect,useState} from 'react';
import {AppState,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {chatConnection,localAccountNetworkSnapshot} from '../../modules/network';
export default function ChatConnectionBar({peer}:{peer:string}){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const read=()=>chatConnection(peer,localAccountNetworkSnapshot()?.pool?.connections??[],Date.now());
 const [status,setStatus]=useState(read);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useEffect(()=>{if(!focused||!foreground)return;const refresh=()=>setStatus(read());refresh();const timer=setInterval(refresh,1000);return()=>clearInterval(timer);},[peer,focused,foreground]);
 return <View accessible accessibilityLabel={status.label} style={{height:2,backgroundColor:status.color}} />;
}
