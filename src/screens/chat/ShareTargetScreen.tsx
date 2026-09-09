import { useContactName } from '../../hooks/useContactName';
/* ------------------------------------------------------------------ */
/*  ShareTargetScreen                                                   */
/*                                                                       */
/*  Opened when the OS hands us a payload from the system Share menu     */
/*  (text / URL / image). Renders a contact picker; on tap, we           */
/*  open / create the direct room, send the payload, and navigate the   */
/*  user into the resulting chat.                                       */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Font, Spacing, Radius } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { getContacts } from '../../services/contactService';
import { getOrCreateDirect, getRooms } from '../../services/chatService';
import { connectRoom, sendChatMessage, type SendChatResult } from '../../services/chatWsManager';
import { persistOutgoingImage, persistSharedFile } from '../../services/voiceMessageUtils';
import { mediaFileSize } from '../../services/mediaLane';
import { formatBytes, getTransferFeedback, mapWithConcurrency, MEDIA_BATCH_CONCURRENCY, MEDIA_MAX_UPLOAD_BYTES, validateMediaSize } from '../../services/mediaTransferPolicy';
import { getCachedContacts, getCachedRooms, getLastMessagePerRoom, type LocalMessage } from '../../services/localMessageStore';
import { playSound } from '../../services/soundService';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import { useAppStore } from '../../store/appStore';
import type { ChatRoom, Contact, RootStackParamList, ShareAttachment } from '../../types';
import SharePreview from '../../components/chat/share-preview';

type ShareTarget = { key: string; name: string; avatar?: string | null; contact?: Contact; room?: ChatRoom; recent: number };

type Nav = NativeStackNavigationProp<RootStackParamList, 'ShareTarget'>;
type R = RouteProp<RootStackParamList, 'ShareTarget'>;

