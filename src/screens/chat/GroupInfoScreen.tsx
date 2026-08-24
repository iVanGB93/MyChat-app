import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { addMemberToRoom, getRoom, removeMemberFromRoom, renameGroupRoom, uploadGroupAvatar } from '../../services/chatService';
import { getContacts } from '../../services/contactService';
import { resolveMediaUrl } from '../../services/api';
import Avatar from '../../components/ui/Avatar';
import type { ChatRoom, Contact, RootStackParamList, RoomMember } from '../../types';

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
  const [busy, setBusy] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);

  const load = useCallback(async () => {
    try { setRoom(await getRoom(route.params.roomId)); }
    catch { alert('Could not load group', 'Please try again.'); }
    finally { setLoading(false); }
  }, [alert, route.params.roomId]);
  useEffect(() => { load(); }, [load]);

  const members = room?.members_detail ?? [];
  const isAdmin = useMemo(() => members.some((m) => m.id === user?.id && m.role === 'admin'), [members, user?.id]);
  const availableContacts = useMemo(() => {
    const ids = new Set(members.map((member) => member.id));
    return contacts.filter((contact) => !ids.has(contact.contact));
  }, [contacts, members]);
  const updateRoom = useCallback((next: ChatRoom) => setRoom(next), []);

  const pickPhoto = useCallback(async () => {
    if (!isAdmin || busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { alert('Permission needed', 'Allow photo library access to choose a group picture.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    setBusy(true);
    try {
      const asset = result.assets[0];
      updateRoom(await uploadGroupAvatar(route.params.roomId, asset.uri, asset.mimeType ?? 'image/jpeg'));
    } catch (error: any) {
      alert('Could not update group photo', error?.response?.data?.error || 'Please try another image.');
    } finally { setBusy(false); }
  }, [alert, busy, isAdmin, route.params.roomId, updateRoom]);

  const saveName = useCallback(async () => {
    const name = draftName.trim();
    if (!name || busy) return;
    setBusy(true);
    try { updateRoom(await renameGroupRoom(route.params.roomId, name)); setShowRename(false); }
    catch (error: any) { alert('Could not rename group', error?.response?.data?.error || 'Please try again.'); }
    finally { setBusy(false); }
  }, [alert, busy, draftName, route.params.roomId, updateRoom]);

  const openAddMembers = useCallback(async () => {
    if (!isAdmin) return;
    setShowAdd(true); setLoadingContacts(true);
    try { setContacts(await getContacts()); }
    catch { alert('Could not load contacts', 'Please try again.'); setShowAdd(false); }
    finally { setLoadingContacts(false); }
  }, [alert, isAdmin]);

  const addMember = useCallback(async (contact: Contact) => {
    if (busy) return;
    setBusy(true);
    try { updateRoom(await addMemberToRoom(route.params.roomId, contact.contact)); }
    catch (error: any) { alert('Could not add member', error?.response?.data?.members || 'Please try again.'); }
    finally { setBusy(false); }
  }, [alert, busy, route.params.roomId, updateRoom]);

  const removeMember = useCallback((member: RoomMember) => {
    if (!isAdmin || member.id === user?.id || busy) return;
    const name = member.display_name?.trim() || member.username;
    confirm({ title: `Remove ${name}?`, message: 'They will stop receiving new messages from this group.', icon: 'person-remove-outline', buttons: [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { updateRoom(await removeMemberFromRoom(route.params.roomId, member.id)); }
        catch (error: any) { alert('Could not remove member', error?.response?.data?.error || 'Please try again.'); }
        finally { setBusy(false); }
      } },
    ] });
  }, [alert, busy, confirm, isAdmin, route.params.roomId, updateRoom, user?.id]);

  const leaveGroup = useCallback(() => {
    if (!user || busy) return;
    confirm({ title: 'Leave group?', message: 'You will stop receiving new messages from this group. You can be added again by an admin.', icon: 'exit-outline', buttons: [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await removeMemberFromRoom(route.params.roomId, user.id); navigation.popToTop(); }
        catch (error: any) { alert('Could not leave group', error?.response?.data?.error || 'Please assign another admin first, then try again.'); setBusy(false); }
      } },
    ] });
  }, [alert, busy, confirm, navigation, route.params.roomId, user]);

  if (loading) return <View style={[styles.center, { backgroundColor: Colors.background }]}><ActivityIndicator size="large" color={Colors.primary} /></View>;

  return <View style={[styles.container, { backgroundColor: Colors.background }]}>
    <FlatList
      data={members}
      keyExtractor={(member) => String(member.id)}
      contentContainerStyle={styles.list}
      ListHeaderComponent={<>
        <View style={[styles.hero, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
          <TouchableOpacity disabled={!isAdmin || busy} onPress={pickPhoto} style={styles.photoWrap}>
            <Avatar name={room?.name || 'Group'} uri={resolveMediaUrl(room?.avatar)} size={82} />
            {isAdmin && <View style={[styles.cameraBadge, { backgroundColor: Colors.primary }]}><Ionicons name="camera" size={15} color={Colors.background} /></View>}
          </TouchableOpacity>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: Colors.text }]} numberOfLines={1}>{room?.name || route.params.roomName}</Text>
            {isAdmin && <TouchableOpacity onPress={() => { setDraftName(room?.name || ''); setShowRename(true); }}><Ionicons name="pencil" size={19} color={Colors.primary} /></TouchableOpacity>}
          </View>
          <Text style={[styles.count, { color: Colors.textSecondary }]}>{members.length} members</Text>
        </View>
        {isAdmin && <TouchableOpacity style={[styles.action, { borderColor: Colors.neonBorder, backgroundColor: Colors.surface }]} onPress={openAddMembers} disabled={busy}><Ionicons name="person-add-outline" size={20} color={Colors.primary} /><Text style={[styles.actionText, { color: Colors.text }]}>Add members</Text></TouchableOpacity>}
        <Text style={[styles.section, { color: Colors.textSecondary }]}>MEMBERS</Text>
      </>}
      renderItem={({ item }) => {
        const primary = item.display_name?.trim() || item.username;
        return <View style={[styles.member, { borderBottomColor: Colors.divider }]}>
          <Avatar name={primary} uri={resolveMediaUrl(item.avatar)} size={44} showOnline isOnline={item.is_online} />
          <View style={styles.memberInfo}><Text style={[styles.memberName, { color: Colors.text }]}>{item.id === user?.id ? `${primary} (You)` : primary}</Text><Text style={[styles.memberSub, { color: Colors.textSecondary }]}>@{item.username}</Text></View>
          {item.role === 'admin' && <Text style={[styles.admin, { color: Colors.primary, borderColor: Colors.primary }]}>ADMIN</Text>}
          {isAdmin && item.id !== user?.id && <TouchableOpacity style={styles.remove} onPress={() => removeMember(item)} disabled={busy}><Ionicons name="person-remove-outline" size={20} color={Colors.error} /></TouchableOpacity>}
        </View>;
      }}
      ListFooterComponent={<View style={styles.footer}><TouchableOpacity style={[styles.leave, { borderColor: Colors.error }]} onPress={leaveGroup} disabled={busy}><Ionicons name="exit-outline" size={19} color={Colors.error} /><Text style={[styles.leaveText, { color: Colors.error }]}>Leave group</Text></TouchableOpacity></View>}
    />
    <Modal visible={showRename} transparent animationType="fade" onRequestClose={() => setShowRename(false)}>
      <View style={styles.modalShade}><View style={[styles.modal, { backgroundColor: Colors.surface }]}><Text style={[styles.modalTitle, { color: Colors.text }]}>Rename group</Text><TextInput value={draftName} onChangeText={setDraftName} maxLength={120} autoFocus style={[styles.input, { color: Colors.text, borderColor: Colors.divider }]} placeholder="Group name" placeholderTextColor={Colors.textSecondary} /><View style={styles.modalActions}><TouchableOpacity onPress={() => setShowRename(false)}><Text style={{ color: Colors.textSecondary }}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={saveName} disabled={!draftName.trim() || busy}><Text style={{ color: Colors.primary, ...Font.semiBold }}>Save</Text></TouchableOpacity></View></View></View>
    </Modal>
    <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
      <View style={[styles.picker, { backgroundColor: Colors.background }]}><View style={[styles.pickerHeader, { borderBottomColor: Colors.divider }]}><Text style={[styles.modalTitle, { color: Colors.text }]}>Add members</Text><TouchableOpacity onPress={() => setShowAdd(false)}><Ionicons name="close" size={26} color={Colors.text} /></TouchableOpacity></View>
        {loadingContacts ? <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View> : <FlatList data={availableContacts} keyExtractor={(contact) => String(contact.id)} ListEmptyComponent={<Text style={[styles.empty, { color: Colors.textSecondary }]}>All of your contacts are already members.</Text>} renderItem={({ item }) => { const person = item.contact_detail; const name = person.display_name?.trim() || person.username; return <TouchableOpacity style={[styles.contact, { borderBottomColor: Colors.divider }]} onPress={() => addMember(item)} disabled={busy}><Avatar name={name} uri={resolveMediaUrl(person.avatar)} size={44} /><View style={styles.memberInfo}><Text style={[styles.memberName, { color: Colors.text }]}>{name}</Text><Text style={[styles.memberSub, { color: Colors.textSecondary }]}>@{person.username}</Text></View><Ionicons name="add-circle-outline" size={26} color={Colors.primary} /></TouchableOpacity>; }} />}
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { paddingBottom: Spacing.lg },
  hero: { alignItems: 'center', padding: Spacing.lg, margin: Spacing.md, borderWidth: 1, borderRadius: Radius.lg }, photoWrap: { position: 'relative', marginBottom: Spacing.sm }, cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, maxWidth: '100%' }, name: { fontSize: Font.size.lg, ...Font.semiBold, maxWidth: '85%' }, count: { fontSize: Font.size.sm, marginTop: 4 },
  action: { marginHorizontal: Spacing.md, minHeight: 48, paddingHorizontal: Spacing.md, borderWidth: 1, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, actionText: { fontSize: Font.size.md, ...Font.medium }, section: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 1, marginHorizontal: Spacing.md, marginTop: Spacing.lg, marginBottom: Spacing.xs },
  member: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth }, memberInfo: { flex: 1, marginLeft: Spacing.md }, memberName: { fontSize: Font.size.md, ...Font.medium }, memberSub: { fontSize: Font.size.sm, marginTop: 2 }, admin: { fontSize: 10, fontWeight: '700', letterSpacing: .6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: Radius.sm }, remove: { padding: Spacing.sm, marginLeft: Spacing.xs },
  footer: { padding: Spacing.md, marginTop: Spacing.lg }, leave: { minHeight: 45, borderWidth: 1, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm }, leaveText: { fontSize: Font.size.md, ...Font.semiBold },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)', justifyContent: 'center', padding: Spacing.lg }, modal: { borderRadius: Radius.lg, padding: Spacing.lg }, modalTitle: { fontSize: Font.size.lg, ...Font.semiBold }, input: { marginTop: Spacing.md, borderWidth: 1, borderRadius: Radius.md, minHeight: 48, paddingHorizontal: Spacing.md, fontSize: Font.size.md }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.lg, marginTop: Spacing.lg },
  picker: { flex: 1 }, pickerHeader: { padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, contact: { minHeight: 66, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth }, empty: { textAlign: 'center', marginTop: Spacing.xl, paddingHorizontal: Spacing.lg },
});
