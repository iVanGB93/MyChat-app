import {validAccountId} from './identityProtocol';
export const NETWORK_WORK_RESET_KEY='@axonic_network_work_reset_v1';
export type NetworkResetIntent={version:1;account:string;at:number};
export function parseNetworkReset(raw:string):NetworkResetIntent{
 const v=JSON.parse(raw) as NetworkResetIntent;
 if(!v||Object.keys(v).sort().join(',')!=='account,at,version'||v.version!==1||!validAccountId(v.account)||!Number.isSafeInteger(v.at)||v.at<0)throw Error('Invalid network reset journal');
 return v;
}
/** Intent is durable before locking; destructive work runs only in a fresh process.
 * A partial reset stays gated and retries idempotently before credentials are loaded. */
export function createNetworkWorkReset(d:{read():Promise<string|null>;write(raw:string):Promise<void>;clear():Promise<void>;vaultAccount():Promise<string|null>;purge(intent:NetworkResetIntent):Promise<void>}){
 let started=false,flight:Promise<void>|null=null;
 return {
  async request(account:string,at:number){const intent=parseNetworkReset(JSON.stringify({version:1,account,at}));started=true;
   const old=await d.read();if(old){if(parseNetworkReset(old).account!==account)throw Error('Another network reset is pending');return;}
   await d.write(JSON.stringify(intent));
  },
  async assertAvailable(){if(await d.read())throw Error('Close and reopen Axonic to finish the network reset');},
  beforeStartup(){if(flight)return flight;flight=(async()=>{
   const raw=await d.read();if(!raw){started=true;return;}
   if(started)throw Error('Close and reopen Axonic to finish the network reset');
   const intent=parseNetworkReset(raw);if(await d.vaultAccount()!==intent.account)throw Error('Network reset account does not match this installation');
   await d.purge(intent);await d.clear();started=true;
  })().finally(()=>{flight=null;});return flight;},
 };
}
/** Fixed allowlist: no identity, chat, downloaded-file, preference or other-owner erasure. */
export const networkResetTables=[
 ['axonic_custody_v1.db','custody'],['axonic_group_custody_v1.db','group_custody'],
 ['axonic_own_custody_v1.db','own_custody'],
 ['axonic_attachment_custody_v1.db','assets'],['axonic_attachment_custody_v1.db','asset_chunks'],
 ['axonic_own_attachment_jobs_v1.db','jobs'],['axonic_own_attachment_jobs_v1.db','finished_jobs'],
 ['axonic_root_message_wakes_v1.db','notices'],['axonic_root_call_wakes_v1.db','wakes'],
] as const;
export const networkResetKeys=(account:string)=>{
 if(!validAccountId(account))throw Error('Invalid network reset account');
 return ['@axonic_group_outbox_v1:','@axonic_attachment_selections_v1:','@axonic_root_notice_actions_v1:'].map(p=>p+account);
};
