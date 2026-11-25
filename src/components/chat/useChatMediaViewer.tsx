import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {hasConfirmedDelivery,type RootChatMessage} from '../../modules/messaging';
import {useAccountState} from '../../modules/ui/liveState';
import {isGroupAvatarFile} from '../../services/group-avatar-file';
import {IMPORTED_STICKER_CONTENT} from '../../services/sticker-file-format';
import MediaViewer,{type MediaViewerItem} from './MediaViewer';

const mediaId=(message:RootChatMessage)=>JSON.stringify([
 message.direction,message.direction==='incoming'?message.peer:null,message.group?.messageId??message.id,
]);

export function chatMediaKind(mime:string){
 if(/^image\/(jpeg|png|gif|webp|heic|heif|avif)$/.test(mime))return 'image';
 if(mime.startsWith('video/'))return 'video';
}

export function conversationMediaItems(newestFirst:readonly RootChatMessage[],owner:string){
 const items:MediaViewerItem[]=[],seen=new Set<string>();
 for(let i=newestFirst.length-1;i>=0;i--){
  const message=newestFirst[i],attachment=message.attachment;
  if(message.deleted||message.localPending||!attachment||attachment.name===IMPORTED_STICKER_CONTENT||
    message.group&&isGroupAvatarFile(attachment))continue;
  const kind=chatMediaKind(attachment.mime),id=mediaId(message);
  if(!kind||seen.has(id))continue;
  seen.add(id);
  items.push({id,kind,name:attachment.name,mimeType:attachment.mime,size:attachment.manifest.bytes,caption:attachment.caption,
   local:{owner,manifest:attachment.manifest,available:message.direction==='outgoing'||hasConfirmedDelivery(message),delivery:message.status}});
 }
 return items;
}

export function useChatMediaViewer(scope:string,messages:readonly RootChatMessage[],older?:React.ComponentProps<typeof MediaViewer>['older']){
 const account=useAccountState(),owner=account.state==='unlocked'?account.account:null;
 const [view,setView]=useState<{owner:string;scope:string;id:string}>();
 const open=useCallback((message:RootChatMessage)=>{if(owner)setView({owner,scope,id:mediaId(message)});},[owner,scope]);
 const active=!!view&&!!owner&&view.owner===owner&&view.scope===scope;
 useEffect(()=>{if(!active&&view)setView(undefined);},[active,view]);
 const items=useMemo(()=>active&&owner?conversationMediaItems(messages,owner):[],[active,messages,owner]);
 const modal=active&&view&&items.length>0&&<MediaViewer key={view.id} items={items} initialId={view.id} older={older} onClose={()=>setView(undefined)}/>;
 return {open,modal};
}
