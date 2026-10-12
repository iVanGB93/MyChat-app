import * as Files from 'expo-file-system/legacy';
import {toByteArray} from 'base64-js';
import {localAccount} from '../../services/identity/localAccount';
import {localRootChat} from '../../services/identity/localRootChat';
import {storeProfileAvatar,readProfileAvatar,clearProfileAvatar} from '../storage/profileStore';

/** UI submits a photo; the durable outbox owns its distribution. */
export async function updateSharedProfileAvatar(account:string,source:string,previous:string|null){
 const current=()=>localAccount.status().state==='unlocked'&&localAccount.status().account===account;
 if(!current())throw Error('Unlock your account first');
 const uri=await storeProfileAvatar(account,source,previous);if(!current())throw Error('Account changed');
 const data=toByteArray(await Files.readAsStringAsync(uri,{encoding:Files.EncodingType.Base64}));
 const state=await localRootChat().snapshot();if(!current())throw Error('Account changed');
 const revision=Math.max(Date.now(),(state.ownProfile?.manifest.revision??0)+1);
 await localRootChat().publishProfile(localAccount.signProfile(data,revision));return uri;
}
export async function removeSharedProfileAvatar(account:string){
 if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)throw Error('Unlock your account first');
 const state=await localRootChat().snapshot();if(localAccount.status().state!=='unlocked'||localAccount.status().account!==account)throw Error('Account changed');await localRootChat().publishProfile(localAccount.signProfile(new Uint8Array(),Math.max(Date.now(),(state.ownProfile?.manifest.revision??0)+1)));await clearProfileAvatar(account);
}

let migrating=false;const migrated=new Set<string>();
export async function migrateSharedProfileAvatar(){
 const account=localAccount.status().account;if(migrating||!account||localAccount.status().state!=='unlocked'||migrated.has(account))return;migrating=true;
 try{const s=await localRootChat().snapshot();if(!s.ownProfile){const source=await readProfileAvatar(account);if(source)await updateSharedProfileAvatar(account,source,source);}if(localAccount.status().account===account)migrated.add(account);}
 finally{migrating=false;}
}
