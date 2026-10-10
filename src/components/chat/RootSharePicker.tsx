import {withRootSharedFile} from '../../modules/storage';
import {AttachmentPreviewContent,useAttachmentPreview} from './AttachmentPreview';
import React,{createContext,useContext,useRef,useState,useEffect} from 'react';
import {Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {useShareIntent} from 'expo-share-intent';
import {localAccount,shortIdentity} from '../../modules/identity';
import {conversations,messaging,queueRootAttachmentSource,queueRootGroupAttachmentSource,rootGroupAttachmentAudience,type RootChatState} from '../../modules/messaging';
import {sharedItems,sharedBatch} from '../../modules/ui/sharedContent';
import {useTheme} from '../../contexts/ThemeContext';
import {chatRoomStyles as styles} from './chat-room-styles';

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
 const choices=[...(state?.contacts??[]).filter(c=>!c.blocked).map(c=>({id:c.account,name:c.alias||shortIdentity(c.account)})),...(state?.groups??[]).filter(g=>g.accepted&&!g.blocked&&g.members.includes(localAccount.status().account!)).map(g=>({id:'group:'+g.id,name:g.name}))];
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
 return <><Modal visible={!preview.isOpen} transparent animationType="fade" onRequestClose={close}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={[styles.forwardPanel,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}>
  <Text style={[styles.forwardTitle,{color:colors.text}]}>Share to Axonic</Text>
  <ScrollView style={{maxHeight:320}}>{draft?.items.map((item,i)=>'text' in item?<Text key={i} numberOfLines={3} style={{color:colors.textSecondary,padding:8}}>{item.text}</Text>:<AttachmentPreviewContent key={i} draft={item}/>)}</ScrollView>
  {!!(error||validation||intent.error)&&<Text accessibilityRole="alert" style={{color:colors.error,padding:12}}>{error||validation||intent.error}</Text>}
  <ScrollView style={{maxHeight:260}}>{choices.map(c=><Pressable key={c.id} disabled={busy||!!draft?.batch.target} accessibilityRole="radio" accessibilityState={{selected:target===c.id}} onPress={()=>setSelected(c.id)} style={styles.forwardRow}><Text style={[styles.forwardRowText,{color:target===c.id?colors.primary:colors.text}]}>{target===c.id?'✓ ':''}{c.name}</Text></Pressable>)}</ScrollView>
  {!choices.length&&<Text style={{color:colors.textSecondary,padding:12}}>Start a conversation in Axonic, then share again.</Text>}
  {!!draft?.batch.completed&&<Text style={{color:colors.textSecondary,padding:8}}>{draft.batch.completed} of {draft.items.length} items queued. Retry continues with the remaining items.</Text>}
  <Pressable accessibilityLabel="Send shared content" disabled={busy||!target||!draft} onPress={()=>void send()} style={{padding:16,opacity:busy||!target||!draft?0.5:1}}><Text style={{color:colors.primary}}>{busy?'Queuing…':'Send'}</Text></Pressable>
  <Pressable disabled={busy} onPress={close} style={{padding:16}}><Text style={{color:colors.primary}}>Cancel</Text></Pressable>
 </View></View></Modal>{preview.modal}</>;
}
