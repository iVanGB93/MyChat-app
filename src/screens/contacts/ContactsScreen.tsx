/* ------------------------------------------------------------------ */
/*  Contacts Screen — list contacts + search & add users               */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Font, Spacing, Radius } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getContacts, addContact, removeContact } from '../../services/contactService';
import { searchUsers } from '../../services/authService';
import { getOrCreateDirect, getRooms } from '../../services/chatService';
import { useAuth } from '../../contexts/AuthContext';
import { useAppStore } from '../../store/appStore';
import { setCachedRelationship } from '../../services/localMessageStore';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import type { Contact, User, RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ContactsRoute = RouteProp<RootStackParamList, 'Contacts'>;

export default function ContactsScreen() {
  const { colors: Colors } = useTheme();
  const { confirm, alert } = useConfirm();
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const route = useRoute<ContactsRoute>();
  const prefillTag = route.params?.prefillTag;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [existingChatUserIds, setExistingChatUserIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const [contactsData, rooms] = await Promise.all([getContacts(), getRooms()]);
      setContacts(contactsData);
      // Mirror full set into the global store so chat screens know who is
      // already accepted (vs. who is a pending message-request sender).
      useAppStore.getState().setContactIds(contactsData.map((c) => c.contact));

      // Build set of user IDs that already have a direct chat
      const chatIds = new Set<number>();
      rooms.forEach((room) => {
        if (room.room_type === 'direct') {
          room.members_detail.forEach((m) => {
            if (m.id !== user?.id) chatIds.add(m.id);
          });
        }
      });
      setExistingChatUserIds(chatIds);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  // Pre-fill the search input when the screen is opened via a deep link
  // (e.g. `axonic://add/AXN-7K3P` from a shared tag).
  useEffect(() => {
    if (prefillTag) setQuery(prefillTag);
  }, [prefillTag]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(query.trim());
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const handleAddContact = async (userId: number) => {
    try {
      await addContact(userId);
      useAppStore.getState().addContactId(userId);
      if (user?.id != null) await setCachedRelationship(user.id, userId, 'contact');
      alert('Done', 'Contact added!');
      fetchContacts();
    } catch {
      alert('Error', 'Could not add contact');
    }
  };

  const handleRemoveContact = (contact: Contact) => {
    confirm({
      title: 'Remove contact',
      message: `Remove ${contact.contact_detail.username}?`,
      icon: 'person-remove-outline',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeContact(contact.id);
              useAppStore.getState().removeContactId(contact.contact);
              if (user?.id != null) await setCachedRelationship(user.id, contact.contact, null);
              fetchContacts();
            } catch { alert('Error', 'Failed to remove contact'); }
          },
        },
      ],
    });
  };

  const handleStartChat = async (userId: number, username: string) => {
    try {
      const room = await getOrCreateDirect(userId);
      navigation.navigate('ChatRoom', { roomId: room.id, roomName: username, otherUserId: userId });
    } catch {
      alert('Error', 'Could not open chat');
    }
  };

  const contactIds = new Set(contacts.map((c) => c.contact));

  // Hide contacts who already have a direct chat room
  const filteredContacts = contacts.filter(
    (c) => !existingChatUserIds.has(c.contact_detail.id)
  );

  // Show all search results including existing chats
  const filteredSearchResults = searchResults;

  const renderSearchItem = ({ item }: { item: User }) => {
    const primary = (item.display_name?.trim() || item.username);
    return (
      <View style={[styles.item, { backgroundColor: Colors.surface }]}>
        <Avatar name={primary} uri={item.avatar} size={44} showOnline isOnline={item.is_online} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: Colors.text }]} numberOfLines={1}>{primary}</Text>
          <Text style={[styles.sub, { color: Colors.textSecondary }]} numberOfLines={1}>
            @{item.username}
            {item.user_tag ? `  ·  ${item.user_tag}` : ''}
          </Text>
        </View>
        <View style={styles.actionBtns}>
          {!contactIds.has(item.id) ? (
            <TouchableOpacity style={[styles.addBtn, { backgroundColor: Colors.primary }]} onPress={() => handleAddContact(item.id)}>
              <Text style={[styles.addBtnText, { color: Colors.textInverse }]}>+ Add</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={[styles.added, { color: Colors.success }]}>✓</Text>
              <TouchableOpacity
                style={[styles.chatBtn, { backgroundColor: Colors.surfaceVariant, borderColor: Colors.border }]}
                onPress={() => handleStartChat(item.id, primary)}
              >
                <Text style={[styles.chatBtnText, { color: Colors.primary }]}>Chat</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderContact = ({ item }: { item: Contact }) => {
    const primary = (item.contact_detail.display_name?.trim() || item.contact_detail.username);
    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: Colors.surface }]}
        activeOpacity={0.7}
        onPress={() => handleStartChat(item.contact_detail.id, primary)}
        onLongPress={() => handleRemoveContact(item)}
      >
        <Avatar
          name={primary}
          uri={item.contact_detail.avatar}
          size={48}
          showOnline
          isOnline={item.contact_detail.is_online}
        />
        <View style={styles.info}>
          <Text style={[styles.name, { color: Colors.text }]} numberOfLines={1}>{primary}</Text>
          <Text style={[styles.sub, { color: Colors.textSecondary }]} numberOfLines={1}>
            {item.contact_detail.is_online ? '🟢 Online' : `@${item.contact_detail.username}`}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.background }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const isSearching = query.trim().length > 0;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }]}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Search by name, @username or tag…"
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
          />
        </View>
        <TouchableOpacity
          style={[styles.scanBtn, { borderColor: Colors.primary, backgroundColor: Colors.surface }]}
          onPress={() => navigation.navigate('ScanTag')}
          activeOpacity={0.7}
          accessibilityLabel="Scan a friend's tag QR code"
        >
          <Ionicons name="qr-code-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {searching && <ActivityIndicator style={styles.searchSpinner} color={Colors.primary} />}

      {/* Search results */}
      {isSearching ? (
        <FlatList
          data={filteredSearchResults}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderSearchItem}
          contentContainerStyle={filteredSearchResults.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={
            !searching ? <EmptyState iconName="search-outline" title="No users found" /> : null
          }
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.border }]} />}
        />
      ) : (
        <FlatList
          data={filteredContacts}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderContact}
          contentContainerStyle={filteredContacts.length === 0 ? styles.emptyContainer : styles.list}
          ListEmptyComponent={
            <EmptyState iconName="people-outline" title="No contacts" subtitle="Search for users above to add them" />
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchContacts(); }} colors={[Colors.primary]} />
          }
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: Colors.border }]} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: Spacing.md },
  emptyContainer: { flexGrow: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  searchInput: { marginBottom: 0 },
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchSpinner: { marginVertical: Spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  info: { flex: 1, marginLeft: Spacing.md },
  name: { fontSize: Font.size.md, ...Font.semiBold },
  sub: { fontSize: Font.size.sm, marginTop: 1 },
  addBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  addBtnText: { fontSize: Font.size.sm, ...Font.semiBold },
  added: { fontSize: Font.size.sm, ...Font.medium, marginRight: Spacing.xs },
  actionBtns: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  chatBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  chatBtnText: { fontSize: Font.size.sm, ...Font.semiBold },
  separator: { height: 1, marginLeft: 76 },
});
