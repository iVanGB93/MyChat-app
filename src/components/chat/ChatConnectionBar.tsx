import {useForegroundEvents} from '../../hooks/useForegroundEvents';
import {subscribeLocalNetworkChanges} from '../../modules/network';
import React,{useEffect,useState} from 'react';
import {AppState,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {chatConnection,localAccountNetworkSnapshot} from '../../modules/network';
export default function ChatConnectionBar({peer}:{peer:string}){
 const focused=useIsFocused(),[foreground,setForeground]=useState(AppState.currentState==='active');
 const read=()=>chatConnection(peer,localAccountNetworkSnapshot()?.pool?.connections??[],Date.now());
 const [status,setStatus]=useState(read);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setForeground(s==='active'));return()=>sub.remove();},[]);
 useForegroundEvents(()=>setStatus(read()),subscribeLocalNetworkChanges,focused&&foreground,peer);
 return <View accessible accessibilityLabel={status.label} style={{height:2,backgroundColor:status.color}} />;
}
