import React,{useEffect,useMemo} from 'react';
import {Animated,View} from 'react-native';
import {chatRoomStyles as styles} from './chat-room-styles';
export default function SyncingHeaderTitle({ title, syncing, color }: { title: string; syncing: boolean; color: string }) {
  const letters = useMemo(() => Array.from(title).slice(0, 24), [title]);
  // Notification placeholders can be replaced by a longer cached group name.
  // Resize before rendering, not in an effect: every letter needs a value now.
  const pulses = useMemo(() => Array.from({ length: letters.length }, () => new Animated.Value(0)), [letters.length]);

  useEffect(() => {
    if (!syncing || pulses.length === 0) {
      pulses.forEach((pulse) => pulse.setValue(0));
      return;
    }
    const wave = Animated.loop(
      Animated.sequence([
        Animated.stagger(45, pulses.map((pulse) => Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]))),
        Animated.delay(350),
      ]),
    );
    wave.start();
    return () => {
      wave.stop();
      pulses.forEach((pulse) => pulse.setValue(0));
    };
  }, [syncing, pulses]);

  return (
    <View style={styles.syncHeaderTitle} accessibilityLabel={syncing ? `${title}, syncing` : title}>
      <View style={styles.syncLetters}>
        {letters.map((letter, index) => (
          <Animated.Text
            key={`${letter}-${index}`}
            style={[styles.syncHeaderLetter, {
              color,
              opacity: syncing ? pulses[index].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) : 1,
              transform: [{ translateY: syncing ? pulses[index].interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) : 0 }],
            }]}
          >
            {letter}
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}