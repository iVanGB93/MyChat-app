import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import Svg,{Circle,Path} from 'react-native-svg';

type Expression='smile'|'blink'|'wink'|'laugh'|'tongue';
const expressions:Expression[]=['blink','laugh','wink','tongue'];

/** Only mounted for the floating control; no frame-by-frame React updates. */
export default function AnimatedStickerButtonFace({color,enabled=true}:{color:string;enabled?:boolean}){
 const focused=useIsFocused(),[active,setActive]=useState(AppState.currentState==='active');
 const [reduceMotion,setReduceMotion]=useState(true),[expression,setExpression]=useState<Expression>('smile');
 const bounce=useRef(new Animated.Value(0)).current;
 useEffect(()=>{
  let alive=true,changed=false;
  void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive&&!changed)setReduceMotion(value);}).catch(()=>{});
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>{changed=true;setReduceMotion(value);});
  const app=AppState.addEventListener('change',state=>setActive(state==='active'));
  return()=>{alive=false;motion.remove();app.remove();};
 },[]);
 useEffect(()=>{
  setExpression('smile');bounce.setValue(0);
  if(!enabled||!focused||!active||reduceMotion)return;
  let stopped=false,index=0,timer:ReturnType<typeof setTimeout>;
  let animation:Animated.CompositeAnimation|undefined;
  const play=()=>{
   if(stopped)return;
   const next=expressions[index++%expressions.length];setExpression(next);
   if(next==='laugh'){
    const frame=(toValue:number)=>Animated.timing(bounce,{toValue,duration:140,easing:Easing.inOut(Easing.sin),useNativeDriver:true,isInteraction:false});
    animation=Animated.sequence([frame(-1.5),frame(0),frame(-1.5),frame(0)]);animation.start();
   }
   timer=setTimeout(()=>{
    if(stopped)return;
    setExpression('smile');timer=setTimeout(play,4200);
   },next==='blink'?150:next==='wink'?550:850);
  };
  timer=setTimeout(play,2800);
  return()=>{stopped=true;clearTimeout(timer);animation?.stop();bounce.setValue(0);};
 },[enabled,focused,active,reduceMotion,bounce]);
 return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:26,height:26,transform:[{translateY:bounce}]}}>
  <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
   <Circle cx={12} cy={12} r={9.2}/>
   {expression==='blink'||expression==='laugh'?<><Path d="M7 9.5 Q8.3 8 9.6 9.5"/><Path d="M14.4 9.5 Q15.7 8 17 9.5"/></>:<>
    <Circle cx={8.2} cy={9.2} r={0.8} fill={color} stroke="none"/>
    {expression==='wink'?<Path d="M14.4 9.5 L17 9.5"/>:<Circle cx={15.8} cy={9.2} r={0.8} fill={color} stroke="none"/>}
   </>}
   {expression==='laugh'?<Path d="M7.3 13 H16.7 Q16 18 12 18 Q8 18 7.3 13Z" fill={color} strokeWidth={1}/>:expression==='tongue'?<><Path d="M7.5 13 Q12 16 16.5 13"/><Path d="M11.5 14.5 V16.8 Q11.5 19 13.4 19 Q15.3 19 15.3 16.8 V14.5" fill={color} strokeWidth={1}/></>:<Path d="M7.5 13.5 Q12 18 16.5 13.5"/>}
  </Svg>
 </Animated.View>;
}
