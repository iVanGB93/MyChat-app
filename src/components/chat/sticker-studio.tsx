import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useTheme } from '../../contexts/ThemeContext';
import { importSticker, importedStickerUri, loadImportedStickers, removeImportedSticker, type ImportedSticker } from '../../services/imported-stickers';
import { stickerGridCellWidth } from '../../utils/sticker-grid';
import StickerCropEditor from './sticker-crop-editor';
import type { StickerCrop } from '../../utils/sticker-crop';

export default function StickerStudio({ ownerId, onBusy, onSend, onClose, initialUri }: {
  initialUri?: string;
  ownerId: number; onBusy: (busy: boolean) => void; onSend: (sticker: ImportedSticker) => Promise<void>; onClose: () => void;
}) {
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const cellWidth = stickerGridCellWidth(width);
  const [items, setItems] = useState<ImportedSticker[]>([]);
  const [draft, setDraft] = useState<string | undefined>(initialUri);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState<StickerCrop>();
  const [cropping, setCropping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ownedDrafts = useRef(new Set<string>());
  useEffect(() => () => {
    // Only remove editor-generated temporary copies, never the source photo.
    for (const uri of ownedDrafts.current) {
      try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* cache cleanup can retry later */ }
    }
  }, []);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ImportedSticker>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true);
    try { await work(); }
    catch (error) { Alert.alert('Sticker action failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  useEffect(() => { let active = true; void loadImportedStickers(ownerId).then((rows) => { if (active) setItems(rows); }).catch(() => Alert.alert('Storage unavailable', 'Your stickers could not be loaded.')); return () => { active = false; }; }, [ownerId]);
  const button = (label: string, action: () => void) => <TouchableOpacity disabled={busy} accessibilityRole="button" onPress={action} accessibilityLabel={label} style={{ padding: 16, borderRadius: 18, backgroundColor: c.surfaceVariant, alignItems: 'center' }}><Text style={{ color: c.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  return <ScrollView scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>Little moments. Big feelings.</Text>
    <Text style={{ color: c.textSecondary }}>Turn a funny photo into your next favorite sticker. Crop, preview, then save — nothing sends automatically.</Text>
    {button('＋ Create sticker', () => { void run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      setDraft(result.assets[0].uri); setRotation(0); setName(''); setSelected(undefined); setCropping(false); setCrop(undefined);
    }); })}
    {draft && <View style={{ gap: 12, alignItems: 'center' }}>
      {cropping ? <>
        <StickerCropEditor key={draft} uri={draft} size={Math.min(300, Math.max(100, width - 64))} disabled={busy} onChange={setCrop} onDragging={setDragging} />
        {button('Apply selected area', () => { void run(async () => {
          if (!crop) throw new Error('Wait for the photo to load before applying the selection.');
          const result = await manipulateAsync(draft, [{ crop }], { format: SaveFormat.PNG });
          ownedDrafts.current.add(result.uri);
          setDraft(result.uri); setCropping(false); setCrop(undefined); setDragging(false);
        }); })}
        {button('Cancel selection', () => { setCropping(false); setCrop(undefined); setDragging(false); })}
      </> : <Image source={{ uri: draft }} style={{ width: 210, height: 210, transform: [{ rotate: `${rotation}deg` }] }} contentFit="contain" />}
      <Text style={{ color: c.textSecondary }}>Your sticker preview</Text>
      <TextInput accessibilityLabel="Sticker name" placeholder="Give it a name (optional)" placeholderTextColor={c.textSecondary} value={name} onChangeText={setName} maxLength={80} editable={!busy} style={{ color: c.text, backgroundColor: c.surfaceVariant, padding: 14, borderRadius: 14, width: '100%' }} />
      {!cropping && button('Select area / Resize', () => { void run(async () => {
        if (rotation) {
          const result = await manipulateAsync(draft, [{ rotate: rotation }], { format: SaveFormat.PNG });
          ownedDrafts.current.add(result.uri); setDraft(result.uri); setRotation(0);
        }
        setCrop(undefined); setCropping(true);
      }); })}
      {!cropping && button('Rotate ↻', () => setRotation((value) => (value + 90) % 360))}
      {!cropping && button('Save sticker', () => { void run(async () => {
        const result = await manipulateAsync(draft, [{ rotate: rotation }, { resize: { width: 512 } }], { format: SaveFormat.PNG });
        try {
          const rows = await importSticker(ownerId, result.uri, name.trim() || 'My photo sticker');
          setItems(rows); setDraft(undefined);
          Alert.alert('Sticker saved!', 'Find it in My stickers below. Tap it to preview and send.');
        } finally { if (result.uri !== draft) { const file = new File(result.uri); if (file.exists) file.delete(); } }
      }); })}
      {button('Cancel creation', () => { setDraft(undefined); setCropping(false); setDragging(false); })}
    </View>}
    <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>My stickers · {items.length}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {items.map((sticker) => <TouchableOpacity key={sticker.id} disabled={busy} onPress={() => { setSelected(sticker); setDraft(undefined); }} accessibilityLabel={`Preview ${sticker.name}`} accessibilityState={{ selected: selected?.id === sticker.id }} style={{ width: cellWidth, alignItems: 'center' }}>
        <Image source={{ uri: importedStickerUri(ownerId, sticker) }} style={{ width: Math.min(110, cellWidth), height: Math.min(110, cellWidth) }} contentFit="contain" />
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selected?.id === sticker.id ? c.primary : 'transparent' }} />
      </TouchableOpacity>)}
    </View>
    {!items.length && <Text style={{ color: c.textSecondary }}>Your collection starts with one smile. Create your first sticker above!</Text>}
    {!draft && selected && <View style={{ alignItems: 'center', gap: 12 }}>
      <Image source={{ uri: importedStickerUri(ownerId, selected) }} style={{ width: 180, height: 180 }} contentFit="contain" />
      {button('Send sticker', () => { void run(async () => { await onSend(selected); onClose(); }); })}
      {button('Remove from collection', () => Alert.alert('Remove sticker?', 'Copies already sent in chats will remain.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void run(async () => { setItems(await removeImportedSticker(ownerId, selected)); setSelected(undefined); }); } },
      ]))}
    </View>}
    {busy && <ActivityIndicator color={c.primary} />}
  </ScrollView>;
}
