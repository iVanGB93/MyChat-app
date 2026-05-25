/* ------------------------------------------------------------------ */
/*  EmptyState — shown when a list has no items                        */
/* ------------------------------------------------------------------ */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Font, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  icon?: string;
  title: string;
  subtitle?: string;
}

export default function EmptyState({ icon = '💬', title, subtitle }: Props) {
  const { colors: Colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.title, { color: Colors.text }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: Colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  icon: { fontSize: 56, marginBottom: Spacing.md },
  title: { fontSize: Font.size.lg, textAlign: 'center', ...Font.semiBold },
  subtitle: { fontSize: Font.size.sm, textAlign: 'center', marginTop: Spacing.sm },
});
