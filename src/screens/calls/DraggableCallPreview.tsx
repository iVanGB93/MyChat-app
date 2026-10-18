import React,{useMemo,useRef} from 'react';
import {Animated,PanResponder,useWindowDimensions,type StyleProp,type ViewStyle} from 'react-native';

/** Temporary movement only: releasing or losing the gesture restores the usual corner. */
export default function DraggableCallPreview({children,style,testID}:{children:React.ReactNode;style?:StyleProp<ViewStyle>;testID?:string}){
 const position=useRef(new Animated.ValueXY()).current;
 const bounds=useWindowDimensions();
 const gesture=useMemo(()=>{
  const reset=()=>Animated.spring(position,{toValue:{x:0,y:0},useNativeDriver:true,tension:90,friction:12}).start();
  return PanResponder.create({
   onStartShouldSetPanResponder:()=>true,
   onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)+Math.abs(g.dy)>4,
   onPanResponderGrant:()=>position.stopAnimation(),
   onPanResponderMove:(_,g)=>position.setValue({x:Math.max(-bounds.width+140,Math.min(0,g.dx)),y:Math.max(0,Math.min(bounds.height-220,g.dy))}),
   onPanResponderRelease:reset,onPanResponderTerminate:reset,
   onPanResponderTerminationRequest:()=>true,
  });
 },[position,bounds.width,bounds.height]);
 return <Animated.View testID={testID} accessibilityLabel="Your camera preview. Drag to see underneath; release to return." {...gesture.panHandlers} style={[style,{transform:position.getTranslateTransform()}]}>{children}</Animated.View>;
}
