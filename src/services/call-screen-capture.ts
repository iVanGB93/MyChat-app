import {requireOptionalNativeModule} from 'expo';
// Older Dev clients must not open a capture session without the Android service permission.
export const callScreenCaptureAvailable=requireOptionalNativeModule<{callScreenSharingAvailable?:boolean}>('AxonicAppUpdate')?.callScreenSharingAvailable===true;
