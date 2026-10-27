import {createStore} from 'zustand/vanilla';
import {retainEqual} from './sharedState';
export type CallMediaStatus={id:string;connection:'connecting'|'p2p'|'relayed';recovering:boolean;muted:boolean;cameraOff:boolean;sharing:boolean;remoteSharing:boolean;sharingBusy:boolean;quality:'unknown'|'poor'|'fair'|'good'};
export const callMediaState=createStore<{value:CallMediaStatus|null}>(()=>({value:null}));
let generation=0;
export function clearCallMediaState(){generation++;callMediaState.setState({value:null});}
/** Metadata only; tracks, streams, signaling and controls remain with their owner. */
export function beginCallMediaState(id:string){const own=++generation;callMediaState.setState({value:null});
 return {update(value:Omit<CallMediaStatus,'id'>){if(own!==generation)return;const old=callMediaState.getState().value,next=retainEqual(old,{...value,id});if(next!==old)callMediaState.setState({value:next});},
  stop(){if(own===generation)clearCallMediaState();}};
}
