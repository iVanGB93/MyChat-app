import { mobileIdentityNetworkSnapshot, mobileIdentityTestMessages } from '../../services/identity/mobileIdentityNetwork';
import AxonLimitSetting from '../../components/AxonLimitSetting';
import React, { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAppStore } from '../../store/appStore';
import { mailboxSessionStatus } from '../../services/mailboxComposition';
import { MAILBOX_ENABLED } from '../../services/transports/p2pTextBridge';
import { networkOverview } from '../../services/networkOverview';
import NeuronSettings from '../../components/NeuronSettings';
import IdentityPreview from '../../components/identity-preview';

export default function NetworkScreen() {
  const { colors } = useTheme(), insets = useSafeAreaInsets();
  const user = useAppStore(s => s.user?.id ?? null);
  const lifecycle = useAppStore(s => s.appLifecycle), net = useAppStore(s => s.net);
  const [delivery, setDelivery] = useState({ queued: 0, held: 0, delivered: 0, expired: 0 });
  const [axonSnapshot, setAxonSnapshot] = useState(mobileIdentityNetworkSnapshot);
  const [session, setSession] = useState(mailboxSessionStatus);
  useFocusEffect(useCallback(() => {
    let active = true;
    const refresh = () => {
      setSession(mailboxSessionStatus());
      if (__DEV__) {
        setAxonSnapshot(mobileIdentityNetworkSnapshot());
        void mobileIdentityTestMessages().then(rows => {
          if (!active) return;
          const outgoing = rows.filter(r => r.direction === 'out');
          setDelivery({ queued: outgoing.filter(r => r.state === 'pending' && r.custody !== 'held' && r.custody !== 'expired').length,
            held: outgoing.filter(r => r.state === 'pending' && r.custody === 'held').length,
            delivered: outgoing.filter(r => r.state === 'delivered').length,
            expired: outgoing.filter(r => r.state === 'pending' && r.custody === 'expired').length });
        }).catch(() => {});
      }
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [user]));
  const overview = networkOverview({ user, lifecycle, online: net !== 'offline', enabled: MAILBOX_ENABLED, session });
  const text = { color: colors.textSecondary, fontSize: 15, lineHeight: 23 };
  const card = [styles.card, { backgroundColor: colors.card, borderColor: colors.border }];
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 24 }}>
    <AxonLimitSetting />
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Your neuron</Text>
    <Text style={text}>Your app is one neuron in Axonic. Connections between apps form the network.</Text>
    {__DEV__ && <View style={card}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Identity network</Text>
      <Text style={text}>Connected axons: {axonSnapshot?.pool?.connections.filter(c => c.state === 'connected').length ?? 0}</Text>
      <Text style={text}>Queued: {delivery.queued} · Held by a neuron: {delivery.held}</Text>
      <Text style={text}>Delivered: {delivery.delivered} · Relay storage expired: {delivery.expired}</Text>
      <Text style={[text, styles.note]}>Development messages only. Held means a neuron saved the encrypted message; delivered means the recipient confirmed saving it.</Text>
    </View>}
    <View style={card}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Hosted connection</Text>
      <Text style={text}>{overview.state}</Text>
      <Text style={text}>Introduced peers: {overview.introducedPeers}</Text>
      <Text style={text}>Direct delivery confirmations this session: {overview.directDelivered}</Text>
      <Text style={[text, styles.note]}>Introduced peers may be offline. These numbers describe this app’s current session, not the whole network.</Text>
      {!!overview.error && <Text accessibilityRole="alert" style={{ color: colors.error }}>{overview.error}</Text>}
    </View>
    <View style={card}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>How participation works today</Text>
      <Text style={text}>This early version uses a configured hosted peer to find contacts and hold encrypted messages temporarily. Participation pauses in the background.</Text>
      <Text style={[text, styles.note]}>FirstNeuron is one hosted participant. Automatic connections to other neurons, including people outside your contacts, are still being added.</Text>
    </View>
    <NeuronSettings />
    {__DEV__ && <IdentityPreview />}
  </ScrollView>;
}
const styles = StyleSheet.create({
  title: { fontSize: 27, fontWeight: '700', marginBottom: 8 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  card: { padding: 18, borderWidth: 1, borderRadius: 16, marginTop: 18, gap: 6 },
  note: { marginTop: 8 },
});
