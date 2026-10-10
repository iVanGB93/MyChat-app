import {Platform,Linking} from 'react-native';
import {File} from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
export async function openAttachmentPreview(uri:string,mime:string){
 if(Platform.OS==='android')await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:uri.startsWith('content:')?uri:new File(uri).contentUri,type:mime,flags:1});
 else await Linking.openURL(uri);
}
