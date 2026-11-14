import type {PlayUpdateInfo,PlayUpdateStartResult} from '../../modules/axonic-app-update';
export type UpdateState={status:'idle'|'checking'|'unavailable'|'current'|'available'|'downloading'|'ready'|'installing'|'error';version:number|null;bytesDownloaded?:number;totalBytesToDownload?:number;progress?:number};
/** Play is the only update authority. No server version policy or mandatory update overlay. */
export function createPlayUpdates(d:{now():number;foreground():boolean;safeToRestart():Promise<boolean>;info():Promise<PlayUpdateInfo|null>;start(immediate:boolean):Promise<PlayUpdateStartResult>;complete():Promise<void>;read():Promise<string|null>;write(value:string):Promise<void>;openStore?():Promise<void>;queryTimeoutMs?:number}){
 let state:UpdateState={status:'idle',version:null},busy=false,stopped=false,last=-Infinity;
 let prompted:{version?:number;at?:number}={};
 let eventRevision=0;
 const listeners=new Set<()=>void>();
 const publish=(next:UpdateState)=>{if(stopped)return;state=next;for(const fn of listeners)try{fn();}catch{}};
 const active=()=>!stopped&&d.foreground();
 function installState(info:Pick<PlayUpdateInfo,'installStatus'|'bytesDownloaded'|'totalBytesToDownload'>){
  if(stopped||![1,2,3,4,5,6,11].includes(info.installStatus??0))return;
  eventRevision++;
  const status=info.installStatus===11?'ready':info.installStatus===3?'installing':info.installStatus===4?'current':[5,6].includes(info.installStatus!)?'error':'downloading';
  const total=Number.isFinite(info.totalBytesToDownload)&&info.totalBytesToDownload!>0?info.totalBytesToDownload!:undefined;
  const downloaded=Number.isFinite(info.bytesDownloaded)&&info.bytesDownloaded!>=0?Math.min(info.bytesDownloaded!,total??Infinity):undefined;
  publish({status,version:state.version,...(status==='downloading'?{bytesDownloaded:downloaded,totalBytesToDownload:total,progress:total&&downloaded!==undefined?Math.floor(downloaded/total*100):undefined}:{})});
 }
 async function check(force=false,userInitiated=false){
  if(!active()||busy||!force&&d.now()>=last&&d.now()-last<6*60*60*1000)return;
  const previousState=state,revision=eventRevision;busy=true;last=d.now();
  let triedStore=false;
  const fallback=async()=>{if(userInitiated&&!triedStore&&active()&&revision===eventRevision&&d.openStore){triedStore=true;await d.openStore();}};
  if(userInitiated||['idle','current','error','unavailable'].includes(state.status))publish({status:'checking',version:state.version});
  try{
   let timer:ReturnType<typeof setTimeout>|undefined;
   const info=await Promise.race([d.info(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Play check timed out')),d.queryTimeoutMs??10000);})]).finally(()=>{if(timer)clearTimeout(timer);});if(!active()||revision!==eventRevision)return;
   if(!info){publish({status:'unavailable',version:null});await fallback();return;}
   const version=info.availableVersionCode;
   if(info.installStatus===11){publish({status:'ready',version});return;}
   if([1,2,3,4,5,6].includes(info.installStatus??0)){state={...state,version};installState(info);return;}
   if(!['available','in_progress'].includes(info.availability)){publish({status:info.availability==='not_available'?'current':'unavailable',version});if(info.availability!=='not_available')await fallback();return;}
   publish({status:'available',version});
   if(!Number.isSafeInteger(version)||!version){await fallback();return;}
   const resuming=info.availability==='in_progress';
   if(!userInitiated&&!resuming){
    let previous=prompted;try{const saved=JSON.parse(await d.read()??'{}');if(saved&&typeof saved==='object'&&saved.version===version&&typeof saved.at==='number'&&(saved.at>(previous.at??-Infinity)||previous.version!==version))previous=saved;}catch{}
    if(previous.version===version&&typeof previous.at==='number'&&d.now()>=previous.at&&d.now()-previous.at<24*60*60*1000)return;
   }
   const immediate=resuming||!info.flexibleAllowed&&!!info.immediateAllowed&&userInitiated;
   if(!info.flexibleAllowed&&!immediate){await fallback();return;}
   // Flexible updates download in the background. The restart check belongs
   // to immediate updates and the explicit installation of a downloaded file.
   if(immediate&&!await d.safeToRestart())return 'restart-blocked' as const;
   if(!active()||revision!==eventRevision)return;
   let outcome:PlayUpdateStartResult;
   try{outcome=await d.start(immediate);}catch{outcome='failed';}
   // Native progress/completion is newer evidence than the Play dialog result.
   // In particular, a late failed/busy result must never hide a downloaded update.
   if(['accepted','cancelled','downloaded'].includes(outcome)){prompted={version,at:d.now()};try{await d.write(JSON.stringify(prompted));}catch{/* In-memory cooldown still prevents repeated prompts this session. */}}
   else {if(revision!==eventRevision)return;publish({status:'error',version});last=-Infinity;if(outcome!=='busy')await fallback();return;}
   if(revision!==eventRevision)return;
   if(outcome==='downloaded')publish({status:'ready',version});
   else if(outcome==='accepted')publish({...state,status:'downloading',version});
  }catch{last=-Infinity;if(revision===eventRevision)publish({status:'error',version:state.version});await fallback().catch(()=>{});}finally{if(!active()){last=-Infinity;if(state.status==='checking')publish(previousState);}busy=false;}
 }
 return {check,installState,snapshot:()=>({...state}),subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async install(){
   if(busy||!active()||state.status!=='ready')return 'unavailable' as const;
   busy=true;
   const revision=eventRevision;
   try{
    if(!await d.safeToRestart())return 'restart-blocked' as const;
    if(!active()||revision!==eventRevision&&state.status!=='ready')return 'unavailable' as const;
    publish({status:'installing',version:state.version});
    await d.complete();
    return 'started' as const;
   }catch{
    if(revision===eventRevision)publish({status:'ready',version:state.version});
    return 'failed' as const;
   }finally{busy=false;}
  },
  stop(){stopped=true;listeners.clear();}};
}
