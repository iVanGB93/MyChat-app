let activeRecorders=0;
const activityListeners=new Set<()=>void>();
export const rootVoiceRecordingActive=()=>activeRecorders>0;
export function subscribeRootVoiceActivity(listener:()=>void){activityListeners.add(listener);return ()=>{activityListeners.delete(listener);};}
/** One foreground recording. Never enqueue audio after cancellation, lock, or an account change. */
export function createRootVoiceRecorder(d:{
 current():boolean;permission():Promise<boolean>;mode(recording:boolean):Promise<void>;
 prepare():Promise<void>;record():void;stop():Promise<void>;uri():string|null;
 remove(uri:string):void;enqueue(uri:string):Promise<void>;now():number;
 changed(state:'idle'|'starting'|'recording'|'sending'):void;
}){
 let state:'idle'|'starting'|'recording'|'sending'='idle',epoch=0,started=0,disposed=false;
 let tail:Promise<unknown>=Promise.resolve();
 const run=(work:()=>Promise<void>)=>{const p=tail.then(work);tail=p.catch(()=>{});return p;};
 const set=(s:typeof state)=>{activeRecorders+=(s==='idle'?0:1)-(state==='idle'?0:1);state=s;for(const listener of activityListeners)listener();if(!disposed)d.changed(s);};
 async function cleanup(){try{await d.stop();}catch{/* May not have prepared yet. */}try{await d.mode(false);}finally{const uri=d.uri();if(uri)d.remove(uri);}}
 return {
  start(){if(disposed||state!=='idle')return Promise.resolve();const generation=++epoch;set('starting');return run(async()=>{
   const valid=()=>!disposed&&generation===epoch&&d.current();
   try{
    if(!valid())return;
    if(!await d.permission())throw Error('Allow microphone access to record a voice message');
    if(!valid())return;await d.mode(true);if(!valid())return;
    await d.prepare();if(!valid())return;d.record();started=d.now();set('recording');
   }finally{if(state!=='recording'||!valid()){try{await cleanup();}finally{set('idle');}}}
  });},
  send(){if(disposed||state!=='recording')return Promise.resolve();const generation=epoch;set('sending');return run(async()=>{
   try{
    try{await d.stop();}finally{await d.mode(false);}
    if(disposed||generation!==epoch||!d.current())return;
    const uri=d.uri();if(!uri||d.now()-started<400)throw Error('Record a voice message longer than half a second');
    await d.enqueue(uri);
   }finally{const uri=d.uri();if(uri)d.remove(uri);set('idle');}
  });},
  cancel(){epoch++;return run(async()=>{try{await cleanup();}finally{set('idle');}});},
  dispose(){disposed=true;epoch++;return run(async()=>{try{await cleanup();}finally{set('idle');}});},
 };
}
