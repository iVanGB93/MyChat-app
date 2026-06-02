/* ------------------------------------------------------------------ */
/*  ConfirmModal — themed Alert/Confirm replacement                    */
/*                                                                     */
/*  Renders a slide-up bottom sheet with:                              */
/*    - optional icon glyph                                            */
/*    - title + optional message                                       */
/*    - list of action buttons (default / destructive / cancel styles) */
/*    - tappable backdrop dismiss                                      */
/*                                                                     */
/*  Used by ConfirmProvider to back the `useConfirm()` hook that       */
/*  replaces `Alert.alert` throughout the app.                         */
/* ------------------------------------------------------------------ */

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

export type ConfirmButtonStyle = 'default' | 'destructive' | 'cancel';

export interface ConfirmButton {
  text: string;
  style?: ConfirmButtonStyle;
  onPress?: () => void | Promise<void>;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Optional Ionicons name shown above the title. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  buttons?: ConfirmButton[];
  /** Whether tapping the backdrop dismisses (default true). */
  dismissOnBackdrop?: boolean;
}

interface Props extends ConfirmOptions {
  visible: boolean;
  onClose: () => void;
}

export default function ConfirmModal({
  visible,
  onClose,
  title,
  message,
  icon,
  buttons,
  dismissOnBackdrop = true,
}: Props) {
  const { colors: Colors } = useTheme();
  const translateY = useRef(new Animated.Value(400)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 11,
        }),
        Animated.timing(backdrop, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(400);
      backdrop.setValue(0);
    }
  }, [visible, translateY, backdrop]);

  const animatedClose = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 400, duration: 180, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      onClose();
      if (after) after();
    });
  };

  const effectiveButtons: ConfirmButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }];

  // For backdrop dismissal we treat the cancel button (if any) as the action.
  const handleBackdropPress = () => {
    if (!dismissOnBackdrop) return;
    const cancelBtn = effectiveButtons.find((b) => b.style === 'cancel');
    animatedClose(cancelBtn?.onPress ? () => void cancelBtn.onPress?.() : undefined);
  };

  const styleForButton = (style: ConfirmButtonStyle = 'default') => {
    if (style === 'destructive') {
      return {
        borderColor: Colors.error,
        backgroundColor: 'transparent',
        textColor: Colors.error,
      };
    }
    if (style === 'cancel') {
      return {
        borderColor: Colors.neonBorder,
        backgroundColor: 'transparent',
        textColor: Colors.textSecondary,
        dashed: true,
      };
    }
    return {
      borderColor: Colors.primary,
      backgroundColor: Colors.highlight,
      textColor: Colors.primary,
    };
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => animatedClose()}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropPress} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: Colors.surface,
            borderColor: Colors.neonBorder,
            shadowColor: Colors.primary,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: Colors.neonBorder }]} />

        {icon && (
          <View
            style={[
              styles.iconWrap,
              { borderColor: Colors.primary, shadowColor: Colors.primary },
            ]}
          >
            <Ionicons name={icon} size={24} color={Colors.primary} />
          </View>
        )}

        <Text style={[styles.title, { color: Colors.primary }]}>{title}</Text>
        {!!message && (
          <Text style={[styles.message, { color: Colors.textSecondary }]}>{message}</Text>
        )}

        <View style={styles.buttonsCol}>
          {effectiveButtons.map((btn, idx) => {
            const visual = styleForButton(btn.style);
            return (
              <TouchableOpacity
                key={`${btn.text}-${idx}`}
                style={[
                  styles.button,
                  {
                    borderColor: visual.borderColor,
                    backgroundColor: visual.backgroundColor,
                    borderStyle: visual.dashed ? 'dashed' : 'solid',
                  },
                ]}
                onPress={() => animatedClose(btn.onPress ? () => void btn.onPress?.() : undefined)}
                activeOpacity={0.75}
              >
                <Text style={[styles.buttonText, { color: visual.textColor }]}>
                  {btn.text.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
    opacity: 0.6,
  },
  iconWrap: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  title: {
    fontSize: Font.size.md,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  message: {
    fontSize: Font.size.sm,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
    letterSpacing: 0.2,
  },
  buttonsCol: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  button: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
  },
  buttonText: {
    fontSize: Font.size.sm,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
});
