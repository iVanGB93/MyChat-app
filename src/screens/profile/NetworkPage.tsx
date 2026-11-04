import React from 'react';
import {ScrollView} from 'react-native';
import {useHeaderHeight} from '@react-navigation/elements';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
export default function NetworkPage({children}:{children:React.ReactNode}){
 const headerHeight=useHeaderHeight(),insets=useSafeAreaInsets();
 return <ScrollView contentContainerStyle={{paddingHorizontal:16,paddingTop:headerHeight+8,paddingBottom:insets.bottom+24,gap:16}}>{children}</ScrollView>;
}
