import {t} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';
import {useTheme} from '../../contexts/ThemeContext';
import {Chrome} from '../../theme';
import type {RootChatMessage} from '../../modules/messaging';

export default function MessageReactionInfo({message,name}:{message:RootChatMessage;name(author:string):string}){
 const {colors}=useTheme();
 if(message.deleted)return null;
 const seen=new Set<string>();
 const reactions=(message.reactions??[]).filter(reaction=>{
  if(!reaction.text||seen.has(reaction.author))return false;
  seen.add(reaction.author);return true;
 });
 return <View style={{padding:16,borderRadius:Chrome.cardRadius,borderWidth:1,borderColor:colors.neonBorder,backgroundColor:colors.surface,gap:14}}>
  <Text accessibilityRole="header" style={{color:colors.primary,fontSize:18,fontWeight:'700'}}>{t("Reactions")}</Text>
  {reactions.length?reactions.map(reaction=><View key={reaction.author} style={{flexDirection:'row',alignItems:'center',gap:14}}>
   <Text style={{fontSize:26}}>{reaction.text}</Text>
   <Text selectable style={{color:colors.text,flex:1,fontSize:16}}>{name(reaction.author)}</Text>
  </View>):<Text style={{color:colors.textSecondary}}>{t("No reactions yet.")}</Text>}
 </View>;
}
