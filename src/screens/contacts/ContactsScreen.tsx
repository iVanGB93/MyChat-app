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
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Font, Spacing, Radius } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { getContacts, addContact, removeContact } from '../../services/contactService';
import { searchUsers } from '../../services/authService';
import { getOrCreateDirect, getRooms } from '../../services/chatService';
import { useAuth } from '../../contexts/AuthContext';
import Avatar from '../../components/ui/Avatar';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';
import type { Contact, User, RootStackParamList } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ContactsScreen() {
  const { colors: Colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
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
      Alert.alert('Done', 'Contact added!');
      fetchContacts();
    } catch {
      Alert.alert('Error', 'Could not add contact');
    }
  };

  const handleRemoveContact = (contact: Contact) => {
    Alert.alert('Remove Contact', `Remove ${contact.contact_detail.username}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await removeContact(contact.id);
            fetchContacts();
          } catch { Alert.alert('Error', 'Failed to remove contact'); }
        },
      },
    ]);
  };

  const handleStartChat = async (userId: number, username: string) => {
    try {
      const room = await getOrCreateDirect(userId);
      navigation.navigate('ChatRoom', { roomId: room.id, roomName: username, otherUserId: userId });
    } catch {
      Alert.alert('Error', 'Could not open chat');
    }
  };

  const contactIds = new Set(contacts.map((c) => c.contact));

  // Hide contacts who already have a direct chat room
  const filteredContacts = contacts.filter(
    (c) => !existingChatUserIds.has(c.contact_detail.id)
  );

  // Show all search results including existing chats
  const filteredSearchResults = searchResults;

  const renderSearchItem = ({ item }: { item: User }) => (
    <View style={[styles.item, { backgroundColor: Colors.surface }]}>
      <Avatar name={item.username} uri={item.avatar} size={44} showOnline isOnline={item.is_online} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: Colors.text }]}>{item.username}</Text>
        <Text style={[styles.sub, { color: Colors.textSecondary }]}>{item.email}</Text>
      </View>
      <View style={styles.actionBtns}>
        {!contactIds.has(item.id) ? (
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: Colors.primary }]} onPress={() => handleAddContact(item.id)}>
            <Text style={[styles.addBtnText, { color: Colors.textInverse }]}>+ Add</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.added, { color: Colors.success }]}>✓</Text>
        )}
        <TouchableOpacity
          style={[styles.chatBtn, { backgroundColor: Colors.surfaceVariant, borderColor: Colors.border }]}
          onPress={() => handleStartChat(item.id, item.username)}
        >
          <Text style={[styles.chatBtnText, { color: Colors.primary }]}>Chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: Colors.surface }]}
      activeOpacity={0.7}
      onPress={() => handleStartChat(item.contact_detail.id, item.contact_detail.username)}
      onLongPress={() => handleRemoveContact(item)}
    >
      <Avatar
        name={item.contact_detail.username}
        uri={item.contact_detail.avatar}
        size={48}
        showOnline
        isOnline={item.contact_detail.is_online}
      />
      <View style={styles.info}>
        <Text style={[styles.name, { color: Colors.text }]}>{item.contact_detail.username}</Text>
        <Text style={[styles.sub, { color: Colors.textSecondary }]}>
          {item.contact_detail.is_online ? '🟢 Online' : item.contact_detail.bio || 'Tap to chat'}
        </Text>
      </View>
    </TouchableOpacity>
  );

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
        <Input
          placeholder="Search users to add…"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
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
            !searching ? <EmptyState icon="🔍" title="No users found" /> : null
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
            <EmptyState icon="👥" title="No contacts" subtitle="Search for users above to add them" />
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
  searchBar: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  searchInput: { marginBottom: 0 },
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
