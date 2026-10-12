export const VOICE_HOLD_DELAY_MS=100;
export const VOICE_CANCEL_DISTANCE=72;
/** Keeps release/cancel tied to the original touch while microphone startup is asynchronous. */
export function createVoiceRecordingGesture(d:{
 start():Promise<void>;send():Promise<void>;cancel():Promise<void>;error(error:unknown):void;
 changed(holding:boolean,cancelling:boolean):void;
 held?():void;
 schedule(work:()=>void,delay:number):ReturnType<typeof setTimeout>;
 clear(timer:ReturnType<typeof setTimeout>):void;
}){
 let timer:ReturnType<typeof setTimeout>|undefined,pressed=false,holding=false,origin=0,cancelling=false,generation=0;
 let starting:Promise<boolean>=Promise.resolve(false);
 const clear=()=>{if(timer!==undefined)d.clear(timer);timer=undefined;};
 const start=()=>{try{return d.start().then(()=>true,error=>{d.error(error);return false;});}catch(error){d.error(error);return Promise.resolve(false);}};
 const cancel=()=>void d.cancel().catch(d.error);
 return {
  press(x:number){if(pressed)return;clear();generation++;origin=x;pressed=true;holding=false;cancelling=false;
   timer=d.schedule(()=>{timer=undefined;if(!pressed)return;holding=true;try{d.held?.();}catch{/* Optional feedback must never interrupt recording. */}d.changed(true,cancelling);starting=start();},VOICE_HOLD_DELAY_MS);
  },
  move(x:number){if(!pressed)return;const next=origin-x>=VOICE_CANCEL_DISTANCE;if(next!==cancelling){cancelling=next;if(holding)d.changed(true,next);}},
  release(x:number){if(!pressed)return;clear();pressed=false;const own=generation,held=holding,discard=origin-x>=VOICE_CANCEL_DISTANCE;holding=false;d.changed(false,false);
   if(discard){if(held)cancel();return;}
   if(!held){starting=start();return;}
   void starting.then(ok=>{if(ok&&generation===own)return d.send();}).catch(d.error);
  },
  terminate(){generation++;clear();pressed=false;holding=false;d.changed(false,false);cancel();},
  dispose(){generation++;clear();pressed=false;holding=false;},
 };
}
