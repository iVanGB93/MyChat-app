import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppStore } from '../../store/appStore';
import AxonLimitSetting from '../../components/AxonLimitSetting';
import { accountNeuronEnabled, mobileNormalChatNetworkSnapshot } from '../../services/identity/mobileNormalChatRuntime';

export default function NetworkScreen() {
  const { colors } = useTheme(), insets = useSafeAreaInsets();
  const user = useAppStore(s => s.user?.id ?? null);
  const lifecycle = useAppStore(s => s.appLifecycle);
  const [snapshot, setSnapshot] = useState(mobileNormalChatNetworkSnapshot);
  useFocusEffect(useCallback(() => {
    const refresh = () => setSnapshot(mobileNormalChatNetworkSnapshot());
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [user]));
  const connections = user && lifecycle === 'active' ? snapshot?.pool?.connections ?? [] : [];
  const connected = connections.filter(c => c.state === 'connected');
  const pending = connections.filter(c => c.state === 'authenticating').length;
  const status = !user ? 'Sign in to join' : lifecycle !== 'active' ? 'Paused'
    : !accountNeuronEnabled() ? 'Unavailable in this build'
    : connected.length ? 'Connected' : snapshot?.state === 'active' ? 'Finding neurons…' : 'Starting…';
  const text = { color: colors.textSecondary, fontSize: 15, lineHeight: 23 };
  const card = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
    <AxonLimitSetting />
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Your neuron</Text>
    <Text style={text}>Your app connects automatically to other neurons to help deliver messages.</Text>
    <View style={card}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>{status}</Text>
      <Text style={[styles.count, { color: colors.text }]}>{connected.length} active {connected.length === 1 ? 'axon' : 'axons'}</Text>
      <Text style={text}>Nearby: {connected.filter(c => c.route === 'lan').length} · Private network: {connected.filter(c => c.route === 'private').length} · Internet: {connected.filter(c => c.route === 'internet').length}</Text>
      {pending > 0 && <Text style={text}>Connecting to {pending} {pending === 1 ? 'neuron' : 'neurons'}…</Text>}
      {!!snapshot?.error && lifecycle === 'active' && !!user && <Text style={text}>{snapshot.error}</Text>}
    </View>
    <Text style={[text, styles.explanation]}>Participation pauses when the app is in the background.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  title: { fontSize: 27, fontWeight: '700', marginBottom: 8 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  count: { fontSize: 25, fontWeight: '600', marginBottom: 6 },
  card: { padding: 18, borderWidth: 1, borderRadius: 16, marginTop: 18, gap: 6 },
  explanation: { marginTop: 18 },
});