export default function ShareTargetScreen() {
  const contactName = useContactName();
  const { colors: Colors } = useTheme();
  const { alert } = useConfirm();
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const insets = useSafeAreaInsets();

  const { text: initialText, attachments: initialAttachments = [] } = route.params ?? {};
  const [caption, setCaption] = useState(initialText ?? '');
  const [attachments, setAttachments] = useState<ShareAttachment[]>(initialAttachments);
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groupRooms, setGroupRooms] = useState<ChatRoom[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<ShareTarget | null>(null);
  const [recentChatAt, setRecentChatAt] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [transferState, setTransferState] = useState<Record<string, 'queued' | 'uploading' | 'sent' | 'failed'>>({});
  const presenceByUserId = useAppStore((s) => s.presenceByUserId);
  const oversizedCount = useMemo(
    () => attachments.filter((attachment) => !!validateMediaSize(attachment.size)).length,
    [attachments],
  );

  // Render cached contacts first. The server update only repairs the list and
  // recalculates recency; it must never hold the share sheet behind a spinner.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (user?.id != null) {
        const cached = await getCachedContacts(user.id).catch(() => [] as Contact[]);
        if (!cancelled && cached.length) setContacts(cached);
        const cachedRooms = await getCachedRooms(user.id).catch(() => [] as ChatRoom[]);
        if (!cancelled) setGroupRooms(cachedRooms.filter((room) => room.room_type === 'group'));
      }
      if (!cancelled) setLoading(false);
      try {
        const [list, rooms, localLastMessages] = await Promise.all([
          getContacts(),
          getRooms().catch(() => user?.id != null ? getCachedRooms(user.id) : []),
          getLastMessagePerRoom().catch(() => ({} as Record<string, LocalMessage>)),
        ]);
        if (cancelled) return;
        setGroupRooms(rooms.filter((room) => room.room_type === 'group').map((room) => ({
          ...room, updated_at: localLastMessages[room.id]?.created_at ?? room.updated_at,
        })));
        const contactIds = new Set(list.map((contact) => contact.contact));
        const recentByContact: Record<number, number> = {};
        for (const room of rooms) {
          if (room.room_type !== 'direct') continue;
          const latest = localLastMessages[room.id]?.created_at ?? room.updated_at;
          const timestamp = new Date(latest).getTime();
          if (!Number.isFinite(timestamp)) continue;
          for (const member of room.members_detail ?? []) {
            if (contactIds.has(member.id)) {
              recentByContact[member.id] = Math.max(recentByContact[member.id] ?? 0, timestamp);
            }
          }
        }
        setContacts(list);
        setRecentChatAt(recentByContact);
      } catch {
        // Cached contacts remain valid when a refresh is temporarily unavailable.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const targets: ShareTarget[] = [
      ...contacts.map((contact) => ({ key: `user:${contact.contact}`, contact,
        name: contactName(contact.contact, contact.contact_detail.display_name?.trim() || contact.contact_detail.username),
        avatar: contact.contact_detail.avatar, recent: recentChatAt[contact.contact] ?? 0 })),
      ...groupRooms.map((room) => ({ key: `room:${room.id}`, room, name: room.name || 'Group', avatar: room.avatar, recent: Date.parse(room.updated_at) || 0 })),
    ];
    return targets.filter((target) => !q || target.name.toLowerCase().includes(q) || target.contact?.contact_detail.username.toLowerCase().includes(q))
      .sort((a, b) => b.recent - a.recent || a.name.localeCompare(b.name));
  }, [contacts, groupRooms, query, recentChatAt, contactName]);

  const handleSend = useCallback(async (target: ShareTarget) => {
    if (sendingTo !== null) return;
    const userId = target.contact?.contact;
    const displayName = target.name;
    setSendingTo(target.key);
    try {
      const room = target.room ?? await getOrCreateDirect(userId!);

      // Make sure the room websocket is alive before we hand the
      // message off \u2014 sendChatMessage queues to the outbox if not,
      // but connecting first gives the best chance of immediate delivery.
      try { await connectRoom(room.id); } catch { /* outbox will retry */ }

      let sentAnything = false;
      if (attachments.length) {
        // A caption for a document/video is sent once as text so the attachment
        // can keep its original filename as the bubble label.
        if (caption.trim() && attachments[0]?.kind !== 'image') {
          const captionResult = await sendChatMessage(room.id, caption.trim(), 'text');
          sentAnything = captionResult.state !== 'failed';
        }

        const results = await mapWithConcurrency(attachments, MEDIA_BATCH_CONCURRENCY, async (attachment, index): Promise<SendChatResult> => {
          const key = `${attachment.uri}|${attachment.fileName}`;
          const sizeFailure = validateMediaSize(attachment.size ?? mediaFileSize(attachment.uri));
          if (sizeFailure) {
            setTransferState((current) => ({ ...current, [key]: 'failed' }));
            return { messageId: null, state: 'failed', error: sizeFailure };
          }

          setTransferState((current) => ({ ...current, [key]: 'uploading' }));
          const stagingId = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
          let persistedUri = attachment.uri;
          try {
            persistedUri = attachment.kind === 'image'
              ? await persistOutgoingImage(stagingId, attachment.uri, attachment.mimeType || 'image/jpeg')
              : persistSharedFile(stagingId, attachment.uri, attachment.fileName);
          } catch (error) {
            console.warn('[ShareTarget] failed to persist shared file:', error);
            const failed: SendChatResult = {
              messageId: null,
              state: 'failed',
              error: { code: 'invalid_file', message: `${attachment.fileName} could not be copied into Axonic.`, retryable: false, status: 0 },
            };
            setTransferState((current) => ({ ...current, [key]: 'failed' }));
            return failed;
          }

          const messageType = attachment.kind === 'file' ? 'document' : attachment.kind;
          const fallback = attachment.kind === 'image' ? '\uD83D\uDCF7 Photo'
            : attachment.kind === 'video' ? `\uD83C\uDFA5 ${attachment.fileName}`
            : `\uD83D\uDCC4 ${attachment.fileName}`;
          const result = await sendChatMessage(
            room.id,
            index === 0 && attachment.kind === 'image' ? (caption.trim() || fallback) : fallback,
            messageType,
            null,
            attachment.kind === 'image'
              ? { file_uri: persistedUri, image_mime: attachment.mimeType || 'image/jpeg' }
              : { file_uri: persistedUri, media_mime: attachment.mimeType || 'application/octet-stream' },
          );
          setTransferState((current) => ({
            ...current,
            [key]: result.state === 'failed' ? 'failed' : result.state === 'sent' ? 'sent' : 'queued',
          }));
          return result;
        });

        sentAnything = sentAnything || results.some((result) => result.state !== 'failed');
        const feedback = getTransferFeedback(results);
        if (feedback) alert(feedback.title, feedback.message);
        const notQueued = attachments.filter((_, index) => !results[index]?.messageId);
        if (notQueued.length) {
          setAttachments(notQueued);
          if (sentAnything) setCaption('');
          setSendingTo(null);
          return;
        }
      } else {
        const body = caption.trim();
        if (!body) {
          alert('Empty', 'Nothing to send.');
          setSendingTo(null);
          return;
        }
        const result = await sendChatMessage(room.id, body, 'text');
        sentAnything = result.state !== 'failed';
      }

      if (!sentAnything) { setSendingTo(null); return; }
      playSound('message_sent');
      setSelectedTarget(null);

      // Replace the share screen with the destination chat so the
      // back button doesn't take the user back to the share picker.
      navigation.replace('ChatRoom', {
        roomId: room.id,
        roomName: displayName,
        otherUserId: userId,
      });
    } catch (err) {
      console.warn('[ShareTarget] send failed:', err);
      alert('Error', 'Could not send the shared content.');
      setSendingTo(null);
    }
  }, [sendingTo, attachments, caption, navigation, alert]);

  const renderItem = ({ item }: { item: ShareTarget }) => {
    const u = item.contact?.contact_detail;
    const primary = item.name;
    const busy = sendingTo === item.key;
    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: Colors.surface }]}
        onPress={() => attachments.length ? setSelectedTarget(item) : handleSend(item)}
        disabled={sendingTo !== null}
        activeOpacity={0.7}
      >
        <Avatar name={primary} uri={item.avatar} size={44} showOnline={!!u} isOnline={u ? presenceByUserId[u.id]?.isOnline ?? false : false} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: Colors.text }]} numberOfLines={1}>{primary}</Text>
          <Text style={[styles.sub, { color: Colors.textTertiary }]} numberOfLines={1}>
            {u ? `@${u.username}` : 'Group chat'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={Colors.primary} />
        ) : (
          <Ionicons name="send" size={20} color={Colors.primary} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: Colors.neonBorder }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          disabled={sendingTo !== null}
          style={styles.headerBtn}
        >
          <Ionicons name="close" size={26} color={Colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: Colors.primary }]}>SHARE TO\u2026</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Preview of what we're about to share */}
      <View style={[styles.preview, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewScroller} contentContainerStyle={styles.previewStrip}>
            {attachments.map((attachment, index) => (
              <View key={`${attachment.uri}-${index}`} style={styles.attachmentPreview}>
                {attachment.kind === 'image' ? (
                  <Image source={{ uri: attachment.uri }} style={[styles.previewImg, styles.multiPreviewImg]} resizeMode="cover" />
                ) : (
                  <View style={[styles.previewImg, styles.multiPreviewImg, styles.filePreview, { backgroundColor: Colors.highlight }]}>
                    <Ionicons name={attachment.kind === 'video' ? 'videocam-outline' : 'document-outline'} size={24} color={Colors.primary} />
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.removeAttachment, { backgroundColor: Colors.surface }]}
                  onPress={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={sendingTo !== null}
                  accessibilityLabel={`Remove ${attachment.fileName}`}
                >
                  <Ionicons name="close" size={14} color={Colors.text} />
                </TouchableOpacity>
                {transferState[`${attachment.uri}|${attachment.fileName}`] ? (
                  <View style={[styles.transferBadge, {
                    backgroundColor: transferState[`${attachment.uri}|${attachment.fileName}`] === 'failed'
                      ? Colors.error
                      : Colors.surface,
                  }]}>
                    {transferState[`${attachment.uri}|${attachment.fileName}`] === 'uploading' ? (
                      <ActivityIndicator size="small" color={Colors.primary} />
                    ) : (
                      <Text style={[styles.transferBadgeText, {
                        color: transferState[`${attachment.uri}|${attachment.fileName}`] === 'failed'
                          ? Colors.textInverse
                          : Colors.primary,
                      }]}>
                        {transferState[`${attachment.uri}|${attachment.fileName}`]}
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <Ionicons name="document-text-outline" size={28} color={Colors.primary} style={{ marginRight: Spacing.md }} />
        )}
        <View style={{ flex: 1 }}>
          {attachments.length ? (
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption\u2026"
              placeholderTextColor={Colors.textTertiary}
              style={[styles.captionInput, { color: Colors.text }]}
              multiline
              maxLength={1000}
            />
          ) : (
            <Text style={[styles.previewText, { color: Colors.text }]} numberOfLines={4}>
              {caption || '(empty)'}
            </Text>
          )}
          {attachments.length ? (
            <Text style={[styles.limitHint, { color: oversizedCount ? Colors.error : Colors.textTertiary }]}>
              {oversizedCount
                ? `${oversizedCount} ${oversizedCount === 1 ? 'item exceeds' : 'items exceed'} the ${formatBytes(MEDIA_MAX_UPLOAD_BYTES)} limit`
                : `${attachments.length} ${attachments.length === 1 ? 'item' : 'items'} · ${formatBytes(MEDIA_MAX_UPLOAD_BYTES)} maximum each`}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Search box */}
      <View style={[styles.searchBox, { backgroundColor: Colors.surface, borderColor: Colors.neonBorder }]}>
        <Ionicons name="search" size={18} color={Colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts and groups"
          placeholderTextColor={Colors.textTertiary}
          style={[styles.searchInput, { color: Colors.text }]}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {/* Contact list */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          iconName="people-outline"
          title="No chats found"
          subtitle={query ? 'No contacts or groups match your search.' : 'Add a contact or join a group to share.'}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.key}
          renderItem={renderItem}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl + insets.bottom }}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.xs }} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <SharePreview
        visible={selectedTarget !== null}
        destination={selectedTarget?.name}
        items={attachments.map((item, index) => ({ id: String(index), uri: item.uri, name: item.fileName, kind: item.kind }))}
        busy={sendingTo !== null}
        onClose={() => { if (sendingTo === null) setSelectedTarget(null); }}
        onRemove={(id) => setAttachments((items) => items.filter((_, index) => index !== Number(id)))}
        onSend={() => { if (selectedTarget) void handleSend(selectedTarget); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: Font.size.md, fontWeight: '800', letterSpacing: 3 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    minHeight: 80,
  },
  previewStrip: { gap: Spacing.xs, paddingRight: Spacing.md },
  previewScroller: { flexGrow: 0, maxWidth: '58%', marginRight: Spacing.sm },
  attachmentPreview: { position: 'relative' },
  multiPreviewImg: { marginRight: 0 },
  filePreview: { alignItems: 'center', justifyContent: 'center' },
  removeAttachment: { position: 'absolute', top: -5, right: -5, width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  transferBadge: { position: 'absolute', left: 3, right: 3, bottom: 3, minHeight: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  transferBadgeText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  previewImg: { width: 64, height: 64, borderRadius: Radius.sm, marginRight: Spacing.md, backgroundColor: '#000' },
  previewText: { fontSize: Font.size.sm },
  captionInput: { fontSize: Font.size.sm, minHeight: 40, padding: 0, textAlignVertical: 'top' },
  limitHint: { fontSize: 10, marginTop: 4 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 44,
  },
  searchInput: { flex: 1, marginLeft: Spacing.sm, fontSize: Font.size.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  info: { flex: 1, marginLeft: Spacing.md },
  name: { fontSize: Font.size.sm, fontWeight: '700' },
  sub: { fontSize: Font.size.xs, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
