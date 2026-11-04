import {AppRegistry,AppState} from 'react-native';
import Native from '../../modules/axonic-nearby';
import {localAccount,startLocalAccount} from '../services/identity/localAccount';
import {selections,subscribeAttachmentSelections} from '../services/identity/rootAttachmentSelections';
import {createMobileAttachmentJobs,subscribeAttachmentJobProgress} from '../services/identity/mobileAttachmentJobs';
import {localRootChat} from '../services/identity/localRootChat';
import {subscribeRootChatCommitted} from '../services/identity/localRootChat';
import {rootMessageStatus} from '../services/identity/rootMessageStatus';
import {rootChatView} from '../services/identity/rootChatActions';
import {rootGroupAllowed} from '../services/identity/rootGroups';
import {attachmentBlockBytes} from '../services/identity/attachmentProtocol';
import {runBackgroundUpload} from '../services/identity/backgroundUploadTask';
import {startLocalAccountNetwork} from './neuronRuntime';

const unlocked=(owner:string)=>localAccount.status().account===owner&&localAccount.status().state==='unlocked'&&!localAccount.status().busy;
export async function readBackgroundUploadWork(owner:string){
 const [selected,jobs]=await Promise.all([selections(owner),createMobileAttachmentJobs().list(owner)]);
 let count=selected.filter(s=>!s.failed).length,held=selected.filter(s=>s.failed).length,bytes=0,sent=0,uploading=0;
 let expiresAt=Infinity;
 const snapshots=new Map<string,Awaited<ReturnType<ReturnType<typeof localRootChat>['messageIdSnapshot']>>>();
 for(const job of jobs){
  if(job.direction!=='outgoing'||job.phase==='complete')continue;
  // Preparation persists a serving job before publishing the descriptor. Until
  // that selection commits, it alone owns pending/held accounting.
  if(selected.some(s=>s.id===job.descriptor.manifest.id))continue;
  if(job.phase==='cancelled'||job.phase==='expired'||job.descriptor.manifest.expires<=Date.now()){held++;continue;}
  const id=job.descriptor.manifest.id;
  let state=snapshots.get(id);
  if(!state){state=rootChatView(owner,await localRootChat().messageIdSnapshot(id));snapshots.set(id,state);}
  const message=state.messages.find(m=>m.direction==='outgoing'&&m.id===job.descriptor.manifest.id&&m.peer===job.descriptor.manifest.recipient);
  // A prepared file is not authorization to send. The worker requires its
  // published message too. Preserve stranded jobs for recovery, but do not
  // keep Android's transfer service alive for work the worker cannot admit.
  if(!message){held++;continue;}
  if(message&&(message.deleted||message.networkCancelledAt!==undefined))continue;
  if(message&&['stored','delivered','read'].includes(rootMessageStatus(message)))continue;
  const contact=state.contacts.find(c=>c.account===job.descriptor.manifest.recipient);
  if(!contact?.accepted||contact.blocked){held++;continue;}
  if(message.group&&(!state.groups?.find(g=>g.id===message.group!.id)?.accepted||!rootGroupAllowed(state,owner,message.peer,message.group))){held++;continue;}
  count++;bytes+=job.descriptor.manifest.bytes;
  expiresAt=Math.min(expiresAt,job.descriptor.manifest.expires);
  if(job.phase==='uploading')uploading++;
  sent+=Math.min(job.descriptor.manifest.bytes,job.cursor*attachmentBlockBytes(job.descriptor.manifest));
 }
 const state=selected.some(s=>!s.failed)?'preparing':uploading?'sending':'waiting';
 return {state,expiresAt,pending:count,held,percent:selected.some(s=>!s.failed)||!bytes?-1:Math.min(99,Math.floor(sent/bytes*100))};
}

export const backgroundUploadNeedsRefresh=(cached:{expiresAt:number}|undefined,dirty:boolean,now:number)=>!cached||dirty||now>=cached.expiresAt;

/** Installed at the app/headless entry; UI subscriptions do not own this lifetime. */
export function registerBackgroundMediaUploads(){
 let scanning=false,again=false;
 async function schedule(){
  if(AppState.currentState!=='active'||!Native?.attachmentUploadSchedule)return;
  if(scanning){again=true;return;}scanning=true;
  try{do{
   again=false;const owner=localAccount.status().account;
   if(!owner||!unlocked(owner)||AppState.currentState!=='active')break;
   const work=await readBackgroundUploadWork(owner);
   if(unlocked(owner)&&AppState.currentState==='active'){if(work.pending)Native.attachmentUploadSchedule(owner);else Native.attachmentUploadDisarm?.(owner);}
  }while(again);}catch{/* Durable queue and foreground sending remain available. */}finally{scanning=false;}
 }
 // Subscribe to admissions, not every byte checkpoint. Native scheduling is single-instance.
 subscribeAttachmentSelections((owner,hasPending)=>{
  if(hasPending&&AppState.currentState==='active'&&unlocked(owner))try{Native?.attachmentUploadSchedule?.(owner);}catch{/* Reopening can retry admission. */}
  else void schedule();
 });
 subscribeAttachmentJobProgress(job=>{if(['queued','confirming','complete','expired','cancelled'].includes(job.phase))void schedule();});
 subscribeRootChatCommitted(()=>void schedule());
 localAccount.subscribe(()=>void schedule());
 AppState.addEventListener('change',state=>{if(state==='active')void schedule();});
 AppRegistry.registerHeadlessTask('AxonicMediaUpload',()=>async(data:{owner:string;token:string})=>{
  if(!Native?.attachmentUploadCurrent?.(data.token))return;
  let wake:(()=>void)|undefined,dirty=true,lastRead=0,cached:Awaited<ReturnType<typeof readBackgroundUploadWork>>|undefined;
  const changed=()=>{dirty=true;wake?.();};
  const off=[subscribeAttachmentJobProgress(changed),subscribeAttachmentSelections(changed),subscribeRootChatCommitted(changed),localAccount.subscribe(changed)];
  let outcome='error';
  try{
   if(localAccount.status().account&&localAccount.status().account!==data.owner){outcome='locked';return;}
   await startLocalAccount();
   outcome=await runBackgroundUpload({current:()=>!!Native?.attachmentUploadCurrent?.(data.token),unlocked:()=>unlocked(data.owner),now:Date.now,start:startLocalAccountNetwork,
    read:async()=>{if(backgroundUploadNeedsRefresh(cached,dirty,Date.now())){const delay=500-(Date.now()-lastRead);if(delay>0)await Native!.axonMessageWait!(delay);dirty=false;cached=await readBackgroundUploadWork(data.owner);lastRead=Date.now();}return !cached!.pending&&dirty?{...cached!,pending:1,percent:-1}:cached!;},
    progress:(count,percent,state)=>{
     if(Native?.attachmentUploadState)Native.attachmentUploadState(data.token,count,percent,state??'waiting');
     else Native?.attachmentUploadProgress?.(data.token,count,percent);
    },
    wait:()=>new Promise<void>(resolve=>{
     let done=false;const finish=()=>{if(done)return;done=true;wake=undefined;resolve();};wake=finish;
     // Native delay also observes an OS stop even when there is no JS event.
     void Native!.axonMessageWait!(1000).then(finish,finish);
     if(dirty)finish();
    }),
   });
  }catch{/* Leave saved jobs intact; never report success on an uncertain read. */}
  finally{off.forEach(fn=>fn());wake?.();Native?.attachmentUploadComplete?.(data.token,outcome);}
 });
 void schedule();
}
