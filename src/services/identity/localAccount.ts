import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import Native from '../../../modules/axonic-nearby';
import { createLocalIdentityController } from './localIdentityController';
import { createLocalAccountBiometrics } from './localAccountBiometrics';
import { createLocalAccountSession, createLocalAccountStartup } from './localAccountSession';
import {createDeviceRemoval,DEVICE_REMOVAL_KEY} from './deviceRemoval';
import {purgeDeviceAccountData} from './deviceRemovalStorage';
import {createRememberedDerivation} from './rememberedDerivation';
import {createNetworkWorkReset,NETWORK_WORK_RESET_KEY} from './networkWorkReset';
import {purgeNetworkWork} from './networkWorkResetStorage';
const VAULT = '@axonic_local_account_v1';
const DEVICE = 'axonic_local_account_device_v1';
const BIOMETRIC = 'axonic_local_account_biometric_v1';
const biometricOptions = { keychainService: 'axonic-local-biometric-v1', requireAuthentication: true,
  authenticationPrompt: 'Unlock your Axonic account', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const networkReset=createNetworkWorkReset({
 read:()=>AsyncStorage.getItem(NETWORK_WORK_RESET_KEY),write:raw=>AsyncStorage.setItem(NETWORK_WORK_RESET_KEY,raw),clear:()=>AsyncStorage.removeItem(NETWORK_WORK_RESET_KEY),
 vaultAccount:async()=>{const raw=await AsyncStorage.getItem(VAULT);return raw?JSON.parse(raw)?.record?.account??null:null;},purge:purgeNetworkWork,
});
export async function requestLocalNetworkReset(account:string,confirmed:true){
 const s=localAccount.status();if(confirmed!==true||s.busy||s.state!=='unlocked'||s.account!==account)throw Error('Unlock your account before resetting network work');
 await networkReset.request(account,Date.now());localAccount.lock();
}
export async function closeForNetworkReset(){
 if(!await AsyncStorage.getItem(NETWORK_WORK_RESET_KEY))throw Error('No network reset is pending');
 if(!Native?.closeForDeviceRemoval)throw Error('Use Force stop in Android app settings, then reopen Axonic to finish the network reset.');
 Native.closeForDeviceRemoval();
}
const rememberedDerivation=createRememberedDerivation(async(password,salt)=>{
  if (!Native?.identityScrypt) throw Error('This build needs the secure identity module');
  const began=Date.now();
  const result=await Native.identityScrypt(password,bytesToHex(salt));
  console.info('[Axonic account timing] password-derivation-ms',Date.now()-began);
  if(!/^[0-9a-f]{64}$/.test(result))throw Error('Password derivation unavailable');
  return hexToBytes(result);
});
const removal=createDeviceRemoval({
 read:()=>AsyncStorage.getItem(DEVICE_REMOVAL_KEY),write:raw=>AsyncStorage.setItem(DEVICE_REMOVAL_KEY,raw),clear:()=>AsyncStorage.removeItem(DEVICE_REMOVAL_KEY),
 vaultAccount:async()=>{const raw=await AsyncStorage.getItem(VAULT);if(!raw)return null;const account=JSON.parse(raw)?.record?.account;if(typeof account!=='string')throw Error('Account storage unavailable');return account;},
 purge:async account=>{
  await purgeDeviceAccountData(account);
  await SecureStore.deleteItemAsync(SESSION,sessionOptions);
  await SecureStore.deleteItemAsync(BIOMETRIC,{keychainService:biometricOptions.keychainService});
  await SecureStore.deleteItemAsync(DEVICE);
  await AsyncStorage.removeItem(VAULT);
 },
});
export const localAccount = createLocalIdentityController({
  beginRemoval:removal.request,
  readVault: async()=>{await removal.assertAvailable();await networkReset.assertAvailable();return AsyncStorage.getItem(VAULT);}, writeVault: async value=>{await removal.assertAvailable();await networkReset.assertAvailable();await AsyncStorage.setItem(VAULT,value);},
  readDeviceSecret: () => SecureStore.getItemAsync(DEVICE),
  writeDeviceSecret: value => SecureStore.setItemAsync(DEVICE, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
}, async size => {
  if (!Native?.identityRandomBytes) throw Error('This build needs the secure identity module');
  return hexToBytes(await Native.identityRandomBytes(size));
}, Date.now, rememberedDerivation.derive);
localAccount.subscribe(()=>{
 const status=localAccount.status();
 if(status.removalPending||(!status.busy&&status.state!=='unlocked'))rememberedDerivation.clear();
});
const SESSION = 'axonic_local_account_session_v1';
const sessionOptions = { keychainService: 'axonic-local-session-v1', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const localAccountSession = createLocalAccountSession({ identity: {
  status: localAccount.status, unlock: localAccount.unlock, lock: () => localAccountBiometrics.lock(),
  resume:(password,saved)=>rememberedDerivation.withSaved(password,saved,()=>localAccount.unlock(password)),
  rememberedDerivation:rememberedDerivation.export,
},
  readPolicy: () => AsyncStorage.getItem('@axonic_auto_lock_v1'),
  writePolicy: value => AsyncStorage.setItem('@axonic_auto_lock_v1', value),
  readCredential: () => SecureStore.getItemAsync(SESSION, sessionOptions),
  writeCredential: value => SecureStore.setItemAsync(SESSION, value, sessionOptions),
  removeCredential: () => SecureStore.deleteItemAsync(SESSION, sessionOptions),
});
export const localAccountBiometrics = createLocalAccountBiometrics({ identity: localAccount,
  onUnlocked: password => localAccountSession.remember(password),
  available: () => SecureStore.canUseBiometricAuthentication(),
  read: () => SecureStore.getItemAsync(BIOMETRIC, biometricOptions),
  write: password => SecureStore.setItemAsync(BIOMETRIC, password, biometricOptions),
  remove: () => SecureStore.deleteItemAsync(BIOMETRIC, { keychainService: biometricOptions.keychainService }),
});
/** Login name is separate from the editable profile nickname. */
export const localAccountUsername = {
  read: (account: string) => AsyncStorage.getItem('@axonic_local_username_v1:' + account),
  write: (account: string, username: string) => {
    const value = username.trim();
    if (!value || value.length > 80) throw Error('Choose a username between 1 and 80 characters');
    return AsyncStorage.setItem('@axonic_local_username_v1:' + account, value);
  },
};

export const startLocalAccount = createLocalAccountStartup({
 inspect:async()=>{const began=Date.now();await removal.beforeStartup();await networkReset.beforeStartup();if(!localAccount.status().account)await localAccount.inspect();console.info('[Axonic account timing] inspect-ms',Date.now()-began);},
 initialize:async()=>{const began=Date.now();await localAccountSession.initialize();console.info('[Axonic account timing] resume-ms',Date.now()-began);},
});

/** UI must show the scope and require explicit confirmation plus the current password.
 * Recovery words restore identity, not these deleted chats. Gallery exports are preserved.
 */
export async function removeAccountFromDevice(input:{account:string;password:string;confirmed:true}){
 if(input.confirmed!==true)throw Error('Confirm device-only removal first');
 await localAccount.prepareDeviceRemoval(input.password,input.account);
 return {restartRequired:true as const};
}

export async function closeForDeviceRemoval(){
 if(!localAccount.status().removalPending)throw Error('No confirmed removal is pending');
 if(!Native?.closeForDeviceRemoval)throw Error('Close Axonic using Force stop in Android app settings, then reopen it to finish removal.');
 Native.closeForDeviceRemoval();
}
