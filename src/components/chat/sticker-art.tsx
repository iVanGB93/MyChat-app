import React, { useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Rect, Path, Circle, Ellipse, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { Sticker } from '../../services/stickers';

/** Bundled vector artwork: no requests, filesystem copies, or Gallery clutter. */
export default function StickerArt({ sticker, size = 150, animate = true, loop = false }: { sticker: Sticker; size?: number; animate?: boolean; loop?: boolean }) {
  const artId=useId().replace(/[^a-zA-Z0-9]/g,'');
  const motion = useRef(new Animated.Value(0)).current;
  const expression = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  // Start still until the accessibility setting has been checked.
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted && !changed) setReduceMotion(value); }).catch(() => {});
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { changed = true; setReduceMotion(value); });
    const app = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => { mounted = false; accessibility.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    motion.setValue(0);
    expression.setValue(0);
    blink.setValue(0);
    if (!animate || reduceMotion || !active || !focused) return;
    const frame = (toValue: number, duration: number) => Animated.timing(motion, {
      toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
    });
    const beat=sticker.id==='party'?180:sticker.mood==='laugh'?150:sticker.mood==='sad'?460:260;
    const animation = Animated.loop(Animated.sequence([
      frame(1, beat), frame(-1, beat), frame(1, beat), frame(-0.5, beat), frame(0, beat), Animated.delay(sticker.id==='party'?600:1100),
    ]), { iterations: loop ? -1 : 3 });
    animation.start();
    const facialAnimation = Animated.loop(Animated.sequence([
      Animated.delay(350),
      Animated.timing(expression, { toValue: 1, duration: 420, useNativeDriver: true, isInteraction: false }),
      Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true, isInteraction: false }),
      Animated.timing(blink, { toValue: 0, duration: 140, useNativeDriver: true, isInteraction: false }),
      Animated.delay(300),
      Animated.timing(expression, { toValue: 0, duration: 480, useNativeDriver: true, isInteraction: false }),
      Animated.delay(900),
    ]), { iterations: loop ? -1 : 3 });
    facialAnimation.start();
    return () => { animation.stop(); facialAnimation.stop(); motion.setValue(0); expression.setValue(0); blink.setValue(0); };
  }, [animate, loop, reduceMotion, active, focused, sticker.id, motion, expression, blink]);
  const tilt = sticker.id === 'hello' || sticker.id === 'party' || sticker.mood === 'sad';
  const bounce = sticker.mood === 'wow' ? 9 : sticker.mood === 'laugh' ? 5 : sticker.id === 'yes' ? 4 : 2;
  const unit = size / 160;
  const wink = sticker.id === 'hello' || sticker.id === 'yes';
  return <View accessible accessibilityLabel={`Sticker: ${sticker.label}`} style={{ width: size, alignItems: 'center', paddingVertical: 10 }}>
    <Animated.View style={{ width:size,height:165*unit,transform: [
      { rotate: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: tilt ? ['-5deg', '0deg', '5deg'] : ['-1deg', '0deg', '1deg'] }) },
      { translateY: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: [bounce*unit, 0, -bounce*unit] }) },
      { scale: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: sticker.mood === 'love' || sticker.mood === 'wow' ? [0.96, 1, 1.06] : [1, 1, 1.02] }) },
    ] }}>
    {/* Tiny body, independent limbs and a bobble head; all motion runs natively. */}
    <Svg style={{position:'absolute',top:102*unit}} width={size} height={60*unit} viewBox="0 0 160 60">
      <Ellipse cx={80} cy={55} rx={29} ry={3} fill="#00BBD4" opacity={0.13}/>
      <Path d="M70 34L67 46M90 34L93 46" stroke="#4397B6" strokeWidth={7} strokeLinecap="round"/>
      <Rect x={57} y={43} width={20} height={10} rx={5} fill="#99EDFA" stroke="#DBFCFF" strokeWidth={1.5}/>
      <Rect x={83} y={43} width={20} height={10} rx={5} fill="#99EDFA" stroke="#DBFCFF" strokeWidth={1.5}/>
      <Rect x={61} y={5} width={38} height={34} rx={13} fill="#48C4DD" stroke="#CCF9FF" strokeWidth={2}/>
      <Rect x={67} y={13} width={26} height={19} rx={7} fill="#103451"/>
      <Path d="M73 23L78 18L83 25L87 21" fill="none" stroke="#6EF2FF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      <Circle cx={80} cy={35} r={1.5} fill="#D5FCFF"/>
    </Svg>
    {[-1,1].map(side=><Animated.View key={side} pointerEvents="none" style={{position:'absolute',left:(side===-1?44:96)*unit,top:109*unit,width:20*unit,height:35*unit,transform:[
      {rotate:motion.interpolate({inputRange:[-1,0,1],outputRange:sticker.id==='hello'&&side===1?['-115deg','-90deg','-155deg']:sticker.id==='party'?[`${side*75}deg`,`${side*35}deg`,`${side*110}deg`]:sticker.id==='thanks'?[`${side*12}deg`,`${side*22}deg`,`${side*35}deg`]:[`${side*-25}deg`,'0deg',`${side*30}deg`]})},
    ]}}><Svg width="100%" height="100%" viewBox="0 0 20 35"><Path d="M10 5V23" stroke="#63D4E6" strokeWidth={7} strokeLinecap="round"/><Circle cx={10} cy={26} r={7} fill="#A7F1FA" stroke="#E0FCFF" strokeWidth={1.5}/><Path d="M7 26H13" stroke="#4397B6" strokeWidth={1.5} strokeLinecap="round"/></Svg></Animated.View>)}
    <Animated.View style={{width:size,height:125*unit,transform:[
      {rotate:motion.interpolate({inputRange:[-1,0,1],outputRange:sticker.id==='thanks'?['-3deg','0deg','3deg']:['5deg','0deg','-5deg']})},
      {translateY:motion.interpolate({inputRange:[-1,0,1],outputRange:[0,0,(sticker.id==='thanks'?5:-2)*unit]})},
    ]}}>
    <Svg width={size} height={size * 0.78} viewBox="0 0 160 125">
      <Defs>
        <LinearGradient id={`${artId}shell`} x1="0%" y1="0%" x2="90%" y2="100%"><Stop offset="0" stopColor="#CBFAFF"/><Stop offset="0.4" stopColor="#54DDEC"/><Stop offset="1" stopColor="#128BBA"/></LinearGradient>
        <LinearGradient id={`${artId}glass`} x1="0%" y1="0%" x2="30%" y2="100%"><Stop offset="0" stopColor="#163D62"/><Stop offset="1" stopColor="#07182F"/></LinearGradient>
      </Defs>
      <Path d="M80 27V15" stroke="#91EEFA" strokeWidth={5} strokeLinecap="round"/>
      <Circle cx={80} cy={10} r={7} fill="#00DAF2" opacity={0.18}/><Circle cx={80} cy={10} r={4} fill="#C3FAFF"/>
      <Rect x={14} y={52} width={16} height={31} rx={8} fill={`url(#${artId}shell)`}/>
      <Rect x={130} y={52} width={16} height={31} rx={8} fill={`url(#${artId}shell)`}/>
      <Path d="M19 61V74M141 61V74" stroke="#E1FDFF" strokeWidth={2} strokeLinecap="round" opacity={0.7}/>
      <Rect x={25} y={25} width={110} height={88} rx={31} fill={`url(#${artId}shell)`} stroke="#D5FBFF" strokeWidth={2.5}/>
      <Rect x={32} y={32} width={96} height={73} rx={25} fill={`url(#${artId}glass)`} stroke="#248AA5" strokeWidth={1.5}/>
      <Path d="M42 45Q46 37 58 37H100" fill="none" stroke="#C5FAFF" strokeWidth={2} strokeLinecap="round" opacity={0.25}/>
      <Ellipse cx={43} cy={79} rx={7} ry={3} fill={sticker.mood==='love'?'#FF91BB':'#00E5FF'} opacity={0.28}/>
      <Ellipse cx={117} cy={79} rx={7} ry={3} fill={sticker.mood==='love'?'#FF91BB':'#00E5FF'} opacity={0.28}/>
      <Path d="M74 109H86" stroke="#E1FDFF" strokeWidth={2} strokeLinecap="round" opacity={0.7}/>
      {sticker.id==='party'&&<><Path d="M102 31L117 4L135 34Z" fill="#A590FF" stroke="#E6DCFF" strokeWidth={2}/><Path d="M110 19L129 24M105 28L133 31" stroke="#FFD988" strokeWidth={3}/><Circle cx={117} cy={5} r={3} fill="#FFD988"/><Path d="M14 20L18 25M145 39L151 36M33 11L31 17" stroke="#FF93B9" strokeWidth={3} strokeLinecap="round"/></>}
      {sticker.id==='yes'&&<Circle cx={133} cy={102} r={14} fill="#00BAA0" stroke="#C7FFF0" strokeWidth={2}/>}
      {sticker.id==='yes'&&<Path d="M126 102L131 107L140 97" stroke="#F1FFFA" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round"/>}
      {sticker.id==='thanks'&&<Path d="M67 112L77 96Q80 92 80 100Q80 92 83 96L93 112" fill="#9CECF5" stroke="#E0FCFF" strokeWidth={2} strokeLinejoin="round"/>}
      {sticker.mood==='love'&&<><Path d="M17 24C7 12 0 27 17 36C34 25 26 12 17 24" fill="#FF86B4"/><Circle cx={142} cy={19} r={3} fill="#FFDDA0"/></>}
    </Svg>
    {/* Separate native-driven layers animate the face without JS frame updates. */}
    {[38, 91].map((left, index) => <Animated.View key={left} pointerEvents="none" style={{ position: 'absolute', left: left * unit, top: 44 * unit, width: 32 * unit, height: 30 * unit, transform: [
      { scaleY: wink && index === 0 ? 1 : blink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.12] }) },
      { scale: expression.interpolate({ inputRange: [0, 1], outputRange: [1, sticker.mood === 'love' || sticker.mood === 'wow' ? 1.2 : 1] }) },
      { translateY: expression.interpolate({ inputRange: [0, 1], outputRange: [0, (sticker.mood === 'sad' ? 2 : -2) * unit] }) },
    ] }}>
      <Svg width="100%" height="100%" viewBox="0 0 32 30">
        {sticker.mood === 'love' ? <Path d="M15 10C6-1-3 15 16 26C35 14 24-1 15 10" fill="#FF92BC" /> :
          sticker.mood === 'laugh' ? <Path d="M5 19Q15 4 25 19" fill="none" stroke="#85F4FF" strokeWidth={4.5} strokeLinecap="round" /> :
          wink&&index===0?<Path d="M5 17Q15 9 25 17" stroke="#85F4FF" strokeWidth={4} strokeLinecap="round" fill="none"/>:
          <><Path d={sticker.mood === 'sad' ? (index===0?'M6 8L22 3':'M6 3L22 8') : 'M6 6Q15 1 24 6'} stroke="#66F0FF" strokeWidth={2} strokeLinecap="round" fill="none" /><Ellipse cx={15} cy={17} rx={sticker.mood === 'wow' ? 7 : 5} ry={sticker.mood==='wow'?9:7} fill="#85F4FF" /><Circle cx={13} cy={14} r={2} fill="#F0FEFF" /></>}
      </Svg>
    </Animated.View>)}
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 60 * unit, top: 74 * unit, width: 40 * unit, height: 28 * unit, transform: [
      { scaleY: expression.interpolate({ inputRange: [0, 1], outputRange: [1, sticker.mood === 'laugh' ? 1.35 : sticker.mood === 'wow' ? 1.2 : 0.7] }) },
      { scaleX: expression.interpolate({ inputRange: [0, 1], outputRange: [1, sticker.mood === 'love' ? 0.65 : 1.08] }) },
    ] }}>
      <Svg width="100%" height="100%" viewBox="0 0 40 28">
        {sticker.mood === 'wow' ? <><Circle cx={20} cy={12} r={9} fill="#00E5FF" /><Circle cx={20} cy={12} r={5} fill="#071428" /></> :
          sticker.mood === 'laugh' ? <><Path d="M5 5Q20 10 35 5Q33 26 20 26Q7 26 5 5" fill="#00E5FF" /><Path d="M12 23Q20 13 28 23" fill="#FF6FAD" /></> :
          <Path d={sticker.mood === 'sad' ? 'M5 17Q20 -2 35 17' : 'M5 6Q20 25 35 6'} fill="none" stroke="#00E5FF" strokeWidth={5} strokeLinecap="round" />}
      </Svg>
    </Animated.View>
    {(sticker.mood === 'love' || sticker.mood === 'sad' || sticker.id === 'party' || sticker.id === 'thanks') && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: (sticker.mood === 'sad' ? 96 : 114) * unit, top: (sticker.mood === 'sad' ? 70 : 14) * unit, width: 24 * unit, height: 28 * unit, opacity: expression, transform: [{ translateY: expression.interpolate({ inputRange: [0, 1], outputRange: [0, (sticker.mood === 'sad' ? 12 : -10) * unit] }) }] }}>
      <Svg width="100%" height="100%" viewBox="0 0 24 28">
        {sticker.mood === 'sad' ? <Path d="M12 3Q-3 22 12 24Q27 22 12 3" fill="#66F0FF" /> : sticker.mood === 'love' ? <Path d="M12 9C3-3-8 13 12 26C32 13 21-3 12 9" fill="#FF6FAD" /> : <Path d="M12 1L15 10L24 13L15 16L12 26L9 16L0 13L9 10Z" fill="#FFE080" />}
      </Svg>
    </Animated.View>}
    </Animated.View>
    </Animated.View>
  </View>;
}
