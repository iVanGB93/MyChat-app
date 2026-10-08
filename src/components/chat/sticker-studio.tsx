import type {StickerDraftStorage} from '../../services/sticker-draft-store';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useTheme } from '../../contexts/ThemeContext';
import { importSticker } from '../../services/imported-stickers';
import PhotoEditor from './photo-editor';

export default function StickerStudio({ ownerId, onBusy, onSaved, initialUri, draftStorage }: {
  initialUri?: string; draftStorage?: StickerDraftStorage;
  ownerId: number | string; onBusy: (busy: boolean) => void; onSaved: () => void;
}) {
  const { colors: c } = useTheme();
  const { width, height } = useWindowDimensions();
  const previewHeight = Math.min(240, Math.max(96, height * .3), Math.max(96, width - 56));
  const [draft, setDraft] = useState<string | undefined>(initialUri);
  const draftId=useRef<string | undefined>(undefined);
  const [loadingDraft,setLoadingDraft]=useState(!!draftStorage);
  const [draftError,setDraftError]=useState('');
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
  const [pendingEdits, setPendingEdits] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [reset, setReset] = useState(0);
  const ownedDrafts = useRef(new Set<string>());
  useEffect(() => () => {
    // Only remove editor-generated temporary copies, never the source photo.
    for (const uri of ownedDrafts.current) {
      try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* cache cleanup can retry later */ }
    }
  }, []);
  const [name, setName] = useState('');
  useEffect(()=>{let active=true;if(draftStorage)void draftStorage.load().then(saved=>{if(active){draftId.current=saved?.id;setDraft(saved?.uri);setName(saved?.name??'');}}).catch(()=>{if(active)setDraftError('Could not restore your draft. Close and reopen the editor to retry.');}).finally(()=>{if(active)setLoadingDraft(false);});return()=>{active=false;};},[draftStorage]);
  async function persist(uri:string,nextName=''){if(draftStorage){const saved=await draftStorage.replace(uri,nextName);draftId.current=saved.id;setDraft(saved.uri);}else setDraft(uri);}
  async function clearDraft(){if(draftStorage&&draftId.current)await draftStorage.clear(draftId.current);draftId.current=undefined;setDraft(undefined);}

  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true);
    try { await work(); }
    catch (error) { Alert.alert('Sticker action failed', error instanceof Error ? error.message : 'Please try again.'); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = false) => <TouchableOpacity disabled={busy || disabled} accessibilityRole="button" onPress={action} accessibilityLabel={label} style={{ padding: 16, borderRadius: 18, backgroundColor: c.surfaceVariant, alignItems: 'center', opacity: disabled ? .45 : 1 }}><Text style={{ color: c.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  const choose = async (uri: string) => { await persist(uri); setName(''); setPendingEdits(false); setReset((value) => value + 1); };
  if(loadingDraft)return <ActivityIndicator accessibilityLabel="Restoring sticker draft" color={c.primary}/>;
  if(draftError)return <Text accessibilityRole="alert" style={{color:c.text,padding:16}}>{draftError}</Text>;
  return <ScrollView scrollEnabled={!isDragging} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 16, gap: 16 }}>
    {!draft && <>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>Little moments. Big feelings.</Text>
    <Text style={{ color: c.textSecondary }}>Turn a funny photo into your next favorite sticker. Crop, preview, then save — nothing sends automatically.</Text>
    {button('＋ Create sticker', () => { void run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      await choose(result.assets[0].uri);
    }); })}
    {button('Choose GIF / WebP file', () => { void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/gif', 'image/webp'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      choose(result.assets[0].uri);
    }); })}
    </>}
    {draft && <View style={{ gap: 12 }}>
      {draftStorage&&<Text style={{color:c.textSecondary}}>Your image, name, and applied edits are saved on this device. Reopen Create after unlocking to continue.</Text>}
      {preserveAnimation === null ? <ActivityIndicator color={c.primary} /> : preserveAnimation
        ? <Image source={{ uri: draft }} autoplay style={{ width: previewHeight, height: previewHeight, alignSelf: 'center' }} contentFit="contain" />
        : <View pointerEvents={busy ? 'none' : 'auto'}><PhotoEditor embedded preserveTransparency maxPreviewHeight={previewHeight} key={`${draft}:${reset}`} uri={draft}
            onEditingChange={setPendingEdits}
            onDraggingChange={setIsDragging}
            onClose={() => setReset((value) => value + 1)}
            onSave={(image) => { void run(async()=>{try{await persist(image.uri,name);}finally{if(draftStorage){try{const file=new File(image.uri);if(file.exists)file.delete();}catch{}}else ownedDrafts.current.add(image.uri);}}); }} /></View>}
      {preserveAnimation && <Text style={{ color: c.textSecondary }}>GIF and WebP stickers keep their original animation. Editing tools are available for still photos only.</Text>}
      <TextInput accessibilityLabel="Sticker name" placeholder="Give it a name (optional)" placeholderTextColor={c.textSecondary} value={name} onChangeText={value=>{setName(value);if(draftStorage&&draftId.current)void draftStorage.rename(draftId.current,value).catch(()=>setDraftError('Could not save the draft name. Please try again.'));}} maxLength={80} editable={!busy} style={{ color: c.text, backgroundColor: c.surfaceVariant, padding: 14, borderRadius: 14, width: '100%' }} />
      {pendingEdits && <Text style={{ color: c.textSecondary }}>Apply or discard your edits before saving the sticker.</Text>}
      {preserveAnimation !== null && button('Save sticker', () => { void run(async () => {
        if (preserveAnimation) {
          await importSticker(ownerId, draft, name.trim() || 'My animated sticker');
          await clearDraft(); onSaved(); return;
        }
        const result = await manipulateAsync(draft, [{ resize: { width: 512 } }], { format: SaveFormat.PNG });
        try {
          await importSticker(ownerId, result.uri, name.trim() || 'My photo sticker');
          await clearDraft();
          onSaved();
        } finally { if (result.uri !== draft) { const file = new File(result.uri); if (file.exists) file.delete(); } }
      }); }, pendingEdits)}
      {button('Cancel creation', () => { void run(async()=>{await clearDraft();setPendingEdits(false);}); })}
    </View>}
    {busy && <ActivityIndicator color={c.primary} />}
  </ScrollView>;
}
