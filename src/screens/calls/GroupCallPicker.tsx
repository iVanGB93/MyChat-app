import {t} from '../../localization/language';
import {MAX_GROUP_CALL_PARTICIPANTS} from '../../modules/calls';
import OutgoingCallAppearance from './OutgoingCallAppearance';
import React,{useRef,useState} from 'react';
import {Modal,View,Text,Pressable,ScrollView} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import Avatar from '../../components/ui/Avatar';

/** Mounted anew for each invitation; selection never changes group membership. */
export default function GroupCallPicker({name,members,initialKind,onClose,onCall,existingCount=1}:{
 existingCount?:number;name:string;members:{id:string;name:string;avatar?:string|null;blocked:boolean}[];
 initialKind:'voice'|'video';onClose():void;onCall(ids:string[],kind:'voice'|'video'):Promise<void>;
}){
 const {colors}=useTheme(),limit=MAX_GROUP_CALL_PARTICIPANTS-existingCount;
 const [kind,setKind]=useState(initialKind),[selected,setSelected]=useState(()=>{const all=members.filter(m=>!m.blocked).map(m=>m.id);return existingCount===1&&all.length<=limit?all:[];});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false);
 const eligible=members.filter(m=>!m.blocked),ids=selected.filter(id=>eligible.some(m=>m.id===id));
 const close=()=>{if(!pending.current)onClose();};
 const start=async()=>{if(pending.current||!ids.length||ids.length>limit)return;pending.current=true;setBusy(true);setError('');try{await onCall(ids,kind);onClose();}catch(e){setError(e instanceof Error?e.message:t("Could not start call"));}finally{pending.current=false;setBusy(false);}};
 return <Modal transparent animationType="slide" onRequestClose={close}>
 <OutgoingCallAppearance adding={existingCount>1} name={name} kind={kind} busy={busy} error={error} start={()=>void start()} cancel={close} switchKind={()=>{if(!pending.current)setKind(kind==='voice'?'video':'voice');}} selectedCount={ids.length} members={<>
    <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}><Text style={{color:colors.textSecondary}}>{t("Call members ·")}{ids.length} {t("selected")}</Text><Pressable disabled={busy||!ids.length&&eligible.length>limit} onPress={()=>setSelected(ids.length?[]:eligible.slice(0,limit).map(m=>m.id))}><Text style={{color:colors.primary}}>{ids.length?'Clear':eligible.length<=limit?t("Select all"):''}</Text></Pressable></View>
    <Text style={{color:colors.textSecondary,marginBottom:8}}>{t("Up to")}{' '}{MAX_GROUP_CALL_PARTICIPANTS} {t("people, including you.")}</Text>
    <ScrollView testID="group-call-members" style={{flexGrow:0,flexShrink:1}} keyboardShouldPersistTaps="handled">{members.map(member=>{const checked=ids.includes(member.id),unavailable=busy||member.blocked||!checked&&ids.length>=limit;return <Pressable key={member.id} accessibilityRole="checkbox" accessibilityLabel={member.name} accessibilityState={{checked,disabled:unavailable}} disabled={unavailable} onPress={()=>setSelected(old=>old.includes(member.id)?old.filter(id=>id!==member.id):[...old,member.id])} style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,opacity:unavailable?0.45:1}}><Avatar name={member.name} uri={member.avatar} size={44}/><View style={{flex:1}}><Text numberOfLines={1} style={{color:colors.text,fontSize:16}}>{member.name}</Text>{member.blocked&&<Text style={{color:colors.textSecondary}}>{t("Blocked")}</Text>}</View><Ionicons name={checked?'checkmark-circle':'ellipse-outline'} size={26} color={checked?colors.primary:colors.textSecondary}/></Pressable>;})}</ScrollView>
 </>}/>
 </Modal>;
}
