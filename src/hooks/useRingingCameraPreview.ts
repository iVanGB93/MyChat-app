import {useEffect,useState} from 'react';
import {AppState} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {localAccount} from '../modules/identity';
import {callCameraPreview} from '../services/callCameraPreview';
export default function useRingingCameraPreview(id:string|undefined,enabled:boolean){
 const [url,setUrl]=useState<{id:string;url:string}|null>(null),[foreground,setForeground]=useState(AppState.currentState==='active');
 useEffect(()=>{const off=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>off.remove();},[]);
 useEffect(()=>{
  setUrl(null);if(!id||!enabled||!foreground)return;
  let active=true;const owner=localAccount.status().account;
  const allowed=()=>active&&AppState.currentState==='active'&&!!owner&&localAccount.status().state==='unlocked'&&localAccount.status().account===owner;
  // Never open a permission prompt just because an incoming call arrived.
  void ImagePicker.getCameraPermissionsAsync().then(permission=>permission.granted&&allowed()?callCameraPreview.start(id,allowed):null)
   .then(stream=>{if(stream&&allowed())setUrl({id,url:stream.toURL()});}).catch(()=>{});
  return()=>{active=false;void callCameraPreview.stop(id);};
 },[id,enabled,foreground]);
 return enabled&&foreground&&url&&url.id===id?url.url:null;
}
