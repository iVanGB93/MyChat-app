import React,{useState} from 'react';
import {View,type TextStyle} from 'react-native';
import SmartMessageText from '../SmartMessageText';

/** An atomic inline spacer lets native text layout reserve room for the footer.
 * Short bubbles grow naturally; wrapped text moves the whole footer to a new
 * line only when necessary. No separate last-line width estimation is needed. */
export default function MessageTextWithFooter({text,style,linkColor,footer}:{text:string;style:TextStyle|TextStyle[];linkColor:string;footer:React.ReactNode}){
 const [size,setSize]=useState({width:0,height:0});
 return <View>
  <SmartMessageText style={style} linkColor={linkColor} trailing={size.width>0?<View accessible={false} importantForAccessibility="no-hide-descendants" style={{width:Math.ceil(size.width)+8,height:Math.ceil(size.height)}}/>:undefined}>{text}</SmartMessageText>
  <View onLayout={e=>{const {width,height}=e.nativeEvent.layout;setSize(old=>old.width===width&&old.height===height?old:{width,height});}} style={{position:'absolute',right:0,bottom:0}}>{footer}</View>
 </View>;
}
