import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { allowedAxons, subscribeAllowedAxons, loadAllowedAxons, setAllowedAxons } from '../services/allowedAxons';
export default function AxonLimitSetting() {
  const { colors } = useTheme(), value = useSyncExternalStore(subscribeAllowedAxons, allowedAxons);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  useEffect(() => { let mounted = true; loadAllowedAxons().catch(() => { if (mounted) setError('Could not load your saved setting.'); }).finally(() => { if (mounted) setBusy(false); }); return () => { mounted = false; }; }, []);
  async function change(next: number) { setBusy(true); setError(''); try { await setAllowedAxons(next); } catch { setError('Could not save. Please try again.'); } finally { setBusy(false); } }
  return <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 20, gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Allow axons: {value}</Text>
    <Text style={{ color: colors.textSecondary }}>Maximum connections to other neurons. Choose 3–10; default 5.</Text>
    <View style={{ flexDirection: 'row', gap: 16 }}>
      {[{ label: '−', delta: -1, name: 'Allow fewer axons' }, { label: '+', delta: 1, name: 'Allow more axons' }].map(b => {
        const disabled = busy || value + b.delta < 3 || value + b.delta > 10;
        return <Pressable key={b.name} accessibilityRole="button" accessibilityLabel={b.name} accessibilityState={{ disabled }} disabled={disabled}
          onPress={() => void change(value + b.delta)} style={{ minWidth: 52, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 10, backgroundColor: colors.background, opacity: disabled ? 0.4 : 1 }}>
          <Text style={{ color: colors.text, fontSize: 24 }}>{b.label}</Text>
        </Pressable>;
      })}
    </View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text>}
  </View>;
}
