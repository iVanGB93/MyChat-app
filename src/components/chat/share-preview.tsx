import {t} from '../../localization/language';
import {selectedVideoThumbnail} from '../../modules/storage';
import ZoomablePhotoPreview from './ZoomablePhotoPreview';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Modal,Pressable,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {Image} from 'expo-image';
import {File} from 'expo-file-system';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Chrome} from '../../theme';
import {useTheme} from '../../contexts/ThemeContext';
import {openAttachmentPreview} from '../../modules/ui/openAttachmentPreview';
import ScreenHeader from '../ui/ScreenHeader';
import {KeyboardAvoidingScreen,KeyboardAwareTextInput} from '../ui/KeyboardForm';
import PhotoEditor from './photo-editor';

export interface PreviewItem {id:string;uri:string;name:string;kind:'image'|'video'|'file';caption?:string;width?:number;height?:number;mimeType?:string;size?:number}
const fileSize=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${n} B`;

/** Review reads originals only. A working image is created only after Edit is pressed. */
export default function SharePreview({items,visible,busy,destination,onRemove,onClose,onSend,onUpdate}:{
 items:PreviewItem[];visible:boolean;busy:boolean;destination?:string;
 onRemove(id:string):void;onClose():void;onSend():void;onUpdate(id:string,changes:Partial<PreviewItem>):void;
}){
 const {colors:c}=useTheme(),insets=useSafeAreaInsets(),window=useWindowDimensions();
 const [selected,setSelected]=useState(items[0]?.id),[editing,setEditing]=useState<string>(),[pageWidth,setPageWidth]=useState(window.width);
 const [zoomed,setZoomed]=useState<string>();
 const [sizes,setSizes]=useState<Record<string,number|undefined>>({}),[failed,setFailed]=useState<Record<string,boolean>>({});
 const [videoFrames,setVideoFrames]=useState<Record<string,string|null>>({});
 const videoUris=JSON.stringify([...new Set(items.filter(item=>item.kind==='video').map(item=>item.uri))]);
 useEffect(()=>{
  let active=true;setVideoFrames({});
  if(visible)void (async()=>{for(const uri of JSON.parse(videoUris) as string[]){
   const frame=await selectedVideoThumbnail(uri);if(!active)return;
   setVideoFrames(old=>({...old,[uri]:frame}));
  }})();
  return()=>{active=false;};
 },[videoUris,visible]);
 const pager=useRef<FlatList<PreviewItem>>(null),thumbs=useRef<ScrollView>(null);
 const index=Math.max(0,items.findIndex(item=>item.id===selected)),current=items[index],multiple=items.length>1;
 const editingItem=items.find(item=>item.id===editing);
 const ids=items.map(item=>item.id).join('|');
 useEffect(()=>{if(!visible)return;setSelected(items[index]?.id);pager.current?.scrollToOffset({offset:index*pageWidth,animated:false});},[ids,pageWidth,visible]);
 useEffect(()=>{if(!current)return;try{const file=new File(current.uri);const size=file.exists?file.size:current.size;setSizes(old=>({...old,[current.uri]:size}));}catch{setSizes(old=>({...old,[current.uri]:current.size}));}},[current?.uri,current?.size]);
 const select=(next:number)=>{if(busy)return;const item=items[next];if(!item)return;setSelected(item.id);pager.current?.scrollToOffset({offset:next*pageWidth,animated:true});thumbs.current?.scrollTo({x:Math.max(0,next*68-100),animated:true});};
 const close=()=>{if(!busy)onClose();};
 const control=(label:string,icon:React.ComponentProps<typeof Ionicons>['name'],action:()=>void,danger=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={({pressed})=>({width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:c.headerBg,borderWidth:1,borderColor:c.neonBorder,opacity:busy?.45:pressed?.7:1})}><Ionicons name={icon} size={22} color={danger?c.error:c.primary}/></Pressable>;
 const size=current&&(sizes[current.uri]??current.size);
 return <Modal visible={visible} animationType="slide" onRequestClose={close}>
  <KeyboardAvoidingScreen style={{backgroundColor:c.background,paddingBottom:insets.bottom}}>
   <ScreenHeader title={multiple?t("Review photos & files"):current?.kind==='image'?t("Review photo"):t("Review attachment")} backLabel="Cancel sharing" disabled={busy} onBack={close}/>
   {!!destination&&<Text numberOfLines={1} style={{color:c.textSecondary,marginHorizontal:16,marginBottom:8}}>{t("To")}{' '}{destination}</Text>}
   <View style={{flex:1,minHeight:100}} onLayout={event=>setPageWidth(event.nativeEvent.layout.width)}>
    <FlatList ref={pager} horizontal pagingEnabled scrollEnabled={multiple&&!busy&&zoomed!==current?.id} showsHorizontalScrollIndicator={false} data={items} keyExtractor={item=>item.id} extraData={{pageWidth,failed,selected,videoFrames}} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
     getItemLayout={(_,i)=>({length:pageWidth,offset:pageWidth*i,index:i})}
     onMomentumScrollEnd={event=>{const i=Math.max(0,Math.min(items.length-1,Math.round(event.nativeEvent.contentOffset.x/pageWidth)));setSelected(items[i]?.id);thumbs.current?.scrollTo({x:Math.max(0,i*68-100),animated:true});}}
     renderItem={({item})=><View style={{width:pageWidth,height:'100%',paddingHorizontal:12,justifyContent:'center'}}>
      {item.kind==='image'?<><ZoomablePhotoPreview uri={item.uri} active={item.id===current?.id} onZoomChange={value=>setZoomed(old=>value?item.id:old===item.id?undefined:old)} onError={()=>setFailed(old=>({...old,[item.uri]:true}))}/>{failed[item.uri]&&<Text accessibilityRole="alert" style={{position:'absolute',alignSelf:'center',color:c.text,backgroundColor:c.surface,padding:12,borderRadius:16}}>{t("Preview unavailable")}</Text>}</>:<Pressable accessibilityRole="button" accessibilityLabel={item.kind==='video'?t("Play video"):t("Preview attachment")} disabled={busy} onPress={()=>void openAttachmentPreview(item.uri,item.mimeType||(item.kind==='video'?'video/mp4':'application/octet-stream')).catch(()=>Alert.alert(t("Preview unavailable"),t("A compatible viewer is needed to preview this file.")))} style={{flex:item.kind==='video'?1:undefined,justifyContent:'center',alignItems:'center',gap:16,padding:24}}>{item.kind==='video'&&videoFrames[item.uri]&&<Image source={{uri:videoFrames[item.uri]!}} contentFit="contain" cachePolicy="none" style={{position:'absolute',width:'100%',height:'100%'}}/>}<View style={item.kind==='video'?{backgroundColor:'#0009',borderRadius:40,padding:4}:undefined}><Ionicons name={item.kind==='video'?'play-circle-outline':'document-text-outline'} size={64} color={c.primary}/></View>{!(item.kind==='video'&&videoFrames[item.uri])&&<><Text numberOfLines={2} style={{color:c.text}}>{item.kind==='file'?item.name:t("Video")}</Text><Text style={{color:c.textSecondary}}>{t("Tap to preview")}</Text></>}</Pressable>}
     </View>}/>
    {current&&<View pointerEvents="box-none" style={{position:'absolute',top:8,right:24,flexDirection:'row',gap:8}}>
     {current.kind==='image'&&control('Edit photo','create-outline',()=>setEditing(current.id))}
     {control('Remove attachment','trash-outline',()=>onRemove(current.id),true)}
    </View>}
    {current?.kind==='image'&&<View style={{position:'absolute',bottom:12,left:24,right:24}}><KeyboardAwareTextInput key={current.id} accessibilityLabel={t("Photo caption")} placeholder={t("Add a comment (optional)")} placeholderTextColor={c.textSecondary} value={current.caption||''} onChangeText={caption=>onUpdate(current.id,{caption})} editable={!busy} multiline maxLength={1600} style={{color:c.text,backgroundColor:c.surface,borderWidth:1,borderColor:c.neonBorder,borderRadius:Chrome.controlRadius,paddingHorizontal:16,paddingVertical:12,minHeight:48,maxHeight:100}}/></View>}
   </View>
   <View style={{paddingHorizontal:16,paddingTop:8,paddingBottom:8,gap:8}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:12}}><Text style={{color:c.textSecondary,flex:1}}>{size===undefined?t("Size unavailable"):fileSize(size)}</Text>{multiple&&<Text accessibilityLiveRegion="polite" style={{color:c.textSecondary}}>{index+1} / {items.length}</Text>}<Pressable accessibilityRole="button" accessibilityLabel={t("Send attachments")} disabled={busy||!items.length||!!editingItem} onPress={onSend} style={{minHeight:44,minWidth:60,paddingHorizontal:16,paddingVertical:10,borderRadius:Chrome.controlRadius,alignItems:'center',justifyContent:'center',backgroundColor:c.primary,opacity:busy||!items.length?.45:1}}>{busy?<ActivityIndicator color={c.textInverse}/>:<Ionicons name="send" size={22} color={c.textInverse}/>}</Pressable></View>
    {multiple&&<ScrollView keyboardShouldPersistTaps="handled" ref={thumbs} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{items.map((item,i)=><Pressable key={item.id} accessibilityRole="button" accessibilityLabel={t("Select attachment {0}",{0:i+1})} accessibilityState={{selected:i===index,disabled:busy}} disabled={busy} onPress={()=>select(i)} style={{width:60,height:60,borderRadius:14,overflow:'hidden',borderWidth:2,borderColor:i===index?c.primary:c.neonBorder,backgroundColor:c.surface,alignItems:'center',justifyContent:'center'}}>{item.kind==='image'?<Image source={{uri:item.uri}} contentFit="cover" style={{width:'100%',height:'100%'}}/>:item.kind==='video'&&videoFrames[item.uri]?<><Image source={{uri:videoFrames[item.uri]!}} contentFit="cover" cachePolicy="none" style={{position:'absolute',width:'100%',height:'100%'}}/><View style={{backgroundColor:'#0009',borderRadius:14,padding:3}}><Ionicons name="play" size={18} color="#fff"/></View></>:<Ionicons name={item.kind==='video'?'videocam-outline':'document-outline'} size={26} color={c.primary}/>}</Pressable>)}</ScrollView>}
   </View>
   {editingItem&&<PhotoEditor key={editingItem.id+editingItem.uri} uri={editingItem.uri} floatingTools onClose={()=>setEditing(undefined)} onSave={image=>{onUpdate(editingItem.id,{...image,name:editingItem.name.replace(/\.[^.]+$/,'')+'.jpg',mimeType:'image/jpeg',size:undefined});setEditing(undefined);}}/>}
  </KeyboardAvoidingScreen>
 </Modal>;
}
