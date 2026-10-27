import React from 'react';
import {View} from 'react-native';
import {chatConnection} from '../../modules/network';
import {useNetworkState} from '../../modules/ui/liveState';
export default function ChatConnectionBar({peer}:{peer:string}){
 const connections=useNetworkState(s=>s.liveConnections);
 const status=chatConnection(peer,connections??[],Date.now());
 return <View accessible accessibilityLabel={status.label} style={{height:2,backgroundColor:status.color}} />;
}
