/** Audio-level metadata only; never records audio. WebRTC has no speaking event.
 * One non-overlapping sample every 250ms, only while the group media leg lives. */
export function createCallSpeakingMonitor(d:{current():boolean;stats():Promise<{forEach(fn:(r:any)=>void):void}>;publish(local:boolean,remote:boolean):void;now?:()=>number;schedule?:(run:()=>void,ms:number)=>ReturnType<typeof setTimeout>;cancel?:(id:ReturnType<typeof setTimeout>)=>void}){
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,started=false;
 let localUntil=-Infinity,remoteUntil=-Infinity,last='';
 const previous=new Map<string,{energy:number;duration:number}>(),now=d.now??Date.now,schedule=d.schedule??((run:()=>void,ms:number)=>setTimeout(run,ms)),cancel=d.cancel??((id:ReturnType<typeof setTimeout>)=>clearTimeout(id));
 async function sample(){
  if(stopped||!d.current())return;
  try{
   const stats=await d.stats();if(stopped||!d.current())return;
   const at=now();let local=false,remote=false;
   stats.forEach(r=>{
    if((r.kind??r.mediaType)!=='audio')return;
    const incoming=r.type==='inbound-rtp',outgoing=r.type==='media-source';if(!incoming&&!outgoing)return;
    let level=Number.isFinite(r.audioLevel)?r.audioLevel:0;
    if(Number.isFinite(r.totalAudioEnergy)&&Number.isFinite(r.totalSamplesDuration)){
     const prior=previous.get(r.id),energy=r.totalAudioEnergy,duration=r.totalSamplesDuration;
     if(!Number.isFinite(r.audioLevel)&&prior&&duration>prior.duration&&energy>=prior.energy)level=Math.sqrt((energy-prior.energy)/(duration-prior.duration));
     previous.set(r.id,{energy,duration});
    }
    if(level>=0.025){if(incoming)remote=true;else local=true;}
   });
   if(local)localUntil=at+350;if(remote)remoteUntil=at+350;
   const l=at<localUntil,r=at<remoteUntil,key=String(l)+r;
   if(key!==last){last=key;d.publish(l,r);}
  }catch{if(!stopped&&d.current()&&last!=='falsefalse'){last='falsefalse';localUntil=remoteUntil=-Infinity;d.publish(false,false);}}
  if(!stopped&&d.current())timer=schedule(()=>void sample(),250);
 }
 return {start(){if(!started){started=true;void sample();}},stop(){stopped=true;if(timer!==undefined)cancel(timer);previous.clear();}};
}
