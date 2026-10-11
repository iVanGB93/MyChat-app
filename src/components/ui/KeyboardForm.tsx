import React,{createContext,forwardRef,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {AppState,findNodeHandle,Keyboard,KeyboardAvoidingView,Platform,ScrollView,StyleSheet,TextInput,View,type ScrollViewProps,type TextInputProps,type ViewProps} from 'react-native';
import {getKeyboardOverlap,supportsKeyboardOverlap} from '../../../modules/axonic-app-update';
import {keyboardScrollDelta} from '../../utils/keyboard-visibility';

type FieldContext={focus(input:TextInput):void;blur(input:TextInput):void};
const FocusContext=createContext<FieldContext|null>(null);
const KeyboardLayoutContext=createContext({nativeInsets:false,visible:false});

/** Each screen/modal owns its avoidance; embedded editors reuse their parent. */
export function KeyboardAvoidingScreen({children,style,keyboardVerticalOffset,...props}:ViewProps&{keyboardVerticalOffset?:number}){
 const root=useRef<View>(null),[top,setTop]=useState(0);
 const [layout,setLayout]=useState({visible:false,overlap:0});
 const rootStyle=StyleSheet.flatten(style),basePadding=rootStyle?.paddingBottom??rootStyle?.paddingVertical??rootStyle?.padding;
 const nativeInsets=Platform.OS==='android'&&Number(Platform.Version)>=30&&supportsKeyboardOverlap();
 useEffect(()=>{
  if(!nativeInsets)return;
  let active=true,running=false;
  const refresh=async()=>{
   if(running||AppState.currentState!=='active')return;
   const tag=findNodeHandle(root.current);if(tag===null)return;
   running=true;
   try{
    const next=await getKeyboardOverlap(tag);
    if(active&&next)setLayout(current=>current.visible===next.visible&&current.overlap===next.overlap?current:next);
   }finally{running=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),250);
  return()=>{active=false;clearInterval(timer);};
 },[nativeInsets]);
 return <View {...props} ref={root} collapsable={false} style={[{flex:1},style,nativeInsets&&{paddingBottom:Math.max(typeof basePadding==='number'?basePadding:0,layout.overlap)}]} onLayout={event=>{
  props.onLayout?.(event);root.current?.measureInWindow((_x,y)=>setTop(y));
 }}><KeyboardLayoutContext.Provider value={{nativeInsets,visible:layout.visible}}><KeyboardAvoidingView enabled={!nativeInsets} style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={keyboardVerticalOffset??top}>{children}</KeyboardAvoidingView></KeyboardLayoutContext.Provider></View>;
}

export function KeyboardFormScrollView({avoidKeyboard=true,keyboardVerticalOffset,...props}:ScrollViewProps&{avoidKeyboard?:boolean;keyboardVerticalOffset?:number}){
 const content=<KeyboardFormContent {...props}/>;
 return avoidKeyboard?<KeyboardAvoidingScreen keyboardVerticalOffset={keyboardVerticalOffset}>{content}</KeyboardAvoidingScreen>:content;
}

function KeyboardFormContent({contentContainerStyle,onScroll,onLayout,onContentSizeChange,...props}:ScrollViewProps){
 const scroll=useRef<ScrollView>(null),focused=useRef<TextInput|null>(null),offset=useRef(0),keyboardTop=useRef<number|null>(null),mounted=useRef(true);
 const [keyboardVisible,setKeyboardVisible]=useState(Keyboard.isVisible());
 const {nativeInsets,visible:nativeVisible}=useContext(KeyboardLayoutContext);
 const reveal=useCallback(()=>{
  requestAnimationFrame(()=>{
   const field=focused.current;if(!mounted.current||!field)return;
   scroll.current?.getNativeScrollRef()?.measureInWindow((_x,y,_w,height)=>{
    field.measureInWindow((_fx,fy,_fw,fh)=>{
     if(!mounted.current||focused.current!==field)return;
     const delta=keyboardScrollDelta(fy,fh,y,height,nativeInsets?Infinity:keyboardTop.current??Infinity);
     if(delta)scroll.current?.scrollTo({y:Math.max(0,offset.current+delta),animated:true});
    });
   });
  });
 },[nativeInsets]);
 useEffect(()=>{
  mounted.current=true;keyboardTop.current=Keyboard.metrics()?.screenY??null;reveal();
  const show=Keyboard.addListener('keyboardDidShow',event=>{keyboardTop.current=event.endCoordinates.screenY;setKeyboardVisible(true);reveal();});
  const hide=Keyboard.addListener('keyboardDidHide',()=>{keyboardTop.current=null;setKeyboardVisible(false);});
  return()=>{mounted.current=false;show.remove();hide.remove();};
 },[reveal]);
 const contentStyle=StyleSheet.flatten(contentContainerStyle);
 const padding=contentStyle?.paddingBottom??contentStyle?.paddingVertical??contentStyle?.padding;
 const content=<FocusContext.Provider value={{focus:input=>{focused.current=input;reveal();},blur:input=>{if(focused.current===input)focused.current=null;}}}>
  <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps={props.keyboardShouldPersistTaps??'handled'} keyboardDismissMode={props.keyboardDismissMode??'on-drag'} scrollEventThrottle={16}
   contentContainerStyle={[contentContainerStyle,{paddingBottom:(typeof padding==='number'?padding:0)+(keyboardVisible||nativeVisible?112:0)}]}
   onScroll={event=>{offset.current=event.nativeEvent.contentOffset.y;onScroll?.(event);}}
   onLayout={event=>{onLayout?.(event);reveal();}} onContentSizeChange={(w,h)=>{onContentSizeChange?.(w,h);reveal();}}/>
 </FocusContext.Provider>;
 return content;
}

/** Keeps the native ref and caller focus handlers, including recovery-word editors. */
export const KeyboardAwareTextInput=forwardRef<TextInput,TextInputProps>(function KeyboardAwareTextInput({onFocus,onBlur,...props},ref){
 const input=useRef<TextInput|null>(null),context=useContext(FocusContext);
 const assignRef=useCallback((value:TextInput|null)=>{input.current=value;if(typeof ref==='function')ref(value);else if(ref)ref.current=value;},[ref]);
 return <TextInput {...props} ref={assignRef}
  onFocus={event=>{if(input.current)context?.focus(input.current);onFocus?.(event);}}
  onBlur={event=>{if(input.current)context?.blur(input.current);onBlur?.(event);}}/>;
});
