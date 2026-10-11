/** Ephemeral metadata emitted only after a new message/selection is durably saved. */
export type RootMessageFeedback={owner:string;peer:string;id:string;group?:string;direction:'incoming'|'outgoing';muted?:boolean};
const listeners=new Set<(event:RootMessageFeedback)=>void>();
export function publishRootMessageFeedback(event:RootMessageFeedback){for(const listener of listeners)try{listener(event);}catch{}}
export function subscribeRootMessageFeedback(listener:(event:RootMessageFeedback)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
