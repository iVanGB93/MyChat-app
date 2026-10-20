import type {RootChatState} from './rootChatTypes';
import {attachmentDigest} from './attachmentProtocol';
import {IMPORTED_STICKER_CONTENT} from '../sticker-file-format';

export type MediaExportRecord={uri:string;peer?:string;id?:string};
/** Export only completed personal messages, never network custody or partial downloads. */
export function createReceivedMediaExporter(d:{
 current():boolean; snapshot():Promise<RootChatState>; enabled():Promise<boolean>;
 read():Promise<Record<string,MediaExportRecord>>; write(rows:Record<string,MediaExportRecord>):Promise<void>;
 source(digest:string):string|null;
 save(uri:string,name:string,mime:string,kind:string):Promise<string>;
 link?(digest:string,uri:string):Promise<void>;
 remove?(digest:string,uri:string):Promise<boolean>;
}){
 let busy=false,retry=false;
 return {nextDelay:()=>retry?15000:Infinity,async run(){
  if(busy||!d.current())return;busy=true;
  try{retry=false;
   if(!d.current())return;
   const rows=await d.read(),state=await d.snapshot();let attempts=0;
   const incoming=new Map<string,RootChatState['messages'][number]>(),removed=new Set<string>();
   const key=(peer:string,id:string)=>peer+':'+id;
   // Match first-reference semantics without a full history search per export.
   for(const m of state.messages)if(m.direction==='incoming'&&!incoming.has(key(m.peer,m.id)))incoming.set(key(m.peer,m.id),m);
   for(const m of state.removedMessages??[])if(m.direction==='incoming')removed.add(key(m.peer,m.id));
   // Delete only recorded exports belonging to messages explicitly deleted or
   // removed locally. Other copies and media from other applications are untouched.
   for(const [digest,row] of Object.entries(rows)){
    if(!d.current())return;
    if(!row.peer||!row.id||!d.remove)continue;
    const message=incoming.get(key(row.peer,row.id));
    if(message?.deleted||removed.has(key(row.peer,row.id))){if(await d.remove(digest,row.uri)){delete rows[digest];await d.write(rows);}continue;}
   }
   if(!await d.enabled()||!d.current())return;
   const blocked=new Set(state.contacts.filter(c=>c.blocked).map(c=>c.account)),accepted=new Set(state.contacts.filter(c=>c.accepted).map(c=>c.account));
   const groups=new Set(state.groups?.filter(g=>g.accepted&&!g.blocked).map(g=>g.id)),hidden=new Set(state.hiddenChats);
   let saved=0;
   for(const m of state.messages){
    if(!d.current())return;
    const a=m.attachment;
    if(!a||m.direction!=='incoming'||m.status!=='delivered'||m.deleted||a.name===IMPORTED_STICKER_CONTENT
     ||hidden.has(m.group?'group:'+m.group.id:m.peer)||blocked.has(m.peer))continue;
    if(m.group?!groups.has(m.group.id):!accepted.has(m.peer))continue;
    const digest=attachmentDigest(a.manifest);
    if(rows[digest]){await d.link?.(digest,rows[digest].uri);continue;}
    const source=d.source(digest);if(!source)continue;
    if(attempts++>=10){retry=true;return saved>0;}
    const kind=a.mime.startsWith('image/')?'image':a.mime.startsWith('video/')?'video':'document';
    const extension:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','audio/mp4':'m4a','audio/ogg':'ogg','audio/mpeg':'mp3'};
    const supplied=a.name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').slice(0,80)||'Attachment';
    const name=`AXN_${digest}__${supplied}${/\.[a-zA-Z0-9]{1,10}$/.test(supplied)?'':'.'+(extension[a.mime]||'bin')}`;
    try{
     const uri=await d.save(source,name,a.mime,kind);
     // Persist even if the account locks during the native copy: this journal
     // is bound to the original owner and prevents duplicate exports on unlock.
     rows[digest]={uri,peer:m.peer,id:m.id};await d.write(rows);
     saved++;
     if(d.current())await d.link?.(digest,uri);
    }catch{retry=true;/* Private file remains usable; retry at a bounded deadline. */}
   }
  }finally{busy=false;}
 }};
}
