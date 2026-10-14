import ScreenHeader from '../ui/ScreenHeader';
import React,{useEffect,useState} from 'react';
import {ActivityIndicator,FlatList,Keyboard,Modal,Pressable,StyleSheet,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../../contexts/ThemeContext';
import {localAccount} from '../../modules/identity';
import {readSharedAvatar,subscribeSharedAvatars} from '../../modules/storage';
import Avatar from '../ui/Avatar';
import {KeyboardAvoidingScreen,KeyboardAwareTextInput} from '../ui/KeyboardForm';

export type ConversationRecipient={id:string;name:string;group?:boolean};
export default function ConversationRecipientPicker({visible=true,title,description,choices,selected,busy,locked=false,loading=false,error,preview,submitLabel,onSelect,onSubmit,onClose}:{
 visible?:boolean;title:string;description:string;choices:ConversationRecipient[];selected:string;busy:boolean;locked?:boolean;loading?:boolean;
 error?:string;preview?:React.ReactNode;submitLabel:string;onSelect(id:string):void;onSubmit():void;onClose():void;
}){
 const {colors}=useTheme(),insets=useSafeAreaInsets(),[query,setQuery]=useState(''),[avatars,setAvatars]=useState<Record<string,string|null>>({}),[keyboardShown,setKeyboardShown]=useState(false);
 useEffect(()=>{const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardShown(true)),hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardShown(false));return()=>{show.remove();hide.remove();};},[]);
 const owner=localAccount.status().account,peers=choices.filter(c=>!c.group).map(c=>c.id).sort().join(',');
 useEffect(()=>{
  if(!visible)return;let active=true,revision=0;setQuery('');setAvatars({});
  const refresh=async()=>{const epoch=++revision;if(!owner)return;
   const pairs=await Promise.all(peers.split(',').filter(Boolean).map(async peer=>[peer,await readSharedAvatar(owner,peer)] as const));
   if(active&&epoch===revision&&localAccount.status().account===owner&&localAccount.status().state==='unlocked')setAvatars(Object.fromEntries(pairs));
  };
  void refresh().catch(()=>{});const off=subscribeSharedAvatars(()=>void refresh().catch(()=>{}));return()=>{active=false;off();};
 },[owner,peers,visible]);
 const term=query.trim().toLocaleLowerCase(),filtered=choices.filter(c=>c.name.toLocaleLowerCase().includes(term)||c.id.toLocaleLowerCase().includes(term));
 const target=choices.find(c=>c.id===selected),disabled=busy||!target;
 return <Modal visible={visible} animationType="slide" onRequestClose={()=>{if(!busy)onClose();}}>
  <KeyboardAvoidingScreen style={{backgroundColor:colors.background,paddingBottom:insets.bottom}}>
   <ScreenHeader title={title} subtitle="Choose a conversation" backLabel={`Close ${title.toLowerCase()}`} disabled={busy} onBack={onClose}/>
   <View style={{paddingLeft:insets.left+16,paddingRight:insets.right+16,paddingTop:16,gap:12}}>
    {!keyboardShown&&preview&&<View style={[styles.preview,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}>{preview}</View>}
    <View style={[styles.search,{backgroundColor:colors.surface,borderColor:colors.neonBorder}]}>
     <Ionicons name="search-outline" size={20} color={colors.textSecondary}/>
     <KeyboardAwareTextInput accessibilityLabel="Search conversations" placeholder="Search conversations" placeholderTextColor={colors.textTertiary} value={query} onChangeText={setQuery} editable={!busy&&!locked} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[styles.searchInput,{color:colors.text}]}/>
     {!!query&&<Pressable accessibilityRole="button" accessibilityLabel="Clear search" disabled={busy||locked} onPress={()=>setQuery('')} style={styles.clear}><Ionicons name="close-circle" size={20} color={colors.textSecondary}/></Pressable>}
    </View>
    {!keyboardShown&&<Text style={[styles.description,{color:colors.textSecondary}]}>{description}</Text>}
   </View>
   <FlatList data={filtered} keyExtractor={item=>item.id} style={{flex:1,minHeight:0}} contentContainerStyle={{paddingHorizontal:16,paddingLeft:insets.left+16,paddingRight:insets.right+16,paddingVertical:12,flexGrow:1}} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    ListEmptyComponent={<View style={styles.empty}>{loading?<ActivityIndicator color={colors.primary}/>:<><Ionicons name={term?'search-outline':'chatbubbles-outline'} size={40} color={colors.textTertiary}/><Text style={[styles.emptyTitle,{color:colors.text}]}>{term?'No conversations found':'No conversations yet'}</Text><Text style={[styles.emptyHint,{color:colors.textSecondary}]}>{term?'Try another name or identity code.':'Start a conversation in Axonic, then try again.'}</Text></>}</View>}
    renderItem={({item})=>{const checked=item.id===selected;return <Pressable accessibilityRole="radio" accessibilityLabel={item.name} accessibilityState={{checked,disabled:busy||locked}} disabled={busy||locked} onPress={()=>onSelect(item.id)} style={({pressed})=>[styles.row,{backgroundColor:checked?colors.highlight:colors.surface,borderColor:checked?colors.primary:colors.divider,opacity:pressed?0.75:1}]}>
     {item.group?<View style={[styles.groupAvatar,{backgroundColor:colors.surfaceVariant,borderColor:colors.primary}]}><Ionicons name="people-outline" size={23} color={colors.primary}/></View>:<Avatar name={item.name} uri={avatars[item.id]} size={44}/>}
     <View style={{flex:1,gap:3}}><Text numberOfLines={1} style={[styles.name,{color:colors.text}]}>{item.name}</Text><Text style={{color:colors.textSecondary,fontSize:12}}>{item.group?'Group':'Private conversation'}</Text></View>
     <Ionicons name={checked?'radio-button-on':'radio-button-off'} size={22} color={checked?colors.primary:colors.textTertiary}/>
    </Pressable>;}}/>
   <View style={[styles.footer,{backgroundColor:colors.background,borderTopColor:colors.divider,paddingLeft:insets.left+16,paddingRight:insets.right+16}]}>
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.error,marginBottom:12}}>{error}</Text>}
    {!!target&&<Text numberOfLines={1} style={{color:colors.textSecondary,marginBottom:10}}>To: {target.name}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={submitLabel} accessibilityState={{disabled,busy}} disabled={disabled} onPress={onSubmit} style={({pressed})=>[styles.submit,{backgroundColor:disabled?colors.surfaceVariant:colors.primary,opacity:pressed?0.8:1}]}>
     {busy?<ActivityIndicator color={colors.textSecondary}/>:<Ionicons name="send" size={19} color={disabled?colors.textTertiary:colors.textInverse}/>}
     <Text style={{fontSize:16,fontWeight:'700',color:disabled?colors.textTertiary:colors.textInverse}}>{busy?'Sending…':submitLabel}</Text>
    </Pressable>
   </View>
  </KeyboardAvoidingScreen>
 </Modal>;
}
const styles=StyleSheet.create({
 preview:{borderWidth:1,borderRadius:16,padding:14,gap:8},search:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,borderRadius:14,borderWidth:1,minHeight:48},searchInput:{flex:1,minWidth:0,paddingVertical:12,fontSize:16},clear:{width:32,height:40,alignItems:'center',justifyContent:'center'},description:{fontSize:13,lineHeight:19},
 row:{flexDirection:'row',alignItems:'center',gap:12,padding:12,borderRadius:16,borderWidth:1,marginBottom:8},groupAvatar:{width:44,height:44,borderRadius:22,borderWidth:2,alignItems:'center',justifyContent:'center'},name:{fontSize:16,fontWeight:'600'},empty:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:24},emptyTitle:{fontSize:18,fontWeight:'600'},emptyHint:{fontSize:14,textAlign:'center',lineHeight:21},footer:{padding:16,borderTopWidth:1},submit:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10,padding:16,borderRadius:14,minHeight:52},
});
