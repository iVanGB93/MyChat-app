import type {MediaStream,MediaStreamTrack,RTCRtpSender} from 'react-native-webrtc';

/** Replaces only the existing video sender; microphone and call transport stay owned by the call. */
export function createCallScreenShare(d:{
 acquire():Promise<MediaStream>;camera():MediaStreamTrack|undefined;sender():RTCRtpSender|undefined;
 preview(stream:MediaStream|null):void;changed(sharing:boolean,busy:boolean):void;error(error:unknown):void;
}){
 let closed=false,epoch=0,sharing=false,busy=false,stream:MediaStream|null=null,camera:MediaStreamTrack|undefined,cameraEnabled=true;
 let tail:Promise<unknown>=Promise.resolve();
 const serial=<T>(work:()=>Promise<T>)=>{const next=tail.then(work);tail=next.catch(()=>{});return next;};
 const dispose=(value:MediaStream|null)=>{if(value){value.getTracks().forEach(t=>t.stop());value.release();}};
 const changed=()=>{if(!closed)d.changed(sharing,busy);};
 const ended=()=>{void stop().catch(d.error);};
 const release=()=>{const track=stream?.getVideoTracks()[0];if(track)(track as MediaStreamTrack & {onended:(()=>void)|null}).onended=null;const old=stream;stream=null;dispose(old);};
 const stop=()=>{epoch++;return serial(async()=>{
  if(closed||!sharing)return;
  busy=true;changed();
  try{
   try{
    const sender=d.sender();if(!sender||!camera)throw Error('Camera unavailable.');
    await sender.replaceTrack(camera);
    if(sender.track?.id!==camera.id)throw Error('Camera track was not restored.');
   }finally{
    if(!closed){if(camera)camera.enabled=cameraEnabled;sharing=false;d.preview(null);release();}
   }
  }finally{busy=false;changed();}
 });};
 return {
  start(){if(closed||sharing||busy)return Promise.resolve();busy=true;const own=++epoch;changed();return serial(async()=>{
   let acquired:MediaStream|null=null;
   try{
    const sender=d.sender(),original=d.camera();if(!sender||!original)throw Error('Wait for the video call to connect before sharing.');
    acquired=await d.acquire();
    if(closed||epoch!==own){dispose(acquired);acquired=null;return;}
    const track=acquired.getVideoTracks()[0];if(!track||track.readyState==='ended')throw Error('Screen capture is unavailable.');
    await sender.replaceTrack(track);
    if(sender.track?.id!==track.id)throw Error('Screen track was not attached.');
    if(closed){dispose(acquired);acquired=null;return;}
    camera=original;cameraEnabled=original.enabled;original.enabled=false;
    stream=acquired;acquired=null;sharing=true;
    (track as MediaStreamTrack & {onended:(()=>void)|null}).onended=ended;d.preview(stream);if(track.readyState==='ended')ended();
   }catch(error){dispose(acquired);throw error;}
   finally{busy=false;changed();}
  });},
  stop,
  active:()=>sharing||busy,
  close(){closed=true;epoch++;release();},
 };
}
