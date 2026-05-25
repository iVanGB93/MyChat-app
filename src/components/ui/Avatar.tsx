/* ------------------------------------------------------------------ */
/*  Avatar — circular user avatar with online indicator                */
/* ------------------------------------------------------------------ */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Font } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  uri?: string | null;
  name: string;
  size?: number;
  showOnline?: boolean;
  isOnline?: boolean;
}

export default function Avatar({ uri, name, size = 48, showOnline = false, isOnline = false }: Props) {
  const { colors: Colors } = useTheme();
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const bgColor = stringToColor(name);

  return (
    <View style={[styles.wrapper, { width: size, height: size }]}>
      {uri ? (
        <Image source={{ uri }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2, backgroundColor: bgColor }]}>
          <Text style={[styles.initials, { fontSize: size * 0.38, color: Colors.textInverse }]}>{initials}</Text>
        </View>
      )}
      {showOnline && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: isOnline ? Colors.online : Colors.offline,
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: size * 0.14,
              borderWidth: size * 0.05,
              borderColor: Colors.surface,
            },
          ]}
        />
      )}
    </View>
  );
}

function stringToColor(str: string): string {
  const colors = ['#7C3AED', '#8B5CF6', '#A78BFA', '#6D28D9', '#5B21B6', '#C084FC', '#9333EA', '#7E22CE'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  image: { resizeMode: 'cover' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  initials: { ...Font.bold },
  badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
});
