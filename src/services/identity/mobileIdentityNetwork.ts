import { allowedAxons, subscribeAllowedAxons, loadAllowedAxons } from '../allowedAxons';
import { createCustodyCourier } from './custodyCourier';
import { createOwnCustodyStore } from './ownCustodyStore';
import { createCustodyService } from './custodyService';
import { createMobileCustodyStore } from './mobileCustodyStore';
import { RTCPeerConnection } from 'react-native-webrtc';
import type { AxonPeerConnection } from './rtcAxonTransport';
import Native from '../../../modules/axonic-nearby';
import { AppState, NativeModules, Platform } from 'react-native';
import { localIdentity } from './localIdentity';
import { createMobileIdentityRecordStore } from './identityRecordStore';
import { createLanIdentityRuntime, type NativeAxonLan } from './lanIdentityRuntime';
import { mobileAxonTransportSupported } from './mobileAxonTransport';
import { createInternetAxonConnector, FIRST_NEURON, BOOTSTRAP_NEURONS } from './internetAxonTransport';
import { observeIdentityForeground } from './identityForeground';
import { validAccountId } from './identityProtocol';
import { createTestMessageStore } from './testMessageStore';
import { createTestMessageQueue } from './testMessageQueue';

const testPeers = new Set<string>();
const testStore = createTestMessageStore();
const ownCustody = createOwnCustodyStore();
const clearTests = () => { testPeers.clear(); };
export function allowMobileIdentityTestPeer(account: string) {
  if (!__DEV__ || localIdentity.status().state !== 'unlocked' || !validAccountId(account)
    || account === localIdentity.status().account || testPeers.size >= 5) return false;
  testPeers.add(account); return true;
}
const testOwner = () => __DEV__ && localIdentity.status().state === 'unlocked' ? localIdentity.status().account ?? null : null;
export async function mobileIdentityTestMessages() {
  const owner = testOwner(); if (!owner) return [];
  const rows = await testStore.list(owner);
  const result = await Promise.all(rows.map(async row => {
    const saved = row.direction === 'out' ? await ownCustody.get(owner, row.id) : null;
    return { ...row, custody: saved ? (row.state === 'delivered' ? 'delivered' : saved.envelope.expires <= Date.now() ? 'expired' : saved.relay ? 'held' : 'sealed') : null };
  }));
  return testOwner() === owner ? result : [];
}
export const mobileIdentityTestInbox = async () => (await mobileIdentityTestMessages())
  .filter(r => r.direction === 'in').map(r => ({ from: r.peer, id: r.id, text: r.text }));
/** Resolves to a persisted ID, NOT a delivery receipt. Inspect the outbox state for delivery. */
export const sendMobileIdentityTestMessage = (account: string, text: string) =>
  __DEV__ && testPeers.has(account) ? active?.enqueueTestMessage(account, text) ?? Promise.resolve(null) : Promise.resolve(null);
/** Explicit development cleanup, scoped to the currently unlocked experimental identity. */
export async function clearMobileIdentityTestMessages() {
  const owner = testOwner(); if (!owner) return;
  active?.invalidateTests(); testPeers.clear(); await testStore.clear(owner); await ownCustody.clear(owner);
}

export const mobileIdentityNetworkSupported = () => __DEV__ && mobileAxonTransportSupported()
  && !!Native?.axonLanStart && !!Native?.axonLanStop && !!Native?.axonLanSnapshot && !!Native?.axonAccept && !!Native?.axonClaim;
