import { neuronCallsEnabled } from './neuronCallFeature';
import type { createNeuronCallCoordinator, NeuronCallView } from './neuronCallCoordinator';
type Coordinator=ReturnType<typeof createNeuronCallCoordinator>;
let active:Coordinator|null=null;
const listeners=new Set<(view:NeuronCallView|null)=>void>();
export const neuronCalls=()=>neuronCallsEnabled()?active:null;
export const notifyNeuronCall=(view:NeuronCallView|null)=>{for(const fn of listeners)fn(view);};
export function registerNeuronCalls(calls:Coordinator){
  active=calls;notifyNeuronCall(calls.snapshot());
  return()=>{if(active===calls){active=null;notifyNeuronCall(null);}};
}
export function subscribeNeuronCalls(fn:(view:NeuronCallView|null)=>void){listeners.add(fn);fn(neuronCalls()?.snapshot()??null);return()=>{listeners.delete(fn);};}
