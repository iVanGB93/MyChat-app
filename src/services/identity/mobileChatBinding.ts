import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import { useAppStore } from '../../store/appStore';
import { getCachedRooms } from '../localMessageStore';
import { isNotifWsReady, sendRawNotif } from '../notificationWsManager';
import { createAccountIdentityLifecycle } from './accountIdentityLifecycle';
import { createAccountIdentityAccess } from './accountIdentityStorage';
import { createChatBindingExchange } from './chatIdentityBinding';
import { createChatBindingTransport } from './chatBindingTransport';
import { createChatIdentityPinStore } from './chatIdentityPinStore';
import { registerChatBindingHandler } from './chatBindingBridge';

// Staging only: normal chat transport and production participation remain disabled.
const enabled = () => __DEV__ && process.env.EXPO_PUBLIC_AXONIC_CHAT_IDENTITY === '1'
  && !!Native?.identityRandomBytes && !!Native?.identityScrypt;
export function startAccountChatBinding() {
  if (!enabled()) return () => {};
  const access = createAccountIdentityAccess({
    storage: owner => {
      const name = `axonic_chat_identity_${owner}_v1`;
      const read = (suffix: string) => SecureStore.getItemAsync(`${name}_${suffix}`);
      const write = (suffix: string, value: string) => SecureStore.setItemAsync(`${name}_${suffix}`, value,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      return { readVault: () => AsyncStorage.getItem(`@${name}`), writeVault: value => AsyncStorage.setItem(`@${name}`, value),
        readDeviceSecret: () => read('device'), writeDeviceSecret: value => write('device', value),
        readUnlockSecret: () => read('unlock'), writeUnlockSecret: value => write('unlock', value) };
    },
    random: async size => hexToBytes(await Native!.identityRandomBytes!(size)), now: Date.now,
    derive: async (password, salt) => {
      const result = await Native!.identityScrypt!(password, bytesToHex(salt));
      if (!/^[0-9a-f]{64}$/.test(result)) throw Error('Device protection unavailable');
      return hexToBytes(result);
    },
  });
  let refresh: (() => Promise<void>) | null = null;
  const lifecycle = createAccountIdentityLifecycle({ ...access,
    attach(owner, identity, current) {
      const pins = createChatIdentityPinStore(owner), rooms = new Map<string, number>();
      const permitted = () => current() && identity.status().state === 'unlocked'
        && useAppStore.getState().user?.id === owner && useAppStore.getState().appLifecycle === 'active';
      const authorized = (room: string, peer: number) => permitted() && rooms.get(room) === peer
        && !useAppStore.getState().blockedIds[peer];
      const exchange = createChatBindingExchange({ owner: { user: owner, account: identity.status().account! },
        current: permitted, now: Date.now, random: () => Native!.identityRandomBytes!(32), authorized,
        pin: (peer, account, guard) => pins.pin(peer, account, guard) });
      const transport = createChatBindingTransport({ owner, current: permitted, now: Date.now, authorized, exchange,
        sign: challenge => identity.signChatBinding(owner, challenge), send: sendRawNotif });
      // Only one room-cache read/operation at a time; logout invalidates pending work.
      let tail: Promise<unknown> = Promise.resolve(), lastRequest = 0;
      const run = <T>(work: () => Promise<T>) => { const p = tail.then(work); tail = p.catch(() => {}); return p; };
      async function loadRooms() {
        rooms.clear();
        const cached = await getCachedRooms(owner);
        if (!permitted()) return;
        for (const room of cached) if (room.room_type === 'direct' && room.members.length === 2 && room.members.includes(owner)) {
          const peer = room.members.find(id => id !== owner);
          if (peer) rooms.set(room.id, peer);
        }
      }
      const unregister = registerChatBindingHandler(frame => run(async () => {
        if (!permitted()) return false;
        await loadRooms(); return permitted() && transport.receive(frame);
      }));
      const poll = () => run(async () => {
        if (!permitted() || !isNotifWsReady() || Date.now() < lastRequest + 60_000) return;
        const room = useAppStore.getState().activeRoomId; if (!room) return;
        await loadRooms(); const peer = rooms.get(room);
        if (!peer || !authorized(room, peer) || await pins.read(peer) || !permitted()) return;
        lastRequest = Date.now(); await transport.request(room, peer);
      });
      refresh = poll;
      void poll().catch(() => {});
      return () => { if (refresh === poll) refresh = null; unregister(); transport.stop(); rooms.clear(); };
    },
  });
  const update = () => {
    const state = useAppStore.getState();
    lifecycle.set(state.user?.id ?? null, !state.authLoading && state.appLifecycle === 'active');
  };
  const unsubscribe = useAppStore.subscribe(update);
  update();
  const timer = setInterval(() => { void refresh?.().catch(() => {}); }, 5000);
  return () => { clearInterval(timer); unsubscribe(); lifecycle.stop(); };
}
