import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { loadStickerPreferences, STICKERS, updateStickerPreferences, type Sticker, type StickerPreferences } from '../../services/stickers';
import StickerArt from './sticker-art';
import StickerStudio from './sticker-studio';
import type { ImportedSticker } from '../../services/imported-stickers';
import { loadImportedStickers, importedStickerUri, markImportedStickerSent, removeImportedSticker } from '../../services/imported-stickers';
import { Image } from 'expo-image';
import { stickerGridCellWidth } from '../../utils/sticker-grid';

export default function StickerPicker({ ownerId, onClose, onSend, onSendImported, initialUri }: {
  initialUri?: string;
  ownerId: number; onClose: () => void; onSend: (sticker: Sticker) => Promise<void>;
  onSendImported: (sticker: ImportedSticker) => Promise<void>;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cellWidth = stickerGridCellWidth(width);
  const [tab, setTab] = useState(initialUri ? 'Create' : 'All');
  const tabChosen = useRef(!!initialUri);
  const [prefs, setPrefs] = useState<StickerPreferences>({ recent: [], favorites: [] });
  const [selected, setSelected] = useState<Sticker>();
  const [customStickers, setCustomStickers] = useState<ImportedSticker[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<ImportedSticker>();
  useEffect(() => { let active = true; loadImportedStickers(ownerId).then((rows) => { if (active) setCustomStickers(rows); }).catch(() => Alert.alert('Storage unavailable', 'Your stickers could not be loaded.')); return () => { active = false; }; }, [ownerId, tab]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([loadStickerPreferences(ownerId), loadImportedStickers(ownerId)]).then(([p, rows]) => {
      if (!active) return;
      setPrefs(p);
      setCustomStickers(rows);
      if (!tabChosen.current) {
        tabChosen.current = true;
        setTab(p.recent.length > 0 || rows.some((s) => Number.isFinite(s.lastSentAt) && s.lastSentAt! > 0) ? 'Recent' : 'All');
      }
    }).catch(() => Alert.alert('Storage unavailable', 'Recent stickers and favorites could not be loaded.'));
    return () => { active = false; };
  }, [ownerId]);
  const ids = tab === 'Recent' ? prefs.recent : prefs.favorites;
  const stickers = tab === 'All' || tab === 'Axonic' ? [...STICKERS] : ids.flatMap((id) => STICKERS.filter((s) => s.id === id));
  const customVisible = tab === 'All' ? customStickers : tab === 'Favorites' ? customStickers.filter((s) => s.favorite) : tab === 'Recent' ? customStickers.filter((s) => Number.isFinite(s.lastSentAt) && s.lastSentAt! > 0).sort((a, b) => b.lastSentAt! - a.lastSentAt!).slice(0, 24) : [];
  return <Modal visible animationType="slide" onRequestClose={() => { if (!sending.current) onClose(); }}>
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>Stickers</Text>
        <TouchableOpacity disabled={busy} onPress={onClose} accessibilityLabel="Close stickers" style={{ padding: 12 }}><Text style={{ color: c.primary }}>Close</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8 }}>
        {['All', 'Axonic', 'Recent', 'Favorites', 'Create'].map((name) => <TouchableOpacity disabled={busy} key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => { tabChosen.current = true; setSelected(undefined); setSelectedCustom(undefined); setTab(name); }} style={{ padding: 12, borderRadius: 20, backgroundColor: tab === name ? c.primary : c.surface }}><Text style={{ color: tab === name ? c.textInverse : c.text }}>{name}</Text></TouchableOpacity>)}
      </View>
      {tab === 'Create' ? <StickerStudio ownerId={ownerId} initialUri={initialUri} onBusy={(value) => { sending.current = value; setBusy(value); }} onSaved={() => setTab('All')} /> : <>
      <ScrollView contentContainerStyle={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {!stickers.length && !customVisible.length && <Text style={{ color: c.textSecondary }}>{tab === 'Recent' ? 'Your sent stickers will appear here.' : 'Choose a sticker and tap Add to favorites.'}</Text>}
        {customVisible.map((sticker) => <TouchableOpacity key={sticker.id} accessibilityLabel={`Preview ${sticker.name}`} onPress={() => { setSelected(undefined); setSelectedCustom(sticker); }} style={{ width: cellWidth, alignItems: 'center', paddingVertical: 4 }}><Image source={{ uri: importedStickerUri(ownerId, sticker) }} contentFit="contain" style={{ width: Math.min(110, cellWidth), height: Math.min(110, cellWidth) }} /></TouchableOpacity>)}
        {stickers.map((sticker) => <TouchableOpacity key={sticker.id} accessibilityLabel={`Preview ${sticker.label} sticker`} accessibilityState={{ selected: selected?.id === sticker.id }} onPress={() => { setSelectedCustom(undefined); setSelected(sticker); }} style={{ width: cellWidth, alignItems: 'center', paddingVertical: 4 }}>
          <StickerArt sticker={sticker} size={Math.min(110, cellWidth)} animate loop />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selected?.id === sticker.id ? c.primary : 'transparent' }} />
        </TouchableOpacity>)}
      </ScrollView>
      {selectedCustom && <View style={{ alignItems: 'center', padding: 12, gap: 8 }}>
        <Image source={{ uri: importedStickerUri(ownerId, selectedCustom) }} style={{ width: 140, height: 140 }} contentFit="contain" />
        <TouchableOpacity disabled={busy} accessibilityLabel="Send sticker" style={{ padding: 16, backgroundColor: c.primary, borderRadius: 14, alignSelf: 'stretch', alignItems: 'center' }} onPress={async () => {
          if (sending.current) return;
          sending.current = true; setBusy(true);
          try {
            await onSendImported(selectedCustom);
            try { await markImportedStickerSent(ownerId, selectedCustom.id); }
            catch { Alert.alert('Sticker queued', 'Could not save it to Recent on this phone.'); }
            onClose();
          }
          catch { Alert.alert('Could not send sticker', 'Please try again.'); }
          finally { sending.current = false; setBusy(false); }
        }}><Text style={{ color: c.textInverse }}>{busy ? 'Sending…' : 'Send sticker'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} style={{ padding: 12 }} onPress={() => Alert.alert('Remove sticker?', 'Copies already sent in chats will remain.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void removeImportedSticker(ownerId, selectedCustom).then((rows) => { setCustomStickers(rows); setSelectedCustom(undefined); }).catch(() => Alert.alert('Could not remove sticker', 'Please try again.')); } }])}><Text style={{ color: c.error }}>Remove from collection</Text></TouchableOpacity>
      </View>}
      {selected && <View style={{ alignItems: 'center', padding: 12, gap: 8 }}>
        <StickerArt sticker={selected} size={140} animate loop />
        <TouchableOpacity disabled={busy} style={{ padding: 12 }} onPress={() => { void updateStickerPreferences(ownerId, selected.id, 'favorite').then(setPrefs).catch(() => Alert.alert('Could not save favorite', 'Please try again.')); }}><Text style={{ color: c.primary }}>{prefs.favorites.includes(selected.id) ? '★ Remove from favorites' : '☆ Add to favorites'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} accessibilityLabel="Send sticker" style={{ backgroundColor: c.primary, padding: 16, borderRadius: 14, alignSelf: 'stretch', alignItems: 'center' }} onPress={async () => {
          if (sending.current) return;
          sending.current = true; setBusy(true);
          try { await onSend(selected); }
          catch { Alert.alert('Could not send sticker', 'The sticker was not queued. Please try again.'); sending.current = false; setBusy(false); return; }
          // A preference write failure must never invite resending an already queued message.
          try { await updateStickerPreferences(ownerId, selected.id, 'recent'); }
          catch { Alert.alert('Sticker queued', 'Could not save it to Recent on this phone.'); }
          onClose();
        }}>{busy ? <ActivityIndicator color={c.textInverse} /> : <Text style={{ color: c.textInverse, fontWeight: '700' }}>Send sticker</Text>}</TouchableOpacity>
      </View>}
      </>}
    </View>
  </Modal>;
}
