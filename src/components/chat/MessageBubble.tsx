import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as IntentLauncher from 'expo-intent-launcher';
import { File } from 'expo-file-system';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { Font, Radius, Spacing, type ThemeColors } from '../../theme';
import type { Message } from '../../types';
import SmartMessageText from '../SmartMessageText';
import VoiceMessageBubble from '../VoiceMessageBubble';

// Give the automatic Axion delivery/reconnect path time to finish before a
// manual resend is offered. Pending remains visible via the clock meanwhile.
const MANUAL_RETRY_DELAY_MS = 10_000;

interface MessageBubbleProps {
  item: Message;
  isMine: boolean;
  isPending: boolean;
  retryStartedAt: number;
  isDelivered: boolean;
  isRead: boolean;
  isDirectChat: boolean;
  Colors: ThemeColors;
  currentUserId?: number;
  onReply: (item: Message) => void;
  onLongPress: (pageY: number, item: Message) => void;
  onRetry: (messageId: string) => void;
  onImagePress: (uri: string | null) => void;
  onReaction: (item: Message, emoji: string) => void;
}

function SharedFileBubble({
  type,
  fileUri,
  label,
  colors,
}: {
  type: 'video' | 'document';
  fileUri: string;
  label: string;
  colors: ThemeColors;
}) {
  const isVideo = type === 'video';
  return (
    <TouchableOpacity
      style={[styles.sharedFile, { backgroundColor: colors.surfaceVariant, borderColor: colors.neonBorder }]}
      onPress={() => openSharedFile(fileUri)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={isVideo ? 'Open shared video' : 'Open shared document'}
    >
      <View style={[styles.sharedFileIcon, { backgroundColor: colors.highlight }]}>
        <Ionicons name={isVideo ? 'videocam-outline' : 'document-text-outline'} size={24} color={colors.primary} />
      </View>
      <View style={styles.sharedFileInfo}>
        <Text style={[styles.sharedFileTitle, { color: colors.text }]} numberOfLines={2}>{label}</Text>
        <Text style={[styles.sharedFileHint, { color: colors.textSecondary }]}>
          {isVideo ? 'Tap to open video' : 'Tap to open document'}
        </Text>
      </View>
      <Ionicons name="open-outline" size={17} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

async function openSharedFile(fileUri: string): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      const file = new File(fileUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri,
        type: file.type || '*/*',
        // FLAG_GRANT_READ_URI_PERMISSION
        flags: 1,
      });
      return;
    }
    await Linking.openURL(fileUri);
  } catch {
    // The receiving device may not have an app registered for this format.
  }
}

