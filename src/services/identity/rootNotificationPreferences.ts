import AsyncStorage from '@react-native-async-storage/async-storage';
import {validAccountId} from './identityProtocol';
import {createPreferenceState} from './preferenceState';
export type RootNotificationPreferences={messages:boolean;calls:boolean;sound:boolean};
export const defaultRootNotificationPreferences:RootNotificationPreferences={messages:true,calls:true,sound:true};
async function readPreferences(account:string):Promise<RootNotificationPreferences>{
 if(!validAccountId(account))throw Error('Invalid notification account');
 const raw=await AsyncStorage.getItem('@axonic_root_notifications_v1:'+account);
 if(!raw)return {...defaultRootNotificationPreferences};
 const saved=JSON.parse(raw);
 if(saved.version!==1||['messages','calls','sound'].some(key=>typeof saved[key]!=='boolean'))throw Error('Could not read notification settings');
 return {messages:saved.messages,calls:saved.calls,sound:saved.sound};
}
async function writePreferences(account:string,value:RootNotificationPreferences){
 if(!validAccountId(account)||['messages','calls','sound'].some(key=>typeof value[key as keyof RootNotificationPreferences]!=='boolean'))throw Error('Invalid notification settings');
 await AsyncStorage.setItem('@axonic_root_notifications_v1:'+account,JSON.stringify({version:1,...value}));
}
export const notificationPreferencesState=createPreferenceState(readPreferences,writePreferences);
export const readRootNotificationPreferences=notificationPreferencesState.read;
export const saveRootNotificationPreferences=notificationPreferencesState.write;
