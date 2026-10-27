import React from 'react';
import {Text,View} from 'react-native';
import type {RootChatMessage} from '../../modules/messaging';
import {messageInfoTimeline,messageInfoRoutes} from '../../modules/messaging';
import {useTheme} from '../../contexts/ThemeContext';

export function MessageStatusTimes({message,now}:{message:RootChatMessage;now:number}){
 const {colors}=useTheme();
 return <View style={{gap:8,marginTop:8}}>{messageInfoTimeline(message,now).map(row=><View key={row.label}>
  <Text style={{color:colors.textSecondary}}>{row.label}</Text>
  <Text style={{color:colors.text}}>{row.at===undefined?'Not recorded':new Date(row.at).toLocaleString()}</Text>
 </View>)}<Text style={{color:colors.textSecondary}}>Times use this device’s clock. Missing times are not estimated.</Text>
 {messageInfoRoutes(message).map(row=><View key={row.label}><Text style={{color:colors.textSecondary}}>{row.label}</Text><Text selectable style={{color:colors.text}}>{row.value}</Text></View>)}
 </View>;
}
