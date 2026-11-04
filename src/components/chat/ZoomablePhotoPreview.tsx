import {useLanguage} from '../../localization/useLanguage';
import {t,languageSnapshot} from '../../localization/language';
import React,{useEffect,useMemo,useRef} from 'react';
import {Animated,PanResponder,Pressable,View} from 'react-native';
import {Image} from 'expo-image';
import {clampImageZoom,clampImageTranslation,touchDistance,DOUBLE_TAP_IMAGE_ZOOM} from '../../utils/image-viewer-gestures';

/** At 1x, horizontal drags belong to the gallery. Zoomed gestures belong to the photo. */
export default function ZoomablePhotoPreview({uri,active,onZoomChange,onError}:{uri:string;active:boolean;onZoomChange(zoomed:boolean):void;onError():void}){
 useLanguage();
 const scale=useRef(new Animated.Value(1)).current,x=useRef(new Animated.Value(0)).current,y=useRef(new Animated.Value(0)).current;
 const state=useRef({scale:1,x:0,y:0,width:1,height:1,distance:0,startScale:1,px:0,py:0,startX:0,startY:0,mode:''});
 const lastTap=useRef(0),callback=useRef(onZoomChange);callback.current=onZoomChange;
 const apply=(zoom:number,tx=0,ty=0)=>{const s=state.current;s.scale=clampImageZoom(zoom);s.x=clampImageTranslation(tx,s.scale,s.width);s.y=clampImageTranslation(ty,s.scale,s.height);scale.setValue(s.scale);x.setValue(s.x);y.setValue(s.y);};
 const reset=()=>{apply(1);lastTap.current=0;state.current.mode='';callback.current(false);};
 useEffect(()=>{reset();},[uri,active]);
 const handlers=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponderCapture:e=>e.nativeEvent.touches.length>=2,
  onMoveShouldSetPanResponderCapture:(e,g)=>e.nativeEvent.touches.length>=2||(state.current.scale>1&&(Math.abs(g.dx)>2||Math.abs(g.dy)>2)),
  onPanResponderGrant:e=>{lastTap.current=0;const s=state.current,t=e.nativeEvent.touches;s.distance=touchDistance(t);s.startScale=s.scale;s.startX=s.x;s.startY=s.y;s.px=t[0]?.pageX??0;s.py=t[0]?.pageY??0;s.mode=t.length>=2?'pinch':'pan';callback.current(true);},
  onPanResponderMove:e=>{const s=state.current,t=e.nativeEvent.touches;if(t.length>=2){const d=touchDistance(t);if(s.mode!=='pinch'){s.distance=d;s.startScale=s.scale;s.mode='pinch';}if(s.distance>0)apply(s.startScale*d/s.distance,s.x,s.y);}else if(t[0]&&s.scale>1){if(s.mode!=='pan'){s.mode='pan';s.px=t[0].pageX;s.py=t[0].pageY;s.startX=s.x;s.startY=s.y;}apply(s.scale,s.startX+t[0].pageX-s.px,s.startY+t[0].pageY-s.py);}},
  onPanResponderRelease:()=>{state.current.mode='';if(state.current.scale<=1.05)reset();else callback.current(true);},
  onPanResponderTerminate:()=>reset(),
  onPanResponderTerminationRequest:()=>false,
 }),[languageSnapshot()]);
 const doubleTap=()=>{const now=Date.now();if(!lastTap.current||now-lastTap.current>280){lastTap.current=now;return;}lastTap.current=0;if(state.current.scale>1)reset();else{apply(DOUBLE_TAP_IMAGE_ZOOM);callback.current(true);}};
 return <View style={{flex:1,overflow:'hidden'}} {...handlers.panHandlers} onLayout={e=>{const {width,height}=e.nativeEvent.layout;if(width!==state.current.width||height!==state.current.height){state.current.width=width;state.current.height=height;reset();}}}>
  <Pressable style={{flex:1}} onPress={doubleTap} accessibilityRole="imagebutton" accessibilityLabel={t("Photo preview. Double-tap or pinch to zoom.")} accessibilityActions={[{name:'activate',label:t("Toggle zoom")}]} onAccessibilityAction={()=>{if(state.current.scale>1)reset();else{apply(DOUBLE_TAP_IMAGE_ZOOM);callback.current(true);}}}>
   <Animated.View style={{flex:1,transform:[{translateX:x},{translateY:y},{scale}]}}><Image source={{uri}} contentFit="contain" style={{width:'100%',height:'100%'}} onError={onError}/></Animated.View>
  </Pressable>
 </View>;
}
