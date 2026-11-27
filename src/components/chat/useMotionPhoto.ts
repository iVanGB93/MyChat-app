import {useEffect,useState} from 'react';
import {readMotionPhoto} from '../../modules/storage';

export function useMotionPhoto(uri:string|undefined,mime:string|undefined){
 const [result,setResult]=useState<{uri:string;mime:string;clip:ReturnType<typeof readMotionPhoto>}>();
 useEffect(()=>{
  if(!uri||!mime||!/^image\/(jpeg|heic|heif|avif)$/i.test(mime))return;
  const clip=readMotionPhoto(uri,mime);
  if(clip)setResult({uri,mime,clip});
 },[uri,mime]);
 return result&&result.uri===uri&&result.mime===mime?result.clip:undefined;
}
