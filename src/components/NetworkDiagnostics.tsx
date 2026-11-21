import {t} from '../localization/language';
import {Chrome} from '../theme';
import RecoverySettings from './RecoverySettings';
import RelayInventoryPanel from './RelayInventoryPanel';
import ScreenHeader from './ui/ScreenHeader';
import {KeyboardFormScrollView} from './ui/KeyboardForm';
import React, {useState} from 'react';
import {Modal, Text, TouchableOpacity, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../contexts/ThemeContext';
import IdentityLookup from './IdentityLookup';
import BootstrapSettings from './BootstrapSettings';

export default function NetworkDiagnostics({lookup}: Pick<React.ComponentProps<typeof IdentityLookup>, 'lookup'>) {
  const [open, setOpen] = useState(false);
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  return <>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("Advanced diagnostics")} onPress={() => setOpen(true)} style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, marginTop: 18, borderWidth: 1, borderRadius:Chrome.cardRadius, borderColor: colors.border, backgroundColor: colors.card}}>
      <Text style={{flex: 1, color: colors.text, fontSize: 16}}>{t("Advanced diagnostics")}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary}/>
    </TouchableOpacity>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={{flex: 1, backgroundColor: colors.background}}>
        <ScreenHeader title={t("Advanced diagnostics")} backLabel="Back to Network" onBack={()=>setOpen(false)}/>
        <KeyboardFormScrollView contentContainerStyle={{padding: 18, paddingBottom: insets.bottom + 24}}>
          {open && <BootstrapSettings/>}
          {open && <RecoverySettings/>}
          {open && <IdentityLookup lookup={lookup} color={colors.text} muted={colors.textSecondary} border={colors.border}/>}
          {open && <RelayInventoryPanel/>}
        </KeyboardFormScrollView>
      </View>
    </Modal>
  </>;
}
