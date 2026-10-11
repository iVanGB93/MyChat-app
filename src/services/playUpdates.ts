import type {PlayUpdateInfo,PlayUpdateStartResult} from '../../modules/axonic-app-update';
export type UpdateState={status:'idle'|'checking'|'unavailable'|'current'|'available'|'downloading'|'ready'|'error';version:number|null};
/** Play is the only update authority. No server version policy or mandatory update overlay. */
export function createPlayUpdates(d:{now():number;foreground():boolean;safeToRestart():Promise<boolean>;info():Promise<PlayUpdateInfo|null>;start(immediate:boolean):Promise<PlayUpdateStartResult>;complete():Promise<void>;read():Promise<string|null>;write(value:string):Promise<void>;queryTimeoutMs?:number}){
 let state:UpdateState={status:'idle',version:null},busy=false,stopped=false,last=-Infinity;
 let prompted:{version?:number;at?:number}={};
 const listeners=new Set<()=>void>();
 const publish=(next:UpdateState)=>{if(stopped)return;state=next;for(const fn of listeners)try{fn();}catch{}};
 const active=()=>!stopped&&d.foreground();
 async function check(force=false,userInitiated=false){
  if(!active()||busy||!force&&d.now()>=last&&d.now()-last<6*60*60*1000)return;
  const previousState=state;busy=true;last=d.now();
  if(userInitiated||['idle','current','error','unavailable'].includes(state.status))publish({status:'checking',version:state.version});
  try{
   let timer:ReturnType<typeof setTimeout>|undefined;
   const info=await Promise.race([d.info(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Play check timed out')),d.queryTimeoutMs??10000);})]).finally(()=>{if(timer)clearTimeout(timer);});if(!active())return;
   if(!info){publish({status:'unavailable',version:null});return;}
   const version=info.availableVersionCode;
   if(info.installStatus===11){publish({status:'ready',version});return;}
   if([1,2,3].includes(info.installStatus??0)){publish({status:'downloading',version});return;}
   if(!['available','in_progress'].includes(info.availability)){publish({status:info.availability==='not_available'?'current':'unavailable',version});return;}
   publish({status:'available',version});
   if(!Number.isSafeInteger(version)||!version||!await d.safeToRestart()||!active())return;
   let previous=prompted;try{const saved=JSON.parse(await d.read()??'{}');if(saved&&typeof saved==='object'&&saved.version===version&&typeof saved.at==='number'&&(saved.at>(previous.at??-Infinity)||previous.version!==version))previous=saved;}catch{}
   if(!active()||!userInitiated&&info.availability!=='in_progress'&&previous.version===version&&typeof previous.at==='number'&&d.now()>=previous.at&&d.now()-previous.at<24*60*60*1000)return;
   if(info.availability!=='in_progress'&&!info.flexibleAllowed&&!(userInitiated&&info.immediateAllowed))return;
   if(!active()||!await d.safeToRestart()||!active())return;
   const outcome=await d.start(info.availability==='in_progress'||!info.flexibleAllowed&&!!info.immediateAllowed);
   if(['accepted','cancelled','downloaded'].includes(outcome)){prompted={version,at:d.now()};try{await d.write(JSON.stringify(prompted));}catch{/* In-memory cooldown still prevents repeated prompts this session. */}}
   else {publish({status:'error',version});last=-Infinity;return;}
   if(active()&&outcome==='downloaded')publish({status:'ready',version});
   else if(active()&&outcome==='accepted')publish({status:'downloading',version});
  }catch{last=-Infinity;publish({status:'error',version:state.version});}finally{if(!active()){last=-Infinity;if(state.status==='checking')publish(previousState);}busy=false;}
 }
 return {check,snapshot:()=>({...state}),subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async install(){if(busy||!active()||state.status!=='ready')return false;busy=true;try{if(!await d.safeToRestart()||!active())return false;await d.complete();return true;}catch{publish({status:'error',version:state.version});return false;}finally{busy=false;}},
  stop(){stopped=true;listeners.clear();}};
}
