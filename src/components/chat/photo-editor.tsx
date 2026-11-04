import {t,languageSnapshot} from '../../localization/language';
import {Ionicons} from '@expo/vector-icons';
import {Chrome} from '../../theme';
import ScreenHeader from '../ui/ScreenHeader';
import {KeyboardAvoidingScreen, KeyboardFormScrollView} from '../ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../ui/KeyboardForm';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Modal, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Image as SvgImage, Path, Text as SvgText } from 'react-native-svg';
import { manipulateAsync, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import StickerCropEditor from './sticker-crop-editor';
import type { StickerCrop } from '../../utils/sticker-crop';

type Stroke = { path: string; color: string };
export default function PhotoEditor({ uri, onClose, onSave, embedded = false, onEditingChange, onDraggingChange, preserveTransparency = false, maxPreviewHeight, floatingTools = false, title = t("Edit picture") }: {
  uri: string; onClose: () => void; onSave: (image: { uri: string; width: number; height: number }) => void;
  embedded?: boolean; onEditingChange?: (pending: boolean) => void;
  onDraggingChange?: (dragging: boolean) => void;
  preserveTransparency?: boolean;
  maxPreviewHeight?: number;
  floatingTools?: boolean;
  title?: string;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const outputFormat = preserveTransparency ? SaveFormat.PNG : SaveFormat.JPEG;
  const [photo, setPhoto] = useState<ImageResult>();
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'preview' | 'draw' | 'text' | 'crop'>(embedded || floatingTools ? 'preview' : 'draw');
  const [modified, setModified] = useState(false);
  const editingCallback = useRef(onEditingChange);
  editingCallback.current = onEditingChange;
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [label, setLabel] = useState('');
  const [position, setPosition] = useState({ x: .5, y: .5 });
  const [color, setColor] = useState('#ffffff');
  const [crop, setCrop] = useState<StickerCrop>();
  const [dragging, setDragging] = useState(false);
  const draggingCallback = useRef(onDraggingChange);
  draggingCallback.current = onDraggingChange;
  const updateDragging = useCallback((active: boolean) => {
    setDragging(active);
    draggingCallback.current?.(active);
  }, [languageSnapshot()]);
  // Discarding/replacing an editor during a gesture must release its parent's scroll lock.
  useEffect(() => () => draggingCallback.current?.(false), []);
  const dirty = modified || strokes.length > 0 || !!label.trim() || mode === 'crop';
  useEffect(() => { editingCallback.current?.(busy || dirty); }, [busy, dirty]);
  useEffect(() => () => editingCallback.current?.(false), []);
  const svg = useRef<Svg>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const temporary = useRef<string[]>([]);
  const kept = useRef<string | undefined>(undefined);
  const width = floatingTools ? window.width - 16 : Math.min(window.width - (embedded ? 56 : 32), 420);
  const [editorHeight, setEditorHeight] = useState<number>();
  // Floating controls overlay the photo; the keyboard resizes this measured body, not a scrolling form.
  const previewHeight = maxPreviewHeight ?? (floatingTools
    ? Math.max(80, (editorHeight ?? window.height - insets.top - 70) - insets.bottom - 12)
    : Math.max(150, window.height * .46));
  const scale = photo ? Math.min(width / photo.width, previewHeight / photo.height) : 1;
  const w = photo ? photo.width * scale : width;
  const h = photo ? photo.height * scale : width;
  // Keep drawing/text coordinates stable when the keyboard changes the displayed size.
  const canvasWidth = width;
  const canvasHeight = photo ? width * photo.height / photo.width : width;
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
      } catch { if (alive.current) Alert.alert(t("Cannot edit photo"), t("This image could not be opened. You can still send the original.")); }
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
    if (!photo) throw new Error(t("Photo not ready"));
    if (!strokes.length && !label.trim()) return photo;
    if (!svg.current || !ready) throw new Error(t("Preview not ready"));
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
      setMode(action === 'crop' ? 'crop' : embedded ? 'preview' : floatingTools ? (action === 'rotate' ? mode : 'preview') : 'draw');
    } catch { Alert.alert(t("Could not edit photo"), t("Please try again. Your original photo has not changed.")); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  const icons:Record<string,React.ComponentProps<typeof Ionicons>['name']>={'Rotate 90°':'refresh-outline',Crop:'crop-outline',Draw:'brush-outline',Text:'text-outline','Stop editing':'hand-left-outline','Undo drawing':'arrow-undo-outline','Apply crop':'checkmark','Cancel crop':'close','Discard edits':'close','Apply edits':'checkmark'};
  const button = (text:string,action:()=>void,disabled=false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={text} accessibilityState={{disabled:busy||disabled,selected:text==='Crop'?mode==='crop':text==='Draw'?mode==='draw':text==='Text'?mode==='text':false}} disabled={busy||disabled} onPress={action} style={{padding:12,minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,backgroundColor:c.headerBg,borderWidth:1,borderColor:(text==='Crop'&&mode==='crop'||text==='Draw'&&mode==='draw'||text==='Text'&&mode==='text')?c.primary:c.neonBorder,opacity:busy || disabled ? .45 : 1}}>{floatingTools?<Ionicons name={icons[text]??'checkmark'} size={22} color={c.primary}/>:<Text style={{color:c.primary}}>{text}</Text>}</TouchableOpacity>;
  const tools=<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:6}}>
    {button('Rotate 90°',()=>void perform('rotate'),!ready||mode==='crop')}{button('Crop',()=>void perform('crop'),!ready||mode==='crop')}
    {button('Draw',()=>setMode('draw'),!ready||mode==='crop')}{button('Text',()=>setMode('text'),!ready||mode==='crop')}
    {button(t("Undo drawing"),()=>setStrokes(value=>value.slice(0,-1)),!strokes.length)}
    {embedded&&mode!=='preview'&&button(t("Stop editing"),()=>setMode('preview'))}
  </View>;
  const content = <>

      {!floatingTools && busy && <ActivityIndicator color={c.primary} />}
      <View testID="photo-editor-stage" style={{position:'relative',alignSelf:'center',justifyContent:'center',width:floatingTools?width:undefined,height:floatingTools?previewHeight:undefined}}>
      {photo && (mode === 'crop' ? <>
        <StickerCropEditor key={photo.uri} uri={photo.uri} size={Math.min(width, previewHeight)} disabled={busy} onChange={setCrop} onDragging={updateDragging} iconControls={floatingTools} viewport={floatingTools?{width,height:previewHeight}:undefined} imageDimensions={floatingTools?photo:undefined}
          actions={floatingTools?<>{button(t("Cancel crop"),()=>setMode('preview'))}{button(t("Apply crop"),()=>void perform('apply'),!crop)}</>:undefined} />
        {!floatingTools&&<><Text style={{ color: c.textSecondary }}>{t("Square crop - drag and resize the selection.")}</Text>
        {button(t("Apply crop"), () => void perform('apply'), !crop)}
        {button(t("Cancel crop"), () => setMode(embedded ? 'preview' : 'draw'))}</>}
      </> : <View style={{ alignSelf: 'center', width: w, height: h }}
        onStartShouldSetResponder={() => !busy && ready && mode !== 'preview'}
        onMoveShouldSetResponder={() => !busy && ready && mode !== 'preview'}
        onResponderGrant={(event) => {
          updateDragging(true);
          const { locationX: x, locationY: y } = event.nativeEvent;
          if (mode === 'text') setPosition({ x: Math.max(0, Math.min(1, x / w)), y: Math.max(.08, Math.min(.95, y / h)) });
          else setStrokes((value) => [...value, { color, path: `M${x * canvasWidth / w},${y * canvasHeight / h} l0.1,0.1` }]);
        }}
        onResponderMove={(event) => {
          const x = Math.max(0, Math.min(w, event.nativeEvent.locationX));
          const y = Math.max(0, Math.min(h, event.nativeEvent.locationY));
          if (mode === 'text') setPosition({ x: x / w, y: Math.max(.08, Math.min(.95, y / h)) });
          else setStrokes((value) => value.map((stroke, i) => i === value.length - 1 ? { ...stroke, path: `${stroke.path} L${x * canvasWidth / w},${y * canvasHeight / h}` } : stroke));
        }}
        onResponderRelease={() => updateDragging(false)} onResponderTerminate={() => updateDragging(false)} onResponderTerminationRequest={() => false}>
        <Svg ref={svg} pointerEvents="none" width={w} height={h} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}>
          <SvgImage key={photo.uri} width={canvasWidth} height={canvasHeight} href={{ uri: photo.uri }} onLoad={() => setReady(true)} />
          {strokes.map((stroke, i) => <Path key={i} d={stroke.path} stroke={stroke.color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {!!label && <SvgText x={position.x * canvasWidth} y={position.y * canvasHeight} textAnchor="middle" fill={color} stroke="#000000" strokeWidth={.4} fontSize={24} fontWeight="bold">{label}</SvgText>}
        </Svg>
      </View>)}
      {floatingTools&&<View style={{position:'absolute',top:4,left:0,right:0}}>{tools}</View>}
      {floatingTools&&busy&&<View pointerEvents="none" style={{position:'absolute',alignSelf:'center'}}><ActivityIndicator color={c.primary}/></View>}
      </View>
      <View testID="photo-editor-options" style={floatingTools?{position:'absolute',bottom:insets.bottom+8,left:16,right:16,gap:8}: {gap:10}}>

      {mode !== 'crop' && <>
        {!floatingTools&&tools}
        {!floatingTools && mode !== 'preview' && <Text style={{ color: c.textSecondary }}>{mode === 'draw' ? t("Draw on the photo with your finger.") : t("Type your text, then drag on the photo to position it.")}</Text>}
        {mode === 'text' && <View style={{flexDirection:'row',alignItems:'center',backgroundColor:c.inputBg,borderColor:c.neonBorder,borderWidth:1,borderRadius:Chrome.controlRadius,paddingRight:4}}>
          <TextInput accessibilityLabel={t("Text on photo")} placeholder={t("Add text to picture")} placeholderTextColor={c.textSecondary} value={label} onChangeText={setLabel} editable={!busy} maxLength={60} returnKeyType="done" onSubmitEditing={()=>Keyboard.dismiss()} style={{flex:1,minWidth:0,color:c.text,padding:14}} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Finish typing")} disabled={busy} onPress={()=>Keyboard.dismiss()} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:busy?.45:1}}>
            <Ionicons name="checkmark" size={24} color={c.primary}/>
          </TouchableOpacity>
        </View>}
        {mode !== 'preview' && <View style={{ flexDirection: 'row', justifyContent:'center', gap: 10 }}>{['#ffffff', '#000000', '#ff5252', '#ffeb3b', '#00e5ff'].map((value) => <TouchableOpacity key={value} accessibilityLabel={t("Use {0} color",{0:value})} disabled={busy} onPress={() => setColor(value)} style={{ backgroundColor: value, width: 38, height: 38, borderRadius: 19, borderWidth: color === value ? 3 : 1, borderColor: c.primary }} />)}</View>}
      </>}
      </View>
      {embedded && dirty && <View style={{ flexDirection: 'row', gap: 8 }}>{button(t("Discard edits"), onClose)}{button(t("Apply edits"), () => void perform('save'), !photo || mode === 'crop' || !ready)}</View>}
    </>;
  if (embedded) return <View style={{ gap: 12 }}>{content}</View>;
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={{flex:1,backgroundColor:c.background}}><ScreenHeader title={title} disabled={busy} onBack={onClose} trailing={<TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Save edited picture")} disabled={busy||!photo||mode==='crop'||!ready} onPress={()=>void perform('save')} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center',opacity:busy||!photo||mode==='crop'||!ready?0.4:1}}>{floatingTools?<Ionicons name="checkmark" size={26} color={c.headerText}/>:<Text style={{color:c.headerText,fontWeight:'700'}}>{t("Done")}</Text>}</TouchableOpacity>}/>
    <>{floatingTools?<KeyboardAvoidingScreen><View style={{flex:1,paddingTop:4}} onLayout={event=>setEditorHeight(event.nativeEvent.layout.height)}>{content}</View></KeyboardAvoidingScreen>:<View style={{flex:1}}><KeyboardFormScrollView bounces={!floatingTools} overScrollMode={floatingTools?"never":"auto"} scrollEnabled={!dragging&&(!floatingTools||mode==='text')} contentContainerStyle={{ flexGrow: 1, padding: 16, paddingTop: 16, paddingBottom: insets.bottom + 16, gap: 14, backgroundColor: c.background }}>{content}</KeyboardFormScrollView></View>}</></View>
  </Modal>;
}
