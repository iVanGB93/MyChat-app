import type {RootMessageFeedback} from './identity/rootMessageFeedback';
/** Event-driven feedback; history, receipts and retry polling never create events. */
export function createMessageSounds(d:{current(owner:string):boolean;visible(peer:string,group?:string):boolean;preferences(owner:string):Promise<{sound:boolean}>;play(kind:'message_sent'|'message_received',current:()=>boolean):Promise<void>}){
 let stopped=false;const seen=new Set<string>();
 function current(e:RootMessageFeedback){return !stopped&&d.current(e.owner)&&(e.direction==='outgoing'||d.visible(e.peer,e.group));}
 return {async receive(e:RootMessageFeedback){
  if(!current(e)||e.direction==='incoming'&&e.muted)return;
  const key=JSON.stringify([e.owner,e.direction,e.group??e.peer,e.id]);if(seen.has(key))return;seen.add(key);
  if(seen.size>2048)seen.delete(seen.values().next().value!);
  try{const preferences=await d.preferences(e.owner);if(!preferences.sound||!current(e))return;await d.play(e.direction==='outgoing'?'message_sent':'message_received',()=>current(e));}catch{/* Feedback never blocks a message. */}
 },stop(){stopped=true;seen.clear();}};
}
