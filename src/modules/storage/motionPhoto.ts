import {File,Paths} from 'expo-file-system';
import {Platform} from 'react-native';
import {isSharedMediaUri,SharedMediaFile} from '../../services/identity/sharedMediaFile';
import {findMotionPhotoClip,type MotionPhotoClip} from './motionPhotoFormat';

const mediaFile=(uri:string)=>isSharedMediaUri(uri)?new SharedMediaFile(uri):new File(uri);
const supportedMime=/^image\/(jpeg|heic|heif|avif)$/i;
const inspected=new Map<string,{size:number;clip:MotionPhotoClip|undefined}>();

export function readMotionPhoto(uri:string,mime:string):MotionPhotoClip|undefined{
 if(Platform.OS!=='android'||!supportedMime.test(mime))return;
 try{
  const file=mediaFile(uri),size=file.size??0;
  if(!size)return;
  const known=inspected.get(uri);
  if(known?.size===size)return known.clip;
  const handle=file.open();
  try{
   const clip=findMotionPhotoClip((offset,length)=>{handle.offset=offset;return handle.readBytes(length);},size);
   if(inspected.size>=256)inspected.delete(inspected.keys().next().value!);
   inspected.set(uri,{size,clip});
   return clip;
  }finally{handle.close();}
 }catch{/* An unavailable or unrecognized original still displays as a photo. */}
}

/** Extract on demand for Android's existing video viewer. Keep one original in Gallery. */
export async function withMotionPhotoVideo(uri:string,clip:MotionPhotoClip,play:(videoUri:string)=>Promise<void>,current:()=>boolean){
 const source=mediaFile(uri);
 const file=new File(Paths.cache,`axonic-motion-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
 try{
  file.create();
  const input=source.open();
  try{
   const output=file.open();
   try{
    input.offset=clip.offset;
    for(let remaining=clip.length;remaining>0;){
     if(!current())return;
     const size=Math.min(1024*1024,remaining),bytes=input.readBytes(size);
     if(bytes.length!==size)throw Error('Motion photo clip was incomplete');
     output.writeBytes(bytes);remaining-=size;
     if(remaining)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
   }finally{output.close();}
  }finally{input.close();}
  if(current())await play(file.uri);
 }finally{try{if(file.exists)file.delete();}catch{/* Cache cleanup is best effort. */}}
}
