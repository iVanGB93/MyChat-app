import React, { useCallback, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppStore } from '../../store/appStore';
import { useContactName } from '../../hooks/useContactName';
import { getCachedContacts, getCachedRooms, getMessagesByIds, getMessageExpectedRecipients, getMessageReceipts, type LocalMessage } from '../../services/localMessageStore';
import { messageInfoRecipients } from '../../services/message-info';
import { chatPreviewText } from '../../utils/chat-preview-text';
import type { RootStackParamList } from '../../types';

const dateLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
export default function MessageInfoScreen({ route }: NativeStackScreenProps<RootStackParamList, 'MessageInfo'>) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const ownerId = useAppStore((s) => s.user?.id);
  const contactName = useContactName();
  const [message, setMessage] = useState<LocalMessage | null>(null);
  const [people, setPeople] = useState<ReturnType<typeof messageInfoRecipients>>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [knownAudience, setKnownAudience] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true, running = false;
    const refresh = async () => {
      if (running || !ownerId || AppState.currentState !== 'active') return;
      running = true;
      try {
        const [messages, expected, receipts, rooms, contacts] = await Promise.all([
          getMessagesByIds([route.params.messageId]), getMessageExpectedRecipients(route.params.messageId),
          getMessageReceipts(route.params.messageId), getCachedRooms(ownerId), getCachedContacts(ownerId),
        ]);
        if (!active) return;
        const row = messages.find((m) => m.room_id === route.params.roomId);
        setMessage(row ?? null);
        setPeople(row?.is_mine ? messageInfoRecipients(expected, receipts) : []);
        setKnownAudience(expected !== null);
        const labels: Record<number, string> = {};
        for (const contact of contacts) labels[contact.contact] = contact.contact_detail.display_name || contact.contact_detail.username;
        for (const member of rooms.find((r) => r.id === route.params.roomId)?.members_detail ?? []) labels[member.id] = member.display_name || member.username;
        setNames(labels); setError(row ? '' : 'This message is no longer stored on this phone.');
      } catch { if (active) setError('Could not read message details. We’ll retry automatically.'); }
      finally { running = false; if (active) setLoading(false); }
    };
    void refresh();
    // SQLite only: no server requests; stop while backgrounded or off-screen.
    const timer = setInterval(() => { void refresh(); }, 2000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { active = false; clearInterval(timer); listener.remove(); };
  }, [ownerId, route.params.messageId, route.params.roomId]));
  const detail = (label: string, value: string) => <View key={label} style={{ gap: 4 }}><Text style={{ color: c.textSecondary }}>{label}</Text><Text selectable style={{ color: c.text }}>{value}</Text></View>;
  return <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24, gap: 20 }}>
    {loading && <ActivityIndicator color={c.primary} />}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.error }}>{error}</Text>}
    {message && <>
      <View style={{ padding: 16, borderRadius: 18, backgroundColor: c.surface, gap: 14 }}>
        <Text selectable style={{ color: c.text, fontSize: 17 }}>{message.is_deleted ? 'This message was deleted.' : chatPreviewText(message.content || '') || message.type}</Text>
        {detail('From', message.is_mine ? 'You' : contactName(message.sender_id, message.sender_name))}
        {detail('Created', dateLabel(message.created_at))}
        {detail('Type', message.type)}
        {!!message.duration_ms && detail('Duration', `${Math.round(message.duration_ms / 1000)} seconds`)}
        {!!message.transfer_error_message && detail('Transfer problem', message.transfer_error_message)}
      </View>
      {message.is_mine ? <>
        {!knownAudience && <Text style={{ color: c.textSecondary }}>The original recipient list is unavailable. Only recorded receipts are shown; missing users cannot be classified.</Text>}
        {['Read', 'Delivered', 'Pending'].map((status) => {
          const rows = people.filter((p) => p.status === status);
          return <View key={status} style={{ gap: 10 }}>
            <Text style={{ color: c.primary, fontSize: 18, fontWeight: '700' }}>{status} · {rows.length}</Text>
            {rows.map((person) => <View key={person.id} style={{ backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 6 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{contactName(person.id, names[person.id] || `User #${person.id}`)}</Text>
              {person.status === 'Pending' ? <Text style={{ color: c.textSecondary }}>Waiting for delivery confirmation</Text> : <>
                <Text style={{ color: c.textSecondary }}>Delivered: {dateLabel(person.deliveredAt)}</Text>
                {person.status === 'Read' && <Text style={{ color: c.textSecondary }}>Read: {dateLabel(person.readAt)}</Text>}
              </>}
            </View>)}
          </View>;
        })}
        <Text style={{ color: c.textSecondary }}>Delivered means received but not yet confirmed read. Times reflect receipts recorded on this phone. Pending does not necessarily mean offline.</Text>
      </> : <Text style={{ color: c.textSecondary }}>Delivery and read receipts for other participants are stored on the sender’s device, not this phone.</Text>}
      {detail('Message ID', message.id)}
    </>}
  </ScrollView>;
}
