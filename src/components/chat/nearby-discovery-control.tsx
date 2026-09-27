import React, { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { nearbyText } from '../../services/p2pTextComposition';

/** Development-only status; route selection does not require a user toggle. */
export default function NearbyDiscoveryControl() {
  const { colors: c } = useTheme();
  const state = useSyncExternalStore(nearbyText.subscribe, nearbyText.getState);
  return <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.surface }}>
    <Text accessibilityLiveRegion="polite" style={{ color: c.textSecondary, fontSize: 12 }}>
      Nearby Wi-Fi · Automatic · Development test{'\n'}{state.message}
    </Text>
  </View>;
}
