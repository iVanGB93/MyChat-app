import React from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import StickerArt from './sticker-art';
import type { Sticker } from '../../services/stickers';

export default function StickerPreview({ sticker, uri, onClose }: { sticker?: Sticker; uri?: string; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { width, height } = useWindowDimensions();
  const size = Math.min(240, width - 80, height * 0.45);
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <Pressable accessibilityLabel="Close sticker preview" accessibilityRole="button" onPress={onClose} style={{ position: 'absolute', inset: 0 }} />
      <View accessibilityViewIsModal style={{ padding: 20, gap: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.neonBorder, alignItems: 'center' }}>
        {sticker ? <StickerArt sticker={sticker} size={size} animate loop /> : <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="Sticker preview" />}
        <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 12 }}><Text style={{ color: c.primary }}>Close</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
