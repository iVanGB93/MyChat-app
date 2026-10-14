import ScreenHeader from '../ui/ScreenHeader';
import {KeyboardAvoidingScreen,KeyboardFormScrollView} from '../ui/KeyboardForm';
import {KeyboardAwareTextInput as TextInput} from '../ui/KeyboardForm';
import React, { useState } from 'react';

import { Modal, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';


import { Ionicons } from '@expo/vector-icons';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../contexts/ThemeContext';

import {openAttachmentPreview} from '../../modules/ui/openAttachmentPreview';

import PhotoEditor from './photo-editor';



export interface PreviewItem { id: string; uri: string; name: string; kind: 'image' | 'video' | 'file'; caption?: string; width?: number; height?: number; mimeType?: string }



export default function SharePreview({ items, visible, busy, destination, onRemove, onClose, onSend, onUpdate }: {

  items: PreviewItem[]; visible: boolean; busy: boolean; destination?: string;

  onRemove: (id: string) => void; onClose: () => void; onSend: () => void;

  onUpdate: (id: string, changes: Partial<PreviewItem>) => void;

}) {

  const { colors: c } = useTheme();

  const insets = useSafeAreaInsets();

  const [pendingEdits, setPendingEdits] = useState<Record<string, boolean>>({});

  const [resets, setResets] = useState<Record<string, number>>({});

  const [draggingEditors, setDraggingEditors] = useState<Record<string, boolean>>({});

  const isDragging = items.some((item) => draggingEditors[item.id]);

  const hasPendingEdits = items.some((item) => pendingEdits[item.id]);

  return (

    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>

      <KeyboardAvoidingScreen style={{backgroundColor:c.background,paddingBottom:insets.bottom}}>

        <ScreenHeader title="Review before sending" backLabel="Cancel sharing" disabled={busy} onBack={onClose}/>

        <Text style={{ color: c.textSecondary, paddingHorizontal: 16, paddingTop:12 }}>{destination ? `To ${destination} · ` : ''}{items.length} selected</Text>

        <KeyboardFormScrollView avoidKeyboard={false} scrollEnabled={!isDragging} contentContainerStyle={{ padding: 16, gap: 16 }}>

          {items.map((item) => (

            <View key={item.id} style={{ backgroundColor: c.surface, borderColor:c.neonBorder,borderWidth:1,borderRadius: 16, padding: 12, gap: 10 }}>

              {item.kind === 'image' ? visible && <View pointerEvents={busy ? 'none' : 'auto'}>

                <PhotoEditor embedded key={`${item.id}:${item.uri}:${resets[item.id] || 0}`} uri={item.uri}

                  onDraggingChange={(active) => setDraggingEditors((values) => values[item.id] === active ? values : { ...values, [item.id]: active })}

                  onClose={() => setResets((values) => ({ ...values, [item.id]: (values[item.id] || 0) + 1 }))}

                  onEditingChange={(pending) => setPendingEdits((values) => values[item.id] === pending ? values : { ...values, [item.id]: pending })}

                  onSave={(image) => onUpdate(item.id, { ...image, name: item.name.replace(/\.[^.]+$/, '')+'.jpg', mimeType: 'image/jpeg' })} />

              </View> : <TouchableOpacity accessibilityLabel={`Preview ${item.name}`} onPress={() => {

                void openAttachmentPreview(item.uri,item.mimeType||'application/octet-stream').catch(() => Alert.alert('Preview unavailable', 'A compatible viewer is needed to preview this file.'));

              }}>

                <View style={{ height: 110, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Ionicons name={item.kind === 'video' ? 'play-circle-outline' : 'document-text-outline'} size={52} color={c.primary} /><Text style={{ color: c.textSecondary }}>Tap to preview</Text></View>

              </TouchableOpacity>}

              {item.kind === 'image' && <>

                <TextInput accessibilityLabel={`Comment for ${item.name}`} placeholder="Add a comment (optional)" placeholderTextColor={c.textSecondary}

                  value={item.caption || ''} onChangeText={(caption) => onUpdate(item.id, { caption })} editable={!busy} multiline maxLength={1600}

                  style={{ color: c.text, backgroundColor: c.surfaceVariant, padding: 12, borderRadius: 10, maxHeight: 100 }} />

              </>}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>

                <Text numberOfLines={2} style={{ flex: 1, color: c.text }}>{item.name}</Text>

                <TouchableOpacity disabled={busy} onPress={() => onRemove(item.id)} accessibilityLabel={`Remove ${item.name}`}><Ionicons name="trash-outline" size={22} color={c.error} /></TouchableOpacity>

              </View>

            </View>

          ))}

        </KeyboardFormScrollView>

        {hasPendingEdits && <Text style={{ color: c.textSecondary, paddingHorizontal: 16, paddingTop:12 }}>Finish loading or apply/discard picture edits before sending.</Text>}

        <TouchableOpacity disabled={busy || !items.length || hasPendingEdits} onPress={onSend} style={{ margin: 16, padding: 16, borderRadius: 14, alignItems: 'center', backgroundColor: c.primary, opacity: items.length && !hasPendingEdits ? 1 : 0.4 }}>

          {busy ? <ActivityIndicator color={c.textInverse} /> : <Text style={{ color: c.textInverse, fontWeight: '700' }}>Send {items.length} {items.length === 1 ? 'item' : 'items'}</Text>}

        </TouchableOpacity>

      </KeyboardAvoidingScreen>

    </Modal>

  );

}
