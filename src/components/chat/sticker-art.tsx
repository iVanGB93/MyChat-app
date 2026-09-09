import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Rect, Path, Circle } from 'react-native-svg';
import type { Sticker } from '../../services/stickers';

/** Bundled vector artwork: no requests, filesystem copies, or Gallery clutter. */
export default function StickerArt({ sticker, size = 150, animate = true, loop = false }: { sticker: Sticker; size?: number; animate?: boolean; loop?: boolean }) {
  const motion = useRef(new Animated.Value(0)).current;
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
    if (!animate || reduceMotion || !active || !focused) return;
    const frame = (toValue: number, duration: number) => Animated.timing(motion, {
      toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
    });
    const animation = Animated.loop(Animated.sequence([
      frame(1, 280), frame(-1, 280), frame(1, 280), frame(0, 280), Animated.delay(1000),
    ]), { iterations: loop ? -1 : 3 });
    animation.start();
    return () => { animation.stop(); motion.setValue(0); };
  }, [animate, loop, reduceMotion, active, focused, sticker.id, motion]);
  const tilt = sticker.id === 'hello' || sticker.id === 'party' || sticker.mood === 'sad';
  const bounce = sticker.mood === 'laugh' ? 5 : sticker.id === 'thanks' || sticker.id === 'yes' ? 3 : 1;
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
      {sticker.mood === 'love' ? <Path d="M49 55C40 44 34 61 52 71C70 59 61 44 52 55M102 55C93 44 85 61 104 71C122 59 113 44 104 55" fill="#00E5FF" />
        : sticker.mood === 'laugh' ? <Path d="M43 64L53 55L63 64M96 64L106 55L116 64" fill="none" stroke="#00E5FF" strokeWidth={5} strokeLinecap="round" />
          : <><Circle cx={53} cy={60} r={sticker.mood === 'wow' ? 8 : 5} fill="#00E5FF" /><Circle cx={106} cy={60} r={sticker.mood === 'wow' ? 8 : 5} fill="#00E5FF" /></>}
      {sticker.mood === 'wow' ? <Circle cx={80} cy={85} r={9} fill="#00E5FF" />
        : <Path d={sticker.mood === 'sad' ? 'M65 91Q80 72 95 91' : 'M65 80Q80 99 95 80'} fill="none" stroke="#00E5FF" strokeWidth={5} strokeLinecap="round" />}
      {sticker.mood === 'sad' && <Path d="M108 72Q97 86 108 86Q119 86 108 72" fill="#66F0FF" />}
    </Svg>
    </Animated.View>
  </View>;
}
