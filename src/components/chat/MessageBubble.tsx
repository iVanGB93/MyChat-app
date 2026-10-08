import {messageBubbleStyles as styles} from './message-bubble-styles';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { openSharedMedia } from '../../services/open-shared-media';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { Font, Radius, Spacing, type ThemeColors } from '../../theme';
import type { Message } from '../../types';
import SmartMessageText from '../SmartMessageText';
import VoiceMessageBubble from '../VoiceMessageBubble';
import { useContactName } from '../../hooks/useContactName';
import { getMessagesByIds } from '../../services/localMessageStore';
import { parseSticker } from '../../services/stickers';
import StickerArt from './sticker-art';
import ReplyContent from './reply-content';
import { IMPORTED_STICKER_CONTENT } from '../../services/sticker-file-format';

function ReplySenderName({ messageId, fallback }: { messageId: string; fallback: string }) {
  const contactName = useContactName();
  const [senderId, setSenderId] = useState<number | undefined>();
  useEffect(() => {
    let active = true;
    setSenderId(undefined);
    void getMessagesByIds([messageId]).then((rows) => { if (active) setSenderId(rows[0]?.sender_id); }).catch(() => {});
    return () => { active = false; };
  }, [messageId]);
  return <>{contactName(senderId, fallback)}</>;
}

// Give the automatic Axion delivery/reconnect path time to finish before a
// manual resend is offered. Pending remains visible via the clock meanwhile.
const MANUAL_RETRY_DELAY_MS = 10_000;

interface MessageBubbleProps {
  item: Message;
  isMine: boolean;
  isPending: boolean;
  isSending: boolean;
  retryStartedAt: number;
  isDelivered: boolean;
  isRead: boolean;
  isDirectChat: boolean;
  Colors: ThemeColors;
  currentUserId?: number;
  onReply: (item: Message) => void;
  onLongPress: (pageY: number, item: Message) => void;
  onRetry: (messageId: string) => void;
  onImagePress: (item: Message) => void;
  onReaction: (item: Message, emoji: string) => void;
}

/** A restrained pendulum motion: visible activity without a distracting spin. */
function PendingClock({ active, color }: { active: boolean; color: string }) {
  const motion = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      motion.stopAnimation();
      motion.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: 220, useNativeDriver: true, isInteraction: false }),
      Animated.timing(motion, { toValue: -1, duration: 220, useNativeDriver: true, isInteraction: false }),
      Animated.timing(motion, { toValue: 0, duration: 180, useNativeDriver: true, isInteraction: false }),
      Animated.delay(180),
    ]));
    animation.start();
    return () => {
      animation.stop();
      motion.setValue(0);
    };
  }, [active, motion]);

  return (
    <Animated.View
      accessibilityLabel={active ? 'Sending message' : 'Message pending'}
      style={{
        transform: [
          { rotate: motion.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '20deg'] }) },
          { translateY: motion.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 0, -0.7] }) },
        ],
      }}
    >
      <Ionicons name="time-outline" size={13} color={color} />
    </Animated.View>
  );
}

function SharedFileBubble({
  type,
  fileUri,
  messageId,
  label,
  colors,
}: {
  type: 'video' | 'document';
  fileUri: string;
  messageId: string;
  label: string;
  colors: ThemeColors;
}) {
  const isVideo = type === 'video';
  return (
    <TouchableOpacity
      style={[styles.sharedFile, { backgroundColor: colors.surfaceVariant, borderColor: colors.neonBorder }]}
      onPress={() => openSharedMedia(fileUri, type, messageId).catch((error) => {
        Alert.alert('Cannot open file', error?.message?.includes('no longer available')
          ? error.message : 'Axonic could not open this file. Make sure a compatible viewer is installed.');
      })}
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

function MessageBubbleBase({
  item,
  isMine,
  isPending,
  isSending,
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
  const contactName = useContactName();
  const isDeliveredPersisted = isMine && item.status === 'delivered';
  const sticker = !item.is_deleted && item.message_type === 'text' ? parseSticker(item.content || '') : undefined;
  const importedSticker = !item.is_deleted && item.message_type === 'image' && item.content === IMPORTED_STICKER_CONTENT;
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
          style={styles.bubbleTouchTarget}
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
              (sticker || importedSticker) && styles.stickerBubble,
            ]}>
              {!isMine && !isDirectChat && (
                <Text style={[styles.senderName, { color: Colors.primary }]}>{contactName(item.sender, item.sender_username)}</Text>
              )}
              {item.reply_to && !item.is_deleted && (
                <View style={[styles.quoteBlock, {
                  borderLeftColor: Colors.primary,
                  backgroundColor: Colors.surfaceVariant,
                }]}>
                  <Text style={[styles.quoteName, { color: Colors.primary }]} numberOfLines={1}>
                    <ReplySenderName messageId={item.reply_to.id} fallback={item.reply_to.sender_name || 'Unknown'} />
                  </Text>
                  <ReplyContent id={item.reply_to.id} content={item.reply_to.content} type={item.reply_to.type}
                    style={[styles.quoteText, { color: Colors.textSecondary }]} />
                </View>
              )}
              {item.is_deleted ? (
                <Text style={[styles.deletedText, { color: Colors.textTertiary }]}>🚫 This message was deleted.</Text>
              ) : sticker ? (
                <TouchableOpacity accessibilityLabel={`Preview ${sticker.label} sticker`} onPress={() => onImagePress(item)} onLongPress={(event) => onLongPress(event.nativeEvent.pageY, item)} delayLongPress={350}>
                  <StickerArt sticker={sticker} animate loop size={104} />
                </TouchableOpacity>
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
                  onPress={() => onImagePress(item)}
                  onLongPress={(event) => {
                    if (!item.is_deleted) onLongPress(event.nativeEvent.pageY, item);
                  }}
                  delayLongPress={350}
                >
                  <ExpoImage
                    source={{ uri: item.file_uri ?? item.file ?? '' }}
                    style={importedSticker ? { width: 108, height: 108 } : styles.imageBubble}
                    contentFit={importedSticker ? 'contain' : 'cover'}
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
                  messageId={item.id}
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
              {!item.is_deleted && item.message_type === 'image' && !importedSticker && !!item.content?.trim()
                && item.content !== '📷 Photo' && (
                  <SmartMessageText style={[styles.messageText, { color: Colors.text, marginTop: 6 }]} linkColor={Colors.primary}>
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
                    {isPending && canRetry && !isSending && (
                      <TouchableOpacity
                        onPress={() => onRetry(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel="Resend pending message"
                      >
                        <Ionicons name="refresh" size={14} color={Colors.primary} />
                      </TouchableOpacity>
                    )}
                    {isPending
                      ? <PendingClock active={isSending} color={statusColor} />
                      : <Text style={[styles.statusIcon, { color: statusColor }]}>{statusIcon}</Text>}
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
    || previous.isSending !== next.isSending
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
