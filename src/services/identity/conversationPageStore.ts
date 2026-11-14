import {buildConversationProjection,conversationCachePrefix,projectionHash,messagePosition,comparePositions,referenceKey,type MessagePosition,type ConversationIndex} from './conversationProjection';
import type {RootChatMessage} from './rootChatTypes';
export type ConversationWindow={generation:number;messages:RootChatMessage[];references:RootChatMessage[];hasMore:boolean;oldest?:MessagePosition};
class InvalidProjection extends Error{}
/** Disposable read index. Dirty is durable BEFORE any authoritative mutation.
 * UI reads and writes share this queue; a crash rebuilds only from the ledger. */
export function createConversationPageStore(owner:string,d:{get(key:string):Promise<string|null>;set(key:string,raw:string):Promise<void>;remove(keys:string[]):Promise<void>;readSource():Promise<string|null>;readRooms?(rooms:string[]):Promise<string>;hash?(raw:string):string;deferProjection?():boolean}){
 const hash=d.hash??projectionHash;
 const meta=conversationCachePrefix(owner)+'index';let tail:Promise<unknown>=Promise.resolve();
 const metrics={indexReads:0,pageReads:0,lookupReads:0,sourceReads:0,builds:0,lastBuildMs:0};
 function serial<T>(work:()=>Promise<T>){const task=tail.then(work);tail=task.catch(()=>{});return task;}
 async function existing(){metrics.indexReads++;const raw=await d.get(meta);if(!raw)return null;try{const v=JSON.parse(raw) as ConversationIndex;
  return v.version===2&&v.owner===owner&&Number.isSafeInteger(v.generation)&&Array.isArray(v.state?.contacts)&&Array.isArray(v.state?.messages)&&v.summaries&&v.rooms&&Object.values(v.rooms).every(r=>Array.isArray(r.pages)&&typeof r.lookupKey==='string'&&typeof r.lookupHash==='string'&&r.pages.every(p=>typeof p.key==='string'&&typeof p.hash==='string'&&p.first&&p.last))?v:null;
 }catch{return null;}}
 function hashes(index:ConversationIndex|null,rooms?:readonly string[]){
  const result=new Map<string,string>();
  if(!index)return result;
  for(const key of rooms??Object.keys(index.rooms)){
   const room=index.rooms[key];
   if(!room)continue;
   result.set(room.lookupKey,room.lookupHash);
   for(const page of room.pages)result.set(page.key,page.hash);
  }
  return result;
 }
 async function publish(raw:string|null,old:ConversationIndex|null,reuse:boolean){
  const started=Date.now();metrics.builds++;
  const {index,values}=buildConversationProjection(owner,raw,(old?.generation??0)+1,hash),previous=reuse?hashes(old):new Map<string,string>(),next=hashes(index);
  for(const [key,value] of values)if(previous.get(key)!==next.get(key))await d.set(key,value);
  await d.set(meta,JSON.stringify(index));
  metrics.lastBuildMs=Date.now()-started;
  // These are disposable index pages only, never messages or media.
  const obsolete=[...hashes(old).keys()].filter(k=>k.startsWith(conversationCachePrefix(owner))&&!values.has(k));
  if(obsolete.length)await d.remove(obsolete).catch(()=>{});
  return index;
 }
 async function publishRooms(old:ConversationIndex,rooms:string[],raw:string){
    const started=Date.now(),built=buildConversationProjection(owner,raw,old.generation+1,hash),changed=new Set(rooms),index:ConversationIndex={...built.index,summaries:{...old.summaries},rooms:{...old.rooms}};
    const previous=hashes(old,rooms),next=hashes(built.index,rooms);
    for(const room of changed){delete index.summaries[room];delete index.rooms[room];if(built.index.rooms[room]){index.rooms[room]=built.index.rooms[room];index.summaries[room]=built.index.summaries[room];}}
    index.state.messages=[...old.state.messages.filter(m=>!changed.has(m.group?'group:'+m.group.id:m.peer)),...built.index.state.messages.filter(m=>changed.has(m.group?'group:'+m.group.id:m.peer))];
    for(const [key,value] of built.values)if(previous.get(key)!==next.get(key))await d.set(key,value);
    await d.set(meta,JSON.stringify(index));metrics.builds++;metrics.lastBuildMs=Date.now()-started;
    const obsolete=[...previous.keys()].filter(k=>!next.has(k)&&k.startsWith(conversationCachePrefix(owner)));if(obsolete.length)await d.remove(obsolete).catch(()=>{});
    return index;
 }
 const scopedDirty=(old:ConversationIndex)=>Array.isArray(old.dirtyRooms)&&old.dirtyRooms.every(room=>typeof room==='string'&&/^(axonic:1:|group:)[a-f0-9]{64}$/.test(room));
 async function rebuild(old:ConversationIndex|null){await d.set(meta,JSON.stringify({...old,version:2,owner,generation:old?.generation??0,dirty:true,dirtyRooms:undefined}));metrics.sourceReads++;return publish(await d.readSource(),old,false);}
 async function ensure(){const old=await existing();if(old&&!old.dirty)return old;
  if(old&&scopedDirty(old)&&d.readRooms)return publishRooms(old,old.dirtyRooms!,await d.readRooms(old.dirtyRooms!));
  return rebuild(old);
 }
 async function checked(key:string,expected:string){if(!key.startsWith(conversationCachePrefix(owner)))throw new InvalidProjection();if(key.endsWith(':lookup'))metrics.lookupReads++;else metrics.pageReads++;const raw=await d.get(key);if(raw===null||hash(raw)!==expected)throw new InvalidProjection('Conversation index needs recovery');try{return JSON.parse(raw);}catch{throw new InvalidProjection();}}
 async function window(index:ConversationIndex,key:string,minimum:number,through?:MessagePosition):Promise<ConversationWindow>{
  const room=index.rooms[key];if(!room)return {generation:index.generation,messages:[],references:[],hasMore:false};
  const cache=new Map<number,RootChatMessage[]>();
  async function page(n:number){let rows=cache.get(n);if(!rows){rows=await checked(room.pages[n].key,room.pages[n].hash) as RootChatMessage[];if(!Array.isArray(rows))throw new InvalidProjection();cache.set(n,rows);}return rows;}
  const newestFirst:RootChatMessage[][]=[];
  let count=0,n=room.pages.length;
  while(n>0){
   const rows=await page(--n);
   newestFirst.push(rows);count+=rows.length;
   if(count>=minimum&&(!through||comparePositions(messagePosition(rows[0],owner),through)<=0))break;
  }
  const rows=newestFirst.reverse().flat();
  let start=Math.max(0,rows.length-minimum);
  if(through){const anchor=rows.findIndex(m=>comparePositions(messagePosition(m,owner),through)>=0);if(anchor>=0)start=Math.min(start,anchor);}
  const messages=rows.slice(start),hasMore=n>0||start>0,refs=new Map<string,RootChatMessage>();
  const loaded=new Set(messages.map(m=>{const p=messagePosition(m,owner);return referenceKey(p.id,p.author);}));
  const missing=new Set(messages.filter(m=>m.reply).map(m=>referenceKey(m.reply!.id,m.reply!.author)).filter(k=>!loaded.has(k)));
  if(missing.size){const lookup=await checked(room.lookupKey,room.lookupHash) as Record<string,number>;
   for(const key of missing){const n=lookup[key];if(n===undefined)continue;if(!Number.isInteger(n)||n<0||n>=room.pages.length)throw new InvalidProjection();
    const target=(await page(n)).find(m=>{const p=messagePosition(m,owner);return referenceKey(p.id,p.author)===key;});if(target)refs.set(key,target);
   }
  }
  return {generation:index.generation,messages,references:[...refs.values()],hasMore,oldest:messages[0]?messagePosition(messages[0],owner):undefined};
 }
 return {
  diagnostics:()=>({...metrics}),
  index:()=>serial(ensure),
  readWindow:(key:string,minimum=50,through?:MessagePosition)=>serial(async()=>{
   if(!Number.isSafeInteger(minimum)||minimum<1)throw Error('Invalid history page size');
   const index=await ensure();try{return await window(index,key,minimum,through);}catch(e){if(!(e instanceof InvalidProjection))throw e;return window(await rebuild(index),key,minimum,through);}
  }),
  patch:(rooms:string[],readPartial:()=>Promise<string>,commit:()=>Promise<void>)=>serial(async()=>{
   const old=await existing(),dirtyRooms=old&&(!old.dirty||scopedDirty(old))?[...new Set([...(old.dirty?old.dirtyRooms!:[]),...rooms])]:undefined;
   await d.set(meta,JSON.stringify({...old,version:2,owner,generation:old?.generation??0,dirty:true,dirtyRooms}));
   await commit();
   if(!old||old.dirty||d.deferProjection?.())return;
   try{
    await publishRooms(old,rooms,await readPartial());
   }catch{/* Committed canonical state survives; dirty projection recovers on next read. */}
  }),
  write:(raw:string,commit:()=>Promise<void>)=>serial(async()=>{
   const old=await existing();await d.set(meta,JSON.stringify({...old,version:2,owner,generation:old?.generation??0,dirty:true,dirtyRooms:undefined}));
   await commit();
   // Background delivery only needs the canonical commit. The durable dirty
   // marker makes the next UI read rebuild; no timer or extra worker is needed.
   if(d.deferProjection?.())return;
   // An index failure must not report an already committed send as failed.
   try{await publish(raw,old,!!old&&!old.dirty);}catch{/* Durable dirty marker forces recovery on the next UI read. */}
  }),
 };
}

