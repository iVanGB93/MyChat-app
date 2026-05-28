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
      {label && (
        <Text style={[styles.label, { color: Colors.primary }]}>{label.toUpperCase()}</Text>
      )}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: Colors.inputBg,
            borderColor: error ? Colors.error : Colors.neonBorder,
            shadowColor: error ? Colors.error : Colors.primary,
          },
        ]}
      >
        <TextInput
          style={[styles.input, { color: Colors.text }, style]}
          placeholderTextColor={Colors.textTertiary}
          secureTextEntry={isPassword && !showPassword}
          autoCapitalize="none"
          {...rest}
        />
        {isPassword && (
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
            <Text style={[styles.eyeText, { color: Colors.primary }]}>{showPassword ? '●' : '◎'}</Text>
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
    fontSize: Font.size.xs,
    marginBottom: Spacing.xs,
    ...Font.semiBold,
    letterSpacing: 1.2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  input: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: Font.size.md,
    letterSpacing: 0.3,
  },
  eyeBtn: { paddingHorizontal: Spacing.md },
  eyeText: { fontSize: 16, fontWeight: '600' },
  error: {
    fontSize: Font.size.xs,
    marginTop: Spacing.xs,
    letterSpacing: 0.3,
  },
});
