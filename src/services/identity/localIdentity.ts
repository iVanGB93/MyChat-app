import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import { createLocalIdentityController } from './localIdentityController';

const VAULT = '@axonic_identity_experiment_v1';
const SECRET = 'axonic_identity_experiment_device_secret_v1';
// A separate namespace leaves every existing login, mailbox pin, and message intact.
export const localIdentity = createLocalIdentityController({
  readVault: () => AsyncStorage.getItem(VAULT),
  writeVault: value => AsyncStorage.setItem(VAULT, value),
  readDeviceSecret: () => SecureStore.getItemAsync(SECRET),
  writeDeviceSecret: value => SecureStore.setItemAsync(SECRET, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
}, async size => {
  if (!Native?.identityRandomBytes) throw Error('A development client rebuild is required for secure identity creation');
  return hexToBytes(await Native.identityRandomBytes(size));
}, Date.now, async (password, salt) => {
  if (!Native?.identityScrypt) throw Error('An updated development client is required to unlock local identities');
  const result = await Native.identityScrypt(password, bytesToHex(salt));
  if (!/^[0-9a-f]{64}$/.test(result)) throw Error('Password derivation unavailable');
  return hexToBytes(result);
});

export const identityCreationSupported = () => !!Native?.identityRandomBytes && !!Native?.identityScrypt;
