import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import Avatar from '../../components/ui/Avatar';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTheme } from '../../contexts/ThemeContext';
import { usePermissionPrompt } from '../../hooks/usePermissionPrompt';
import { resolveMediaUrl } from '../../services/api';
import { initiateCall } from '../../services/callService';
import { getContacts } from '../../services/contactService';
import { getCachedContacts, getCachedRooms } from '../../services/localMessageStore';
import { useAppStore } from '../../store/appStore';
import { Font, Radius, Spacing } from '../../theme';
import type { RootStackParamList, RoomMember, User } from '../../types';

dayjs.extend(relativeTime);

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'UserInfo'>;
type UserSummary = Partial<User> & Pick<RoomMember, 'id' | 'username'>;

interface ActionProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}

export default function UserInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { user } = useAuth();
  const { alert } = useConfirm();
  const { colors: Colors } = useTheme();
  const { ensure: ensurePermission } = usePermissionPrompt();
  const presence = useAppStore((state) => state.presenceByUserId[route.params.userId]);
  const isMuted = useAppStore((state) => !!state.mutedRooms[route.params.roomId]);
  const toggleRoomMuted = useAppStore((state) => state.toggleRoomMuted);
  const [profile, setProfile] = useState<UserSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(false);

  const applyBestProfile = useCallback((contactProfile?: User, member?: RoomMember) => {
    if (contactProfile) {
      setProfile(contactProfile);
      return;
    }
    if (member) setProfile(member);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (user?.id != null) {
          const [cachedContacts, cachedRooms] = await Promise.all([
            getCachedContacts(user.id),
            getCachedRooms(user.id),
          ]);
          if (!active) return;
          const contactProfile = cachedContacts.find(
            (contact) => contact.contact === route.params.userId,
          )?.contact_detail;
          const member = cachedRooms
            .find((room) => room.id === route.params.roomId)
            ?.members_detail.find((item) => item.id === route.params.userId);
          applyBestProfile(contactProfile, member);
        }
      } finally {
        if (active) setLoading(false);
      }

      // Refresh richer profile metadata in the background; the cached room or
      // contact above already makes this screen immediately usable offline.
      getContacts()
        .then((contacts) => {
          if (!active) return;
          const fresh = contacts.find((contact) => contact.contact === route.params.userId)?.contact_detail;
          if (fresh) setProfile(fresh);
        })
        .catch(() => {});
    })();
    return () => { active = false; };
  }, [applyBestProfile, route.params.roomId, route.params.userId, user?.id]);

  const displayName = profile?.display_name?.trim() || profile?.username || route.params.roomName;
  const username = profile?.username || route.params.roomName;
  const isOnline = presence?.isOnline ?? profile?.is_online ?? false;
  const lastSeen = presence?.lastSeen ?? profile?.last_seen ?? null;
  const statusText = isOnline
    ? 'Online now'
    : lastSeen ? `Last seen ${dayjs(lastSeen).fromNow()}` : 'Offline';

  const openChat = useCallback(() => {
    navigation.navigate('ChatRoom', {
      roomId: route.params.roomId,
      roomName: displayName,
      otherUserId: route.params.userId,
    });
  }, [displayName, navigation, route.params.roomId, route.params.userId]);

  const startCall = useCallback(async (callType: 'voice' | 'video') => {
    if (calling) return;
    const permission = callType === 'video' ? 'camera+microphone' : 'microphone';
    if (!(await ensurePermission(permission))) return;
    setCalling(true);
    try {
      const result = await initiateCall(route.params.userId, callType);
      navigation.navigate('ActiveCall', {
        callId: result.call_id,
        otherName: displayName,
        callType,
        roomName: result.room_name,
        isOutgoing: true,
        peerUserId: route.params.userId,
      });
    } catch {
      alert('Could not start call', `Axonic could not call ${displayName}. Please try again.`);
    } finally {
      setCalling(false);
    }
  }, [alert, calling, displayName, ensurePermission, navigation, route.params.userId]);

  const Action = useMemo(() => ({ icon, label, onPress }: ActionProps) => (
    <TouchableOpacity style={styles.action} activeOpacity={0.72} onPress={onPress}>
      <View style={[styles.actionIcon, { borderColor: Colors.neonBorder, backgroundColor: Colors.highlight }]}>
        <Ionicons name={icon} size={23} color={Colors.primary} />
      </View>
      <Text style={[styles.actionLabel, { color: Colors.text }]}>{label}</Text>
    </TouchableOpacity>
  ), [Colors.highlight, Colors.neonBorder, Colors.primary, Colors.text]);

  if (loading && !profile) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: Colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={[styles.hero, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Avatar name={displayName} uri={resolveMediaUrl(profile?.avatar)} size={112} showOnline isOnline={isOnline} />
        <Text selectable style={[styles.name, { color: Colors.text }]}>{displayName}</Text>
        <Text selectable style={[styles.username, { color: Colors.textSecondary }]}>@{username}</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.online : Colors.offline }]} />
          <Text style={[styles.status, { color: isOnline ? Colors.online : Colors.textSecondary }]}>
            {statusText}
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: Colors.divider }]} />
        <View style={styles.actions}>
          <Action icon="chatbubble-ellipses-outline" label="Message" onPress={openChat} />
          <Action icon="call-outline" label="Voice" onPress={() => void startCall('voice')} />
          <Action icon="videocam-outline" label="Video" onPress={() => void startCall('video')} />
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>ABOUT</Text>
        <Text selectable style={[styles.bio, { color: Colors.text }]}>
          {profile?.bio?.trim() || 'No bio yet.'}
        </Text>
      </View>

      <View style={[styles.section, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Text style={[styles.sectionLabel, { color: Colors.textSecondary }]}>AXONIC PROFILE</Text>
        <View style={styles.detailRow}>
          <Ionicons name="person-outline" size={20} color={Colors.primary} />
          <View style={styles.detailText}>
            <Text style={[styles.detailLabel, { color: Colors.textSecondary }]}>Username</Text>
            <Text selectable style={[styles.detailValue, { color: Colors.text }]}>@{username}</Text>
          </View>
        </View>
        {!!profile?.user_tag && (
          <View style={styles.detailRow}>
            <Ionicons name="at-outline" size={20} color={Colors.primary} />
            <View style={styles.detailText}>
              <Text style={[styles.detailLabel, { color: Colors.textSecondary }]}>Axonic ID</Text>
              <Text selectable style={[styles.detailValue, { color: Colors.text }]}>{profile.user_tag}</Text>
            </View>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.setting, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}
        activeOpacity={0.72}
        onPress={() => toggleRoomMuted(route.params.roomId)}
      >
        <Ionicons
          name={isMuted ? 'notifications-off-outline' : 'notifications-outline'}
          size={21}
          color={Colors.primary}
        />
        <Text style={[styles.settingText, { color: Colors.text }]}>
          {isMuted ? 'Unmute notifications' : 'Mute notifications'}
        </Text>
        <Ionicons name="chevron-forward" size={19} color={Colors.textTertiary} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { alignItems: 'center', borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.lg },
  name: { marginTop: Spacing.md, fontSize: Font.size.xl, ...Font.semiBold, textAlign: 'center' },
  username: { marginTop: 3, fontSize: Font.size.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: Font.size.sm, ...Font.medium },
  divider: { width: '100%', height: StyleSheet.hairlineWidth, marginVertical: Spacing.lg },
  actions: { width: '100%', flexDirection: 'row', justifyContent: 'space-evenly', gap: Spacing.md },
  action: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  actionIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Font.size.sm, ...Font.medium },
  section: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  sectionLabel: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1.1 },
  bio: { fontSize: Font.size.md, lineHeight: 22 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
  detailText: { flex: 1 },
  detailLabel: { fontSize: Font.size.xs },
  detailValue: { fontSize: Font.size.md, marginTop: 2, ...Font.medium },
  setting: { minHeight: 58, borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  settingText: { flex: 1, fontSize: Font.size.md, ...Font.medium },
});
