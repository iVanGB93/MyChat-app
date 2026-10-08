export type RootToast={account:string;sender:string;group?:string;name:string;text:string};
const listeners=new Set<(preview:RootToast)=>boolean>();
export function subscribeRootMessageToast(listener:(preview:RootToast)=>boolean){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function publishRootMessageToast(preview:RootToast){let displayed=false;for(const listener of listeners){try{displayed=listener(preview)||displayed;}catch{}}return displayed;}
