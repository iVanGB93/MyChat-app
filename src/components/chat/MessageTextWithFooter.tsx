import React,{useState} from 'react';
import {PixelRatio,View,type TextStyle} from 'react-native';
import SmartMessageText from '../SmartMessageText';

/** An atomic inline spacer lets native text layout reserve room for the footer.
 * Short bubbles grow naturally; wrapped text moves the whole footer to a new
 * line only when necessary. No separate last-line width estimation is needed. */
type Size={width:number;height:number};
// Identical time/status labels use the same typography across both chat types.
const measurements=new Map<string,Size>();
export default function MessageTextWithFooter({text,style,linkColor,footer,footerKey}:{text:string;style:TextStyle|TextStyle[];linkColor:string;footer:React.ReactNode;footerKey:string}){
 const key=PixelRatio.getFontScale()+':'+footerKey;
 const [measured,setMeasured]=useState<{key:string;size:Size}>();
 const size=measured?.key===key?measured.size:measurements.get(key);
 return <View>
  <SmartMessageText style={style} linkColor={linkColor} trailing={size?<View accessible={false} importantForAccessibility="no-hide-descendants" style={{width:size.width+8,height:size.height}}/>:undefined}>{text}</SmartMessageText>
  <View onLayout={e=>{
   const width=Math.ceil(e.nativeEvent.layout.width),height=Math.ceil(e.nativeEvent.layout.height);
   if(width<=0||height<=0)return;
   if(measurements.size>=256&&!measurements.has(key))measurements.delete(measurements.keys().next().value!);
   const next={width,height};
   measurements.set(key,next);
   if(size?.width!==width||size.height!==height)setMeasured({key,size:next});
  }} style={{position:'absolute',right:0,bottom:0}}>{footer}</View>
 </View>;
}
