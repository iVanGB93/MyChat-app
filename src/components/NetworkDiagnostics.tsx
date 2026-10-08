import React, {useState} from 'react';
import {Modal, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import IdentityLookup from './IdentityLookup';

export default function NetworkDiagnostics({lookup}: Pick<React.ComponentProps<typeof IdentityLookup>, 'lookup'>) {
  const [open, setOpen] = useState(false);
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Advanced diagnostics" onPress={() => setOpen(true)} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, marginTop: 18, borderWidth: 1, borderRadius: 16, borderColor: colors.border, backgroundColor: colors.card}}>
      <Text style={{flex: 1, color: colors.text, fontSize: 16}}>Advanced diagnostics</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary}/>
    </TouchableOpacity>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{flex: 1, backgroundColor: colors.background, paddingTop: insets.top}}>
        <View style={{flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16, backgroundColor: colors.headerBg}}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Network" onPress={() => setOpen(false)} hitSlop={8}>
            <Ionicons name="arrow-back" size={26} color={colors.headerText}/>
          </TouchableOpacity>
          <Text accessibilityRole="header" style={{flex: 1, color: colors.headerText, fontSize: 18, fontWeight: '600'}}>Advanced diagnostics</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 18, paddingBottom: insets.bottom + 24}}>
          {open && <IdentityLookup lookup={lookup} color={colors.text} muted={colors.textSecondary} border={colors.border}/>}
        </ScrollView>
      </View>
    </Modal>
  </>;
}
