import {t} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';
import type {RootChatMessage} from '../../modules/messaging';
import {messageInfoTimeline,messageInfoRoutes} from '../../modules/messaging';
import {useTheme} from '../../contexts/ThemeContext';

export function MessageStatusTimes({message,now,owner,name}:{message:RootChatMessage;now:number;owner?:string|null;name?:(account:string)=>string}){
 const {colors}=useTheme();
 return <View style={{gap:8,marginTop:8}}>{messageInfoTimeline(message,now).map(row=><View key={row.label}>
  <Text style={{color:colors.textSecondary}}>{row.label}</Text>
  <Text style={{color:colors.text}}>{row.at===undefined?t("Not recorded"):new Date(row.at).toLocaleString()}</Text>
 </View>)}<Text style={{color:colors.textSecondary}}>{t("Times use this device’s clock. Missing times are not estimated.")}</Text>
 {messageInfoRoutes(message,owner&&name?{owner,name}:undefined).map(row=><View key={row.label}><Text style={{color:colors.textSecondary}}>{row.label}</Text><Text selectable style={{color:colors.text}}>{row.value}</Text></View>)}
 </View>;
}
