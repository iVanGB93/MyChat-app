import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Image as SvgImage, Path, Text as SvgText } from 'react-native-svg';
import { manipulateAsync, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import StickerCropEditor from './sticker-crop-editor';
import type { StickerCrop } from '../../utils/sticker-crop';

type Stroke = { path: string; color: string };
export default function PhotoEditor({ uri, onClose, onSave, embedded = false, onEditingChange, preserveTransparency = false, maxPreviewHeight }: {
  uri: string; onClose: () => void; onSave: (image: { uri: string; width: number; height: number }) => void;
  embedded?: boolean; onEditingChange?: (pending: boolean) => void;
  preserveTransparency?: boolean;
  maxPreviewHeight?: number;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const outputFormat = preserveTransparency ? SaveFormat.PNG : SaveFormat.JPEG;
  const [photo, setPhoto] = useState<ImageResult>();
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'preview' | 'draw' | 'text' | 'crop'>(embedded ? 'preview' : 'draw');
  const [modified, setModified] = useState(false);
  const editingCallback = useRef(onEditingChange);
  editingCallback.current = onEditingChange;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [label, setLabel] = useState('');
  const [position, setPosition] = useState({ x: .5, y: .5 });
  const [color, setColor] = useState('#ffffff');
  const [crop, setCrop] = useState<StickerCrop>();
  const [dragging, setDragging] = useState(false);
  const dirty = modified || strokes.length > 0 || !!label.trim() || mode === 'crop';
  useEffect(() => { editingCallback.current?.(busy || dirty); }, [busy, dirty]);
  useEffect(() => () => editingCallback.current?.(false), []);
  const svg = useRef<Svg>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const temporary = useRef<string[]>([]);
  const kept = useRef<string | undefined>(undefined);
  const width = Math.min(window.width - (embedded ? 56 : 32), 420);
  const previewHeight = maxPreviewHeight ?? Math.max(150, window.height * .46);
  const scale = photo ? Math.min(width / photo.width, previewHeight / photo.height) : 1;
  const w = photo ? photo.width * scale : width;
  const h = photo ? photo.height * scale : width;
  const remember = (image: ImageResult) => {
    if (!alive.current) { try { new File(image.uri).delete(); } catch {} }
    else temporary.current.push(image.uri);
    return image;
  };
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        let image = remember(await manipulateAsync(uri, [], { format: outputFormat, compress: .95 }));
        const longest = Math.max(image.width, image.height);
        image = remember(await manipulateAsync(image.uri, longest > 1600 ? [{ resize: image.width >= image.height ? { width: 1600 } : { height: 1600 } }] : [], { format: outputFormat, compress: .95 }));
        if (alive.current) setPhoto(image);
      } catch { if (alive.current) Alert.alert('Cannot edit photo', 'This image could not be opened. You can still send the original.'); }
      finally { if (alive.current) setBusy(false); }
    })();
    return () => {
      alive.current = false;
      for (const path of temporary.current) {
        if (path !== kept.current) { try { new File(path).delete(); } catch {} }
      }
    };
  }, [uri, outputFormat]);
  const flatten = async () => {
    if (!photo) throw new Error('Photo not ready');
    if (!strokes.length && !label.trim()) return photo;
    if (!svg.current || !ready) throw new Error('Preview not ready');
    const base64 = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Export timed out')), 10_000);
      svg.current!.toDataURL((value) => { clearTimeout(timer); value ? resolve(value) : reject(new Error('Empty image')); }, { width: photo.width, height: photo.height });
    });
    const file = new File(Paths.cache, `photo-edit-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    file.write(base64, { encoding: 'base64' });
    temporary.current.push(file.uri);
    return { ...photo, uri: file.uri };
  };
  const perform = async (action: 'rotate' | 'crop' | 'apply' | 'save') => {
    if (locked.current || busy || !photo) return;
    locked.current = true; setBusy(true);
    try {
      const base = mode === 'crop' ? photo : await flatten();
      if (action === 'save') {
        const final = remember(await manipulateAsync(base.uri, [], { format: outputFormat, compress: .92 }));
        kept.current = final.uri;
        onSave(final);
        return;
      }
      const actions = action === 'rotate' ? [{ rotate: 90 }] : action === 'apply' && crop ? [{ crop }] : [];
      const next = remember(await manipulateAsync(base.uri, actions, { format: outputFormat, compress: .95 }));
      setReady(false); setPhoto(next); setStrokes([]); setLabel('');
      if (action === 'rotate' || action === 'apply' || strokes.length || label.trim()) setModified(true);
      setMode(action === 'crop' ? 'crop' : embedded ? 'preview' : 'draw');
    } catch { Alert.alert('Could not edit photo', 'Please try again. Your original photo has not changed.'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const button = (text: string, action: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" disabled={busy || disabled} onPress={action} style={{ padding: 12, borderRadius: 12, backgroundColor: c.surfaceVariant, opacity: busy || disabled ? .45 : 1 }}><Text style={{ color: c.primary }}>{text}</Text></TouchableOpacity>;
  const content = <>
      {!embedded && <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{button('Cancel', onClose)}<Text style={{ color: c.text, fontSize: 20 }}>Edit picture</Text>{button('Done', () => void perform('save'), !photo || mode === 'crop' || !ready)}</View>}
      {busy && <ActivityIndicator color={c.primary} />}
      {photo && (mode === 'crop' ? <>
        <StickerCropEditor key={photo.uri} uri={photo.uri} size={Math.min(width, previewHeight)} disabled={busy} onChange={setCrop} onDragging={setDragging} />
        <Text style={{ color: c.textSecondary }}>Square crop · drag and resize the selection.</Text>
        {button('Apply crop', () => void perform('apply'), !crop)}
        {button('Cancel crop', () => setMode(embedded ? 'preview' : 'draw'))}
      </> : <View style={{ alignSelf: 'center', width: w, height: h }}
        onStartShouldSetResponder={() => !busy && ready && mode !== 'preview'}
        onMoveShouldSetResponder={() => !busy && ready && mode !== 'preview'}
        onResponderGrant={(event) => {
          setDragging(true);
          const { locationX: x, locationY: y } = event.nativeEvent;
          if (mode === 'text') setPosition({ x: Math.max(0, Math.min(1, x / w)), y: Math.max(.08, Math.min(.95, y / h)) });
          else setStrokes((value) => [...value, { color, path: `M${x},${y} l0.1,0.1` }]);
        }}
        onResponderMove={(event) => {
          const x = Math.max(0, Math.min(w, event.nativeEvent.locationX));
          const y = Math.max(0, Math.min(h, event.nativeEvent.locationY));
          if (mode === 'text') setPosition({ x: x / w, y: Math.max(.08, Math.min(.95, y / h)) });
          else setStrokes((value) => value.map((stroke, i) => i === value.length - 1 ? { ...stroke, path: `${stroke.path} L${x},${y}` } : stroke));
        }}
        onResponderRelease={() => setDragging(false)} onResponderTerminate={() => setDragging(false)} onResponderTerminationRequest={() => false}>
        <Svg ref={svg} pointerEvents="none" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <SvgImage key={photo.uri} width={w} height={h} href={{ uri: photo.uri }} onLoad={() => setReady(true)} />
          {strokes.map((stroke, i) => <Path key={i} d={stroke.path} stroke={stroke.color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {!!label && <SvgText x={position.x * w} y={position.y * h} textAnchor="middle" fill={color} stroke="#000000" strokeWidth={.4} fontSize={24} fontWeight="bold">{label}</SvgText>}
        </Svg>
      </View>)}
      {mode !== 'crop' && <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {button('Rotate 90°', () => void perform('rotate'), !ready)}{button('Crop', () => void perform('crop'), !ready)}
          {button('Draw', () => setMode('draw'))}{button('Text', () => setMode('text'))}
          {embedded && mode !== 'preview' && button('Stop editing', () => setMode('preview'))}
          {button('Undo drawing', () => setStrokes((value) => value.slice(0, -1)), !strokes.length)}
        </View>
        {mode !== 'preview' && <Text style={{ color: c.textSecondary }}>{mode === 'draw' ? 'Draw on the photo with your finger.' : 'Type your text, then drag on the photo to position it.'}</Text>}
        {mode === 'text' && <TextInput accessibilityLabel="Text on photo" placeholder="Add text to picture" placeholderTextColor={c.textSecondary} value={label} onChangeText={setLabel} editable={!busy} maxLength={60} style={{ color: c.text, backgroundColor: c.surface, padding: 12, borderRadius: 10 }} />}
        {mode !== 'preview' && <View style={{ flexDirection: 'row', gap: 10 }}>{['#ffffff', '#000000', '#ff5252', '#ffeb3b', '#00e5ff'].map((value) => <TouchableOpacity key={value} accessibilityLabel={`Use ${value} color`} disabled={busy} onPress={() => setColor(value)} style={{ backgroundColor: value, width: 38, height: 38, borderRadius: 19, borderWidth: color === value ? 3 : 1, borderColor: c.primary }} />)}</View>}
      </>}
      {embedded && dirty && <View style={{ flexDirection: 'row', gap: 8 }}>{button('Discard edits', onClose)}{button('Apply edits', () => void perform('save'), !photo || mode === 'crop' || !ready)}</View>}
    </>;
  if (embedded) return <View style={{ gap: 12 }}>{content}</View>;
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <ScrollView scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, gap: 14, backgroundColor: c.background }}>{content}</ScrollView>
  </Modal>;
}