/** One runtime owned by the development app root, independent of navigation. */
function createMobileIdentityNetwork() {
  if (!mobileIdentityNetworkSupported()) return null;
  const records = createMobileIdentityRecordStore(Date.now);
  let custody: { owner: string; service: ReturnType<typeof createCustodyService> } | null = null;
  function custodian() {
    const owner = testOwner(); if (!owner) return null;
    if (custody?.owner === owner) return custody.service;
    const next: { owner: string; service: ReturnType<typeof createCustodyService> } = { owner, service: createCustodyService({ owner, records, store: createMobileCustodyStore(owner), now: Date.now,
      current: () => custody === next && testOwner() === owner }) };
    custody = next; return next.service;
  }
  const queue = createTestMessageQueue({ store: testStore, owner: testOwner, allowed: peer => testPeers.has(peer),
    randomId: () => Native!.identityRandomBytes!(32), now: Date.now,
    send: async (peer, text, id) => {
      if (await runtime.sendTestMessage(peer, text, id)) return true;
      await courier.deposit(peer, text, id); return false;
    } });
  const runtime = createLanIdentityRuntime({ identity: localIdentity, limit: allowedAxons(), native: Native as NativeAxonLan,
    store: records, now: Date.now,
    onCustody: (raw, peer) => custodian()?.receive(peer.account, raw) ?? Promise.resolve(JSON.stringify({ status: 'rejected' })),
    onTestMessage: queue.receive,
    rtc: Platform.OS === 'android' && NativeModules.WebRTCModule?.axonicIdentityGuardVersion?.() === 1 ? {
      random: () => Native!.identityRandomBytes!(32),
      sign: (target, session, kind, sdp) => localIdentity.signSignal(target, session, kind, sdp),
      createConnection: () => {
        // Consumed by the pinned Android WebRTC patch before any data-channel observer.
        const configuration = { axonicIdentityGuard: true,
          iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
        return new RTCPeerConnection(configuration) as unknown as AxonPeerConnection;
      },
    } : undefined,
    internet: Native?.axonWssConnect ? {
      peers: [...BOOTSTRAP_NEURONS], connect: createInternetAxonConnector(
        Native as NativeAxonLan & { axonWssConnect(host: string, account: string): Promise<string> },
        () => localIdentity.status().account ?? null),
    } : undefined });
  const courier = createCustodyCourier({ owner: testOwner, allowed: peer => testPeers.has(peer), now: Date.now,
    records, own: ownCustody, messages: testStore, relays: () => runtime.custodians(), request: runtime.custodyRequest,
    seal: (record, device, id, text) => localIdentity.sealCustody(record, device, id, text),
    receive: envelope => localIdentity.receiveCustody(envelope, records, queue.receive) });
  const stopLimit = subscribeAllowedAxons(() => runtime.setLimit(allowedAxons()));
  void loadAllowedAxons().catch(() => {});
  runtime.tick();
  const stopTests = localIdentity.subscribe(() => { if (localIdentity.status().state !== 'unlocked') { custody = null; courier.invalidate(); queue.invalidate(); clearTests(); } });
  const interval = setInterval(() => { runtime.tick(); void queue.tick().catch(() => {}); void courier.tick().catch(() => {}); }, 1000);
  let sweeping = false;
  const sweep = setInterval(() => { if (sweeping) return; const service = custodian(); if (!service) return;
    sweeping = true; void service.sweep().catch(() => {}).finally(() => { sweeping = false; }); }, 60_000);
  return { snapshot: runtime.snapshot, custodyRequest: runtime.custodyRequest, enqueueTestMessage: queue.enqueue, invalidateTests() { queue.invalidate(); courier.invalidate(); },
    stop() { custody = null; clearInterval(sweep); clearInterval(interval); stopTests(); stopLimit(); courier.stop(); queue.stop(); clearTests(); runtime.stop(); } };
}
export const mobileInternetAxonsSupported = () => __DEV__ && !!Native?.axonWssConnect;
let active: ReturnType<typeof createMobileIdentityNetwork> = null;
let owners = 0;
/** Development protocol access; a held response never marks an own message delivered. */
export const requestMobileIdentityCustody = (target: string, raw: string) =>
  __DEV__ ? active?.custodyRequest(target, raw) ?? Promise.resolve(null) : Promise.resolve(null);
export const mobileIdentityNetworkSnapshot = () => active?.snapshot() ?? null;
let stopForeground: (() => void) | null = null;
export function startMobileIdentityNetwork() {
  // The account runtime exclusively owns the native LAN listener in staging.
  if (!__DEV__ || process.env.EXPO_PUBLIC_AXONIC_CHAT_IDENTITY === '1') return () => {};
  if (owners++ === 0) {
    stopForeground = observeIdentityForeground({ identity: localIdentity,
      currentState: () => AppState.currentState,
      subscribeState: fn => { const sub = AppState.addEventListener('change', fn); return () => sub.remove(); },
    });
    active = createMobileIdentityNetwork();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owners === 0) { active?.stop(); active = null; stopForeground?.(); stopForeground = null; }
  };
}

