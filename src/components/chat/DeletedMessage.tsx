import {useLanguage} from '../../localization/useLanguage';
import {t} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';

/** Let the complete tombstone wrap at large system font sizes. */
export default function DeletedMessage({color}:{color:string}){
 useLanguage();
 return <View style={{flexDirection:'row',minWidth:150,maxWidth:'100%'}} accessibilityLabel={t("Message deleted")}>
  <Text style={{color,fontSize:14,fontStyle:'italic',flexShrink:1}}>{t("Message deleted")}</Text>
 </View>;
}
