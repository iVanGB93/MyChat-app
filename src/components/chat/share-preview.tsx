import React, { useState } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { openSharedMedia } from '../../services/open-shared-media';
import FullscreenImageViewer from './fullscreen-image-viewer';

export interface PreviewItem { id: string; uri: string; name: string; kind: 'image' | 'video' | 'file' }

export default function SharePreview({ items, visible, busy, destination, onRemove, onClose, onSend }: {
  items: PreviewItem[]; visible: boolean; busy: boolean; destination?: string;
  onRemove: (id: string) => void; onClose: () => void; onSend: () => void;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState<string | null>(null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}>
          <TouchableOpacity onPress={onClose} disabled={busy} accessibilityLabel="Cancel sharing"><Ionicons name="close" size={28} color={c.text} /></TouchableOpacity>
          <Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '700' }}>Review before sending</Text>
        </View>
        <Text style={{ color: c.textSecondary, paddingHorizontal: 16 }}>{destination ? `To ${destination} · ` : ''}{items.length} selected</Text>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {items.map((item) => (
            <View key={item.id} style={{ backgroundColor: c.surface, borderRadius: 16, padding: 12, gap: 10 }}>
              <TouchableOpacity accessibilityLabel={`Preview ${item.name}`} onPress={() => {
                if (item.kind === 'image') setImageUri(item.uri);
                else void openSharedMedia(item.uri, item.kind).catch(() => Alert.alert('Preview unavailable', 'A compatible viewer is needed to preview this file.'));
              }}>
                {item.kind === 'image'
                  ? <Image source={{ uri: item.uri }} style={{ width: '100%', height: 260 }} contentFit="contain" />
                  : <View style={{ height: 110, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Ionicons name={item.kind === 'video' ? 'play-circle-outline' : 'document-text-outline'} size={52} color={c.primary} /><Text style={{ color: c.textSecondary }}>Tap to preview</Text></View>}
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text numberOfLines={2} style={{ flex: 1, color: c.text }}>{item.name}</Text>
                <TouchableOpacity disabled={busy} onPress={() => onRemove(item.id)} accessibilityLabel={`Remove ${item.name}`}><Ionicons name="trash-outline" size={22} color={c.error} /></TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity disabled={busy || !items.length} onPress={onSend} style={{ margin: 16, padding: 16, borderRadius: 14, alignItems: 'center', backgroundColor: c.primary, opacity: items.length ? 1 : 0.4 }}>
          {busy ? <ActivityIndicator color={c.textInverse} /> : <Text style={{ color: c.textInverse, fontWeight: '700' }}>Send {items.length} {items.length === 1 ? 'item' : 'items'}</Text>}
        </TouchableOpacity>
      </View>
      <FullscreenImageViewer uri={imageUri} accentColor={c.primary} onClose={() => setImageUri(null)} />
    </Modal>
  );
}
