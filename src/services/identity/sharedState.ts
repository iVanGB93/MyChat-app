import {createStore} from 'zustand/vanilla';

/** Reuse equal JSON branches. Never mutate protocol or durable-store objects. */
export function retainEqual<T>(previous:T,next:T):T {
 if(Object.is(previous,next))return previous;
 if(!previous||!next||typeof previous!=='object'||typeof next!=='object')return next;
 if(Array.isArray(previous)!==Array.isArray(next))return next;
 if(!Array.isArray(next)&&(Object.getPrototypeOf(previous)!==Object.prototype||Object.getPrototypeOf(next)!==Object.prototype))return next;
 const a=previous as Record<string,unknown>,b=next as Record<string,unknown>;
 const keys=Object.keys(b);let equal=keys.length===Object.keys(a).length;
 const result:any=Array.isArray(next)?[]:{};
 for(const key of keys){result[key]=retainEqual(a[key],b[key]);if(!Object.hasOwn(a,key)||result[key]!==a[key])equal=false;}
 return equal?previous:result;
}

/** One source subscription regardless of React consumer count. Detached when unused.
 * read() is synchronous; asynchronous resources use a revision/epoch guarded adapter. */
export function createObservedState<T>(read:()=>T,observe:(changed:()=>void)=>()=>void){
 const store=createStore<{value:T}>(()=>({value:read()}));
 let subscribers=0,stop:(()=>void)|undefined;
 const refresh=()=>{const previous=store.getState().value,value=retainEqual(previous,read());if(value!==previous)store.setState({value});};
 return {getState:store.getState,getInitialState:store.getInitialState,
  subscribe(listener:(state:{value:T},previous:{value:T})=>void){
   const off=store.subscribe(listener);
   if(subscribers++===0){stop=observe(refresh);refresh();}
   return()=>{off();if(--subscribers===0){stop?.();stop=undefined;}};
  },refresh};
}
