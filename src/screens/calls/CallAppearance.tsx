import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Font, Radius, Spacing } from '../../theme';

/* -------------------- helpers -------------------- */

export function ActionButton({
  size = 64,
  testID,
  icon,
  label,
  active,
  onPress,
  Colors,
}: {
  size?: number;
  testID?: string;
  icon: any;
  label: string;
  active?: boolean;
  onPress: () => void;
  Colors: any;
}) {
  return (
    <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} activeOpacity={0.7} style={{ alignItems: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: active ? Colors.primary : Colors.neonBorder,
          backgroundColor: active ? 'rgba(0,70,85,0.85)' : 'rgba(2,4,19,0.65)',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOpacity: active ? 0.5 : 0.2,
          shadowRadius: active ? 10 : 6,
          shadowOffset: { width: 0, height: 0 },
          elevation: active ? 5 : 2,
        }}
      >
        <Ionicons name={icon} size={22} color={active ? Colors.primary : '#fff'} />
      </View>
      <Text style={{ color: '#fff', backgroundColor: 'rgba(2,4,19,0.65)', paddingHorizontal: 6, borderRadius: 6, fontSize: Font.size.xs, marginTop: 6, ...Font.medium }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* -------------------- styles -------------------- */

export function makeStyles(Colors: any) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#020413',
    },
    fullVideo: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000',
    },
    pipWrap: {
      position: 'absolute',
      top: Platform.OS === 'ios' ? 60 : 40,
      right: Spacing.md,
      width: 110,
      height: 150,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.9)',
      backgroundColor: 'rgba(255,255,255,0.12)',
      shadowColor: Colors.primary,
      shadowOpacity: 0.45,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      overflow: 'hidden',
      zIndex: 5,
    },
    pip: {
      flex: 1,
      backgroundColor: '#000',
      borderRadius: Radius.lg,
      overflow: 'hidden',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      paddingTop: Platform.OS === 'ios' ? 70 : 50,
      paddingBottom: Platform.OS === 'ios' ? 50 : 32,
    },
    top: { alignItems: 'center' },
    typePill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    typePillText: {
      fontSize: 11,
      ...Font.bold,
      letterSpacing: 1.5,
    },
    avatarWrap: {
      marginTop: Spacing.xl,
      padding: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: Colors.neonBorder,
      shadowColor: Colors.primary,
      shadowOpacity: 0.5,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    name: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      color: '#fff',
      fontSize: Font.size.xxl,
      marginTop: Spacing.lg,
      ...Font.bold,
      letterSpacing: 0.5,
    },
    status: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      color: 'rgba(255,255,255,0.75)',
      fontSize: Font.size.md,
      marginTop: Spacing.xs,
      ...Font.medium,
      letterSpacing: 1,
    },
    quality: {
      backgroundColor: 'rgba(2,4,19,0.65)',
      paddingHorizontal: 8,
      borderRadius: 8,
      marginTop: 4,
      fontSize: Font.size.xs,
      fontWeight: '700',
      letterSpacing: 0.8,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      paddingHorizontal: Spacing.lg,
    },
    endBtn: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: Colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: Colors.error,
      shadowOpacity: 0.7,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    },
  });
}
