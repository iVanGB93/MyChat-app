import {requireOptionalNativeModule} from 'expo';
import {NativeModules} from 'react-native';
// Older Dev clients must not open a capture session without the Android service permission.
export const callScreenCaptureAvailable=requireOptionalNativeModule<{callScreenSharingAvailable?:boolean}>('AxonicAppUpdate')?.callScreenSharingAvailable===true;
export async function excludeScreenControls(trackId:string,fraction:number){
 const native=NativeModules.WebRTCModule;
 if(typeof native?.mediaStreamTrackSetScreenExcludedBottom!=='function')throw Error('Update Axonic Dev to hide sharing controls from capture.');
 if(!Number.isFinite(fraction)||fraction<0||fraction>0.45)throw Error('Invalid screen controls size');
 await native.mediaStreamTrackSetScreenExcludedBottom(trackId,fraction);
}
