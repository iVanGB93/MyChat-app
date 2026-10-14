import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, hexToBytes, utf8ToBytes} from '@noble/hashes/utils.js';
import type {PasswordDerivation} from './identityVault';

type Saved = {version:1;salt:string;key:string};
/** Only the OS-protected remembered-login credential may persist this value.
 * Explicit password unlocks always run the KDF. Vault AEAD/device binding and
 * identity validation still run on every resumed unlock.
 */
export function createRememberedDerivation(native:PasswordDerivation){
 let active:{password:string;saved:Saved}|null=null;
 let latest:{binding:string;salt:string;key:Uint8Array}|null=null,epoch=0,scoped=false;
 const binding=(password:string)=>bytesToHex(sha256(utf8ToBytes(password)));
 const clear=()=>{epoch++;latest?.key.fill(0);latest=null;active=null;};
 const derive:PasswordDerivation=async(password,salt)=>{
  const own=epoch,saltHex=bytesToHex(salt);
  const key=active?.password===password&&active.saved.salt===saltHex
   ?hexToBytes(active.saved.key):await native(password,salt);
  if(key.length!==32){key.fill(0);throw Error('Password derivation unavailable');}
  if(own===epoch){latest?.key.fill(0);latest={binding:binding(password),salt:saltHex,key:key.slice()};}
  return key;
 };
 return {derive,clear,
  export(password:string):Saved|undefined{
   if(!latest||latest.binding!==binding(password))return undefined;
   return {version:1,salt:latest.salt,key:bytesToHex(latest.key)};
  },
  async withSaved<T>(password:string,value:unknown,work:()=>Promise<T>):Promise<T>{
   if(scoped)throw Error('An account recovery is already running');
   scoped=true;
   const saved=value as Partial<Saved>|null;
   if(saved?.version===1&&typeof saved.salt==='string'&&/^[0-9a-f]{64}$/.test(saved.salt)&&typeof saved.key==='string'&&/^[0-9a-f]{64}$/.test(saved.key))
    active={password,saved:saved as Saved};
   try{return await work();}catch(error){clear();throw error;}
   finally{active=null;scoped=false;}
  },
 };
}
