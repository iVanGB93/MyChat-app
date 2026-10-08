import React from 'react';
import {Modal,Pressable,Text,TouchableOpacity,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {chatRoomStyles as styles} from './chat-room-styles';

export default function AttachmentMenu({visible,onClose,onCamera,onMultimedia,onFiles}:{
 visible:boolean;onClose():void;onCamera():void;onMultimedia():void;onFiles():void;
}){
 const {colors}=useTheme(),insets=useSafeAreaInsets();
 const rows=[
  {label:'Camera',icon:'camera' as const,action:onCamera},
  {label:'Multimedia',icon:'images' as const,action:onMultimedia},
  {label:'Files',icon:'document-attach-outline' as const,action:onFiles},
  {label:'Cancel',icon:'close' as const,action:onClose},
 ];
 return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
  <Pressable style={styles.modalBackdrop} onPress={onClose}>
   <Pressable onPress={event=>event.stopPropagation()} style={[styles.attachSheet,{backgroundColor:colors.surface,borderColor:colors.neonBorder,marginBottom:24+insets.bottom}]}>
    {rows.map((row,index)=><React.Fragment key={row.label}>
     {index>0&&<View style={[styles.attachDivider,{backgroundColor:colors.border}]}/>}
     <TouchableOpacity accessibilityRole="button" accessibilityLabel={row.label} style={styles.attachRow} onPress={row.action} activeOpacity={0.7}>
      <Ionicons name={row.icon} size={22} color={index===3?colors.textTertiary:colors.primary}/>
      <Text style={[styles.attachLabel,{color:index===3?colors.textTertiary:colors.text}]}>{row.label}</Text>
     </TouchableOpacity>
    </React.Fragment>)}
   </Pressable>
  </Pressable>
 </Modal>;
}
