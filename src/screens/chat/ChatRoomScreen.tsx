/* ------------------------------------------------------------------ */
/*  Chat Room Screen — modern purple theme with keyboard fix            */
/* ------------------------------------------------------------------ */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import dayjs from 'dayjs';
import { Font, Spacing, Radius } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useChat, WsMessage } from '../../hooks/useChat';
import { getRoomMessages } from '../../services/chatService';
import { initiateCall } from '../../services/callService';
import { playSound } from '../../services/soundService';
import { useNotificationContext } from '../../contexts/NotificationContext';
import type { Message, RootStackParamList } from '../../types';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;

export default function ChatRoomScreen({ route, navigation }: Props) {
  const { roomId, otherUserId } = route.params;
  const { user } = useAuth();
  const { messages: wsMessages, sendMessage, connected, markAsRead, readIds, markIdsAsRead, reconnectCount } = useChat(roomId, user?.id);
  const { subscribe } = useNotificationContext();
  const { colors: Colors } = useTheme();
  const [historicalMessages, setHistoricalMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Add call buttons to header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 16, marginRight: 4 }}>
          <TouchableOpacity onPress={() => handleCall('video')}>
            <Text style={{ fontSize: 20 }}>📹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleCall('voice')}>
            <Text style={{ fontSize: 20 }}>📞</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, otherUserId]);

  const handleCall = async (callType: 'voice' | 'video') => {
    if (!otherUserId) {
      Alert.alert('Info', 'Calls are only available in direct chats');
      return;
    }
    try {
      const res = await initiateCall(otherUserId, callType);
      navigation.navigate('ActiveCall', {
        callId: res.call_id,
        otherName: route.params.roomName,
        callType,
        roomName: res.room_name,
        isOutgoing: true,
        peerUserId: otherUserId,
      });
    } catch {
      Alert.alert('Error', 'Failed to start call');
    }
  };

  // Load message history (re-fetch on WS reconnect to catch missed messages)
  useEffect(() => {
    (async () => {
      try {
        const res = await getRoomMessages(roomId);
        setHistoricalMessages(res.results);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, [roomId, reconnectCount]);

  // Listen for read receipts from the notification channel (backup)
  useEffect(() => {
    const unsub = subscribe((payload) => {
      if (
        payload.event === 'messages_read' &&
        payload.room_id === roomId &&
        payload.message_ids
      ) {
        markIdsAsRead(payload.message_ids as string[]);
      }
    });
    return unsub;
  }, [subscribe, roomId, markIdsAsRead]);

  // Merge historical + live messages
  const msgs = useMemo(() => {
    const histIds = new Set(historicalMessages.map((m) => m.id));
    const liveConverted: Message[] = wsMessages
      .filter((m) => !histIds.has(m.id))
      .map((m) => ({
        id: m.id,
        room: roomId,
        sender: m.sender_id,
        sender_username: m.sender,
        content: m.content,
        message_type: m.message_type as any,
        file: null,
        is_read: m.is_read ?? false,
        created_at: m.created_at,
      }));
    const merged = [...historicalMessages, ...liveConverted]
      .map((msg) => ({
        ...msg,
        is_read: msg.is_read || readIds.has(msg.id),
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return merged;
  }, [historicalMessages, wsMessages, roomId, readIds]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (msgs.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
    }
  }, [msgs.length]);

  // Scroll when keyboard shows
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  // Play sound for incoming live messages
  const prevWsCount = useRef(wsMessages.length);
  useEffect(() => {
    if (wsMessages.length > prevWsCount.current) {
      const last = wsMessages[wsMessages.length - 1];
      if (last && last.sender_id !== user?.id) {
        playSound('message_received');
      }
    }
    prevWsCount.current = wsMessages.length;
  }, [wsMessages.length]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setText('');
    playSound('message_sent');
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.sender === user?.id;
    return (
      <View style={[styles.bubbleRow, isMine ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.bubble, isMine ? [styles.bubbleSent, { backgroundColor: Colors.bubbleSent }] : [styles.bubbleReceived, { backgroundColor: Colors.bubbleReceived }]]}>
          {!isMine && (
            <Text style={[styles.senderName, { color: Colors.primary }]}>{item.sender_username}</Text>
          )}
          <Text style={[styles.messageText, { color: Colors.text }]}>
            {item.content}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.timeText, { color: Colors.textTertiary }]}>
              {dayjs(item.created_at).format('HH:mm')}
            </Text>
            {isMine && (
              <Text style={[
                styles.checkMark,
                item.is_read ? [styles.checkRead, { color: Colors.checkBlue }] : [styles.checkSent, { color: Colors.textTertiary }],
              ]}>
                {item.is_read ? '✓✓' : '✓'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: Colors.chatBg }]}>
        <ActivityIndicator size="large" color={Colors.teal} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: Colors.chatBg }]}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
    >
      {/* Connection indicator */}
      {!connected && (
        <View style={[styles.connectionBar, { backgroundColor: Colors.primary }]}>
          <Text style={[styles.connectionText, { color: Colors.textInverse }]}>⏳ Connecting…</Text>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={msgs}
        extraData={readIds.size}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      {/* Input bar */}
      <View style={[styles.inputBar, { backgroundColor: Colors.chatBg }]}>
        <View style={[styles.inputRow, { backgroundColor: Colors.surface }]}>
          <TextInput
            style={[styles.textInput, { color: Colors.text }]}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={Colors.textTertiary}
            multiline
            maxLength={2000}
          />
        </View>
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: Colors.primary, shadowColor: Colors.primary }, !text.trim() && [styles.sendBtnDisabled, { backgroundColor: Colors.primaryLight }]]}
          onPress={handleSend}
          disabled={!text.trim()}
          activeOpacity={0.7}
        >
          <Text style={[styles.sendIcon, { color: Colors.textInverse }]}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  connectionBar: {
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  connectionText: { fontSize: Font.size.xs, ...Font.medium },

  messagesList: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },

  bubbleRow: { marginBottom: Spacing.xs + 2 },
  bubbleRowRight: { alignItems: 'flex-end' },
  bubbleRowLeft: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderRadius: Radius.lg,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  bubbleSent: {
    borderBottomRightRadius: Radius.sm,
  },
  bubbleReceived: {
    borderBottomLeftRadius: Radius.sm,
  },

  senderName: {
    fontSize: Font.size.xs,
    marginBottom: 2,
    ...Font.semiBold,
  },

  messageText: {
    fontSize: Font.size.md,
    lineHeight: 20,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    gap: 3,
  },
  timeText: { fontSize: 10 },
  checkMark: { fontSize: 10 },
  checkSent: {},
  checkRead: {},

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  inputRow: {
    flex: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  textInput: {
    fontSize: Font.size.md,
    maxHeight: 100,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { fontSize: 18 },
});
