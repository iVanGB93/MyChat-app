/* ------------------------------------------------------------------ */
/*  Input — styled text input with label                               */
/* ------------------------------------------------------------------ */

import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, TextInputProps, TouchableOpacity } from 'react-native';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
}

export default function Input({ label, error, isPassword, style, ...rest }: Props) {
  const { colors: Colors } = useTheme();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label && <Text style={[styles.label, { color: Colors.textSecondary }]}>{label}</Text>}
      <View style={[styles.inputContainer, { backgroundColor: Colors.inputBg }, error ? { borderColor: Colors.error } : null]}>
        <TextInput
          style={[styles.input, { color: Colors.text }, style]}
          placeholderTextColor={Colors.textTertiary}
          secureTextEntry={isPassword && !showPassword}
          autoCapitalize="none"
          {...rest}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
            <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={[styles.error, { color: Colors.error }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  label: {
    fontSize: Font.size.sm,
    marginBottom: Spacing.xs,
    ...Font.medium,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: Font.size.md,
  },
  eyeBtn: { paddingHorizontal: Spacing.md },
  eyeText: { fontSize: 18 },
  error: {
    fontSize: Font.size.xs,
    marginTop: Spacing.xs,
  },
});
