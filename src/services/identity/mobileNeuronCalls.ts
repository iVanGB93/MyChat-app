import { neuronCallsEnabled } from './neuronCallFeature';
import type { createNeuronCallCoordinator, NeuronCallView } from './neuronCallCoordinator';
type Coordinator=ReturnType<typeof createNeuronCallCoordinator<number>>;
let active:Coordinator|null=null;
const listeners=new Set<(view:NeuronCallView|null)=>void>();
export const neuronCalls=()=>neuronCallsEnabled()?active:null;
export const notifyNeuronCall=(view:NeuronCallView|null)=>{for(const fn of listeners)fn(view);};
export function registerNeuronCalls(calls:Coordinator){
  active=calls;notifyNeuronCall(calls.snapshot());
  return()=>{if(active===calls){active=null;notifyNeuronCall(null);}};
}
export function subscribeNeuronCalls(fn:(view:NeuronCallView|null)=>void){listeners.add(fn);fn(neuronCalls()?.snapshot()??null);return()=>{listeners.delete(fn);};}

/** Permission dialogs can pause identity access. Await its foreground reattachment. */
export async function waitForNeuronCalls(current:()=>boolean, timeoutMs=10000):Promise<Coordinator|null>{
 const deadline=Date.now()+timeoutMs;
 while(current()&&neuronCallsEnabled()){
  const calls=neuronCalls();if(calls)return calls;
  if(Date.now()>=deadline)return null;
  await new Promise<void>(resolve=>setTimeout(resolve,50));
 }
 return null;
}

let permissionCall:{owner:number;id:string;until:number}|null=null;
export function holdIncomingCallPermission(owner:number,id:string){
 const held={owner,id,until:Date.now()+60000};permissionCall=held;
 return()=>{if(permissionCall===held)permissionCall=null;};
}
export const incomingCallPermissionHeld=(owner:number,id:string)=>permissionCall?.owner===owner&&permissionCall.id===id&&permissionCall.until>Date.now();
export async function waitForNeuronCallPeer(user:number,current:()=>boolean,timeoutMs=10000):Promise<Coordinator|null>{
 const deadline=Date.now()+timeoutMs;
 while(current()&&neuronCallsEnabled()){
  const calls=neuronCalls();
  if(calls&&await calls.peerReady(user)&&current()&&calls===neuronCalls())return calls;
  if(Date.now()>=deadline)return null;
  await new Promise<void>(resolve=>setTimeout(resolve,100));
 }
 return null;
}
