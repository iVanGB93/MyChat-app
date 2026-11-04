import {t} from '../../localization/language';
import {Ionicons} from '@expo/vector-icons';
import {Chrome} from '../../theme';
import {KeyboardAvoidingScreen, KeyboardFormScrollView} from '../ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../ui/KeyboardForm';
import type {StickerDraftStorage} from '../../services/sticker-draft-store';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
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
  const window=useWindowDimensions();
  const previewSize=Math.max(100,Math.min(220,window.width-64,window.height*0.3));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(initialUri);
  const draftId=useRef<string | undefined>(undefined);
  const [loadingDraft,setLoadingDraft]=useState(!!draftStorage);
  const [draftError,setDraftError]=useState('');
  const [preserveAnimation, setPreserveAnimation] = useState<boolean | null>(null);
  useEffect(() => {
    if (loadingDraft) return;
    let active = true;
    setPreserveAnimation(null);
    if (draft) void new File(draft).bytes().then((bytes) => {
      const head = String.fromCharCode(...bytes.slice(0, 12));
      if (active) setPreserveAnimation(head.startsWith('GIF87a') || head.startsWith('GIF89a') || (head.startsWith('RIFF') && head.slice(8) === 'WEBP'));
    }).catch(() => { if (active) Alert.alert(t("Sticker unavailable"), t("Could not read the selected image. Please choose it again.")); });
    return () => { active = false; };
  }, [draft,loadingDraft]);
  const [pendingEdits, setPendingEdits] = useState(false);
  const ownedDrafts = useRef(new Set<string>());
  useEffect(() => () => {
    // Only remove editor-generated temporary copies, never the source photo.
    for (const uri of ownedDrafts.current) {
      try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* cache cleanup can retry later */ }
    }
  }, []);
  const [name, setName] = useState('');
  useEffect(()=>{let active=true;if(draftStorage)void (initialUri?draftStorage.replace(initialUri):draftStorage.load()).then(saved=>{if(active){draftId.current=saved?.id;setDraft(saved?.uri);setName(saved?.name??'');}}).catch(()=>{if(active)setDraftError('Could not restore your draft. Close and reopen the editor to retry.');}).finally(()=>{if(active)setLoadingDraft(false);});return()=>{active=false;};},[draftStorage,initialUri]);
  async function persist(uri:string,nextName=''){if(draftStorage){const saved=await draftStorage.replace(uri,nextName);draftId.current=saved.id;setDraft(saved.uri);}else setDraft(uri);}
  async function clearDraft(){if(draftStorage&&draftId.current)await draftStorage.clear(draftId.current);draftId.current=undefined;setDraft(undefined);}

  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true);
    try { await work(); }
    catch (error) { Alert.alert(t("Sticker action failed"), error instanceof Error ? error.message : t("Please try again.")); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = false) => <TouchableOpacity disabled={busy || disabled} accessibilityRole="button" onPress={action} accessibilityLabel={label} style={{ flexGrow:1, padding: 16, borderWidth:1,borderColor:c.neonBorder,borderRadius: Chrome.controlRadius, backgroundColor: c.surfaceVariant, alignItems: 'center', opacity: disabled ? .45 : 1 }}><Text style={{ color: c.primary, fontWeight: '700' }}>{label}</Text></TouchableOpacity>;
  const choose = async (uri: string) => { await persist(uri); setName(''); setPendingEdits(false); setEditing(false); };
  if(loadingDraft)return <ActivityIndicator accessibilityLabel={t("Restoring sticker draft")} color={c.primary}/>;
  if(draftError)return <Text accessibilityRole="alert" style={{color:c.text,padding:16}}>{draftError}</Text>;
  return <KeyboardAvoidingScreen>
    {!draft ? <KeyboardFormScrollView avoidKeyboard={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
    <Text style={{ color: c.text, fontSize: 24, fontWeight: '700' }}>{t("Little moments. Big feelings.")}</Text>
    <Text style={{ color: c.textSecondary }}>{t("Turn a funny photo into your next favorite sticker. Crop, preview, then save — nothing sends automatically.")}</Text>
    {button('＋ Create sticker', () => { void run(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      await choose(result.assets[0].uri);
    }); })}
    {button(t("Choose GIF / WebP file"), () => { void run(async () => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/gif', 'image/webp'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      await choose(result.assets[0].uri);
    }); })}
    </KeyboardFormScrollView> : <View style={{flex:1,paddingHorizontal:8,paddingTop:4,gap:8}}>
      <View style={{height:previewSize+80,alignItems:'center'}}>
        {preserveAnimation === null ? <ActivityIndicator color={c.primary}/> : <Image source={{uri:draft}} autoplay={!!preserveAnimation} contentFit="contain" style={{width:previewSize,height:previewSize}}/>}
        <View style={{position:'absolute',top:8,right:8,flexDirection:'row',gap:8}}>
          {preserveAnimation===false&&<TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Edit sticker")} disabled={busy} onPress={()=>setEditing(true)} style={{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:Chrome.controlRadius,borderWidth:1,borderColor:c.neonBorder,backgroundColor:c.headerBg}}><Ionicons name="create-outline" size={24} color={c.primary}/></TouchableOpacity>}
        </View>
        <View style={{position:'absolute',bottom:8,left:8,right:8,flexDirection:'row',alignItems:'center',backgroundColor:c.inputBg,borderColor:c.neonBorder,borderWidth:1,borderRadius:Chrome.controlRadius}}>
          <TextInput accessibilityLabel={t("Sticker name")} placeholder={t("Give it a name (optional)")} placeholderTextColor={c.textSecondary} value={name} onChangeText={value=>{setName(value);if(draftStorage&&draftId.current)void draftStorage.rename(draftId.current,value).catch(()=>setDraftError('Could not save the draft name. Please try again.'));}} maxLength={80} editable={!busy} returnKeyType="done" onSubmitEditing={()=>Keyboard.dismiss()} style={{flex:1,minWidth:0,color:c.text,padding:14}}/>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Finish naming sticker")} onPress={()=>Keyboard.dismiss()} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="checkmark" size={24} color={c.primary}/></TouchableOpacity>
        </View>
      </View>
      {preserveAnimation&&<Text style={{color:c.textSecondary,paddingHorizontal:8}}>{t("Original animation preserved. Editing is available for still images.")}</Text>}
      <View style={{flexDirection:'row',gap:8,paddingHorizontal:8,paddingBottom:8}}>
      {preserveAnimation !== null && button(t("Save sticker"), () => { void run(async () => {
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
      {button(t("Cancel creation"), () => { void run(async()=>{await clearDraft();setPendingEdits(false);}); })}
      </View>
    </View>}
    {draft&&editing&&<PhotoEditor floatingTools preserveTransparency maxPreviewHeight={Math.min(300,window.height*0.4)} title={t("Edit sticker")} uri={draft}
      onEditingChange={setPendingEdits}
      onClose={()=>{setEditing(false);setPendingEdits(false);}}
      onSave={image=>{setEditing(false);void run(async()=>{try{await persist(image.uri,name);}finally{if(draftStorage){try{const file=new File(image.uri);if(file.exists)file.delete();}catch{}}else ownedDrafts.current.add(image.uri);}setPendingEdits(false);});}}/>}
    {busy && <ActivityIndicator color={c.primary} />}
  </KeyboardAvoidingScreen>;
}
