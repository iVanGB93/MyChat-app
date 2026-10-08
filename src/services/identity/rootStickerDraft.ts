import AsyncStorage from '@react-native-async-storage/async-storage';
import {Directory,File,Paths} from 'expo-file-system';
import {localAccount} from './localAccount';
import {validAccountId} from './identityProtocol';
import {createStickerDraftStore,type StickerDraft} from '../sticker-draft-store';

let sequence=0;
const stores=new Map<string,ReturnType<typeof createStickerDraftStore>>();
export function rootStickerDraft(owner:string){
 if(!validAccountId(owner))throw Error('Invalid sticker account');
 const existing=stores.get(owner);if(existing)return existing;
 const directory=new Directory(Paths.document,'axonic-sticker-drafts-v1',owner.slice(9)),key='@axonic_sticker_draft_v1:'+owner;
 const file=(id:string)=>{if(!/^[a-z0-9-]{1,64}$/.test(id))throw Error('Invalid sticker draft');return new File(directory,id);};
 const store=createStickerDraftStore({
  current:()=>localAccount.status().account===owner,
  read:async()=>{const raw=await AsyncStorage.getItem(key);if(raw===null)return null;const saved=JSON.parse(raw);
   if(typeof saved.id!=='string'||typeof saved.name!=='string'||saved.name.length>80)throw Error('Sticker draft needs recovery');
   const source=file(saved.id);if(!source.exists)throw Error('Sticker draft file unavailable');return {id:saved.id,uri:source.uri,name:saved.name};},
  write:async(value:StickerDraft|null)=>{if(value)await AsyncStorage.setItem(key,JSON.stringify({id:value.id,name:value.name}));else await AsyncStorage.removeItem(key);},
  stage:uri=>{const source=new File(uri);if(!source.exists||source.size<1||source.size>25*1024*1024)throw Error('Choose a photo smaller than 25 MiB');
   directory.create({intermediates:true,idempotent:true});let id:string,target:File;do{id=Date.now().toString(36)+'-'+(sequence++).toString(36);target=file(id);}while(target.exists);
   source.copy(target);return {id,uri:target.uri};},
  remove:draft=>{try{const source=file(draft.id);if(source.exists)source.delete();}catch{/* Only obsolete own draft copies; cleanup may retry later. */}},
 });
 stores.set(owner,store);return store;
}
