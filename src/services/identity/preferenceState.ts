import {createStore} from 'zustand/vanilla';
import {retainEqual} from './sharedState';

/** Shared presentation + coalesced reads. Operational reads still go to storage:
 * another Android runtime may have written preferences while this one slept. */
export function createPreferenceState<T>(read:(owner:string)=>Promise<T>,write:(owner:string,value:T)=>Promise<void>){
 const store=createStore<{values:Record<string,T>}>(()=>({values:{}}));
 const flights=new Map<string,Promise<T>>(),versions=new Map<string,number>();
 const publish=(owner:string,value:T)=>{const old=store.getState().values,next=retainEqual(old[owner],value);
  if(next===old[owner])return;const values={...old,[owner]:next};if(Object.keys(values).length>8)delete values[Object.keys(values)[0]];store.setState({values});};
 return {...store,
  read(owner:string):Promise<T>{const existing=flights.get(owner);if(existing)return existing;
   const version=versions.get(owner)??0;
   const result=read(owner).then(value=>{if((versions.get(owner)??0)!==version)return store.getState().values[owner]??read(owner);publish(owner,value);return value;});
   flights.set(owner,result);void result.finally(()=>{if(flights.get(owner)===result)flights.delete(owner);}).catch(()=>{});return result;
  },
  async write(owner:string,value:T){await write(owner,value);versions.set(owner,(versions.get(owner)??0)+1);flights.delete(owner);publish(owner,value);},
 };
}
