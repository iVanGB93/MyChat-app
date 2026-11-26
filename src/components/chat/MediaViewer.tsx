import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Modal,Pressable,Text,View,useWindowDimensions} from 'react-native';
import {Image} from 'expo-image';
import {File} from 'expo-file-system';
import {Ionicons} from '@expo/vector-icons';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Chrome} from '../../theme';
import {useTheme} from '../../contexts/ThemeContext';
import {t} from '../../localization/language';
import {localAccount} from '../../modules/identity';
import {selectedVideoThumbnail} from '../../modules/storage';
import {openAttachmentPreview} from '../../modules/ui/openAttachmentPreview';
import ScreenHeader from '../ui/ScreenHeader';
import StatusBarFade from '../ui/StatusBarFade';
import {KeyboardAvoidingScreen,KeyboardAwareTextInput} from '../ui/KeyboardForm';
import PhotoEditor from './photo-editor';
import ZoomablePhotoPreview from './ZoomablePhotoPreview';
import {useAttachmentFile,useAttachmentPreview} from './useAttachmentFile';

export interface PreviewItem {
 id:string;uri:string;name:string;kind:'image'|'video'|'file';caption?:string;
 width?:number;height?:number;mimeType?:string;size?:number;
}
type LocalViewerFile={owner:string;fileKey:string;previewKey?:string;delivery:string;downloadUntil?:number};
export type MediaViewerItem=PreviewItem|(Omit<PreviewItem,'uri'>&{local:LocalViewerFile});
type Review={
 onRemove(id:string):void;onSend():void;onUpdate(id:string,changes:Partial<PreviewItem>):void;destination?:string;
};
const thumbSize=60,thumbStride=68;
const fileSize=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${(n/1024).toFixed(1)} KB`:`${n} B`;

function useViewerUri(item:MediaViewerItem){
 const local='local' in item?item.local:null;
 const file=useAttachmentFile(local?.owner??null,local?.fileKey,local?.delivery);
 return 'uri' in item?item.uri:file?.uri;
}

function useViewerPreview(item:MediaViewerItem){
 const local='local' in item?item.local:null;
 return useAttachmentPreview(local?.owner??null,local?.previewKey);
}

function useVideoFrame(uri:string|undefined,read:(uri:string)=>Promise<string|null>){
 const [frame,setFrame]=useState<{uri:string;image:string|null}>();
 useEffect(()=>{
  if(!uri)return;
  let active=true;
  void read(uri).then(image=>{if(active)setFrame({uri,image});});
  return()=>{active=false;};
 },[uri,read]);
 return frame&&frame.uri===uri?frame.image:null;
}

function MediaSlide({item,active,busy,frameFor,onZoomChange}:{
 item:MediaViewerItem;active:boolean;busy:boolean;frameFor:(uri:string)=>Promise<string|null>;onZoomChange(value:boolean):void;
}){
 const {colors}=useTheme(),uri=useViewerUri(item),preview=useViewerPreview(item);
 const frame=useVideoFrame(item.kind==='video'&&active&&!preview?uri:undefined,frameFor)??(item.kind==='video'?preview:null);
 const [failed,setFailed]=useState<string>();
 const unavailable=!uri||failed===uri;
 const error=t(uri?'Preview unavailable':'Not available on this device');
 if(item.kind==='image'&&uri)return <>
  <ZoomablePhotoPreview uri={uri} active={active} onZoomChange={onZoomChange} onError={()=>setFailed(uri)}/>
  {unavailable&&<Text accessibilityRole="alert" style={{position:'absolute',alignSelf:'center',color:colors.text,backgroundColor:colors.surface,padding:12,borderRadius:16}}>{error}</Text>}
 </>;
 if(!uri&&'local' in item&&(item.local.downloadUntil??0)>Date.now()){
  return <View style={{flex:1,justifyContent:'center',alignItems:'center',gap:12}}>
   {!!preview&&<Image source={{uri:preview}} contentFit="contain" style={{position:'absolute',width:'100%',height:'100%'}}/>}
   <View style={{backgroundColor:colors.surface,padding:12,borderRadius:16,flexDirection:'row',alignItems:'center',gap:8}}>
    <ActivityIndicator color={colors.primary}/><Text style={{color:colors.text}}>{t("Downloading")}</Text>
   </View>
  </View>;
 }
 const video=item.kind==='video';
 async function open(){
  if(!uri||busy)return;
  if('local' in item){const status=localAccount.status();if(status.state!=='unlocked'||status.account!==item.local.owner)return;}
  try{await openAttachmentPreview(uri,item.mimeType||(video?'video/mp4':'application/octet-stream'));}
  catch{setFailed(uri);}
 }
 return <Pressable accessibilityRole="button" accessibilityLabel={t(video?'Play video':'Preview attachment')} disabled={!uri||busy} onPress={()=>void open()} style={{flex:video?1:undefined,justifyContent:'center',alignItems:'center',gap:16,padding:24}}>
  {!!frame&&<Image source={{uri:frame}} contentFit="contain" cachePolicy="none" style={{position:'absolute',width:'100%',height:'100%'}}/>}
  <View style={frame?{backgroundColor:'#0009',borderRadius:40,padding:4}:undefined}>
   <Ionicons name={video?'play-circle-outline':item.kind==='image'?'image-outline':'document-text-outline'} size={64} color={colors.primary}/>
  </View>
  {!frame&&<Text numberOfLines={2} style={{color:colors.text}}>{video?t('Video'):item.name}</Text>}
  {(unavailable||!frame)&&<Text style={{color:colors.textSecondary}}>{unavailable?error:t('Tap to preview')}</Text>}
 </Pressable>;
}

function MediaThumb({item,index,selected,busy,onPress,frameFor}:{
 item:MediaViewerItem;index:number;selected:boolean;busy:boolean;onPress():void;frameFor:(uri:string)=>Promise<string|null>;
}){
 const {colors}=useTheme(),uri=useViewerUri(item),preview=useViewerPreview(item),frame=useVideoFrame(item.kind==='video'&&!preview?uri:undefined,frameFor);
 return <Pressable accessibilityRole="button" accessibilityLabel={t('Select attachment {0}',{0:index+1})} accessibilityState={{selected,disabled:busy}} disabled={busy} onPress={onPress} style={{width:thumbSize,height:thumbSize,marginRight:thumbStride-thumbSize,borderRadius:14,overflow:'hidden',borderWidth:2,borderColor:selected?colors.primary:colors.neonBorder,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'}}>
  {preview?<Image source={{uri:preview}} recyclingKey={preview} contentFit="cover" style={{width:'100%',height:'100%'}}/>:item.kind==='image'&&uri?<Image source={{uri}} recyclingKey={uri} allowDownscaling cachePolicy="memory" contentFit="cover" style={{width:'100%',height:'100%'}}/>:frame?<><Image source={{uri:frame}} contentFit="cover" cachePolicy="none" style={{position:'absolute',width:'100%',height:'100%'}}/><View style={{backgroundColor:'#0009',borderRadius:14,padding:3}}><Ionicons name="play" size={18} color="#fff"/></View></>:<Ionicons name={item.kind==='video'?'videocam-outline':item.kind==='image'?'image-outline':'document-outline'} size={26} color={colors.primary}/>}
 </Pressable>;
}

/** Shared read-only and review viewer. Media is resolved only for mounted pages and thumbnails. */
export default function MediaViewer({items,initialId,visible=true,busy=false,review,older,onClose}:{
 items:readonly MediaViewerItem[];initialId?:string;visible?:boolean;busy?:boolean;review?:Review;
 older?:{loading:boolean;error?:string;load():void};onClose():void;
}){
 const {colors:c}=useTheme(),insets=useSafeAreaInsets(),window=useWindowDimensions();
 const [selected,setSelected]=useState(initialId??items[0]?.id),[editing,setEditing]=useState<string>(),[pageWidth,setPageWidth]=useState(window.width);
 const [zoomed,setZoomed]=useState<string>(),[size,setSize]=useState<{uri:string;bytes:number}>();
 const pager=useRef<FlatList<MediaViewerItem>>(null),thumbs=useRef<FlatList<MediaViewerItem>>(null);
 const index=Math.max(0,items.findIndex(item=>item.id===selected)),current=items[index],multiple=items.length>1;
 const editingItem=items.find(item=>item.id===editing);
 const [frameFor]=useState(()=>{
  const cache=new Map<string,Promise<string|null>>();
  return (uri:string)=>{
   const existing=cache.get(uri);
   if(existing)return existing;
   if(cache.size>=20)cache.delete(cache.keys().next().value!);
   const pending=selectedVideoThumbnail(uri);cache.set(uri,pending);return pending;
  };
 });
 const scrollThumbs=(at:number,animated:boolean)=>thumbs.current?.scrollToOffset({offset:Math.max(0,at*thumbStride-100),animated});
 const ids=items.map(item=>item.id).join('|');
 useEffect(()=>{
  if(!visible)return;
  if(selected!==current?.id)setSelected(current?.id);
  pager.current?.scrollToOffset({offset:index*pageWidth,animated:false});
  scrollThumbs(index,false);
 },[ids,pageWidth,visible]);
 const currentUri=review&&current&&'uri' in current?current.uri:undefined;
 useEffect(()=>{
  if(!currentUri||current?.size!==undefined)return;
  try{const file=new File(currentUri);if(file.exists)setSize({uri:currentUri,bytes:file.size});}catch{/* Size is optional. */}
 },[currentUri,current?.size]);
 const select=(next:number)=>{
  if(busy||!items[next])return;
  setSelected(items[next].id);setZoomed(undefined);
  pager.current?.scrollToOffset({offset:next*pageWidth,animated:false});scrollThumbs(next,true);
 };
 const close=()=>{if(!busy)onClose();};
 const control=(label:string,icon:React.ComponentProps<typeof Ionicons>['name'],action:()=>void,danger=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={({pressed})=>({width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:c.headerBg,borderWidth:1,borderColor:c.neonBorder,opacity:busy?.45:pressed?.7:1})}><Ionicons name={icon} size={22} color={danger?c.error:c.primary}/></Pressable>;
 const bytes=current?.size??(size&&size.uri===currentUri?size.bytes:undefined);
 const Surface=review?KeyboardAvoidingScreen:View;
 const showFooter=!!review||!!current?.caption||!!older||multiple||bytes!==undefined;
 return <Modal visible={visible} animationType={review?'slide':'fade'} statusBarTranslucent={!review} navigationBarTranslucent={!review} onRequestClose={close}>
  <Surface style={{flex:1,backgroundColor:c.background,paddingBottom:review?insets.bottom:0}}>
   {!!review&&<ScreenHeader title={multiple?t('Review photos & files'):current?.kind==='image'?t('Review photo'):t('Review attachment')} backLabel={t('Cancel sharing')} disabled={busy} onBack={close}/>}
   {!!review?.destination&&<Text numberOfLines={1} style={{color:c.textSecondary,marginHorizontal:16,marginBottom:8}}>{t('To')}{' '}{review.destination}</Text>}
   <View style={{flex:1,minHeight:100}} onLayout={event=>setPageWidth(event.nativeEvent.layout.width)}>
    <FlatList ref={pager} horizontal pagingEnabled scrollEnabled={multiple&&!busy&&zoomed!==current?.id} showsHorizontalScrollIndicator={false} data={items} keyExtractor={item=>item.id} extraData={{selected,pageWidth,busy}} initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
     testID="axonic-media-pages" initialScrollIndex={index||undefined} getItemLayout={(_,i)=>({length:pageWidth,offset:pageWidth*i,index:i})}
     onMomentumScrollEnd={event=>{const i=Math.max(0,Math.min(items.length-1,Math.round(event.nativeEvent.contentOffset.x/pageWidth)));setSelected(items[i]?.id);scrollThumbs(i,true);}}
     renderItem={({item})=><View style={{width:pageWidth,height:'100%',paddingHorizontal:review?12:0,justifyContent:'center'}}>
      <MediaSlide item={item} active={item.id===current?.id} busy={busy} frameFor={frameFor} onZoomChange={value=>setZoomed(old=>value?item.id:old===item.id?undefined:old)}/>
     </View>}/>
    {review&&current&&<View pointerEvents="box-none" style={{position:'absolute',top:8,right:24,flexDirection:'row',gap:8}}>
     {current.kind==='image'&&control(t('Edit photo'),'create-outline',()=>setEditing(current.id))}
     {control(t('Remove attachment'),'trash-outline',()=>review.onRemove(current.id),true)}
    </View>}
    {review&&current?.kind==='image'&&<View style={{position:'absolute',bottom:12,left:24,right:24}}><KeyboardAwareTextInput key={current.id} accessibilityLabel={t('Photo caption')} placeholder={t('Add a comment (optional)')} placeholderTextColor={c.textSecondary} value={current.caption||''} onChangeText={caption=>review.onUpdate(current.id,{caption})} editable={!busy} multiline maxLength={1600} style={{color:c.text,backgroundColor:c.surface,borderWidth:1,borderColor:c.neonBorder,borderRadius:Chrome.controlRadius,paddingHorizontal:16,paddingVertical:12,minHeight:48,maxHeight:100}}/></View>}
   </View>
   {!review&&<>
    <StatusBarFade/>
    <View pointerEvents="box-none" style={{position:'absolute',top:insets.top+8,left:insets.left+Chrome.gutter}}>
     {control(t('Close media viewer'),'arrow-back',close)}
    </View>
   </>}
   {showFooter&&<View pointerEvents="box-none" style={[{paddingHorizontal:16,paddingVertical:8,gap:8},!review&&{
    position:'absolute',bottom:Math.max(insets.bottom,8)+6,left:insets.left+Chrome.gutter,right:insets.right+Chrome.gutter,
    borderRadius:Chrome.cardRadius,backgroundColor:c.headerBg+'EB',
   }]}>
    {!review&&!!current?.caption&&<Text numberOfLines={3} style={{color:c.text}}>{current.caption}</Text>}
    {!!older?.error&&<Text accessibilityRole="alert" style={{color:c.error}}>{older.error}</Text>}
    <View pointerEvents="box-none" style={{flexDirection:'row',alignItems:'center',gap:12}}>
     <Text style={{color:c.textSecondary,flex:1}}>{bytes===undefined?(review?t('Size unavailable'):null):fileSize(bytes)}</Text>
     {multiple&&<Text accessibilityLiveRegion="polite" style={{color:c.textSecondary}}>{index+1} / {items.length}</Text>}
     {older&&<Pressable accessibilityRole="button" disabled={older.loading} onPress={older.load} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:c.primary}}>{t(older.loading?'Loading older messages...':'Load older media')}</Text></Pressable>}
     {review&&<Pressable accessibilityRole="button" accessibilityLabel={t('Send attachments')} disabled={busy||!items.length||!!editingItem} onPress={review.onSend} style={{minHeight:44,minWidth:60,paddingHorizontal:16,paddingVertical:10,borderRadius:Chrome.controlRadius,alignItems:'center',justifyContent:'center',backgroundColor:c.primary,opacity:busy||!items.length?.45:1}}>{busy?<ActivityIndicator color={c.textInverse}/>:<Ionicons name="send" size={22} color={c.textInverse}/>}</Pressable>}
    </View>
    {multiple&&<FlatList testID="axonic-media-thumbnails" ref={thumbs} keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} data={items} keyExtractor={item=>item.id} extraData={{selected,busy}} initialNumToRender={7} maxToRenderPerBatch={6} windowSize={3}
     initialScrollIndex={index>2?index-2:undefined} getItemLayout={(_,i)=>({length:thumbStride,offset:thumbStride*i,index:i})}
     renderItem={({item,index:i})=><MediaThumb item={item} index={i} selected={i===index} busy={busy} onPress={()=>select(i)} frameFor={frameFor}/>}/>}
   </View>}
   {review&&editingItem&&'uri' in editingItem&&<PhotoEditor key={editingItem.id+editingItem.uri} uri={editingItem.uri} floatingTools onClose={()=>setEditing(undefined)} onSave={image=>{review.onUpdate(editingItem.id,{...image,name:editingItem.name.replace(/\.[^.]+$/,'')+'.jpg',mimeType:'image/jpeg',size:undefined});setEditing(undefined);}}/>}
  </Surface>
 </Modal>;
}
