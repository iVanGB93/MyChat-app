import {withRootSharedFile} from '../../modules/storage';
import {useAttachmentPreview} from './AttachmentPreview';
import React,{createContext,useContext,useRef,useState,useEffect} from 'react';
import {Image,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import ConversationRecipientPicker from './ConversationRecipientPicker';
import {useShareIntent} from 'expo-share-intent';
import {localAccount,shortIdentity} from '../../modules/identity';
import {conversations,messaging,type RootChatState} from '../../modules/messaging';
import {queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience} from '../../modules/media';
import {sharedItems,sharedBatch} from '../../modules/ui/sharedContent';
import {useTheme} from '../../contexts/ThemeContext';

type Pending={reviewed?:boolean;key:string;items:ReturnType<typeof sharedItems>;batch:ReturnType<typeof sharedBatch>};
const Context=createContext<null|{pending:React.MutableRefObject<Pending|null>;intent:ReturnType<typeof useShareIntent>}>(null);
export function RootShareProvider({children}:{children:React.ReactNode}){
 const intent=useShareIntent({resetOnBackground:false}),pending=useRef<Pending|null>(null);
 return <Context.Provider value={{intent,pending}}>{children}</Context.Provider>;
}
export default function RootSharePicker({onSent}:{onSent(target:string):void}){
 const context=useContext(Context)!,{intent,pending}=context,{colors}=useTheme();
 const [state,setState]=useState<RootChatState>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState('');
 const preview=useAttachmentPreview();
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!intent.hasShareIntent)return;let alive=true;void conversations().snapshot().then(s=>{if(alive)setState(s);}).catch(()=>{if(alive)setError('Unable to read conversations.');});return()=>{alive=false;};},[intent.hasShareIntent]);
 if(!intent.hasShareIntent&&!intent.error)return null;
 const key=JSON.stringify(intent.shareIntent);
 let validation='';
 try{if(!pending.current||pending.current.key!==key){const items=sharedItems(intent.shareIntent);pending.current={key,items,batch:sharedBatch(items)};}}catch(e){validation=e instanceof Error?e.message:'Unable to read shared content.';}
 const draft=validation?null:pending.current;
 const close=()=>{if(busy||pending.current?.batch.busy)return;pending.current=null;setSelected('');setError('');intent.resetShareIntent();};
 const choices=[...(state?.contacts??[]).filter(c=>!c.blocked).map(c=>({id:c.account,name:c.alias||shortIdentity(c.account)})),...(state?.groups??[]).filter(g=>g.accepted&&!g.blocked&&g.members.includes(localAccount.status().account!)).map(g=>({id:'group:'+g.id,name:g.name,group:true}))];
 const target=draft?.batch.target||selected;
 async function send(){
  if(!draft||!target||busy)return;
  const owner=localAccount.status().account;if(!owner)return;
  setBusy(true);setError('');
  try{
   if(!draft.reviewed){
    const files=draft.items.filter((item):item is Exclude<typeof item,{text:string}>=>!('text' in item));
    if(files.length){const reviewed=await preview.confirm(files);if(!reviewed)return;draft.items=[...draft.items.filter(item=>'text' in item),...reviewed];draft.batch=sharedBatch(draft.items);}
    draft.reviewed=true;
   }
   const result=await draft.batch.send(owner,target,()=>localAccount.status().state==='unlocked'&&localAccount.status().account===owner,async item=>{
    const fresh=await conversations().snapshot();
    if(localAccount.status().state!=='unlocked'||localAccount.status().account!==owner)throw Error('Unlock your account to continue.');
    const group=target.startsWith('group:')?target.slice(6):null;
    if(group){const g=fresh.groups?.find(g=>g.id===group);if(!g||g.blocked||!g.accepted||!g.members.includes(owner))throw Error('Choose an active group.');}
    else if(!fresh.contacts.some(c=>c.account===target&&!c.blocked))throw Error('This conversation is unavailable or blocked.');
    if('text' in item)return group?messaging.sendGroupText(group,item.text,undefined,owner):messaging.sendText(target,item.text,undefined,owner);
    return withRootSharedFile(owner,item.uri,async uri=>group?queueRootGroupAttachmentSource(await rootGroupAttachmentAudience(group),uri,item.name,item.mime,item.caption):queueRootAttachmentSource(target,uri,item.name,item.mime,owner,undefined,item.caption));
   });
   if(result&&pending.current===draft){pending.current=null;intent.resetShareIntent();if(mounted.current){setSelected('');onSent(target);}}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to share. Try again.');}
  finally{if(mounted.current)setBusy(false);}
 }
 const first=draft?.items[0],file=first&&!('text' in first)?first:null;
 const content=first&&'text' in first?first.text:file?.caption||file?.name||'Shared content';
 const previewContent=draft&&<View style={{flexDirection:'row',alignItems:'center',gap:12}}>
  {file?.mime.startsWith('image/')?<Image source={{uri:file.uri}} accessibilityLabel="Shared image preview" style={{width:56,height:56,borderRadius:10}}/>:<Ionicons name={file?file.mime.startsWith('video/')?'videocam-outline':file.mime.startsWith('audio/')?'musical-notes-outline':'document-outline':'chatbubble-outline'} size={28} color={colors.primary}/>}
  <View style={{flex:1,gap:4}}><Text style={{color:colors.primary,fontSize:12,fontWeight:'600'}}>{draft.items.length===1?'SHARED CONTENT':`${draft.items.length} ITEMS TO SHARE`}</Text><Text numberOfLines={2} style={{color:colors.text,fontSize:14}}>{content}</Text></View>
 </View>;
 return <><ConversationRecipientPicker visible={!preview.isOpen} title="Share to Axonic" choices={choices} selected={draft?target:''} busy={busy} locked={!!draft?.batch.target} loading={!state&&!error} preview={previewContent}
  description={draft?.batch.completed?`${draft.batch.completed} of ${draft.items.length} items queued. Retry sends the remaining items.`:'Select a conversation. You can review media before sending.'}
  error={error||validation||intent.error||undefined} submitLabel="Send" onSelect={setSelected} onSubmit={()=>void send()} onClose={close}/>{preview.modal}</>;
}
