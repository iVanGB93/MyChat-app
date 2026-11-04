import {t} from '../../localization/language';
import {Chrome} from '../../theme';
import {Ionicons} from '@expo/vector-icons';
import type {StickerDraftStorage} from '../../services/sticker-draft-store';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { loadStickerPreferences, STICKERS, updateStickerPreferences, type Sticker, type StickerPreferences } from '../../services/stickers';
import StickerArt from './sticker-art';
import StickerStudio from './sticker-studio';
import type { ImportedSticker } from '../../services/imported-stickers';
import { loadImportedStickers, importedStickerUri, markImportedStickerSent, removeImportedSticker } from '../../services/imported-stickers';
import { Image } from 'expo-image';
import { stickerGridCellWidth } from '../../utils/sticker-grid';

export default function StickerPicker({ ownerId, onClose, onSend, onSendImported, initialUri, allowCreate = true, draftStorage }: {
  initialUri?: string; allowCreate?: boolean; draftStorage?: StickerDraftStorage;
  ownerId: number | string; onClose: () => void; onSend: (sticker: Sticker) => Promise<void>;
  onSendImported: (sticker: ImportedSticker) => Promise<void>;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const sheetWidth=Math.min(width,640);
  const [gridWidth,setGridWidth]=useState(sheetWidth-2);
  const cellWidth = stickerGridCellWidth(Math.min(gridWidth,sheetWidth-2));
  const [tab, setTab] = useState(initialUri ? 'Create' : 'All');
  const tabChosen = useRef(!!initialUri);
  const [prefs, setPrefs] = useState<StickerPreferences>({ recent: [], favorites: [] });
  const [selected, setSelected] = useState<Sticker>();
  const [customStickers, setCustomStickers] = useState<ImportedSticker[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<ImportedSticker>();
  useEffect(() => { let active = true; loadImportedStickers(ownerId).then((rows) => { if (active) setCustomStickers(rows); }).catch(() => Alert.alert(t("Storage unavailable"), t("Your stickers could not be loaded."))); return () => { active = false; }; }, [ownerId, tab]);
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
    }).catch(() => Alert.alert(t("Storage unavailable"), t("Recent stickers and favorites could not be loaded.")));
    return () => { active = false; };
  }, [ownerId]);
  const ids = tab === 'Recent' ? prefs.recent : prefs.favorites;
  const stickers = tab === 'All' || tab === 'Axonic' ? [...STICKERS] : ids.flatMap((id) => STICKERS.filter((s) => s.id === id));
  const customVisible = tab === 'All' ? customStickers : tab === 'Favorites' ? customStickers.filter((s) => s.favorite) : tab === 'Recent' ? customStickers.filter((s) => Number.isFinite(s.lastSentAt) && s.lastSentAt! > 0).sort((a, b) => b.lastSentAt! - a.lastSentAt!).slice(0, 24) : [];
  const close=()=>{if(!sending.current)onClose();};
  return <Modal visible transparent statusBarTranslucent animationType="slide" onRequestClose={close}>
    <View style={{flex:1,justifyContent:'flex-end',alignItems:'center'}}>
    <Pressable accessibilityRole="button" accessibilityLabel={t("Close stickers")} disabled={busy} onPress={close} style={{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'rgba(0,0,0,0.35)'}}/>
    <View accessibilityViewIsModal style={{width:sheetWidth,height:Math.min(height*0.78,height-insets.top-16),backgroundColor:c.background,borderTopLeftRadius:28,borderTopRightRadius:28,borderWidth:1,borderBottomWidth:0,borderColor:c.neonBorder,overflow:'hidden',paddingBottom:Math.max(insets.bottom,12)}}>
      <View style={{alignItems:'center',paddingTop:10}}><View style={{width:36,height:4,borderRadius:2,backgroundColor:c.textTertiary,opacity:0.5}}/></View>
      <View style={{flexDirection:'row',alignItems:'center',paddingLeft:20,paddingRight:8,paddingVertical:4}}>
        <Text accessibilityRole="header" style={{flex:1,color:c.primary,fontSize:22,fontWeight:'700'}}>{t("Stickers")}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Close stickers")} disabled={busy} onPress={close} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={24} color={c.primary}/></TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,flexShrink:0}} contentContainerStyle={{paddingHorizontal:16,paddingBottom:8,gap:8}}>
        {['All', 'Axonic', 'Recent', 'Favorites', 'Create'].filter(name => allowCreate || name !== 'Create').map((name) => <TouchableOpacity disabled={busy} key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => { tabChosen.current = true; setSelected(undefined); setSelectedCustom(undefined); setTab(name); }} style={{ padding: 12, borderRadius: 20, backgroundColor: tab === name ? c.primary : c.surface }}><Text style={{ color: tab === name ? c.textInverse : c.text }}>{name}</Text></TouchableOpacity>)}
      </ScrollView>
      {tab === 'Create' ? <StickerStudio draftStorage={draftStorage} ownerId={ownerId} initialUri={initialUri} onBusy={(value) => { sending.current = value; setBusy(value); }} onSaved={() => setTab('All')} /> : <>
      <ScrollView onLayout={event=>setGridWidth(event.nativeEvent.layout.width)} contentContainerStyle={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {!stickers.length && !customVisible.length && <Text style={{ color: c.textSecondary }}>{tab === 'Recent' ? t("Your sent stickers will appear here.") : t("Choose a sticker and tap Add to favorites.")}</Text>}
        {customVisible.map((sticker) => <TouchableOpacity key={sticker.id} accessibilityLabel={`Preview ${sticker.name}`} onPress={() => { setSelected(undefined); setSelectedCustom(sticker); }} style={{ width: cellWidth, alignItems: 'center', paddingVertical: 4 }}><Image source={{ uri: importedStickerUri(ownerId, sticker) }} contentFit="contain" style={{ width: Math.min(110, cellWidth), height: Math.min(110, cellWidth) }} /></TouchableOpacity>)}
        {stickers.map((sticker) => <TouchableOpacity key={sticker.id} accessibilityLabel={t("Preview {0} sticker",{0:sticker.label})} accessibilityState={{ selected: selected?.id === sticker.id }} onPress={() => { setSelectedCustom(undefined); setSelected(sticker); }} style={{ width: cellWidth, alignItems: 'center', paddingVertical: 4 }}>
          <StickerArt sticker={sticker} size={Math.min(110, cellWidth)} animate loop />
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: selected?.id === sticker.id ? c.primary : 'transparent' }} />
        </TouchableOpacity>)}
      </ScrollView>
      {selectedCustom && <View style={{ alignItems: 'center', padding: 12, gap: 8 }}>
        <Image source={{ uri: importedStickerUri(ownerId, selectedCustom) }} style={{ width: 140, height: 140 }} contentFit="contain" />
        <TouchableOpacity disabled={busy} accessibilityLabel={t("Send sticker")} style={{ padding: 16, backgroundColor: c.primary, borderRadius: Chrome.controlRadius, alignSelf: 'stretch', alignItems: 'center' }} onPress={async () => {
          if (sending.current) return;
          sending.current = true; setBusy(true);
          try {
            await onSendImported(selectedCustom);
            try { await markImportedStickerSent(ownerId, selectedCustom.id); }
            catch { Alert.alert(t("Sticker queued"), t("Could not save it to Recent on this phone.")); }
            onClose();
          }
          catch { Alert.alert(t("Could not send sticker"), t("Please try again.")); }
          finally { sending.current = false; setBusy(false); }
        }}><Text style={{ color: c.textInverse }}>{busy ? t("Sending…") : t("Send sticker")}</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} style={{ padding: 12 }} onPress={() => Alert.alert(t("Remove sticker?"), t("Copies already sent in chats will remain."), [{ text: t("Cancel"), style: 'cancel' }, { text: t("Remove"), style: 'destructive', onPress: () => { void removeImportedSticker(ownerId, selectedCustom).then((rows) => { setCustomStickers(rows); setSelectedCustom(undefined); }).catch(() => Alert.alert(t("Could not remove sticker"), t("Please try again."))); } }])}><Text style={{ color: c.error }}>{t("Remove from collection")}</Text></TouchableOpacity>
      </View>}
      {selected && <View style={{ alignItems: 'center', padding: 12, gap: 8 }}>
        <StickerArt sticker={selected} size={140} animate loop />
        <TouchableOpacity disabled={busy} style={{ padding: 12 }} onPress={() => { void updateStickerPreferences(ownerId, selected.id, 'favorite').then(setPrefs).catch(() => Alert.alert(t("Could not save favorite"), t("Please try again."))); }}><Text style={{ color: c.primary }}>{prefs.favorites.includes(selected.id) ? '★ Remove from favorites' : '☆ Add to favorites'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={busy} accessibilityLabel={t("Send sticker")} style={{ backgroundColor: c.primary, padding: 16, borderRadius: Chrome.controlRadius, alignSelf: 'stretch', alignItems: 'center' }} onPress={async () => {
          if (sending.current) return;
          sending.current = true; setBusy(true);
          try { await onSend(selected); }
          catch { Alert.alert(t("Could not send sticker"), t("The sticker was not queued. Please try again.")); sending.current = false; setBusy(false); return; }
          // A preference write failure must never invite resending an already queued message.
          try { await updateStickerPreferences(ownerId, selected.id, 'recent'); }
          catch { Alert.alert(t("Sticker queued"), t("Could not save it to Recent on this phone.")); }
          onClose();
        }}>{busy ? <ActivityIndicator color={c.textInverse} /> : <Text style={{ color: c.textInverse, fontWeight: '700' }}>{t("Send sticker")}</Text>}</TouchableOpacity>
      </View>}
      </>}
    </View>
    </View>
  </Modal>;
}
