import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import Avatar from '../ui/Avatar';

interface Props {
  visible: boolean;
  name: string;
  subtitle?: string | null;
  avatarUri?: string | null;
  isGroup: boolean;
  onClose: () => void;
  onMessage: () => void;
  onCall?: () => void;
  onDetails: () => void;
}

interface ActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}

export default function ChatAvatarActionModal({
  visible,
  name,
  subtitle,
  avatarUri,
  isGroup,
  onClose,
  onMessage,
  onCall,
  onDetails,
}: Props) {
  const { colors: Colors } = useTheme();
  const insets = useSafeAreaInsets();

  const Action = ({ icon, label, onPress }: ActionProps) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.action}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View
        style={[
          styles.actionIcon,
          { backgroundColor: Colors.highlight, borderColor: Colors.neonBorder },
        ]}
      >
        <Ionicons name={icon} size={23} color={Colors.primary} />
      </View>
      <Text style={[styles.actionLabel, { color: Colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Close profile preview"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: Colors.surface,
              borderColor: Colors.neonBorder,
              paddingBottom: Spacing.lg + insets.bottom,
            },
          ]}
        >
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close profile preview"
            style={styles.close}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>

          <Avatar name={name} uri={avatarUri} size={142} />
          <Text selectable style={[styles.name, { color: Colors.text }]} numberOfLines={2}>
            {name}
          </Text>
          {!!subtitle && (
            <Text selectable style={[styles.subtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
              {subtitle}
            </Text>
          )}

          <View style={[styles.divider, { backgroundColor: Colors.divider }]} />
          <View style={styles.actions}>
            <Action icon="chatbubble-ellipses-outline" label="Message" onPress={onMessage} />
            {!isGroup && onCall && (
              <Action icon="call-outline" label="Call" onPress={onCall} />
            )}
            <Action
              icon={isGroup ? 'people-outline' : 'information-circle-outline'}
              label="Details"
              onPress={onDetails}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  close: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  name: {
    marginTop: Spacing.md,
    fontSize: Font.size.lg,
    ...Font.semiBold,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 4,
    fontSize: Font.size.sm,
  },
  divider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.lg,
  },
  actions: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    gap: Spacing.md,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  actionIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: Font.size.sm,
    ...Font.medium,
  },
});
