import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import type { Sticker } from '../../services/stickers';

/** Bundled vector artwork: no requests, filesystem copies, or Gallery clutter. */
export default function StickerArt({ sticker, size = 150, animate = true, loop = false }: { sticker: Sticker; size?: number; animate?: boolean; loop?: boolean }) {
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
    const animation = Animated.loop(Animated.sequence([
      frame(1, 280), frame(-1, 280), frame(1, 280), frame(0, 280), Animated.delay(1000),
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
  const bounce = sticker.mood === 'laugh' ? 5 : sticker.id === 'thanks' || sticker.id === 'yes' ? 3 : 1;
  const unit = size / 160;
  const wink = sticker.id === 'hello' || sticker.id === 'yes';
  return <View accessible accessibilityLabel={`Sticker: ${sticker.label}`} style={{ width: size, alignItems: 'center', paddingVertical: 10 }}>
    <Animated.View style={{ transform: [
      { rotate: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: tilt ? ['-7deg', '0deg', '7deg'] : ['-1deg', '0deg', '1deg'] }) },
      { translateY: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: [bounce, 0, -bounce] }) },
      { scale: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: sticker.mood === 'love' || sticker.mood === 'wow' ? [0.96, 1, 1.06] : [1, 1, 1.02] }) },
    ] }}>
    <Svg width={size} height={size * 0.78} viewBox="0 0 160 125">
      <Path d="M80 26V14M27 54H16V83H27M133 54H144V83H133" stroke="#00B2CC" strokeWidth={7} strokeLinecap="round" />
      <Circle cx={80} cy={10} r={7} fill="#00E5FF" stroke="#FFFFFF" strokeWidth={3} />
      <Rect x={25} y={25} width={110} height={88} rx={30} fill="#071428" stroke="#FFFFFF" strokeWidth={5} />
      <Rect x={34} y={34} width={92} height={69} rx={22} fill="#0C2854" stroke="#00E5FF" strokeWidth={2} />
    </Svg>
    {/* Separate native-driven layers animate the face without JS frame updates. */}
    {[38, 91].map((left, index) => <Animated.View key={left} pointerEvents="none" style={{ position: 'absolute', left: left * unit, top: 44 * unit, width: 32 * unit, height: 30 * unit, transform: [
      { scaleY: wink && index === 0 ? 1 : blink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.12] }) },
      { scale: expression.interpolate({ inputRange: [0, 1], outputRange: [1, sticker.mood === 'love' || sticker.mood === 'wow' ? 1.2 : 1] }) },
      { translateY: expression.interpolate({ inputRange: [0, 1], outputRange: [0, (sticker.mood === 'sad' ? 2 : -2) * unit] }) },
    ] }}>
      <Svg width="100%" height="100%" viewBox="0 0 32 30">
        {sticker.mood === 'love' ? <Path d="M15 11C6 0-2 17 16 27C34 15 24 0 15 11" fill="#00E5FF" /> :
          sticker.mood === 'laugh' ? <Path d="M5 20L15 11L25 20" fill="none" stroke="#00E5FF" strokeWidth={5} strokeLinecap="round" /> :
          <><Path d={sticker.mood === 'sad' ? 'M6 9L22 3' : 'M6 6Q15 1 24 6'} stroke="#66F0FF" strokeWidth={2.5} strokeLinecap="round" fill="none" /><Circle cx={15} cy={16} r={sticker.mood === 'wow' ? 8 : 5} fill="#00E5FF" /></>}
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
  </View>;
}
