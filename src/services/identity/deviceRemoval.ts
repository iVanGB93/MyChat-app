import {validAccountId} from './identityProtocol';
export const DEVICE_REMOVAL_KEY='@axonic_device_removal_v1';
export function removalAccount(raw:string):string {
 let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('Invalid device removal journal');}
 const v=value as {version:number;account:string};
 if(!v||Object.keys(v).sort().join(',')!=='account,version'||v.version!==1||!validAccountId(v.account))throw Error('Invalid device removal journal');
 return v.account;
}
/** Commit intent while authenticated; purge only before any account starts in a new process.
 * The journal is removed last, so failures retry without exposing a partly erased account.
 */
export function createDeviceRemoval(d:{read():Promise<string|null>;write(raw:string):Promise<void>;clear():Promise<void>;vaultAccount():Promise<string|null>;purge(account:string):Promise<void>}){
 let started=false,pending:Promise<void>|null=null;
 return {
  async request(account:string){if(!validAccountId(account))throw Error('Invalid removal account');started=true;
   const existing=await d.read();if(existing&&removalAccount(existing)!==account)throw Error('Another removal is pending');
   await d.write(JSON.stringify({version:1,account}));
  },
  async assertAvailable(){if(await d.read())throw Error('Close and reopen Axonic to finish removing this account');},
  beforeStartup(){if(pending)return pending;
   pending=(async()=>{const raw=await d.read();if(!raw){started=true;return;}if(started)throw Error('Close and reopen Axonic to finish removing this account');
    const account=removalAccount(raw),vault=await d.vaultAccount();if(vault&&vault!==account)throw Error('Removal account does not match this installation');
    await d.purge(account);await d.clear();started=true;
   })().finally(()=>{pending=null;});return pending;
  },
 };
}
const ownPrefixes=['@axonic_group_outbox_v1:','@axonic_known_neurons_v1:','@axonic_root_chat_v1:','@axonic_root_profile_v1:','@axonic_local_username_v1:','@axonic_attachment_selections_v1:','@axonic_received_exports_v1:','@axonic_sticker_draft_v1:','@axonic_root_notifications_v1:','@axonic_root_notice_actions_v1:'];
export function deviceRemovalKeys(keys:readonly string[],account:string){
 if(!validAccountId(account))throw Error('Invalid removal account');
 const exact=new Set([...ownPrefixes.map(p=>p+account),'@axonic_stickers:v1:root-'+account.slice(9),'@axonic_imported_stickers:v1:root-'+account.slice(9),
 '@axonic_auto_lock_v1','@axonic_local_account_name_v1','@axonic_root_call_wake_owner_v1','@axonic_root_notification_open_v1']);
 return keys.filter(k=>exact.has(k)||k.startsWith('@axonic_root_draft:'+account+':'));
}
export const deviceRemovalTables=[
 ['axonic_group_custody_v1.db','group_custody','owner'],
 ['axonic_own_attachment_jobs_v1.db','jobs','owner'],['axonic_own_attachment_jobs_v1.db','finished_jobs','owner'],
 ['axonic_call_control_v1.db','call_journal','owner'],['axonic_call_control_v1.db','call_history','owner'],
 ['axonic_own_custody_v1.db','own_custody','owner'],['axonic_custody_v1.db','custody','owner'],
 ['axonic_attachment_custody_v1.db','assets','owner'],['axonic_attachment_custody_v1.db','asset_chunks','owner'],
 ['axonic_root_call_wakes_v1.db','wakes','owner'],['axonic_root_message_wakes_v1.db','notices','owner'],
 ['axonic_identity_records_v1.db','identity_records','account'],
] as const;
