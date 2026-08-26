/* ------------------------------------------------------------------ */
/*  Create Group — choose accepted contacts, then name the group       */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

import { Font, Radius, Spacing } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { getContacts } from '../../services/contactService';
import { createGroupRoom } from '../../services/chatService';
import { cacheContacts, getCachedContacts } from '../../services/localMessageStore';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import { useAppStore } from '../../store/appStore';
import type { Contact, RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function GroupCreateScreen() {
  const navigation = useNavigation<Nav>();
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const presenceByUserId = useAppStore((s) => s.presenceByUserId);

  useEffect(() => {
    let active = true;
    (async () => {
      // Local contacts make the picker usable immediately; the API refresh is
      // deliberately non-blocking so a slow connection never delays selection.
      if (user?.id != null) {
        const cached = await getCachedContacts(user.id).catch(() => [] as Contact[]);
        if (active && cached.length) setContacts(cached);
      }
      if (active) setLoading(false);
      getContacts()
        .then((items) => {
          if (active) setContacts(items);
          if (user?.id != null) cacheContacts(user.id, items).catch(() => {});
        })
        .catch(() => { /* cached contacts remain usable offline */ });
    })();
    return () => { active = false; };
  }, [user?.id]);

  const selectedCount = selected.size;
  const canCreate = name.trim().length > 0 && selectedCount >= 2 && !creating;
  const selectionText = useMemo(
    () => selectedCount === 0 ? 'Choose at least 2 contacts' : `${selectedCount} contact${selectedCount === 1 ? '' : 's'} selected`,
    [selectedCount],
  );

  const toggleContact = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const createGroup = useCallback(async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const room = await createGroupRoom(name.trim(), Array.from(selected));
      navigation.replace('ChatRoom', { roomId: room.id, roomName: room.name });
    } catch (error: any) {
      const detail = error?.response?.data?.members?.[0]
        || error?.response?.data?.name?.[0]
        || error?.response?.data?.detail
        || 'Please check your connection and try again.';
      alert('Could not create group', String(detail));
    } finally {
      setCreating(false);
    }
  }, [alert, canCreate, name, navigation, selected]);

  if (loading) {
    return <View style={[styles.center, { backgroundColor: Colors.background }]}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      <View style={styles.form}>
        <Input
          placeholder="Group name"
          value={name}
          onChangeText={setName}
          maxLength={120}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={createGroup}
        />
        <Text style={[styles.helper, { color: Colors.textSecondary }]}>{selectionText}</Text>
      </View>

      <FlatList
        data={contacts}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={contacts.length === 0 ? styles.empty : styles.list}
        renderItem={({ item }) => {
          const person = item.contact_detail;
          const primary = person.display_name?.trim() || person.username;
          const isSelected = selected.has(person.id);
          return (
            <TouchableOpacity
              style={[styles.contact, { borderBottomColor: Colors.divider }]}
              onPress={() => toggleContact(person.id)}
              activeOpacity={0.7}
            >
              <Avatar name={primary} uri={person.avatar} size={46} showOnline isOnline={presenceByUserId[person.id]?.isOnline ?? false} />
              <View style={styles.contactInfo}>
                <Text style={[styles.contactName, { color: Colors.text }]} numberOfLines={1}>{primary}</Text>
                <Text style={[styles.contactSub, { color: Colors.textSecondary }]} numberOfLines={1}>@{person.username}</Text>
              </View>
              <Ionicons
                name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={26}
                color={isSelected ? Colors.primary : Colors.textTertiary}
              />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="people-outline" size={42} color={Colors.textTertiary} /><Text style={[styles.emptyText, { color: Colors.textSecondary }]}>Add contacts before creating a group.</Text></View>}
      />

      <View style={[styles.footer, { backgroundColor: Colors.background, borderTopColor: Colors.divider }]}>
        <TouchableOpacity
          style={[styles.createButton, { backgroundColor: canCreate ? Colors.primary : Colors.surfaceVariant }]}
          disabled={!canCreate}
          onPress={createGroup}
          activeOpacity={0.8}
        >
          {creating ? <ActivityIndicator color="#fff" /> : <><Ionicons name="people" size={19} color="#fff" /><Text style={styles.createText}>Create group</Text></>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  form: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  helper: { fontSize: Font.size.sm, marginBottom: Spacing.sm },
  list: { paddingBottom: 88 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: Font.size.md, textAlign: 'center' },
  contact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  contactInfo: { flex: 1, marginLeft: Spacing.md },
  contactName: { fontSize: Font.size.md, ...Font.semiBold },
  contactSub: { fontSize: Font.size.sm, marginTop: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  createButton: { minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.sm },
  createText: { color: '#fff', fontSize: Font.size.md, ...Font.semiBold },
});
