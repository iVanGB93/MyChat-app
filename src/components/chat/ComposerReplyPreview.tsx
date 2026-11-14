import React from 'react';
import {Pressable, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {chatRoomStyles as styles} from './chat-room-styles';

export default function ComposerReplyPreview({children,cancelLabel,onCancel,editing=false}:{
  children:React.ReactNode;cancelLabel:string;onCancel():void;editing?:boolean;
}){
  const {colors}=useTheme();
  return <View style={styles.composerReplyPreview}>
    <View style={styles.composerReplyContent}>
      <Ionicons name={editing?'create-outline':'arrow-undo-outline'} size={18} color={colors.primary}/>
      <View style={styles.composerReplyBody}>{children}</View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel} onPress={onCancel}
      style={({pressed})=>[styles.composerReplyClose,{opacity:pressed?0.65:1}]}>
      <Ionicons name="close" size={22} color={colors.primary}/>
    </Pressable>
  </View>;
}
