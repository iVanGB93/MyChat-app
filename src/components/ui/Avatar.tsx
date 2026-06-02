/* ------------------------------------------------------------------ */
/*  Avatar — futuristic neon-ring style                               */
/* ------------------------------------------------------------------ */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  uri?: string | null;
  name: string;
  size?: number;
  showOnline?: boolean;
  isOnline?: boolean;
}

function stringToColor(str: string): string {
  const palette = ['#00E5FF', '#A855F7', '#00FF9F', '#FF3B6B', '#FFB800', '#66F0FF'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

export default function Avatar({ uri, name, size = 48, showOnline = false, isOnline = false }: Props) {
  const { colors: Colors } = useTheme();
  const [failed, setFailed] = useState(false);
  // Reset failure state when the source uri changes so a new url gets a fresh try.
  useEffect(() => { setFailed(false); }, [uri]);
  const initials = name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const ringColor = stringToColor(name || 'A');
  const innerSize = size - 4;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: ringColor,
            shadowColor: ringColor,
          },
        ]}
      >
        {uri && !failed ? (
          <Image
            source={{ uri }}
            style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
            resizeMode="cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <View
            style={[
              styles.placeholder,
              {
                width: innerSize,
                height: innerSize,
                borderRadius: innerSize / 2,
                backgroundColor: Colors.surface,
              },
            ]}
          >
            <Text style={{ fontSize: size * 0.35, fontWeight: '700', color: ringColor, letterSpacing: 0.5 }}>
              {initials}
            </Text>
          </View>
        )}
      </View>

      {showOnline && (
        <View
          style={[
            styles.badge,
            {
              width: size * 0.28,
              height: size * 0.28,
              borderRadius: (size * 0.28) / 2,
              backgroundColor: isOnline ? Colors.online : Colors.offline,
              borderColor: Colors.background,
              shadowColor: isOnline ? Colors.online : 'transparent',
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.75,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 2,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
