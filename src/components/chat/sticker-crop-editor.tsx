import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../contexts/ThemeContext';
import { stickerCrop, type StickerCrop } from '../../utils/sticker-crop';

export default function StickerCropEditor({ uri, size, disabled, onChange, onDragging }: {
  uri: string; size: number; disabled: boolean;
  onChange: (crop: StickerCrop | undefined) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const { colors: c } = useTheme();
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [selection, setSelection] = useState({ x: .5, y: .5, fraction: 1 });
  const crop = dimensions && stickerCrop(dimensions.width, dimensions.height, selection.x, selection.y, selection.fraction);
  const scale = dimensions ? size / Math.max(dimensions.width, dimensions.height) : 1;
  const displayWidth = dimensions ? dimensions.width * scale : size;
  const displayHeight = dimensions ? dimensions.height * scale : size;
  useEffect(() => {
    onChange(dimensions ? stickerCrop(dimensions.width, dimensions.height, selection.x, selection.y, selection.fraction) : undefined);
  }, [dimensions, selection, onChange]);
  const move = (event: GestureResponderEvent) => {
    if (disabled || !dimensions) return;
    const { locationX, locationY } = event.nativeEvent;
    setSelection((value) => ({ ...value, x: Math.max(0, Math.min(1, locationX / displayWidth)), y: Math.max(0, Math.min(1, locationY / displayHeight)) }));
  };
  const control = (label: string, action: () => void) => <TouchableOpacity disabled={disabled || !dimensions} accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ padding: 12, backgroundColor: c.surfaceVariant, borderRadius: 12 }}><Text style={{ color: c.primary }}>{label}</Text></TouchableOpacity>;
  return <View style={{ alignItems: 'center', gap: 12 }}>
    <Text style={{ color: c.textSecondary }}>Drag to select the area. Use − / + to resize it.</Text>
    <View style={{ width: displayWidth, height: displayHeight, overflow: 'hidden', backgroundColor: c.surfaceVariant }}
      onStartShouldSetResponder={() => !disabled && !!dimensions}
      onMoveShouldSetResponder={() => !disabled && !!dimensions}
      onResponderGrant={(event) => { onDragging(true); move(event); }}
      onResponderMove={move}
      onResponderRelease={() => onDragging(false)}
      onResponderTerminate={() => onDragging(false)}
      onResponderTerminationRequest={() => false}>
      <Image pointerEvents="none" source={{ uri }} style={{ width: displayWidth, height: displayHeight }} contentFit="contain"
        onLoad={({ source }) => { if (source.width > 0 && source.height > 0) setDimensions({ width: source.width, height: source.height }); }}
        onError={() => { setDimensions(undefined); onChange(undefined); }} />
      {crop && <View pointerEvents="none" style={{ position: 'absolute', left: crop.originX * scale, top: crop.originY * scale, width: crop.width * scale, height: crop.height * scale, borderWidth: 3, borderColor: c.primary, backgroundColor: 'rgba(255,255,255,0.08)' }} />}
    </View>
    {!dimensions && <Text style={{ color: c.textSecondary }}>Waiting for photo. If it cannot load, choose another photo.</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {control('− Smaller area', () => setSelection((v) => ({ ...v, fraction: Math.max(.15, v.fraction - .1) })))}
      {control('+ Larger area', () => setSelection((v) => ({ ...v, fraction: Math.min(1, v.fraction + .1) })))}
      {control('Reset area', () => setSelection({ x: .5, y: .5, fraction: 1 }))}
    </View>
  </View>;
}
