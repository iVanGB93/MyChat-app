import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import { createLocalIdentityController } from './localIdentityController';
import { createLocalAccountBiometrics } from './localAccountBiometrics';
const VAULT = '@axonic_local_account_v1';
const DEVICE = 'axonic_local_account_device_v1';
const BIOMETRIC = 'axonic_local_account_biometric_v1';
const biometricOptions = { keychainService: 'axonic-local-biometric-v1', requireAuthentication: true,
  authenticationPrompt: 'Unlock your Axonic account', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const localAccount = createLocalIdentityController({
  readVault: () => AsyncStorage.getItem(VAULT), writeVault: value => AsyncStorage.setItem(VAULT, value),
  readDeviceSecret: () => SecureStore.getItemAsync(DEVICE),
  writeDeviceSecret: value => SecureStore.setItemAsync(DEVICE, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
}, async size => {
  if (!Native?.identityRandomBytes) throw Error('This build needs the secure identity module');
  return hexToBytes(await Native.identityRandomBytes(size));
}, Date.now, async (password, salt) => {
  if (!Native?.identityScrypt) throw Error('This build needs the secure identity module');
  const result = await Native.identityScrypt(password, bytesToHex(salt));
  if (!/^[0-9a-f]{64}$/.test(result)) throw Error('Password derivation unavailable');
  return hexToBytes(result);
});
export const localAccountBiometrics = createLocalAccountBiometrics({ identity: localAccount,
  available: () => SecureStore.canUseBiometricAuthentication(),
  read: () => SecureStore.getItemAsync(BIOMETRIC, biometricOptions),
  write: password => SecureStore.setItemAsync(BIOMETRIC, password, biometricOptions),
  remove: () => SecureStore.deleteItemAsync(BIOMETRIC, { keychainService: biometricOptions.keychainService }),
});
export const localAccountName = {
  read: () => AsyncStorage.getItem('@axonic_local_account_name_v1'),
  write: (name: string) => AsyncStorage.setItem('@axonic_local_account_name_v1', name.trim().slice(0, 80)),
};
