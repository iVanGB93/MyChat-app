import {notifyAvatarChanged} from './sharedProfileStore';
import {manipulateAsync,SaveFormat} from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Files from 'expo-file-system/legacy';

const key = (account: string) => '@axonic_root_profile_v1:' + account;
export async function readProfileAvatar(account: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key(account));
  return raw ? JSON.parse(raw).avatar ?? null : null;
}
export async function storeProfileAvatar(account: string, source: string, previous: string | null) {
  const directory = Files.documentDirectory + 'root-profiles/';
  await Files.makeDirectoryAsync(directory, {intermediates: true});
  const destination = directory + account.slice(-64) + '-' + Date.now() + '.jpg';
  let thumbnail=await manipulateAsync(source,[{resize:{width:128,height:128}}],{compress:0.65,format:SaveFormat.JPEG});
  let info=await Files.getInfoAsync(thumbnail.uri);
  if(!info.exists||!info.size)throw Error('Could not prepare profile photo');
  if(info.size>16384){await Files.deleteAsync(thumbnail.uri,{idempotent:true});thumbnail=await manipulateAsync(source,[{resize:{width:96,height:96}}],{compress:0.4,format:SaveFormat.JPEG});info=await Files.getInfoAsync(thumbnail.uri);}
  if(!info.exists||!info.size||info.size>16384)throw Error('Choose a smaller profile photo');
  await Files.copyAsync({from: thumbnail.uri, to: destination});
  await Files.deleteAsync(thumbnail.uri,{idempotent:true}).catch(()=>{});
  await AsyncStorage.setItem(key(account), JSON.stringify({version: 1, avatar: destination}));
  if (previous?.startsWith(directory)) await Files.deleteAsync(previous, {idempotent: true}).catch(() => {});
  notifyAvatarChanged({owner:account,peer:account});return destination;
}

export async function clearProfileAvatar(account:string){
 const previous=await readProfileAvatar(account);await AsyncStorage.removeItem(key(account));notifyAvatarChanged({owner:account,peer:account});
 const directory=Files.documentDirectory+'root-profiles/';if(previous?.startsWith(directory))await Files.deleteAsync(previous,{idempotent:true}).catch(()=>{});
}
