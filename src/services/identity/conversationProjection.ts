import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {rootChatView} from './rootChatActions';
import {rootGroupMessageIndex,rootGroupPhoto} from './rootGroups';
import {compareRootMessages,type RootChatMessage,type RootChatState} from './rootChatTypes';

export const CONVERSATION_PAGE_SIZE=50;
export type MessagePosition={at:number;id:string;author:string};
export const messagePosition=(m:RootChatMessage,owner:string):MessagePosition=>({at:m.at,id:m.group?.messageId??m.id,author:m.direction==='outgoing'?owner:m.peer});
export const comparePositions=(a:MessagePosition,b:MessagePosition)=>a.at-b.at||(a.id<b.id?-1:a.id>b.id?1:0)||(a.author<b.author?-1:a.author>b.author?1:0);
export const conversationKey=(m:RootChatMessage)=>m.group?'group:'+m.group.id:m.peer;
export const referenceKey=(id:string,author:string)=>JSON.stringify([id,author]);
export type ConversationPreview=Pick<RootChatMessage,'id'|'direction'|'text'|'at'|'status'|'read'|'deleted'|'retiredAttachment'|'networkCancelledAt'|'descriptorDelivered'|'networkStoredUntil'|'attachmentStoredUntil'> & {attachment?:{name:string;mime?:string;caption?:string}};
export type ConversationSummary={key:string;count:number;unread:number;last?:ConversationPreview};
export type ConversationIndex={version:2;owner:string;generation:number;dirty?:boolean;dirtyRooms?:string[];state:RootChatState;summaries:Record<string,ConversationSummary>;rooms:Record<string,{count:number;pages:{key:string;hash:string;first:MessagePosition;last:MessagePosition}[];lookupKey:string;lookupHash:string}>};
export const projectionHash=(raw:string)=>bytesToHex(sha256(new TextEncoder().encode(raw)));
export const conversationCachePrefix=(owner:string)=>'@axonic_conversations_v1:'+owner+':';
/** Compare the same selected ledger rows before/after a commit. Transport-only
 * action acknowledgments do not change the conversation's presentation. */
export function conversationPresentationChanged(owner:string,before:RootChatState,after:RootChatState){
 const visible=(state:RootChatState)=>{const view=rootChatView(owner,state);
  // A selected action may refer to an unloaded message. Retain its content and
  // identity in this comparison; only delivery bookkeeping is invisible.
  const actions=[...(state.actions??[]),...(state.groupActions??[])].map(({status,...action})=>action);
  return [view.contacts,view.groups,view.hiddenChats,view.messages,actions];};
 return JSON.stringify(visible(before))!==JSON.stringify(visible(after));
}
// The existing native SHA-256 port accepts ASCII. JSON escapes preserve every
// UTF-16 code unit (including emoji pairs) while keeping identical portable hashes.
export const conversationPageJSON=(value:unknown)=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function buildConversationProjection(owner:string,raw:string|null,generation:number,hash:typeof projectionHash=projectionHash){
 const source:RootChatState=raw===null?{version:1,messages:[],contacts:[]}:JSON.parse(raw);
 if(source.version!==1||!Array.isArray(source.messages)||!Array.isArray(source.contacts))throw Error('Invalid chat history');
 const view=rootChatView(owner,source),groups=rootGroupMessageIndex(view),rooms=new Map<string,RootChatMessage[]>();
 for(const m of view.messages)if(!m.group){const rows=rooms.get(m.peer)??[];rows.push(m);rooms.set(m.peer,rows);}
 for(const [id,rows] of groups)rooms.set('group:'+id,rows);
 const index:ConversationIndex={version:2,owner,generation,state:{version:1,contacts:view.contacts,groups:view.groups,hiddenChats:view.hiddenChats,messages:[]},summaries:{},rooms:{}};
 const values=new Map<string,string>(),prefix=conversationCachePrefix(owner),all:RootChatMessage[]=[];
 for(const [key,rows] of rooms){
  rows.sort((a,b)=>compareRootMessages(a,b,owner));all.push(...rows);
  const m=rows.at(-1);let last:ConversationPreview|undefined;
  if(m){const {id,direction,text,at,status,read,deleted,retiredAttachment,networkCancelledAt,descriptorDelivered,networkStoredUntil,attachmentStoredUntil}=m;
   const media=m.localMedia??m.attachment;
   last={id,direction,text,at,status,read,deleted,retiredAttachment:retiredAttachment?true:undefined,networkCancelledAt,descriptorDelivered,networkStoredUntil,attachmentStoredUntil,...(!deleted&&media?{attachment:{name:media.name,mime:media.mime,caption:media.caption}}:{})};}
  index.summaries[key]={key,count:rows.length,unread:rows.filter(m=>m.direction==='incoming'&&!m.read&&!m.deleted).length,last};
  const base=prefix+key+':',lookupKey=base+'lookup',lookup:Record<string,number>={};
  const pages:ConversationIndex['rooms'][string]['pages']=[];
  for(let offset=0;offset<rows.length;offset+=CONVERSATION_PAGE_SIZE){const page=rows.slice(offset,offset+CONVERSATION_PAGE_SIZE),key=base+'page:'+pages.length,raw=conversationPageJSON(page);
   for(const m of page){const p=messagePosition(m,owner);lookup[referenceKey(p.id,p.author)]=pages.length;}
   values.set(key,raw);pages.push({key,hash:hash(raw),first:messagePosition(page[0],owner),last:messagePosition(page[page.length-1],owner)});
  }
  const rawLookup=conversationPageJSON(lookup);values.set(lookupKey,rawLookup);index.rooms[key]={count:rows.length,pages,lookupKey,lookupHash:hash(rawLookup)};
 }
 // Only selected group-avatar records accompany the summaries, not their histories.
 const photoState={...view,messages:all};for(const group of view.groups??[]){const photo=rootGroupPhoto(photoState,group.id,owner);if(photo)index.state.messages.push(photo);}
 return {index,values};
}
