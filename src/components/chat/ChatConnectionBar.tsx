import React from 'react';
import {View} from 'react-native';
import {chatConnection} from '../../modules/network';
import {useNetworkState} from '../../modules/ui/liveState';
export default function ChatConnectionBar({peer,edge=false}:{peer:string;edge?:boolean}){
 const connections=useNetworkState(s=>s.liveConnections);
 const status=chatConnection(peer,connections??[],Date.now());
 return <View accessible accessibilityLabel={status.label} pointerEvents="none" style={edge?{position:'absolute',top:-1,bottom:-1,left:-1,right:-1,borderRadius:28,borderBottomWidth:2,borderBottomColor:status.color}:{height:2,backgroundColor:status.color}} />;
}
