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
 let busy=false;
 return {async run(){
  if(busy||!d.current())return;busy=true;
  try{
   if(!d.current())return;
   const rows=await d.read(),state=await d.snapshot();let attempts=0;
   // Delete only recorded exports belonging to messages explicitly deleted or
   // removed locally. Other copies and media from other applications are untouched.
   for(const [digest,row] of Object.entries(rows)){
    if(!d.current())return;
    if(!row.peer||!row.id||!d.remove)continue;
    const message=state.messages.find(m=>m.peer===row.peer&&m.id===row.id&&m.direction==='incoming');
    const removed=state.removedMessages?.some(m=>m.peer===row.peer&&m.id===row.id&&m.direction==='incoming');
    if(message?.deleted||removed){if(await d.remove(digest,row.uri)){delete rows[digest];await d.write(rows);}continue;}
   }
   if(!await d.enabled()||!d.current())return;
   for(const m of state.messages){
    if(!d.current())return;
    const a=m.attachment;
    if(!a||m.direction!=='incoming'||m.status!=='delivered'||m.deleted||a.name===IMPORTED_STICKER_CONTENT
     ||state.hiddenChats?.includes(m.group?'group:'+m.group.id:m.peer)
     ||state.contacts.some(c=>c.account===m.peer&&c.blocked))continue;
    if(m.group?!state.groups?.some(g=>g.id===m.group!.id&&g.accepted&&!g.blocked):!state.contacts.some(c=>c.account===m.peer&&c.accepted))continue;
    const digest=attachmentDigest(a.manifest);
    if(rows[digest]){await d.link?.(digest,rows[digest].uri);continue;}
    const source=d.source(digest);if(!source)continue;
    if(attempts++>=10)break;
    const kind=a.mime.startsWith('image/')?'image':a.mime.startsWith('video/')?'video':'document';
    const extension:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','audio/mp4':'m4a','audio/ogg':'ogg','audio/mpeg':'mp3'};
    const supplied=a.name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').slice(0,80)||'Attachment';
    const name=`AXN_${digest}__${supplied}${/\.[a-zA-Z0-9]{1,10}$/.test(supplied)?'':'.'+(extension[a.mime]||'bin')}`;
    try{
     const uri=await d.save(source,name,a.mime,kind);
     // Persist even if the account locks during the native copy: this journal
     // is bound to the original owner and prevents duplicate exports on unlock.
     rows[digest]={uri,peer:m.peer,id:m.id};await d.write(rows);
     if(d.current())await d.link?.(digest,uri);
    }catch{/* Private file remains usable; retry next pass. Native save is idempotent. */}
   }
  }finally{busy=false;}
 }};
}
