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
import { formatBytes, mapWithConcurrency, MEDIA_BATCH_CONCURRENCY, MEDIA_MAX_UPLOAD_BYTES, validateMediaSize } from '../../services/mediaTransferPolicy';
import { cacheContacts, getCachedContacts, getLastMessagePerRoom, type LocalMessage } from '../../services/localMessageStore';
import { playSound } from '../../services/soundService';
import Avatar from '../../components/ui/Avatar';
import EmptyState from '../../components/ui/EmptyState';
import { useAppStore } from '../../store/appStore';
import type { Contact, RootStackParamList, ShareAttachment } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ShareTarget'>;
type R = RouteProp<RootStackParamList, 'ShareTarget'>;

export default function ShareTargetScreen() {
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
  const [recentChatAt, setRecentChatAt] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [sendingTo, setSendingTo] = useState<number | null>(null);
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
      }
      if (!cancelled) setLoading(false);
      try {
        const [list, rooms, localLastMessages] = await Promise.all([
          getContacts(),
          getRooms().catch(() => []),
          getLastMessagePerRoom().catch(() => ({} as Record<string, LocalMessage>)),
        ]);
        if (cancelled) return;
        if (user?.id != null) cacheContacts(user.id, list).catch(() => {});
        const contactIds = new Set(list.map((contact) => contact.contact));
        const recentByContact: Record<number, number> = {};
        for (const room of rooms) {
          if (room.room_type !== 'direct') continue;
          const latest = localLastMessages[room.id]?.created_at ?? room.updated_at;
          const timestamp = new Date(latest).getTime();
          if (!Number.isFinite(timestamp)) continue;
          for (const member of room.members_detail) {
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
    const matching = contacts.filter((c) => {
      const u = c.contact_detail;
      return (
        !q ||
        u.username.toLowerCase().includes(q) ||
        (u.display_name ?? '').toLowerCase().includes(q)
      );
    });
    return matching.sort((a, b) => {
      const recentDifference = (recentChatAt[b.contact] ?? 0) - (recentChatAt[a.contact] ?? 0);
      if (recentDifference !== 0) return recentDifference;
      const aName = a.contact_detail.display_name?.trim() || a.contact_detail.username;
      const bName = b.contact_detail.display_name?.trim() || b.contact_detail.username;
      return aName.localeCompare(bName);
    });
  }, [contacts, query, recentChatAt]);

  const handleSend = useCallback(async (contact: Contact) => {
    if (sendingTo !== null) return;
    const userId = contact.contact;
    const displayName = contact.contact_detail.display_name?.trim() || contact.contact_detail.username;
    setSendingTo(userId);
    try {
      const room = await getOrCreateDirect(userId);

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

        const failed = results.filter((result) => result.state === 'failed');
        const queued = results.filter((result) => result.state === 'queued');
        sentAnything = sentAnything || results.some((result) => result.state !== 'failed');
        if (failed.length > 0) {
          alert(
            failed.length === results.length ? 'Nothing was sent' : 'Some items were not sent',
            `${results.length - failed.length} of ${results.length} items were queued or sent. ${failed[0].error?.message || 'Please try the failed item again.'}`,
          );
        } else if (queued.length > 0) {
          alert('Transfer queued', 'Axonic will finish sending when the connection is available.');
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

      if (sentAnything) playSound('message_sent');

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

  const renderItem = ({ item }: { item: Contact }) => {
    const u = item.contact_detail;
    const primary = u.display_name?.trim() || u.username;
    const busy = sendingTo === item.contact;
    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: Colors.surface }]}
        onPress={() => handleSend(item)}
        disabled={sendingTo !== null}
        activeOpacity={0.7}
      >
        <Avatar name={primary} uri={u.avatar} size={44} showOnline isOnline={presenceByUserId[u.id]?.isOnline ?? false} />
        <View style={styles.info}>
          <Text style={[styles.name, { color: Colors.text }]} numberOfLines={1}>{primary}</Text>
          <Text style={[styles.sub, { color: Colors.textTertiary }]} numberOfLines={1}>
            @{u.username}
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
          placeholder="Search contacts"
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
          title="No contacts"
          subtitle={query ? 'No contacts match your search.' : 'Add contacts first to share with them.'}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl + insets.bottom }}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.xs }} />}
          keyboardShouldPersistTaps="handled"
        />
      )}
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