function MessageBubbleBase({
  item,
  isMine,
  isPending,
  retryStartedAt,
  isDelivered,
  isRead,
  isDirectChat,
  Colors,
  currentUserId,
  onReply,
  onLongPress,
  onRetry,
  onImagePress,
  onReaction,
}: MessageBubbleProps) {
  const isDeliveredPersisted = isMine && item.status === 'delivered';
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (!isPending) {
      setCanRetry(false);
      return;
    }

    const createdAt = Date.parse(item.created_at);
    const firstAttemptAt = Number.isFinite(createdAt) ? createdAt : Date.now();
    const eligibleAt = Math.max(firstAttemptAt, retryStartedAt) + MANUAL_RETRY_DELAY_MS;
    const remainingMs = eligibleAt - Date.now();

    if (remainingMs <= 0) {
      setCanRetry(true);
      return;
    }

    setCanRetry(false);
    const timer = setTimeout(() => setCanRetry(true), remainingMs);
    return () => clearTimeout(timer);
  }, [isPending, item.created_at, retryStartedAt]);

  let statusIcon: string;
  let statusColor: string;
  if (isPending) {
    statusIcon = '⏱';
    statusColor = Colors.textTertiary;
  } else if (isRead) {
    statusIcon = '✓✓';
    statusColor = Colors.checkBlue;
  } else if (isDelivered || isDeliveredPersisted) {
    statusIcon = '✓';
    statusColor = Colors.textTertiary;
  } else {
    // Unknown local state defaults to pending to avoid false delivery ticks.
    statusIcon = '⏱';
    statusColor = Colors.textTertiary;
  }

  return (
    <Swipeable
      renderLeftActions={() => (
        <View style={styles.swipeReplyHint}>
          <Ionicons name="arrow-undo" size={22} color={Colors.primary} />
        </View>
      )}
      leftThreshold={40}
      friction={2}
      overshootLeft={false}
      enabled={!item.is_deleted}
      onSwipeableOpen={(direction, swipeable) => {
        if (direction === 'left') {
          onReply(item);
          swipeable.close();
        }
      }}
    >
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <TouchableOpacity
          onLongPress={(event) => {
            if (!item.is_deleted) onLongPress(event.nativeEvent.pageY, item);
          }}
          delayLongPress={350}
          activeOpacity={0.85}
        >
          <View style={[
            styles.bubbleWrap,
            item.reactions && Object.keys(item.reactions).length > 0 && !item.is_deleted && styles.bubbleWrapWithReactions,
          ]}>
            <View style={[
              styles.bubble,
              isMine
                ? [styles.bubbleSent, { backgroundColor: Colors.bubbleSent, borderColor: Colors.neonBorder }]
                : [styles.bubbleReceived, { backgroundColor: Colors.bubbleReceived, borderColor: Colors.divider }],
            ]}>
              {!isMine && !isDirectChat && (
                <Text style={[styles.senderName, { color: Colors.primary }]}>{item.sender_username}</Text>
              )}
              {item.reply_to && !item.is_deleted && (
                <View style={[styles.quoteBlock, {
                  borderLeftColor: Colors.primary,
                  backgroundColor: Colors.surfaceVariant,
                }]}>
                  <Text style={[styles.quoteName, { color: Colors.primary }]} numberOfLines={1}>
                    {item.reply_to.sender_name || 'Unknown'}
                  </Text>
                  <Text style={[styles.quoteText, { color: Colors.textSecondary }]} numberOfLines={2}>
                    {item.reply_to.content
                      || (item.reply_to.type && item.reply_to.type !== 'text'
                        ? `[${item.reply_to.type}]`
                        : '')}
                  </Text>
                </View>
              )}
              {item.is_deleted ? (
                <Text style={[styles.deletedText, { color: Colors.textTertiary }]}>🚫 This message was deleted.</Text>
              ) : item.message_type === 'voice' ? (
                <VoiceMessageBubble
                  fileUri={item.file_uri ?? item.file ?? null}
                  durationMs={item.duration_ms ?? null}
                  loading={!(item.file_uri || item.file)}
                  tint={Colors.primary}
                  subtleColor={Colors.textSecondary}
                  trackBg={Colors.surfaceVariant}
                />
              ) : item.message_type === 'image' && (item.file_uri || item.file) ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onImagePress(item.file_uri ?? item.file ?? null)}
                  onLongPress={(event) => {
                    if (!item.is_deleted) onLongPress(event.nativeEvent.pageY, item);
                  }}
                  delayLongPress={350}
                >
                  <ExpoImage
                    source={{ uri: item.file_uri ?? item.file ?? '' }}
                    style={styles.imageBubble}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={100}
                    recyclingKey={item.id}
                  />
                  {item.uploading && (
                    <View style={styles.mediaOverlay}>
                      <ActivityIndicator color="#fff" />
                      <Text style={styles.mediaOverlayText}>Uploading…</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : item.message_type === 'image' ? (
                <View style={[styles.imageBubble, styles.mediaPlaceholder, { backgroundColor: Colors.surfaceVariant }]}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={[styles.mediaPlaceholderText, { color: Colors.textSecondary }]}>Receiving…</Text>
                </View>
              ) : (item.message_type === 'video' || item.message_type === 'document') && (item.file_uri || item.file) ? (
                <SharedFileBubble
                  type={item.message_type}
                  fileUri={item.file_uri ?? item.file ?? ''}
                  label={item.content || (item.message_type === 'video' ? 'Video' : 'Document')}
                  colors={Colors}
                />
              ) : item.message_type === 'video' || item.message_type === 'document' ? (
                <View style={[styles.sharedFile, { backgroundColor: Colors.surfaceVariant, borderColor: Colors.neonBorder }]}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={[styles.sharedFileHint, { color: Colors.textSecondary, marginLeft: Spacing.sm }]}>
                    Receiving {item.message_type}…
                  </Text>
                </View>
              ) : (
                <SmartMessageText style={[styles.messageText, { color: Colors.text }]} linkColor={Colors.primary}>
                  {item.content}
                </SmartMessageText>
              )}
              {isMine && item.transfer_error_message ? (
                <Text style={[styles.transferError, { color: Colors.error }]} numberOfLines={2}>
                  Not sent · {item.transfer_error_message}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                <Text style={[styles.timeText, { color: Colors.textTertiary }]}>
                  {dayjs(item.created_at).format('HH:mm')}
                </Text>
                {isMine && !item.is_deleted && (
                  <>
                    {isPending && canRetry && (
                      <TouchableOpacity
                        onPress={() => onRetry(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Resend pending message"
                      >
                        <Ionicons name="refresh" size={14} color={Colors.primary} />
                      </TouchableOpacity>
                    )}
                    <Text style={[styles.statusIcon, { color: statusColor }]}>{statusIcon}</Text>
                  </>
                )}
              </View>
            </View>
            {!item.is_deleted && item.reactions && Object.keys(item.reactions).length > 0 && (
              <View style={[styles.reactionsOverlay, styles.reactionsOverlayLeft]}>
                {Object.entries(item.reactions).map(([emoji, users]) => {
                  const mine = users.includes(String(currentUserId));
                  return (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() => onReaction(item, emoji)}
                      style={[styles.reactionBadge, {
                        backgroundColor: mine ? Colors.neonGlow : Colors.surface,
                        borderColor: mine ? Colors.primary : Colors.neonBorder,
                        shadowColor: Colors.primary,
                      }]}
                    >
                      <Text style={styles.reactionEmojiInBadge}>{emoji}</Text>
                      <Text style={[styles.reactionBadgeText, { color: mine ? Colors.primary : Colors.text }]}>
                        {users.length}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </Swipeable>
  );
}

function areBubblePropsEqual(previous: MessageBubbleProps, next: MessageBubbleProps): boolean {
  if (
    previous.isMine !== next.isMine
    || previous.isPending !== next.isPending
    || previous.retryStartedAt !== next.retryStartedAt
    || previous.isDelivered !== next.isDelivered
    || previous.isRead !== next.isRead
    || previous.isDirectChat !== next.isDirectChat
    || previous.Colors !== next.Colors
    || previous.currentUserId !== next.currentUserId
    || previous.onReply !== next.onReply
    || previous.onLongPress !== next.onLongPress
    || previous.onRetry !== next.onRetry
    || previous.onImagePress !== next.onImagePress
    || previous.onReaction !== next.onReaction
  ) {
    return false;
  }

  const a = previous.item;
  const b = next.item;
  return (
    a.id === b.id
    && a.content === b.content
    && a.message_type === b.message_type
    && a.file === b.file
    && a.file_uri === b.file_uri
    && a.duration_ms === b.duration_ms
    && a.uploading === b.uploading
    && a.is_read === b.is_read
    && a.is_deleted === b.is_deleted
    && a.status === b.status
    && a.transfer_error_code === b.transfer_error_code
    && a.transfer_error_message === b.transfer_error_message
    && a.sync === b.sync
    && a.sender === b.sender
    && a.sender_username === b.sender_username
    && a.created_at === b.created_at
    && JSON.stringify(a.reactions) === JSON.stringify(b.reactions)
    && JSON.stringify(a.reply_to) === JSON.stringify(b.reply_to)
  );
}

const MessageBubble = React.memo(MessageBubbleBase, areBubblePropsEqual);

export default MessageBubble;

const styles = StyleSheet.create({
  bubbleRow: { marginBottom: Spacing.md },
  bubbleRowRight: { alignItems: 'flex-end' },
  bubbleRowLeft: { alignItems: 'flex-start' },
  bubble: {
    minWidth: 96,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderRadius: Radius.lg,
    borderWidth: 1,
    elevation: 2,
  },
  bubbleSent: { borderBottomRightRadius: Radius.xs ?? 4 },
  bubbleReceived: { borderBottomLeftRadius: Radius.xs ?? 4 },
  senderName: {
    fontSize: Font.size.xs,
    marginBottom: 2,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  messageText: { fontSize: Font.size.md, lineHeight: 22, letterSpacing: 0.2 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
    gap: 4,
  },
  timeText: { fontSize: 10, letterSpacing: 0.3 },
  statusIcon: { fontSize: 10 },
  transferError: { fontSize: 11, lineHeight: 15, marginTop: 5, fontWeight: '600' },
  imageBubble: {
    width: 220,
    height: 220,
    borderRadius: Radius.sm,
    backgroundColor: '#0002',
  },
  sharedFile: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 220,
    maxWidth: 280,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  sharedFileIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  sharedFileInfo: { flex: 1, minWidth: 0, paddingRight: Spacing.xs },
  sharedFileTitle: { fontSize: Font.size.sm, fontWeight: '700' },
  sharedFileHint: { fontSize: Font.size.xs, marginTop: 3 },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  mediaPlaceholderText: { fontSize: Font.size.sm, letterSpacing: 0.3 },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: Radius.sm,
  },
  mediaOverlayText: { color: '#fff', fontSize: Font.size.sm, letterSpacing: 0.3 },
  deletedText: { fontSize: Font.size.sm, fontStyle: 'italic', lineHeight: 20 },
  bubbleWrap: { maxWidth: '80%' },
  bubbleWrapWithReactions: { paddingBottom: 12 },
  reactionsOverlay: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  reactionsOverlayLeft: { left: 8 },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  reactionBadgeText: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginLeft: 3 },
  reactionEmojiInBadge: { fontSize: 13, lineHeight: 18 },
  swipeReplyHint: {
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: Spacing.sm,
  },
  quoteBlock: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.sm,
    paddingVertical: 4,
    paddingRight: Spacing.sm,
    marginBottom: 6,
    borderRadius: 4,
  },
  quoteName: { fontSize: Font.size.xs, fontWeight: '700', letterSpacing: 0.3 },
  quoteText: { fontSize: Font.size.xs, marginTop: 1 },
});
