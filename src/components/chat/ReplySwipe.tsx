import React from 'react';
import {View} from 'react-native';
import {Swipeable} from 'react-native-gesture-handler';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {messageBubbleStyles as styles} from './message-bubble-styles';
export default function ReplySwipe({children,disabled,onReply}:{children:React.ReactNode;disabled?:boolean;onReply():void}){
 const {colors}=useTheme();
 return <Swipeable renderLeftActions={()=><View style={styles.swipeReplyHint}><Ionicons name="arrow-undo" size={22} color={colors.primary}/></View>} leftThreshold={40} friction={2} overshootLeft={false} enabled={!disabled} onSwipeableOpen={(direction,swipeable)=>{if(direction==='left'){onReply();swipeable.close();}}}>{children}</Swipeable>;
}
