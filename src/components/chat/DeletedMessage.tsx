import {useLanguage} from '../../localization/useLanguage';
import {t} from '../../localization/language';
import React from 'react';
import {Text,View} from 'react-native';

/** Let the complete tombstone wrap at large system font sizes. */
export default function DeletedMessage({color}:{color:string}){
 useLanguage();
 return <View style={{minWidth:160,maxWidth:'100%',alignSelf:'stretch'}} accessibilityLabel={t("Message deleted")}>
  <Text style={{color,fontSize:14,lineHeight:20,fontStyle:'italic',alignSelf:'stretch'}}>{t("Message deleted")}</Text>
 </View>;
}
