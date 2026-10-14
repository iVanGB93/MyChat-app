import RecoverySettings from './RecoverySettings';
import ScreenHeader from './ui/ScreenHeader';
import {KeyboardFormScrollView} from './ui/KeyboardForm';
import React, {useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
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
      <View style={{flex: 1, backgroundColor: colors.background}}>
        <ScreenHeader title="Advanced diagnostics" backLabel="Back to Network" onBack={()=>setOpen(false)}/>
        <KeyboardFormScrollView contentContainerStyle={{padding: 18, paddingBottom: insets.bottom + 24}}>
          {open && <RecoverySettings/>}
          {open && <IdentityLookup lookup={lookup} color={colors.text} muted={colors.textSecondary} border={colors.border}/>}
        </KeyboardFormScrollView>
      </View>
    </Modal>
  </>;
}
