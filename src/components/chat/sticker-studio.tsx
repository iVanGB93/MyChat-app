import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useTheme } from '../../contexts/ThemeContext';
import { importSticker } from '../../services/imported-stickers';
import StickerCropEditor from './sticker-crop-editor';
import type { StickerCrop } from '../../utils/sticker-crop';

export default function StickerStudio({ ownerId, onBusy, onSaved, initialUri }: {
  initialUri?: string;
  ownerId: number; onBusy: (busy: boolean) => void; onSaved: () => void;
}) {
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState<string | undefined>(initialUri);
  const [preserveAnimation, setPreserveAnimation] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    setPreserveAnimation(null);
    if (draft) void new File(draft).bytes().then((bytes) => {
      const head = String.fromCharCode(...bytes.slice(0, 12));
      if (active) setPreserveAnimation(head.startsWith('GIF87a') || head.startsWith('GIF89a') || (head.startsWith('RIFF') && head.slice(8) === 'WEBP'));
    }).catch(() => { if (active) Alert.alert('Sticker unavailable', 'Could not read the selected image. Please choose it again.'); });
    return () => { active = false; };
  }, [draft]);
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
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true);
    try { await work(); }
    catch (error) { Alert.alert('Sticker action failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const button = (label: string, action: () => void) => <TouchableOpacity disabled={busy} accessibilityRole="button" onPress={action} accessibilityLabel={label} style={{ padding: 16, borderRadius: 18, backgroundColor: c.surfaceVariant, alignItems: 'center' }}><Text style={{ color: c.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  return <ScrollView scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>Little moments. Big feelings.</Text>
    <Text style={{ color: c.textSecondary }}>Turn a funny photo into your next favorite sticker. Crop, preview, then save — nothing sends automatically.</Text>
    {button('＋ Create sticker', () => { void run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      setDraft(result.assets[0].uri); setRotation(0); setName(''); setCropping(false); setCrop(undefined);
    }); })}
    {button('Choose GIF / WebP file', () => { void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/gif', 'image/webp'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      setDraft(result.assets[0].uri); setRotation(0); setName(''); setCropping(false); setCrop(undefined);
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
      {preserveAnimation && <Text style={{ color: c.textSecondary }}>GIF and WebP stickers keep their original animation. Crop and rotate are available for still photos only.</Text>}
      <TextInput accessibilityLabel="Sticker name" placeholder="Give it a name (optional)" placeholderTextColor={c.textSecondary} value={name} onChangeText={setName} maxLength={80} editable={!busy} style={{ color: c.text, backgroundColor: c.surfaceVariant, padding: 14, borderRadius: 14, width: '100%' }} />
      {!cropping && preserveAnimation === false && button('Select area / Resize', () => { void run(async () => {
        if (rotation) {
          const result = await manipulateAsync(draft, [{ rotate: rotation }], { format: SaveFormat.PNG });
          ownedDrafts.current.add(result.uri); setDraft(result.uri); setRotation(0);
        }
        setCrop(undefined); setCropping(true);
      }); })}
      {!cropping && preserveAnimation === false && button('Rotate ↻', () => setRotation((value) => (value + 90) % 360))}
      {!cropping && preserveAnimation !== null && button('Save sticker', () => { void run(async () => {
        if (preserveAnimation) {
          await importSticker(ownerId, draft, name.trim() || 'My animated sticker');
          setDraft(undefined); onSaved(); return;
        }
        const result = await manipulateAsync(draft, [{ rotate: rotation }, { resize: { width: 512 } }], { format: SaveFormat.PNG });
        try {
          await importSticker(ownerId, result.uri, name.trim() || 'My photo sticker');
          setDraft(undefined);
          onSaved();
        } finally { if (result.uri !== draft) { const file = new File(result.uri); if (file.exists) file.delete(); } }
      }); })}
      {button('Cancel creation', () => { setDraft(undefined); setCropping(false); setDragging(false); })}
    </View>}
    {busy && <ActivityIndicator color={c.primary} />}
  </ScrollView>;
}
