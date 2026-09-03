import React from 'react';
import { ActivityIndicator, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DarkColors, Font, Spacing } from '../theme';

/** Same branding before theme hydration and while restoring the saved session. */
export default function StartupScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const iconSize = Math.min(176, width * 0.5, (height - insets.top - insets.bottom) * 0.3);

  return (
    <View
      testID="axonic-startup-screen"
      style={{
        flex: 1,
        backgroundColor: DarkColors.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: Spacing.xl,
        gap: Spacing.xl,
      }}
    >
      <View style={{ width: iconSize, height: iconSize, borderRadius: 32, borderCurve: 'continuous', overflow: 'hidden' }}>
        <Image
          source={require('../../assets/icon.png')}
          contentFit="contain"
          transition={0}
          accessibilityLabel="Axonic app icon"
          style={{ width: '100%', height: '100%' }}
        />
      </View>
      <Text selectable style={{ color: DarkColors.text, fontSize: Font.size.xxl, fontWeight: '700', letterSpacing: 6 }}>
        AXONIC
      </Text>
      <ActivityIndicator size="small" color={DarkColors.primary} accessibilityLabel="Loading Axonic" />
    </View>
  );
}
