import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import StickerArt from './sticker-art';
import type { Sticker } from '../../services/stickers';
import { loadStickerPreferences, updateStickerPreferences } from '../../services/stickers';
import { importSticker, isImportedStickerFavorite } from '../../services/imported-stickers';

export default function StickerPreview({ sticker, uri, userId, onClose }: { sticker?: Sticker; uri?: string; userId?: number; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { width, height } = useWindowDimensions();
  const size = Math.min(240, width - 80, height * 0.45);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setFavorite(null);
    setError('');
    if (userId) {
      const check = sticker ? loadStickerPreferences(userId).then((prefs) => prefs.favorites.includes(sticker.id))
        : isImportedStickerFavorite(userId, uri || '');
      check.then((value) => { if (active) setFavorite(value); })
        .catch(() => { if (active) { setFavorite(false); setError('Could not check favorites. Please try again.'); } });
    }
    return () => { active = false; mounted.current = false; };
  }, [userId, sticker?.id, uri]);
  const addFavorite = async () => {
    if (!userId || busy.current || favorite) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      if (sticker) {
        const prefs = await loadStickerPreferences(userId);
        if (!prefs.favorites.includes(sticker.id)) await updateStickerPreferences(userId, sticker.id, 'favorite');
      } else if (uri) await importSticker(userId, uri, 'Sticker', true);
      else throw new Error('Sticker unavailable');
      if (mounted.current) setFavorite(true);
    } catch {
      if (mounted.current) setError('Could not save favorite. Please try again.');
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <Pressable accessibilityLabel="Close sticker preview" accessibilityRole="button" onPress={onClose} style={{ position: 'absolute', inset: 0 }} />
      <View accessibilityViewIsModal style={{ padding: 20, gap: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.neonBorder, alignItems: 'center' }}>
        {sticker ? <StickerArt sticker={sticker} size={size} animate loop /> : <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Sticker preview" />}
        {!!userId && <Pressable accessibilityRole="button" accessibilityState={{ disabled: favorite === null || saving || favorite, busy: saving }}
          disabled={favorite === null || saving || favorite} onPress={() => { void addFavorite(); }}
          style={{ padding: 12, borderRadius: 14, backgroundColor: c.background }}>
          <Text accessibilityLiveRegion="polite" style={{ color: c.primary, fontWeight: '600' }}>
            {saving ? 'Saving…' : favorite === null ? 'Checking favorites…' : favorite ? '★ In favorites' : '☆ Add to favorites'}
          </Text>
        </Pressable>}
        {!!error && <Text selectable accessibilityRole="alert" style={{ color: c.text, maxWidth: size }}>{error}</Text>}
        <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}><Text style={{ color: c.primary }}>Close</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
