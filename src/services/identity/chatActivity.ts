/** Ephemeral hints carried only by an already authenticated, encrypted chat channel. */
export function createChatActivity(d:{owner():string|null;now():number;allowed(peer:string,group?:string):Promise<boolean>;changed?():void;send(peer:string,raw:string):Promise<boolean>}){
 const incoming=new Map<string,number>(),lastSent=new Map<string,number>();
 let generation=0;
 return {
  nextDeadline:()=>Math.min(Infinity,...[...incoming.values()].filter(until=>until>d.now())),
  typing:(peer:string,group?:string)=>(incoming.get('typing:'+(group??'direct')+':'+peer)??0)>d.now(),
  recording:(peer:string,group?:string)=>(incoming.get('recording:'+(group??'direct')+':'+peer)??0)>d.now(),
  clear(){generation++;incoming.clear();lastSent.clear();d.changed?.();},
  async receive(from:string,raw:string):Promise<boolean|null>{
   let packet:unknown;try{packet=JSON.parse(raw);}catch{return null;}
   if(!Array.isArray(packet)||!['axonic-chat-activity-v1','axonic-chat-recording-v1'].includes(packet[0]))return null;
   const owner=d.owner(),epoch=generation;
   const group=packet.length===5?packet[4]:undefined;
   if(group!==undefined&&(typeof group!=='string'||!/^[a-f0-9]{64}$/.test(group)))return false;
   if(!owner||![4,5].includes(packet.length)||packet[1]!==owner||typeof packet[2]!=='boolean'||!Number.isSafeInteger(packet[3])||packet[3]<=d.now()||packet[3]>d.now()+15000)return false;
   if(!await d.allowed(from,group)||d.owner()!==owner||epoch!==generation)return false;
   const kind=packet[0]==='axonic-chat-recording-v1'?'recording':'typing';
   const key=kind+':'+(group??'direct')+':'+from;
   if(incoming.size>=100&&!incoming.has(key))for(const [peer,until] of incoming)if(until<=d.now())incoming.delete(peer);
   if(incoming.size>=100&&!incoming.has(key))return false;
   incoming.set(key,packet[2]?Math.min(packet[3],d.now()+4000):0);d.changed?.();return true;
  },
  async notify(peer:string,typing:boolean,group?:string,kind:'typing'|'recording'='typing'){
   const owner=d.owner(),epoch=generation,key=kind+':'+(group??'direct')+':'+peer;if(!owner)return;
   if(typing&&(lastSent.get(key)??0)>d.now()-3000)return;
   if(!await d.allowed(peer,group)||owner!==d.owner()||epoch!==generation)return;
   if(typing&&(lastSent.get(key)??0)>d.now()-3000)return;
   if(lastSent.size>=100&&!lastSent.has(key))lastSent.clear();
   if(typing)lastSent.set(key,d.now());else lastSent.delete(key);
   await d.send(peer,JSON.stringify([kind==='recording'?'axonic-chat-recording-v1':'axonic-chat-activity-v1',peer,typing,d.now()+4000,...(group?[group]:[])]));
  },
 };
}
