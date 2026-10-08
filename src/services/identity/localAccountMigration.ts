import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {localAccount} from './localAccount';
import {getCachedRooms,getMessages,getCachedRelationshipSets} from '../localMessageStore';
import {createChatIdentityPinStore} from './chatIdentityPinStore';
import {prepareLegacyHistoryArchive,type LegacyHistoryArchive} from './legacyHistoryArchive';
import {localRootChat} from './localRootChat';
const SOURCE='@axonic_local_migration_source_v1';
/** Retains legacy sessions and history; the target archive cannot send old outbox rows. */
export async function existingLocalIdentity(){
 const raw=await AsyncStorage.getItem('@axonic_user_cache');if(!raw)return null;
 const user=JSON.parse(raw);if(!Number.isSafeInteger(user.id)||user.id<1)return null;
 const vault=await AsyncStorage.getItem('@axonic_chat_identity_'+user.id+'_v1');if(!vault)return null;
 return {owner:user.id,name:String(user.display_name||user.username||'').slice(0,80)};
}
export async function stageExistingLocalIdentity(owner:number){
 const current=await existingLocalIdentity();if(current?.owner!==owner)throw Error('The existing account changed');
 const key='axonic_chat_identity_'+owner+'_v1';
 const [vault,secret,password]=await Promise.all([AsyncStorage.getItem('@'+key),SecureStore.getItemAsync(key+'_device'),SecureStore.getItemAsync(key+'_unlock')]);
 if(!vault||!secret||!password)throw Error('Existing identity protection is missing. Nothing was replaced.');
 const words=await localAccount.beginImport(vault,password,secret);
 // beginImport authenticated this exact vault before recording its public provenance.
 try{await AsyncStorage.setItem(SOURCE,JSON.stringify({version:1,owner,account:JSON.parse(vault).record.account}));}
 catch(error){localAccount.lock();throw error;}
 return words;
}

let archiving:Promise<LegacyHistoryArchive|null>|undefined;
export function archiveExistingLocalHistory():Promise<LegacyHistoryArchive|null>{
 if(archiving)return archiving;
 archiving=archive().finally(()=>{archiving=undefined;});return archiving;
}
/** Apply saved blocks before accepting or sending any root-addressed chat. */
export async function prepareLocalChatMigration(){
 const account=localAccount.status().account;
 const current=()=>localAccount.status().state==='unlocked'&&localAccount.status().account===account;
 const raw=await AsyncStorage.getItem(SOURCE);
 if(!current())throw Error('Unlock your account first');
 if(!raw)return;
 const source=JSON.parse(raw);if(source.account!==account)return;
 if(source.version!==1||!Number.isSafeInteger(source.owner)||source.owner<1)throw Error('Invalid relationship migration owner');
 const ledger=localRootChat(),marker='legacy:'+source.owner;
 if((await ledger.snapshot()).imports?.includes(marker))return;
 const sets=await getCachedRelationshipSets(source.owner),pins=createChatIdentityPinStore(source.owner);
 const contacts=[];
 for(const id of new Set([...sets.contactIds,...sets.blockedIds])){
  const peer=await pins.read(id);if(!current())throw Error('Relationship migration interrupted');
  if(peer)contacts.push({account:peer,alias:'',blocked:sets.blockedIds.includes(id),accepted:sets.contactIds.includes(id)});
 }
 if(!current())throw Error('Relationship migration interrupted');
 await ledger.importRelationships(marker,contacts);
}
async function archive():Promise<LegacyHistoryArchive|null>{
 const account=localAccount.status().account;
 const current=()=>localAccount.status().state==='unlocked'&&localAccount.status().account===account;
 const check=()=>{if(!current())throw Error('Unlock your account to read existing history');};
 check();const raw=await AsyncStorage.getItem(SOURCE);check();if(!raw)return null;
 const source=JSON.parse(raw);
 if(source.version!==1||!Number.isSafeInteger(source.owner)||source.owner<1)throw Error('Invalid history migration record');
 if(source.account!==account)return null; // New/restored unrelated identities cannot inherit another user's archive.
 const key='@axonic_legacy_history_v1:'+account;
 const existing=await AsyncStorage.getItem(key);check();
 if(existing){const saved=JSON.parse(existing) as LegacyHistoryArchive;
  if(saved.version!==1||saved.owner!==source.owner||saved.account!==account||!Array.isArray(saved.rooms))throw Error('Saved history needs recovery');
  return saved;
 }
 const pins=createChatIdentityPinStore(source.owner);
 const saved=await prepareLegacyHistoryArchive({owner:source.owner,account:account!,current,
  rooms:()=>getCachedRooms(source.owner,true),messages:getMessages,pin:peer=>pins.read(peer)});
 const encoded=JSON.stringify(saved);
 if(new TextEncoder().encode(encoded).length>20*1024*1024)throw Error('History needs a larger archive. Your original data is unchanged.');
 check();await AsyncStorage.setItem(key,encoded);check();return saved;
}
