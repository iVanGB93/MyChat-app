/* ------------------------------------------------------------------ */
/*  Group Info — local members view and a safe leave action            */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { getRoom, removeMemberFromRoom } from '../../services/chatService';
import Avatar from '../../components/ui/Avatar';
import type { ChatRoom, RootStackParamList, RoomMember } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'GroupInfo'>;

export default function GroupInfoScreen() {
  const { colors: Colors } = useTheme();
  const { alert, confirm } = useConfirm();
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(async () => {
    try { setRoom(await getRoom(route.params.roomId)); }
    catch { alert('Could not load group', 'Please try again.'); }
    finally { setLoading(false); }
  }, [alert, route.params.roomId]);

  useEffect(() => { load(); }, [load]);

  const leaveGroup = useCallback(() => {
    if (!user || leaving) return;
    confirm({
      title: 'Leave group?',
      message: 'You will stop receiving new messages from this group. You can be added again by an admin.',
      icon: 'exit-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive', onPress: async () => {
            setLeaving(true);
            try {
              await removeMemberFromRoom(route.params.roomId, user.id);
              navigation.popToTop();
            } catch (error: any) {
              const detail = error?.response?.data?.error || 'Please assign another admin first, then try again.';
              alert('Could not leave group', detail);
              setLeaving(false);
            }
          },
        },
      ],
    });
  }, [alert, confirm, leaving, navigation, route.params.roomId, user]);

  if (loading) return <View style={[styles.center, { backgroundColor: Colors.background }]}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  const members = room?.members_detail ?? [];

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={[styles.hero, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <View style={[styles.groupIcon, { backgroundColor: Colors.highlight }]}><Ionicons name="people" size={32} color={Colors.primary} /></View>
        <Text style={[styles.name, { color: Colors.text }]}>{room?.name || route.params.roomName}</Text>
        <Text style={[styles.count, { color: Colors.textSecondary }]}>{members.length} members</Text>
      </View>
      <Text style={[styles.section, { color: Colors.textSecondary }]}>MEMBERS</Text>
      <FlatList
        data={members}
        keyExtractor={(member) => String(member.id)}
        renderItem={({ item }: { item: RoomMember }) => {
          const primary = item.display_name?.trim() || item.username;
          return <View style={[styles.member, { borderBottomColor: Colors.divider }]}>
            <Avatar name={primary} uri={item.avatar} size={44} showOnline isOnline={item.is_online} />
            <View style={styles.memberInfo}>
              <Text style={[styles.memberName, { color: Colors.text }]}>{item.id === user?.id ? `${primary} (You)` : primary}</Text>
              <Text style={[styles.memberSub, { color: Colors.textSecondary }]}>@{item.username}</Text>
            </View>
            {item.role === 'admin' && <Text style={[styles.admin, { color: Colors.primary, borderColor: Colors.primary }]}>ADMIN</Text>}
          </View>;
        }}
        contentContainerStyle={styles.list}
      />
      <View style={[styles.footer, { backgroundColor: Colors.background, borderTopColor: Colors.divider }]}>
        <TouchableOpacity style={[styles.leave, { borderColor: Colors.error }]} onPress={leaveGroup} disabled={leaving}>
          {leaving ? <ActivityIndicator color={Colors.error} /> : <><Ionicons name="exit-outline" size={19} color={Colors.error} /><Text style={[styles.leaveText, { color: Colors.error }]}>Leave group</Text></>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', padding: Spacing.lg, margin: Spacing.md, borderWidth: 1, borderRadius: Radius.lg },
  groupIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  name: { fontSize: Font.size.lg, ...Font.semiBold }, count: { fontSize: Font.size.sm, marginTop: 4 },
  section: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1, marginHorizontal: Spacing.md, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  list: { paddingBottom: 84 }, member: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  memberInfo: { flex: 1, marginLeft: Spacing.md }, memberName: { fontSize: Font.size.md, ...Font.medium }, memberSub: { fontSize: Font.size.sm, marginTop: 2 },
  admin: { fontSize: 10, fontWeight: '700', letterSpacing: .6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.sm },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  leave: { minHeight: 45, borderWidth: 1, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm }, leaveText: { fontSize: Font.size.md, ...Font.semiBold },
});
