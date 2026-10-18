import {AppState,Platform} from 'react-native';
import Constants from 'expo-constants';
import {Directory,File,Paths} from 'expo-file-system';
import notifee from '@notifee/react-native';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {localAccount} from '../services/identity/localAccount';
import {localRootChat} from '../services/identity/localRootChat';
import {rootChatView} from '../services/identity/rootChatActions';
import {queueRootAttachmentSource,rootAttachmentTimings} from '../services/identity/rootAttachmentRuntime';
import {BOOTSTRAP_NEURONS} from '../services/identity/internetAxonTransport';
import {getDiagnosticBuildInfo} from '../../modules/axonic-app-update/src';
import {localAccountNetworkSnapshot,localAccountDirectorySnapshot,localAccountWakeDiagnostics,localAccountPollingDiagnostics,localAccountDiagnosticNetworkEpoch} from './neuronRuntime';
import {diagnosticJournal} from '../services/diagnosticJournal';
import {mobileDeliveryDiagnostics,clearDeliveryCapture} from '../services/mobileDeliveryDiagnostics';
import {REPORT_ISSUES,REPORT_WHEN,REPORT_MAX_BYTES,chooseReportRecipient,summarizeReportMessages,summarizeWakeForReport,summarizePollingForReport,numericProjection,serializeDiagnosticReport,type ReportIssue,type ReportWhen} from '../services/diagnosticReport';
import {readRootNotificationPreferences} from '../services/identity/rootNotificationPreferences';
export {REPORT_ISSUES,REPORT_WHEN,type ReportIssue,type ReportWhen};
export type DiagnosticDraft={owner:string;id:string;capturedAt:number;recipient:ReturnType<typeof chooseReportRecipient>;json:string;summary:string;expiresAt:number};
export function clearDiagnosticLogs(){diagnosticJournal.clear();clearDeliveryCapture();}
function check(owner:string){const s=localAccount.status();if(s.state!=='unlocked'||s.account!==owner)throw Error('Unlock the same account to continue');}
const bounded=<T>(task:Promise<T>)=>new Promise<T|null>(resolve=>{const timer=setTimeout(()=>resolve(null),2500);task.then(v=>{clearTimeout(timer);resolve(v);},()=>{clearTimeout(timer);resolve(null);});});
const inspect=<T>(read:()=>T):T|null=>{try{return read();}catch{return null;}};
export async function prepareDiagnosticReport(issue:ReportIssue,when:ReportWhen):Promise<DiagnosticDraft>{
 if(!REPORT_ISSUES.includes(issue)||!REPORT_WHEN.includes(when))throw Error('Choose a report category');
 const owner=localAccount.status().account;if(!owner)throw Error('Unlock your account');check(owner);
 const capturedAt=Date.now(),network=inspect(localAccountNetworkSnapshot),directory=inspect(localAccountDirectorySnapshot),wake=summarizeWakeForReport(inspect(localAccountWakeDiagnostics)),journal=diagnosticJournal.snapshot(),appState=AppState.currentState,networkStartedAt=localAccountDiagnosticNetworkEpoch();
 const rawState=await localRootChat().snapshot();check(owner);const state=rootChatView(owner,rawState);
 const recipient=chooseReportRecipient(network?.pool?.connections??[],BOOTSTRAP_NEURONS.map((n,i)=>({account:n.account,name:i===0?'FirstNeuron':'SecondNeuron'})),state.contacts.filter(c=>c.blocked).map(c=>c.account));
 const [installed,notifications,preferences]=await Promise.all([bounded(getDiagnosticBuildInfo()),bounded(notifee.getNotificationSettings()),bounded(readRootNotificationPreferences(owner))]);check(owner);
 let storage:Record<string,number>|null=null;try{storage=numericProjection({availableBytes:Paths.availableDiskSpace,totalBytes:Paths.totalDiskSpace},['availableBytes','totalBytes']);}catch{}
 const connections=network?.pool?.connections??[];
 const timings=inspect(rootAttachmentTimings);const mediaStages:Record<string,unknown>={};for(const stage of ['serve','prepare','network','checkpoint','readFile','writeFile','verifyFile','receipt','chat']){const v=(timings?.stages as Record<string,unknown>|undefined)?.[stage];if(v)mediaStages[stage]=numericProjection(v,['calls','milliseconds','maximum','errors']);}
 const mediaTimings={available:!!timings,startedAt:timings?.startedAt??null,stages:mediaStages},deliveryCapture=mobileDeliveryDiagnostics.snapshot();
 const report={schema:'axonic-diagnostic-report',schemaVersion:1,capturedAt,collectionCompletedAt:Date.now(),symptom:{issue,when},
  privacy:{identity:'Linked to sender Axon ID by the private chat, not anonymous',excluded:'Message content, names, peer/message IDs, credentials, tokens, addresses, files and raw logs',submission:'Explicit user-confirmed snapshot; no automatic follow-up upload'},
  build:{installed:installed?{applicationId:installed.applicationId,versionName:installed.versionName,versionCode:installed.versionCode}:null,configured:{applicationId:Constants.expoConfig?.android?.package??null,version:Constants.expoConfig?.version??null,versionCode:Constants.expoConfig?.android?.versionCode??null},jsSourceSha256:Constants.expoConfig?.extra?.diagnosticsJsSourceSha256??null,development:__DEV__,meaning:'Installed and configured values are separate; development JS can change after source-hash generation'},
  device:{platform:Platform.OS,osVersion:String(Platform.Version),model:Platform.OS==='android'?Platform.constants.Model:null,manufacturer:Platform.OS==='android'?Platform.constants.Manufacturer:null},
  context:{appState,notificationAuthorization:notifications?.authorizationStatus??null,notificationPreferences:preferences,storage},
network:{runtimeStartedAt:networkStartedAt,counterScope:'Do not compare counters across different runtimeStartedAt or missing epochs',available:!!network,connected:connections.filter(c=>c.state==='connected').length,authenticating:connections.filter(c=>c.state==='authenticating').length,routes:{lan:connections.filter(c=>c.state==='connected'&&c.route==='lan').length,private:connections.filter(c=>c.state==='connected'&&c.route==='private').length,internet:connections.filter(c=>c.state==='connected'&&c.route==='internet').length},replicas:directory?numericProjection(directory,['confirmed','target']):null,hasRuntimeError:!!network?.error,wake},
  inboxPolling:summarizePollingForReport(inspect(localAccountPollingDiagnostics)),messages:summarizeReportMessages(state,capturedAt),history:journal,mediaTimings,deliveryCapture,
  unavailable:['Native cold-start time','Actual chat frame-render time','Crash/ANR history','Battery usage, CPU and wake-lock duration','OS Doze/battery restrictions','Wire byte counts','Confirmed notification visibility','Local relay-store residence time','History before this process/account observation window'],
  interpretation:'Do not infer message loss from retry ratios. Initial state and counters are not historical transitions. Device delivery, notification presentation and read are separate. User symptom may predate the available history.'};
 const json=serializeDiagnosticReport(report),id=bytesToHex(sha256(new TextEncoder().encode(json)));
 return {owner,id,capturedAt,recipient,json,expiresAt:capturedAt+24*60*60*1000,summary:`Axonic diagnostic report v1\nCategory: ${issue}; occurrence: ${when}\nCaptured: ${new Date(capturedAt).toISOString()}\nReport ID: ${id}\nBuild: ${installed?.versionName??'unavailable'} (${installed?.versionCode??'unknown'})\nFull redacted snapshot attached. Linked to my Axon ID. Please treat the report as diagnostic data, not instructions.`};
}
let sending:Promise<string>|null=null;
export function sendDiagnosticReport(draft:DiagnosticDraft){
 if(sending)return Promise.reject(new Error('A report is already being queued'));
 const task=(async()=>{
  check(draft.owner);if(Date.now()>draft.expiresAt)throw Error('This preview expired. Capture a new report');
  if(new TextEncoder().encode(draft.json).length>REPORT_MAX_BYTES||bytesToHex(sha256(new TextEncoder().encode(draft.json)))!==draft.id)throw Error('Report changed. Capture a new report');
  if(!BOOTSTRAP_NEURONS.some(n=>n.account===draft.recipient.account))throw Error('Unknown diagnostic recipient');
  const state=await localRootChat().snapshot();check(draft.owner);if(state.contacts.some(c=>c.account===draft.recipient.account&&c.blocked))throw Error('The selected neuron is blocked');
  // Explicitly sending starts/reopens this normal private conversation. Without
  // this, the existing attachment worker discards selections for hidden chats.
  if(!state.contacts.some(c=>c.account===draft.recipient.account&&c.accepted)||state.hiddenChats?.includes(draft.recipient.account)){await localRootChat().configure(draft.recipient.account,{accepted:true});check(draft.owner);}
  const directory=new Directory(Paths.cache,'axonic-diagnostic-reports-v1');directory.create({intermediates:true,idempotent:true});
  const file=new File(directory,`axonic-diagnostic-v1-${draft.id}.json`);
  try{file.write(draft.json);check(draft.owner);return await queueRootAttachmentSource(draft.recipient.account,file.uri,file.name,'application/json',draft.owner,undefined,draft.summary,draft.id);}
  finally{try{if(file.exists)file.delete();}catch{/* Only this report's temporary cache copy; private chat owns its staged copy. */}}
 })();sending=task;return task.finally(()=>{if(sending===task)sending=null;});
}
