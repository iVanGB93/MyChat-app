import AsyncStorage from '@react-native-async-storage/async-storage';
import {fromByteArray} from 'base64-js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {receiveProfilePart,receiveProfileOffer,type ProfileManifest,type ProfilePart,type ProfileCache} from '../../services/identity/rootProfileProtocol';
import {validAccountId} from '../../services/identity/identityProtocol';
const listeners=new Set<()=>void>();
export function notifyAvatarChanged(){for(const listener of listeners)listener();}
export function subscribeSharedAvatars(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
function key(owner:string,peer:string){if(!validAccountId(owner)||!validAccountId(peer))throw Error('Invalid profile identity');return '@axonic_shared_avatar_v1:'+owner+':'+peer;}
async function read(owner:string,peer:string):Promise<ProfileCache>{const raw=await AsyncStorage.getItem(key(owner,peer));return raw?JSON.parse(raw):{};}
export async function readSharedAvatar(owner:string,peer:string){const p=(await read(owner,peer)).current;return p?.data?'data:image/jpeg;base64,'+fromByteArray(hexToBytes(p.data)):null;}
export async function sharedAvatarHash(owner:string,peer:string){return (await read(owner,peer)).current?.manifest.hash??null;}
export async function storeSharedAvatarOffer(owner:string,peer:string,manifest:ProfileManifest,current:()=>boolean){
 if(!current())return null;const before=await read(owner,peer);if(!current())return null;
 const next=receiveProfileOffer(before,peer,manifest,Date.now());if(!next)return null;
 if(JSON.stringify(next)!==JSON.stringify(before)){if(!current())return null;await AsyncStorage.setItem(key(owner,peer),JSON.stringify(next));if(next.current?.manifest.hash!==before.current?.manifest.hash)notifyAvatarChanged();}
 return current()?{known:next.current?.manifest.hash??null,needed:next.pending?.manifest.revision===manifest.revision&&next.current?.manifest.hash!==manifest.hash}:null;
}
export async function storeSharedAvatarPart(owner:string,peer:string,id:string,part:ProfilePart,current:()=>boolean){
 if(!current())return false;const before=await read(owner,peer);if(!current())return false;
 const next=receiveProfilePart(before,peer,owner,id,part,Date.now());if(!next)return false;if(next===before)return true;
 if(!current())return false;await AsyncStorage.setItem(key(owner,peer),JSON.stringify(next));
 if(next.current?.manifest.hash!==before.current?.manifest.hash)notifyAvatarChanged();
 return current();
}
