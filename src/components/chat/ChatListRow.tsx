import React from 'react';
import {View,Text,TouchableOpacity} from 'react-native';
import {Swipeable} from 'react-native-gesture-handler';
import {Ionicons} from '@expo/vector-icons';
import type {ThemeColors} from '../../theme';
import Avatar from '../ui/Avatar';
import {chatPreviewText} from '../../utils/chat-preview-text';
import {chatListStyles as styles} from './chat-list-styles';
interface ChatListRowProps {
  roomId: string;
  displayName: string;
  avatarUri: string | null;
  isDirect: boolean;
  isOnline: boolean;
  otherUserId?: number;
  lastMsgContent: string | null;
  lastMsgTime: string | null;
  lastMsgFromMe: boolean;
  lastMsgStatus?: 'pending' | 'delivered' | 'read';
  unread: number;
  typingLabel: string | null;
  isMuted: boolean;
  selectionMode: boolean;
  selected: boolean;
  Colors: ThemeColors;
  onOpen: (roomId: string, displayName: string, otherUserId?: number) => void;
  onLongPress: (roomId: string) => void;
  onToggleSelection: (roomId: string) => void;
  onAvatarPress: (roomId: string) => void;
  onMarkRead: (roomId: string) => void;
}

function ChatListRowBase({
  roomId,
  displayName,
  avatarUri,
  isDirect,
  isOnline,
  otherUserId,
  lastMsgContent,
  lastMsgTime,
  lastMsgFromMe,
  lastMsgStatus,
  unread,
  typingLabel,
  isMuted,
  selectionMode,
  selected,
  Colors,
  onOpen,
  onLongPress,
  onToggleSelection,
  onAvatarPress,
  onMarkRead,
}: ChatListRowProps) {
  const renderRightActions = () => (
    <TouchableOpacity
      style={[styles.swipeAction, { backgroundColor: Colors.primary }]}
      activeOpacity={0.8}
      onPress={() => onMarkRead(roomId)}
    >
      <Ionicons name="checkmark-done" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Mark read</Text>
    </TouchableOpacity>
  );

  const row = (
    <TouchableOpacity
      testID={`chat-row-${roomId}`}
      accessibilityLabel={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${displayName}` : `Open chat with ${displayName}`}
      accessibilityState={{ selected }}
      style={[
        styles.chatItem,
        {
          borderColor: selected ? Colors.primary : Colors.neonBorder,
          backgroundColor: selected ? Colors.highlight : Colors.background,
        },
      ]}
      activeOpacity={0.7}
      onLongPress={() => onLongPress(roomId)}
      delayLongPress={350}
      onPress={() => {
        if (selectionMode) onToggleSelection(roomId);
        else onOpen(roomId, displayName, otherUserId);
      }}
    >
      {/* Left accent bar */}
      <View style={[styles.accentBar, { backgroundColor: Colors.primary }]} />

      {selectionMode && (
        <View
          style={[
            styles.selectionCircle,
            {
              borderColor: selected ? Colors.primary : Colors.textTertiary,
              backgroundColor: selected ? Colors.primary : 'transparent',
            },
          ]}
        >
          {selected && <Ionicons name="checkmark" size={15} color={Colors.background} />}
        </View>
      )}

      <TouchableOpacity
        testID={`chat-avatar-${roomId}`}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Preview ${displayName}`}
        style={styles.avatarWrapper}
        activeOpacity={0.72}
        disabled={selectionMode}
        onPress={(event) => {
          event.stopPropagation();
          onAvatarPress(roomId);
        }}
      >
        <Avatar
          name={displayName}
          uri={avatarUri}
          size={50}
          showOnline={isDirect}
          isOnline={isOnline}
        />
      </TouchableOpacity>

      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={[styles.chatName, { color: Colors.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            {isMuted && (
              <Ionicons
                name="notifications-off"
                size={14}
                color={Colors.textTertiary}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          {lastMsgTime && (
            <Text style={[styles.chatTime, { color: Colors.primary }]}>
              {lastMsgTime}
            </Text>
          )}
        </View>
        <View style={styles.chatBottomRow}>
          <Text
            style={[
              styles.lastMessage,
              typingLabel
                ? { color: Colors.primary, fontStyle: 'italic' }
                : { color: unread > 0 ? Colors.text : Colors.textSecondary, fontWeight: unread > 0 ? '600' : '400' },
            ]}
            numberOfLines={1}
          >
            {typingLabel
              ? typingLabel
              : lastMsgContent != null
                ? (
                  <>
                    {lastMsgFromMe && (
                      <Text
                        style={{
                          color: lastMsgStatus === 'read'
                            ? Colors.checkBlue
                            : Colors.textTertiary,
                        }}
                      >
                        {lastMsgStatus === 'pending'
                          ? '⏱ '
                          : lastMsgStatus === 'read'
                            ? '✓✓ '
                            : '✓ '}
                      </Text>
                    )}
                    {chatPreviewText(lastMsgContent)}
                  </>
                )
                : '— no messages yet —'}
          </Text>
          {unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: isMuted ? Colors.textTertiary : Colors.primary }]}>
              <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (unread > 0 && !selectionMode) {
    return (
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight={false}
        onSwipeableOpen={(direction, swipeable) => {
          if (direction === 'right') {
            onMarkRead(roomId);
            swipeable.close();
          }
        }}
      >
        {row}
      </Swipeable>
    );
  }
  return row;
}

export default React.memo(ChatListRowBase);


